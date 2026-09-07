"""Interrogation automatique du site à intervalle configurable.

Désactivée par défaut : rien ne se déclenche tant que l'utilisateur
n'a pas explicitement activé le polling depuis l'interface.
"""

from __future__ import annotations

import asyncio
import sqlite3
from datetime import datetime, timedelta, timezone

from app.db import obtenir_connexion
from app.services.client_ingestion import executer_cycle_ingestion

INTERVALLE_VERIFICATION_SECONDES = 30


def lire_etat_polling(connexion: sqlite3.Connection) -> dict:
    lignes = connexion.execute(
        "SELECT cle, valeur FROM etat_ingestion WHERE cle IN ('polling_actif', 'polling_intervalle_minutes', 'derniere_execution')"
    ).fetchall()
    valeurs = {ligne["cle"]: ligne["valeur"] for ligne in lignes}
    return {
        "actif": valeurs.get("polling_actif") == "1",
        "intervalle_minutes": int(valeurs.get("polling_intervalle_minutes") or 5),
        "derniere_execution": valeurs.get("derniere_execution"),
    }


def enregistrer_etat_polling(connexion: sqlite3.Connection, *, actif: bool, intervalle_minutes: int) -> None:
    for cle, valeur in (
        ("polling_actif", "1" if actif else "0"),
        ("polling_intervalle_minutes", str(intervalle_minutes)),
    ):
        connexion.execute(
            "INSERT INTO etat_ingestion (cle, valeur) VALUES (?, ?) "
            "ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
            (cle, valeur),
        )


def _enregistrer_derniere_execution(connexion: sqlite3.Connection, horodatage: str) -> None:
    connexion.execute(
        "INSERT INTO etat_ingestion (cle, valeur) VALUES ('derniere_execution', ?) "
        "ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
        (horodatage,),
    )


async def boucle_polling() -> None:
    """Tâche de fond : vérifie régulièrement si un cycle d'ingestion est dû."""
    while True:
        await asyncio.sleep(INTERVALLE_VERIFICATION_SECONDES)
        try:
            with obtenir_connexion() as connexion:
                etat = lire_etat_polling(connexion)
                if not etat["actif"]:
                    continue
                if etat["derniere_execution"]:
                    derniere = datetime.fromisoformat(etat["derniere_execution"])
                    prochaine = derniere + timedelta(minutes=etat["intervalle_minutes"])
                    if datetime.now(timezone.utc) < prochaine:
                        continue
                executer_cycle_ingestion(connexion)
                _enregistrer_derniere_execution(connexion, datetime.now(timezone.utc).isoformat())
        except Exception:
            # Une erreur de cycle ne doit jamais arrêter la boucle de polling.
            continue
