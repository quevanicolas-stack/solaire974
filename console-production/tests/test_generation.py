"""Tests de l'adaptateur de génération factice et de l'orchestration."""

import sqlite3

import pytest

from app.db import SCHEMA
from app.services.adaptateurs.factice import AdaptateurGenerationFactice
from app.services.generation import ErreurGeneration, obtenir_adaptateur


def test_adaptateur_factice_produit_le_nombre_de_variantes_demande(tmp_path):
    adaptateur = AdaptateurGenerationFactice()
    resultats = adaptateur.generer(
        prompt="Portrait de Nala",
        images_reference=[],
        parametres={"nb_variantes": 3},
        dossier_sortie=tmp_path,
    )
    assert len(resultats) == 3
    for resultat in resultats:
        assert resultat["chemin"].exists()
        assert resultat["seed"]


def test_adaptateur_factice_seeds_sont_differentes(tmp_path):
    adaptateur = AdaptateurGenerationFactice()
    resultats = adaptateur.generer(
        prompt="Portrait de Nala",
        images_reference=[],
        parametres={"nb_variantes": 5},
        dossier_sortie=tmp_path,
    )
    seeds = {r["seed"] for r in resultats}
    assert len(seeds) == 5


def test_obtenir_adaptateur_factice_par_defaut():
    adaptateur = obtenir_adaptateur("factice")
    assert isinstance(adaptateur, AdaptateurGenerationFactice)


def test_obtenir_adaptateur_inconnu_leve_une_erreur():
    with pytest.raises(ErreurGeneration):
        obtenir_adaptateur("fournisseur-qui-nexiste-pas")
