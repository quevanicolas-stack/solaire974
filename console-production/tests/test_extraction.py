"""Tests de l'extraction vidéo.

Le calcul des horodatages est une fonction pure, testée sans ffmpeg.
L'orchestration ffmpeg elle-même (extraire_et_filtrer) nécessite un
vrai binaire ffmpeg installé : elle est vérifiée manuellement (voir
README) plutôt que testée ici, pour ne pas rendre la suite dépendante
d'un binaire externe.
"""

import pytest

from app.services.extraction_video import calculer_horodatages


def test_calculer_horodatages_repartit_sur_toute_la_duree():
    horodatages = calculer_horodatages(duree_s=20.0, nb_images=4)
    assert len(horodatages) == 4
    assert horodatages == [2.5, 7.5, 12.5, 17.5]


def test_calculer_horodatages_evite_les_bornes():
    horodatages = calculer_horodatages(duree_s=10.0, nb_images=1)
    assert horodatages == [5.0]
    assert 0.0 not in horodatages


def test_calculer_horodatages_rejette_nb_images_invalide():
    with pytest.raises(ValueError):
        calculer_horodatages(duree_s=10.0, nb_images=0)
