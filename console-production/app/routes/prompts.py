"""Prévisualisation et historique du prompt de génération d'une commande."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.db import obtenir_connexion
from app.services.generateur_prompt import ErreurTemplatePrompt, construire_prompt

routeur = APIRouter(prefix="/commandes/{numero}/prompt")
templates = Jinja2Templates(directory="app/templates")


def _construire_pour_commande(commande, style: str | None) -> dict:
    return construire_prompt(
        espece=commande["espece"],
        espece_autre=commande["espece_autre"],
        prenom=commande["prenom_animal"],
        objet_prefere=commande["objet_prefere"],
        note_identite=commande["note_identite"],
        style=style or None,
    )


@routeur.get("")
def afficher_page_prompt(request: Request, numero: str, style: str = ""):
    with obtenir_connexion() as connexion:
        commande = connexion.execute("SELECT * FROM commandes WHERE numero = ?", (numero,)).fetchone()
        historique = connexion.execute(
            "SELECT * FROM prompts_historique WHERE commande_numero = ? ORDER BY horodatage DESC", (numero,)
        ).fetchall()

    apercu, erreur = None, None
    try:
        apercu = _construire_pour_commande(commande, style)
    except ErreurTemplatePrompt as e:
        erreur = str(e)

    return templates.TemplateResponse(
        request,
        "prompt.html",
        {"commande": commande, "historique": historique, "apercu": apercu, "style": style, "erreur": erreur},
    )


@routeur.post("/enregistrer")
def enregistrer_prompt(numero: str, style: str = Form("")):
    with obtenir_connexion() as connexion:
        commande = connexion.execute("SELECT * FROM commandes WHERE numero = ?", (numero,)).fetchone()
        resultat = _construire_pour_commande(commande, style)
        connexion.execute(
            """
            INSERT INTO prompts_historique (commande_numero, template_utilise, variables_json, prompt_texte, horodatage)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                numero,
                resultat["template_utilise"],
                json.dumps(resultat["variables"], ensure_ascii=False),
                resultat["prompt_texte"],
                datetime.now(timezone.utc).isoformat(),
            ),
        )
    return RedirectResponse(f"/commandes/{numero}/prompt", status_code=303)
