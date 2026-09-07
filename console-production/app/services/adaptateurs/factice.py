"""Adaptateur de test : ne consomme aucune API, aucun coût, aucun réseau.

Produit des images clairement identifiables comme factices (texte
"IMAGE DE TEST" visible), pour que tout le pipeline soit testable et
débogable avant qu'un fournisseur d'IA réel ne soit choisi.
"""

from __future__ import annotations

import random
import uuid
from pathlib import Path

from PIL import Image, ImageDraw


class AdaptateurGenerationFactice:
    def generer(
        self,
        prompt: str,
        images_reference: list[Path],
        parametres: dict,
        dossier_sortie: Path,
    ) -> list[dict]:
        dossier_sortie.mkdir(parents=True, exist_ok=True)
        nb_variantes = int(parametres.get("nb_variantes", 3))

        resultats = []
        for _ in range(nb_variantes):
            seed = str(random.randint(0, 999_999_999))
            image = self._construire_image(prompt, seed, len(images_reference))
            chemin = dossier_sortie / f"variante_{uuid.uuid4().hex[:8]}.jpg"
            image.save(chemin, quality=85)
            resultats.append({"chemin": chemin, "seed": seed})
        return resultats

    def _construire_image(self, prompt: str, seed: str, nb_references: int) -> Image.Image:
        couleur = tuple(random.randint(60, 200) for _ in range(3))
        image = Image.new("RGB", (800, 800), color=couleur)
        dessin = ImageDraw.Draw(image)
        texte = (
            "IMAGE DE TEST — ADAPTATEUR FACTICE\n"
            f"seed {seed}\n"
            f"{nb_references} image(s) de référence fournie(s)\n\n"
            f"{prompt[:300]}"
        )
        dessin.multiline_text((40, 40), texte, fill="white")
        return image
