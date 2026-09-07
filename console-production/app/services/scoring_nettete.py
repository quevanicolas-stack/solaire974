"""Score de netteté d'une image par variance du laplacien.

Une image nette a des transitions de contraste marquées : la variance
du laplacien (dérivée seconde) y est élevée. Une image floue lisse ces
transitions, la variance chute. C'est une mesure relative : elle sert
à comparer des images entre elles, pas une valeur physique absolue.
"""

from __future__ import annotations

from pathlib import Path

import cv2


class ErreurScoringNettete(Exception):
    """Image illisible ou format non supporté par OpenCV."""


def calculer_score_nettete(chemin_image: Path) -> float:
    image = cv2.imread(str(chemin_image), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ErreurScoringNettete(f"Image illisible ou format non supporté : {chemin_image}")
    return cv2.Laplacian(image, cv2.CV_64F).var()
