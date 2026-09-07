"""Construction du prompt de génération à partir des templates par espèce.

Les templates vivent dans config/templates_prompts.yaml, jamais en dur
dans le code : les morphologies diffèrent d'une espèce à l'autre, le
gabarit chien n'est pas le gabarit chat.
"""

from __future__ import annotations

from pathlib import Path

import yaml

CHEMIN_TEMPLATES = Path(__file__).resolve().parent.parent.parent / "config" / "templates_prompts.yaml"


class ErreurTemplatePrompt(Exception):
    """Fichier de templates absent, mal formé, ou espèce sans gabarit."""


def charger_templates(chemin: Path | None = None) -> dict:
    chemin = chemin or CHEMIN_TEMPLATES
    if not chemin.exists():
        raise ErreurTemplatePrompt(f"Fichier de templates introuvable : {chemin}")
    with open(chemin, encoding="utf-8") as fichier:
        contenu = yaml.safe_load(fichier)
    if not contenu:
        raise ErreurTemplatePrompt(f"Fichier de templates vide : {chemin}")
    return contenu


def construire_prompt(
    *,
    espece: str,
    espece_autre: str | None,
    prenom: str,
    objet_prefere: str,
    note_identite: str | None,
    style: str | None = None,
    templates: dict | None = None,
) -> dict:
    """Rend le prompt final pour une commande. Retourne le template utilisé,
    les variables et le texte, pour permettre son enregistrement tel quel."""
    templates = templates if templates is not None else charger_templates()
    cle_template = espece if espece in templates else "autre"
    if cle_template not in templates:
        raise ErreurTemplatePrompt(f"Aucun gabarit disponible pour l'espèce « {espece} ».")

    gabarit = templates[cle_template]["gabarit"]
    style_final = style or templates[cle_template].get("style_defaut", "")
    variables = {
        "prenom": prenom,
        "espece": espece_autre if (espece == "autre" and espece_autre) else espece,
        "objet_prefere": objet_prefere,
        "note_identite": note_identite or "non précisée",
        "style": style_final,
    }
    return {
        "template_utilise": cle_template,
        "variables": variables,
        "prompt_texte": gabarit.format(**variables).strip(),
    }
