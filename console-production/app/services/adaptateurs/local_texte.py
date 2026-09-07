"""Adaptateur de génération LOCAL, texte seul (première version du "vrai"
adaptateur, avant l'ajout de la prise en compte des photos de référence).

Utilise Stable Diffusion 1.5 via la bibliothèque diffusers, exécuté
entièrement sur la machine (puce Apple Silicon via MPS si disponible,
sinon CPU). Les poids du modèle sont téléchargés une seule fois, à la
première utilisation, puis mis en cache sur disque par Hugging Face
(~/.cache/huggingface) : aucune requête réseau lors des générations
suivantes.

Le vérificateur de contenu (safety checker) de Stable Diffusion est
désactivé ici : il déclenche régulièrement de faux positifs (image
noircie) sur des sujets bénins comme des portraits d'animaux, et cet
outil ne traite que ce type de contenu, en local, pour un usage
strictement personnel.
"""

from __future__ import annotations

import random
import uuid
from pathlib import Path
from typing import Any

from app.config import configuration
from app.services.adaptateurs.base import ErreurAdaptateurGeneration

_pipeline_charge: Any = None


def _charger_pipeline() -> Any:
    """Charge le pipeline Stable Diffusion une seule fois par processus."""
    global _pipeline_charge
    if _pipeline_charge is not None:
        return _pipeline_charge

    try:
        import torch
        from diffusers import StableDiffusionPipeline
    except ImportError as erreur:
        raise ErreurAdaptateurGeneration(
            "torch et diffusers ne sont pas installés. Lance : pip install -r requirements.txt"
        ) from erreur

    peripherique = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if peripherique == "mps" else torch.float32

    try:
        pipeline = StableDiffusionPipeline.from_pretrained(
            configuration.modele_generation_local,
            torch_dtype=dtype,
            safety_checker=None,
        )
    except Exception as erreur:
        raise ErreurAdaptateurGeneration(
            f"Échec du chargement du modèle « {configuration.modele_generation_local} » : {erreur}"
        ) from erreur

    pipeline = pipeline.to(peripherique)
    pipeline.enable_attention_slicing()
    _pipeline_charge = pipeline
    return pipeline


class AdaptateurGenerationLocaleTexte:
    """Génère des images en local à partir du seul texte du prompt.

    Les images de référence sont acceptées par l'interface mais pas
    encore utilisées : voir le futur adaptateur avec IP-Adapter pour
    la prise en compte des photos de l'animal.
    """

    def generer(
        self,
        prompt: str,
        images_reference: list[Path],
        parametres: dict,
        dossier_sortie: Path,
    ) -> list[dict]:
        dossier_sortie.mkdir(parents=True, exist_ok=True)
        pipeline = _charger_pipeline()

        import torch

        nb_variantes = int(parametres.get("nb_variantes", 3))
        nb_etapes = int(parametres.get("nb_etapes", 25))

        resultats = []
        for _ in range(nb_variantes):
            seed = random.randint(0, 999_999_999)
            generateur = torch.Generator(device=pipeline.device).manual_seed(seed)
            try:
                image = pipeline(prompt, num_inference_steps=nb_etapes, generator=generateur).images[0]
            except Exception as erreur:
                raise ErreurAdaptateurGeneration(f"Échec de la génération : {erreur}") from erreur

            chemin = dossier_sortie / f"variante_{uuid.uuid4().hex[:8]}.jpg"
            image.save(chemin, quality=90)
            resultats.append({"chemin": chemin, "seed": str(seed)})
        return resultats
