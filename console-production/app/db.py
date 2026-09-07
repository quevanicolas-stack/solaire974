"""Connexion et initialisation de la base SQLite."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.config import configuration

SCHEMA = """
CREATE TABLE IF NOT EXISTS commandes (
    numero              TEXT PRIMARY KEY,
    prenom_animal       TEXT NOT NULL,
    espece              TEXT NOT NULL,
    espece_autre        TEXT,
    objet_prefere       TEXT NOT NULL,
    photo_objet_chemin  TEXT,
    note_identite       TEXT,
    format              TEXT NOT NULL,
    statut              TEXT NOT NULL DEFAULT 'recue',
    origine             TEXT NOT NULL,
    nb_revisions        INTEGER NOT NULL DEFAULT 0,
    date_creation       TEXT NOT NULL,
    date_maj            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fichiers_sources (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_numero     TEXT NOT NULL REFERENCES commandes(numero),
    type                TEXT NOT NULL,
    chemin              TEXT NOT NULL,
    somme_controle      TEXT NOT NULL,
    taille_octets       INTEGER NOT NULL,
    recupere_le         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extraits_images (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_numero     TEXT NOT NULL REFERENCES commandes(numero),
    source              TEXT NOT NULL,
    chemin              TEXT NOT NULL,
    score_nettete       REAL,
    horodatage_video_s  REAL,
    retenue             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompts_historique (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_numero     TEXT NOT NULL REFERENCES commandes(numero),
    template_utilise    TEXT NOT NULL,
    variables_json      TEXT NOT NULL,
    prompt_texte        TEXT NOT NULL,
    horodatage          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variantes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_numero     TEXT NOT NULL REFERENCES commandes(numero),
    prompt_id           INTEGER NOT NULL REFERENCES prompts_historique(id),
    chemin              TEXT NOT NULL,
    seed                TEXT,
    parametres_json     TEXT,
    horodatage          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS livrables (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_numero     TEXT NOT NULL REFERENCES commandes(numero),
    variante_id         INTEGER NOT NULL REFERENCES variantes(id),
    type                TEXT NOT NULL,
    chemin              TEXT NOT NULL,
    horodatage          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS historique_statuts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_numero     TEXT NOT NULL REFERENCES commandes(numero),
    statut              TEXT NOT NULL,
    horodatage          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions_chronometrage (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_numero     TEXT NOT NULL REFERENCES commandes(numero),
    debut               TEXT NOT NULL,
    fin                 TEXT
);

CREATE TABLE IF NOT EXISTS etat_ingestion (
    cle                 TEXT PRIMARY KEY,
    valeur              TEXT
);
"""


def initialiser_base(chemin: Path | None = None) -> None:
    """Crée le fichier de base et les tables si elles n'existent pas encore."""
    chemin = chemin or configuration.chemin_base_donnees
    chemin.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(chemin) as connexion:
        connexion.executescript(SCHEMA)


@contextmanager
def obtenir_connexion(chemin: Path | None = None) -> Iterator[sqlite3.Connection]:
    """Fournit une connexion SQLite avec les lignes accessibles par nom de colonne."""
    chemin = chemin or configuration.chemin_base_donnees
    connexion = sqlite3.connect(chemin)
    connexion.row_factory = sqlite3.Row
    connexion.execute("PRAGMA foreign_keys = ON")
    try:
        yield connexion
        connexion.commit()
    except Exception:
        connexion.rollback()
        raise
    finally:
        connexion.close()
