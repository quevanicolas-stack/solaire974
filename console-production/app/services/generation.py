"""Orchestration de la génération : choix de l'adaptateur, collecte des
images de référence, écriture des variantes et de leurs métadonnées."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.config import configuration
from app.services.adaptateurs.base import AdaptateurGeneration, ErreurAdaptateurGeneration
from app.services.adaptateurs.factice import AdaptateurGenerationFactice
from app.services.adaptateurs.local_texte import AdaptateurGenerationLocaleTexte

ADAPTATEURS_DISPONIBLES: dict[str, type[AdaptateurGeneration]] = {
    "factice": AdaptateurGenerationFactice,
    "local_texte": AdaptateurGenerationLocaleTexte,
}


class ErreurGeneration(Exception):
    """Prompt introuvable, adaptateur inconnu, ou échec de génération."""


def obtenir_adaptateur(nom: str | None = None) -> AdaptateurGeneration:
    nom = nom or configuration.adaptateur_generation
    classe = ADAPTATEURS_DISPONIBLES.get(nom)
    if classe is None:
        raise ErreurGeneration(
            f"Adaptateur de génération inconnu : « {nom} ». Disponibles : {', '.join(ADAPTATEURS_DISPONIBLES)}."
        )
    return classe()


def collecter_images_reference(connexion: sqlite3.Connection, commande_numero: str) -> list[Path]:
    """Images de référence pour la génération : extraits vidéo retenus + photos de détail du client."""
    extraits_retenus = connexion.execute(
        "SELECT chemin FROM extraits_images WHERE commande_numero = ? AND retenue = 1", (commande_numero,)
    ).fetchall()
    photos_detail = connexion.execute(
        "SELECT chemin FROM fichiers_sources WHERE commande_numero = ? AND type = 'photo'", (commande_numero,)
    ).fetchall()
    return [Path(ligne["chemin"]) for ligne in [*extraits_retenus, *photos_detail]]


def lancer_generation(
    connexion: sqlite3.Connection,
    *,
    commande_numero: str,
    prompt_id: int,
    nb_variantes: int,
) -> list[int]:
    ligne_prompt = connexion.execute(
        "SELECT * FROM prompts_historique WHERE id = ? AND commande_numero = ?",
        (prompt_id, commande_numero),
    ).fetchone()
    if ligne_prompt is None:
        raise ErreurGeneration("Prompt introuvable pour cette commande.")

    images_reference = collecter_images_reference(connexion, commande_numero)
    dossier_sortie = configuration.dossier_commandes / commande_numero / "variantes"
    parametres = {"nb_variantes": nb_variantes}

    adaptateur = obtenir_adaptateur()
    try:
        resultats = adaptateur.generer(ligne_prompt["prompt_texte"], images_reference, parametres, dossier_sortie)
    except ErreurAdaptateurGeneration as erreur:
        raise ErreurGeneration(str(erreur)) from erreur

    horodatage = datetime.now(timezone.utc).isoformat()
    ids_crees = []
    for resultat in resultats:
        curseur = connexion.execute(
            """
            INSERT INTO variantes (commande_numero, prompt_id, chemin, seed, parametres_json, horodatage)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                commande_numero,
                prompt_id,
                str(resultat["chemin"]),
                resultat["seed"],
                json.dumps(parametres, ensure_ascii=False),
                horodatage,
            ),
        )
        ids_crees.append(curseur.lastrowid)
    return ids_crees
