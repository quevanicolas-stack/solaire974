"""Tests du score de netteté (variance du laplacien)."""

import numpy as np
import pytest

from app.services.scoring_nettete import ErreurScoringNettete, calculer_score_nettete


def _sauvegarder_damier(chemin, taille=200, case=10):
    import cv2

    damier = np.zeros((taille, taille), dtype=np.uint8)
    for y in range(0, taille, case * 2):
        for x in range(0, taille, case * 2):
            damier[y : y + case, x : x + case] = 255
            damier[y + case : y + case * 2, x + case : x + case * 2] = 255
    cv2.imwrite(str(chemin), damier)


def test_image_nette_a_un_score_plus_eleve_quune_image_floue(tmp_path):
    import cv2

    chemin_net = tmp_path / "net.jpg"
    chemin_flou = tmp_path / "flou.jpg"

    _sauvegarder_damier(chemin_net)

    image_nette = cv2.imread(str(chemin_net))
    image_floue = cv2.GaussianBlur(image_nette, (15, 15), 10)
    cv2.imwrite(str(chemin_flou), image_floue)

    score_net = calculer_score_nettete(chemin_net)
    score_flou = calculer_score_nettete(chemin_flou)

    assert score_net > score_flou


def test_image_illisible_leve_une_erreur_explicite(tmp_path):
    chemin_invalide = tmp_path / "pas_une_image.jpg"
    chemin_invalide.write_bytes(b"ceci n'est pas une image")

    with pytest.raises(ErreurScoringNettete):
        calculer_score_nettete(chemin_invalide)
