"""Tests de création de commande et de génération de numéro manuel."""

import sqlite3

import pytest

from app.db import SCHEMA
from app.services.gestion_commandes import (
    ErreurValidationCommande,
    creer_commande,
    generer_numero_manuel,
    valider_champs_commande,
)


@pytest.fixture
def connexion(tmp_path, monkeypatch):
    import dataclasses

    from app import config as module_config
    from app.services import gestion_commandes as module_gestion

    nouvelle_configuration = dataclasses.replace(
        module_config.configuration, dossier_commandes=tmp_path / "commandes"
    )
    monkeypatch.setattr(module_gestion, "configuration", nouvelle_configuration)

    connexion = sqlite3.connect(":memory:")
    connexion.row_factory = sqlite3.Row
    connexion.executescript(SCHEMA)
    yield connexion
    connexion.close()


def test_valider_champs_commande_rejette_espece_inconnue():
    with pytest.raises(ErreurValidationCommande):
        valider_champs_commande("Nala", "dragon", None, "balle", "30x40")


def test_valider_champs_commande_exige_precision_si_espece_autre():
    with pytest.raises(ErreurValidationCommande):
        valider_champs_commande("Kiwi", "autre", "", "balle", "30x40")


def test_generer_numero_manuel_incremente_le_compteur_du_jour(connexion):
    from datetime import datetime, timezone

    aujourd_hui = datetime.now(timezone.utc)
    premier = generer_numero_manuel(connexion, aujourd_hui)
    assert premier.endswith("-01")

    creer_commande(
        connexion,
        numero=premier,
        prenom_animal="Nala",
        espece="chien",
        espece_autre=None,
        objet_prefere="sa balle",
        note_identite=None,
        format_choisi="30x40",
        origine="manuelle",
    )

    deuxieme = generer_numero_manuel(connexion, aujourd_hui)
    assert deuxieme.endswith("-02")


def test_creer_commande_cree_larborescence_sur_disque(connexion, tmp_path):
    numero = "MAN-20260907-01"
    creer_commande(
        connexion,
        numero=numero,
        prenom_animal="Nala",
        espece="chien",
        espece_autre=None,
        objet_prefere="sa balle",
        note_identite=None,
        format_choisi="30x40",
        origine="manuelle",
    )
    dossier = tmp_path / "commandes" / numero
    for sous_dossier in ("sources", "extraits", "variantes", "livrables"):
        assert (dossier / sous_dossier).is_dir()

    ligne = connexion.execute("SELECT * FROM commandes WHERE numero = ?", (numero,)).fetchone()
    assert ligne["statut"] == "recue"
    assert ligne["origine"] == "manuelle"
