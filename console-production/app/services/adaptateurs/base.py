"""Interface commune à tous les fournisseurs de génération d'images.

Un nouvel adaptateur réel (Midjourney, Stable Diffusion, autre) s'ajoute
en créant un fichier supplémentaire dans ce dossier qui implémente
cette interface, sans modifier le reste du code. Le choix du
fournisseur reste une décision à prendre explicitement, jamais codée
en dur par défaut : voir factice.py, seul adaptateur actif tant
qu'aucun autre n'est configuré.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class ErreurAdaptateurGeneration(Exception):
    """Erreur levée par un adaptateur pendant la génération (dépendance
    manquante, modèle introuvable, échec d'inférence)."""


class AdaptateurGeneration(ABC):
    @abstractmethod
    def generer(
        self,
        prompt: str,
        images_reference: list[Path],
        parametres: dict,
        dossier_sortie: Path,
    ) -> list[dict]:
        """Génère un lot de variantes dans dossier_sortie.

        Retourne une liste de {"chemin": Path, "seed": str}, une entrée
        par image produite.
        """
        raise NotImplementedError
