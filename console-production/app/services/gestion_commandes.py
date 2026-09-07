"""Création des commandes et de leur arborescence sur disque.

Utilisé aussi bien par le mode manuel (formulaire local) que par le
module d'ingestion (commandes récupérées depuis le site).
"""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.config import configuration
from app.modeles import ESPECES, FORMATS

SOUS_DOSSIERS = ("sources", "extraits", "variantes", "livrables")


class ErreurValidationCommande(ValueError):
    """Levée quand les champs d'une commande sont invalides."""


def _horodatage() -> str:
    return datetime.now(timezone.utc).isoformat()


def generer_numero_manuel(connexion: sqlite3.Connection, aujourd_hui: datetime | None = None) -> str:
    """Génère un numéro MAN-{AAAAMMJJ}-{compteur}, unique par jour."""
    aujourd_hui = aujourd_hui or datetime.now(timezone.utc)
    prefixe = f"MAN-{aujourd_hui:%Y%m%d}-"
    ligne = connexion.execute(
        "SELECT COUNT(*) AS total FROM commandes WHERE numero LIKE ?",
        (f"{prefixe}%",),
    ).fetchone()
    compteur = ligne["total"] + 1
    return f"{prefixe}{compteur:02d}"


def valider_champs_commande(
    prenom_animal: str,
    espece: str,
    espece_autre: str | None,
    objet_prefere: str,
    format_choisi: str,
) -> None:
    if not prenom_animal.strip():
        raise ErreurValidationCommande("Le prénom de l'animal est obligatoire.")
    if espece not in ESPECES:
        raise ErreurValidationCommande(f"Espèce inconnue : {espece}.")
    if espece == "autre" and not (espece_autre or "").strip():
        raise ErreurValidationCommande("Merci de préciser l'espèce dans le champ libre.")
    if not objet_prefere.strip():
        raise ErreurValidationCommande("L'objet préféré de l'animal est obligatoire.")
    if format_choisi not in FORMATS:
        raise ErreurValidationCommande(f"Format inconnu : {format_choisi}.")


def creer_dossiers_commande(numero: str) -> Path:
    """Crée l'arborescence commandes/{numero}/{sources,extraits,variantes,livrables}."""
    dossier_commande = configuration.dossier_commandes / numero
    for sous_dossier in SOUS_DOSSIERS:
        (dossier_commande / sous_dossier).mkdir(parents=True, exist_ok=True)
    return dossier_commande


def creer_commande(
    connexion: sqlite3.Connection,
    *,
    numero: str,
    prenom_animal: str,
    espece: str,
    espece_autre: str | None,
    objet_prefere: str,
    note_identite: str | None,
    format_choisi: str,
    origine: str,
) -> None:
    """Insère la commande en base et crée son arborescence sur disque.

    Ne gère pas les fichiers source : voir `enregistrer_fichier_source`.
    """
    valider_champs_commande(prenom_animal, espece, espece_autre, objet_prefere, format_choisi)
    creer_dossiers_commande(numero)
    horodatage = _horodatage()
    connexion.execute(
        """
        INSERT INTO commandes (
            numero, prenom_animal, espece, espece_autre, objet_prefere,
            note_identite, format, statut, origine, date_creation, date_maj
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'recue', ?, ?, ?)
        """,
        (
            numero,
            prenom_animal.strip(),
            espece,
            (espece_autre or "").strip() or None,
            objet_prefere.strip(),
            (note_identite or "").strip() or None,
            format_choisi,
            origine,
            horodatage,
            horodatage,
        ),
    )
    connexion.execute(
        "INSERT INTO historique_statuts (commande_numero, statut, horodatage) VALUES (?, 'recue', ?)",
        (numero, horodatage),
    )


def calculer_sha256(chemin: Path) -> str:
    hachage = hashlib.sha256()
    with open(chemin, "rb") as fichier:
        for bloc in iter(lambda: fichier.read(1024 * 1024), b""):
            hachage.update(bloc)
    return hachage.hexdigest()


def enregistrer_fichier_source(
    connexion: sqlite3.Connection,
    *,
    commande_numero: str,
    type_fichier: str,
    chemin: Path,
) -> None:
    """Enregistre en base un fichier déjà présent dans sources/, avec sa somme de contrôle."""
    somme_controle = calculer_sha256(chemin)
    connexion.execute(
        """
        INSERT INTO fichiers_sources (commande_numero, type, chemin, somme_controle, taille_octets, recupere_le)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            commande_numero,
            type_fichier,
            str(chemin),
            somme_controle,
            chemin.stat().st_size,
            _horodatage(),
        ),
    )


def enregistrer_photo_objet(
    connexion: sqlite3.Connection,
    *,
    commande_numero: str,
    chemin: Path,
) -> None:
    """La photo de l'objet préféré est facultative et stockée à part (colonne dédiée)."""
    connexion.execute(
        "UPDATE commandes SET photo_objet_chemin = ?, date_maj = ? WHERE numero = ?",
        (str(chemin), _horodatage(), commande_numero),
    )
