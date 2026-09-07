"""Client d'ingestion en mode PULL, conforme à CONTRAT_INGESTION.md.

L'outil interroge le site, jamais l'inverse. Toute la logique de
parsing et de vérification est isolée dans des fonctions pures pour
rester testable sans réseau (voir tests/test_contrat_ingestion.py).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import httpx

from app.config import configuration
from app.services.gestion_commandes import (
    calculer_sha256,
    creer_commande,
    creer_dossiers_commande,
    enregistrer_fichier_source,
    enregistrer_photo_objet,
)


class ErreurIngestion(Exception):
    """Erreur générique d'ingestion."""


class ErreurAuthentification(ErreurIngestion):
    """Jeton absent ou invalide (401)."""


class ErreurCommandeIntrouvable(ErreurIngestion):
    """Commande ou fichier introuvable côté site (404)."""


class ErreurReseau(ErreurIngestion):
    """Erreur transitoire (site injoignable, timeout) : à retenter au cycle suivant."""


class ErreurSommeControle(ErreurIngestion):
    """Le fichier téléchargé ne correspond pas à la somme de contrôle annoncée."""


def creer_client_http() -> httpx.Client:
    if not configuration.url_site or not configuration.jeton_site:
        raise ErreurIngestion(
            "URL_SITE et JETON_SITE doivent être renseignés dans le .env pour interroger le site."
        )
    return httpx.Client(
        base_url=configuration.url_site,
        headers={"Authorization": f"Bearer {configuration.jeton_site}"},
        timeout=30.0,
    )


def extraire_hachage(somme_controle: str) -> str:
    """"sha256:9f86d0..." -> "9f86d0..."."""
    if ":" in somme_controle:
        return somme_controle.split(":", 1)[1]
    return somme_controle


def parser_commande(commande_json: dict[str, Any]) -> dict[str, Any]:
    """Normalise le JSON du contrat en champs directement utilisables par creer_commande.

    Fonction pure, ne touche ni au réseau ni au disque : c'est elle
    que couvrent les tests de parsing du contrat.
    """
    champs_requis = ("numero", "animal", "objet_prefere", "format", "fichiers")
    manquants = [champ for champ in champs_requis if champ not in commande_json]
    if manquants:
        raise ErreurIngestion(f"Commande mal formée, champs manquants : {', '.join(manquants)}")

    animal = commande_json["animal"]
    return {
        "numero": commande_json["numero"],
        "prenom_animal": animal["prenom"],
        "espece": animal["espece"] if animal["espece"] in ("chien", "chat") else "autre",
        "espece_autre": animal["espece"] if animal["espece"] not in ("chien", "chat") else None,
        "objet_prefere": commande_json["objet_prefere"],
        "note_identite": commande_json.get("note_identite"),
        "format_choisi": commande_json["format"],
        "fichiers": commande_json["fichiers"],
    }


def fichier_deja_present(chemin: Path, taille_attendue: int, somme_attendue: str) -> bool:
    """Vrai si un fichier intègre est déjà sur disque : pas besoin de le retélécharger."""
    if not chemin.exists():
        return False
    if chemin.stat().st_size != taille_attendue:
        return False
    return calculer_sha256(chemin) == extraire_hachage(somme_attendue)


def lister_commandes_pretes(
    client: httpx.Client, depuis: str | None = None, limite: int = 20
) -> list[dict[str, Any]]:
    parametres = {"limite": limite}
    if depuis:
        parametres["depuis"] = depuis
    try:
        reponse = client.get("/api/commandes/pretes", params=parametres)
    except httpx.RequestError as erreur:
        raise ErreurReseau(f"Site injoignable : {erreur}") from erreur

    if reponse.status_code == 401:
        raise ErreurAuthentification("Jeton d'ingestion invalide ou expiré.")
    reponse.raise_for_status()
    return reponse.json()["commandes"]


def telecharger_fichier(client: httpx.Client, fichier_json: dict[str, Any], destination: Path) -> Path:
    taille_attendue = fichier_json["taille_octets"]
    somme_attendue = fichier_json["somme_controle"]

    if fichier_deja_present(destination, taille_attendue, somme_attendue):
        return destination

    try:
        reponse = client.get(fichier_json["url"])
    except httpx.RequestError as erreur:
        raise ErreurReseau(f"Téléchargement interrompu : {erreur}") from erreur

    if reponse.status_code == 404:
        raise ErreurCommandeIntrouvable(f"Fichier introuvable : {fichier_json['id']}")
    reponse.raise_for_status()

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(reponse.content)

    if calculer_sha256(destination) != extraire_hachage(somme_attendue):
        destination.unlink(missing_ok=True)
        raise ErreurSommeControle(f"Somme de contrôle invalide pour {fichier_json['nom_fichier']}")

    return destination


def marquer_recuperee(client: httpx.Client, numero: str) -> None:
    try:
        reponse = client.post(f"/api/commandes/{numero}/recuperee")
    except httpx.RequestError as erreur:
        raise ErreurReseau(f"Impossible de confirmer la récupération : {erreur}") from erreur
    if reponse.status_code == 401:
        raise ErreurAuthentification("Jeton d'ingestion invalide ou expiré.")
    if reponse.status_code == 404:
        raise ErreurCommandeIntrouvable(f"Commande introuvable côté site : {numero}")
    reponse.raise_for_status()


def executer_cycle_ingestion(connexion: sqlite3.Connection) -> dict[str, Any]:
    """Lance un cycle complet : liste, télécharge, enregistre, marque récupéré.

    Ne lève pas d'exception pour les erreurs par commande : elles sont
    collectées dans le résumé pour que le cycle continue sur les
    commandes suivantes.
    """
    resume: dict[str, Any] = {"nouvelles": 0, "erreurs": []}

    try:
        client = creer_client_http()
    except ErreurIngestion as erreur:
        resume["erreurs"].append(str(erreur))
        return resume

    with client:
        try:
            commandes = lister_commandes_pretes(client)
        except ErreurIngestion as erreur:
            resume["erreurs"].append(str(erreur))
            return resume

        for commande_json in commandes:
            numero = commande_json.get("numero", "?")
            try:
                _traiter_commande(connexion, client, commande_json)
                resume["nouvelles"] += 1
            except ErreurIngestion as erreur:
                resume["erreurs"].append(f"{numero} : {erreur}")

    return resume


def _traiter_commande(connexion: sqlite3.Connection, client: httpx.Client, commande_json: dict[str, Any]) -> None:
    champs = parser_commande(commande_json)
    numero = champs["numero"]

    deja_connue = connexion.execute(
        "SELECT 1 FROM commandes WHERE numero = ?", (numero,)
    ).fetchone()
    if not deja_connue:
        creer_commande(
            connexion,
            numero=numero,
            prenom_animal=champs["prenom_animal"],
            espece=champs["espece"],
            espece_autre=champs["espece_autre"],
            objet_prefere=champs["objet_prefere"],
            note_identite=champs["note_identite"],
            format_choisi=champs["format_choisi"],
            origine="site",
        )
    dossier_sources = creer_dossiers_commande(numero) / "sources"

    for fichier_json in champs["fichiers"]:
        destination = dossier_sources / fichier_json["nom_fichier"]
        telecharger_fichier(client, fichier_json, destination)
        type_fichier = fichier_json["type"]
        deja_enregistre = connexion.execute(
            "SELECT 1 FROM fichiers_sources WHERE commande_numero = ? AND chemin = ?",
            (numero, str(destination)),
        ).fetchone()
        if deja_enregistre:
            continue
        if type_fichier == "photo_objet":
            enregistrer_photo_objet(connexion, commande_numero=numero, chemin=destination)
        else:
            enregistrer_fichier_source(
                connexion, commande_numero=numero, type_fichier=type_fichier, chemin=destination
            )

    marquer_recuperee(client, numero)
