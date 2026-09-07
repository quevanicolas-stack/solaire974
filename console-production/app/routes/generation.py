"""Lancement de la génération (adaptateur factice) et consultation des variantes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Form, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import RedirectResponse

from app.config import configuration
from app.db import obtenir_connexion
from app.services.generation import ErreurGeneration, lancer_generation

routeur = APIRouter(prefix="/commandes/{numero}/generation")
templates = Jinja2Templates(directory="app/templates")


def _url_fichier(chemin: str) -> str:
    chemin_relatif = Path(chemin).relative_to(configuration.dossier_commandes)
    return f"/fichiers/commandes/{chemin_relatif.as_posix()}"


def _charger_contexte(connexion, numero: str, erreur: str | None = None) -> dict:
    commande = connexion.execute("SELECT * FROM commandes WHERE numero = ?", (numero,)).fetchone()
    historique_prompts = connexion.execute(
        "SELECT * FROM prompts_historique WHERE commande_numero = ? ORDER BY horodatage DESC", (numero,)
    ).fetchall()
    variantes = [
        {**dict(ligne), "url": _url_fichier(ligne["chemin"])}
        for ligne in connexion.execute(
            "SELECT * FROM variantes WHERE commande_numero = ? ORDER BY horodatage DESC", (numero,)
        ).fetchall()
    ]
    return {
        "commande": commande,
        "historique_prompts": historique_prompts,
        "variantes": variantes,
        "erreur": erreur,
        "adaptateur_actif": configuration.adaptateur_generation,
    }


@routeur.get("")
def afficher_page_generation(request: Request, numero: str):
    with obtenir_connexion() as connexion:
        contexte = _charger_contexte(connexion, numero)
    return templates.TemplateResponse(request, "generation.html", contexte)


@routeur.post("/lancer")
def lancer(request: Request, numero: str, prompt_id: int = Form(...), nb_variantes: int = Form(3)):
    with obtenir_connexion() as connexion:
        try:
            lancer_generation(connexion, commande_numero=numero, prompt_id=prompt_id, nb_variantes=nb_variantes)
        except ErreurGeneration as erreur:
            contexte = _charger_contexte(connexion, numero, erreur=str(erreur))
            return templates.TemplateResponse(request, "generation.html", contexte)
    return RedirectResponse(f"/commandes/{numero}/generation", status_code=303)
