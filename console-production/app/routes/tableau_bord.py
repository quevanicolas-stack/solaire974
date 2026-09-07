"""Page d'accueil : liste des commandes."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates

from app.db import obtenir_connexion
from app.modeles import LIBELLES_STATUTS

routeur = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@routeur.get("/")
def afficher_tableau_bord(request: Request):
    with obtenir_connexion() as connexion:
        commandes = connexion.execute(
            "SELECT numero, prenom_animal, espece, statut, origine, date_creation "
            "FROM commandes ORDER BY date_creation DESC"
        ).fetchall()
    return templates.TemplateResponse(
        request,
        "tableau_bord.html",
        {"commandes": commandes, "libelles_statuts": LIBELLES_STATUTS},
    )
