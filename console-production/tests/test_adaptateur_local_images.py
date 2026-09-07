"""Tests de câblage de l'adaptateur local avec IP-Adapter (photo de référence).

Ne teste pas l'inférence réelle (nécessiterait torch/diffusers/transformers
installés et plusieurs Go de poids). Vérifie l'enregistrement de
l'adaptateur, la sélection de l'image de référence, et le message
d'erreur explicite en l'absence de dépendances ou de référence.
"""

import importlib.util
from pathlib import Path

import pytest

from app.services.adaptateurs.base import ErreurAdaptateurGeneration
from app.services.adaptateurs.local_images import (
    NB_IMAGES_REFERENCE_MAX,
    AdaptateurGenerationLocaleImages,
    choisir_images_reference,
)
from app.services.generation import obtenir_adaptateur

TORCH_INSTALLE = importlib.util.find_spec("torch") is not None


def test_obtenir_adaptateur_local_images_instancie_la_bonne_classe():
    adaptateur = obtenir_adaptateur("local_images")
    assert isinstance(adaptateur, AdaptateurGenerationLocaleImages)


def test_choisir_images_reference_garde_lordre_et_plafonne_au_maximum():
    images = [Path(f"/tmp/photo_{i}.jpg") for i in range(NB_IMAGES_REFERENCE_MAX + 2)]
    resultat = choisir_images_reference(images)
    assert resultat == images[:NB_IMAGES_REFERENCE_MAX]


def test_choisir_images_reference_sans_aucune_image_leve_une_erreur():
    with pytest.raises(ErreurAdaptateurGeneration):
        choisir_images_reference([])


@pytest.mark.skipif(
    TORCH_INSTALLE,
    reason="torch est installé : ce test ne vérifie que le message d'erreur en son absence",
)
def test_generer_sans_torch_installe_leve_une_erreur_explicite(tmp_path):
    image_bidon = tmp_path / "reference.jpg"
    image_bidon.write_bytes(b"peu importe, torch n'est pas installe")

    adaptateur = AdaptateurGenerationLocaleImages()
    with pytest.raises(ErreurAdaptateurGeneration):
        adaptateur.generer("un prompt de test", [image_bidon], {"nb_variantes": 1}, tmp_path)
