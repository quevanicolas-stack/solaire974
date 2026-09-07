"""Tests de construction du prompt par espèce."""

import pytest

from app.services.generateur_prompt import ErreurTemplatePrompt, construire_prompt

TEMPLATES_TEST = {
    "chien": {
        "style_defaut": "aquarelle",
        "gabarit": "Portrait de {prenom}, un {espece}, style {style}, avec {objet_prefere}. {note_identite}.",
    },
    "autre": {
        "style_defaut": "peinture",
        "gabarit": "Portrait de {prenom}, {espece}, style {style}, avec {objet_prefere}. {note_identite}.",
    },
}


def test_construire_prompt_utilise_le_gabarit_de_lespece():
    resultat = construire_prompt(
        espece="chien",
        espece_autre=None,
        prenom="Nala",
        objet_prefere="sa balle",
        note_identite="tache noire",
        templates=TEMPLATES_TEST,
    )
    assert resultat["template_utilise"] == "chien"
    assert "Nala" in resultat["prompt_texte"]
    assert "aquarelle" in resultat["prompt_texte"]


def test_construire_prompt_espece_inconnue_retombe_sur_autre():
    resultat = construire_prompt(
        espece="autre",
        espece_autre="furet",
        prenom="Kiwi",
        objet_prefere="son tunnel",
        note_identite=None,
        templates=TEMPLATES_TEST,
    )
    assert resultat["template_utilise"] == "autre"
    assert "furet" in resultat["prompt_texte"]
    assert "non précisée" in resultat["prompt_texte"]


def test_construire_prompt_style_personnalise_remplace_le_defaut():
    resultat = construire_prompt(
        espece="chien",
        espece_autre=None,
        prenom="Nala",
        objet_prefere="sa balle",
        note_identite="tache noire",
        style="néon cyberpunk",
        templates=TEMPLATES_TEST,
    )
    assert "néon cyberpunk" in resultat["prompt_texte"]
    assert "aquarelle" not in resultat["prompt_texte"]


def test_construire_prompt_espece_sans_gabarit_leve_une_erreur():
    templates_incomplets = {"chien": TEMPLATES_TEST["chien"]}
    with pytest.raises(ErreurTemplatePrompt):
        construire_prompt(
            espece="dragon",
            espece_autre="dragon",
            prenom="Smaug",
            objet_prefere="son trésor",
            note_identite=None,
            templates=templates_incomplets,
        )
