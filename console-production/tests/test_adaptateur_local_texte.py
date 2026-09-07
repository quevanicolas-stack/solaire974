"""Tests de câblage de l'adaptateur de génération local (texte seul).

Ne teste pas l'inférence réelle : nécessiterait torch/diffusers
installés et plusieurs Go de poids de modèle téléchargés. Vérifie
l'enregistrement de l'adaptateur et le message d'erreur explicite
quand les dépendances lourdes ne sont pas installées.
"""

import importlib.util

import pytest

from app.services.adaptateurs.base import ErreurAdaptateurGeneration
from app.services.adaptateurs.local_texte import AdaptateurGenerationLocaleTexte
from app.services.generation import obtenir_adaptateur

TORCH_INSTALLE = importlib.util.find_spec("torch") is not None


def test_obtenir_adaptateur_local_texte_instancie_la_bonne_classe():
    adaptateur = obtenir_adaptateur("local_texte")
    assert isinstance(adaptateur, AdaptateurGenerationLocaleTexte)


@pytest.mark.skipif(
    TORCH_INSTALLE,
    reason="torch est installé : ce test ne vérifie que le message d'erreur en son absence",
)
def test_generer_sans_torch_installe_leve_une_erreur_explicite(tmp_path):
    adaptateur = AdaptateurGenerationLocaleTexte()
    with pytest.raises(ErreurAdaptateurGeneration):
        adaptateur.generer("un prompt de test", [], {"nb_variantes": 1}, tmp_path)
