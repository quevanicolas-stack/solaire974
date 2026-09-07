"""Point d'entrée de l'outil interne de production.

Application FastAPI servie en local uniquement, utilisateur unique.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import configuration
from app.db import initialiser_base
from app.routes import commandes, extraction, ingestion, tableau_bord
from app.services.planificateur import boucle_polling


@asynccontextmanager
async def cycle_de_vie(app: FastAPI):
    initialiser_base()
    configuration.dossier_commandes.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/fichiers/commandes",
        StaticFiles(directory=configuration.dossier_commandes),
        name="fichiers_commandes",
    )
    tache_polling = asyncio.create_task(boucle_polling())
    yield
    tache_polling.cancel()


app = FastAPI(title="Console de production — œuvres animalières", lifespan=cycle_de_vie)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(tableau_bord.routeur)
app.include_router(commandes.routeur)
app.include_router(extraction.routeur)
app.include_router(ingestion.routeur)
