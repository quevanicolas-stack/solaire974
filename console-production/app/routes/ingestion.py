"""Bouton de récupération manuelle et réglage du polling automatique."""

from __future__ import annotations

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.db import obtenir_connexion
from app.services.client_ingestion import executer_cycle_ingestion
from app.services.planificateur import enregistrer_etat_polling, lire_etat_polling

routeur = APIRouter(prefix="/ingestion")
templates = Jinja2Templates(directory="app/templates")


@routeur.get("")
def afficher_page_ingestion(request: Request, resume: str | None = None):
    with obtenir_connexion() as connexion:
        etat_polling = lire_etat_polling(connexion)
    return templates.TemplateResponse(
        request,
        "ingestion.html",
        {"etat_polling": etat_polling, "resume": resume},
    )


@routeur.post("/executer")
def executer_ingestion_manuelle(request: Request):
    with obtenir_connexion() as connexion:
        resultat = executer_cycle_ingestion(connexion)

    if resultat["erreurs"]:
        message = f"{resultat['nouvelles']} commande(s) récupérée(s), erreurs : {' ; '.join(resultat['erreurs'])}"
    else:
        message = f"{resultat['nouvelles']} commande(s) récupérée(s), aucune erreur."

    return RedirectResponse(f"/ingestion?resume={message}", status_code=303)


@routeur.post("/polling")
def modifier_polling(actif: str = Form("0"), intervalle_minutes: int = Form(5)):
    with obtenir_connexion() as connexion:
        enregistrer_etat_polling(connexion, actif=actif == "1", intervalle_minutes=max(1, intervalle_minutes))
    return RedirectResponse("/ingestion", status_code=303)
