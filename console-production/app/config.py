"""Lecture de la configuration depuis le fichier .env.

NOM_MARQUE doit rester modifiable en une seule ligne (le nom de marque
n'est pas encore arrêté) : il ne doit jamais être codé en dur ailleurs
dans l'application.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

RACINE_PROJET = Path(__file__).resolve().parent.parent

load_dotenv(RACINE_PROJET / ".env")


def _chemin_absolu(valeur: str) -> Path:
    chemin = Path(valeur)
    return chemin if chemin.is_absolute() else RACINE_PROJET / chemin


@dataclass(frozen=True)
class Configuration:
    nom_marque: str
    chemin_base_donnees: Path
    dossier_commandes: Path
    url_site: str
    jeton_site: str
    extraction_nb_images: int
    extraction_seuil_nettete: float
    adaptateur_generation: str


def charger_configuration() -> Configuration:
    return Configuration(
        nom_marque=os.getenv("NOM_MARQUE", "À_DEFINIR"),
        chemin_base_donnees=_chemin_absolu(os.getenv("DATABASE_PATH", "data/app.db")),
        dossier_commandes=_chemin_absolu(os.getenv("COMMANDES_DIR", "commandes")),
        url_site=os.getenv("URL_SITE", ""),
        jeton_site=os.getenv("JETON_SITE", ""),
        extraction_nb_images=int(os.getenv("EXTRACTION_NB_IMAGES", "40")),
        extraction_seuil_nettete=float(os.getenv("EXTRACTION_SEUIL_NETTETE", "100.0")),
        adaptateur_generation=os.getenv("ADAPTATEUR_GENERATION", "factice"),
    )


configuration = charger_configuration()
