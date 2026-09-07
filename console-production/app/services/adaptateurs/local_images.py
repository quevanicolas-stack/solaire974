"""Adaptateur de génération LOCAL avec prise en compte d'une photo de
référence (IP-Adapter), pour que l'image générée s'inspire vraiment de
l'animal photographié — pas seulement du texte du prompt.

Mêmes principes que local_texte.py : Stable Diffusion 1.5 en local,
aucun appel réseau après le téléchargement initial des poids (base +
IP-Adapter, plusieurs Go supplémentaires par rapport au texte seul).
"""

from __future__ import annotations

import random
import uuid
from pathlib import Path
from typing import Any

from app.config import configuration
from app.services.adaptateurs.base import ErreurAdaptateurGeneration

_pipeline_charge: Any = None

DEPOT_IP_ADAPTER = "h94/IP-Adapter"
# La version "plus" retient des détails de l'image de référence (tokens par
# patch) au lieu d'un unique vecteur global : bien meilleure fidélité et
# réglage plus progressif que la version standard, qui basculait
# brutalement entre "quasi-copie" et "aucune ressemblance" selon l'intensité.
POIDS_IP_ADAPTER = "ip-adapter-plus_sd15.bin"
NB_IMAGES_REFERENCE_MAX = 3


def _charger_pipeline() -> Any:
    """Charge le pipeline Stable Diffusion + IP-Adapter une seule fois par processus."""
    global _pipeline_charge
    if _pipeline_charge is not None:
        return _pipeline_charge

    try:
        import torch
        from diffusers import StableDiffusionPipeline
        from transformers import CLIPVisionModelWithProjection
    except ImportError as erreur:
        raise ErreurAdaptateurGeneration(
            "torch, diffusers et transformers ne sont pas installés. "
            "Lance : pip install -r requirements-generation-locale.txt"
        ) from erreur

    peripherique = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if peripherique == "mps" else torch.float32

    try:
        encodeur_image = CLIPVisionModelWithProjection.from_pretrained(
            DEPOT_IP_ADAPTER, subfolder="models/image_encoder", torch_dtype=dtype
        )
        pipeline = StableDiffusionPipeline.from_pretrained(
            configuration.modele_generation_local,
            image_encoder=encodeur_image,
            torch_dtype=dtype,
            safety_checker=None,
        )
        pipeline.load_ip_adapter(DEPOT_IP_ADAPTER, subfolder="models", weight_name=POIDS_IP_ADAPTER)
    except Exception as erreur:
        raise ErreurAdaptateurGeneration(
            f"Échec du chargement du modèle ou de l'IP-Adapter : {erreur}"
        ) from erreur

    pipeline = pipeline.to(peripherique)
    # Ne pas appeler enable_attention_slicing() (ni xformers, ni cpu_offload)
    # ici : fait après load_ip_adapter(), ça casse les processeurs
    # d'attention installés par l'IP-Adapter et provoque une erreur
    # "'tuple' object has no attribute 'shape'" (bug connu de diffusers,
    # voir huggingface/diffusers#6914, #8863, #9448).
    pipeline.set_ip_adapter_scale(0.5)
    _pipeline_charge = pipeline
    return pipeline


def choisir_images_reference(images_reference: list[Path]) -> list[Path]:
    """Jusqu'à NB_IMAGES_REFERENCE_MAX images (photos de détail en priorité,
    voir generation.collecter_images_reference), pour une meilleure fidélité
    que sur une seule image."""
    if not images_reference:
        raise ErreurAdaptateurGeneration(
            "Aucune image de référence disponible : sélectionne des extraits vidéo "
            "et/ou vérifie que des photos de détail ont été déposées."
        )
    return images_reference[:NB_IMAGES_REFERENCE_MAX]


class AdaptateurGenerationLocaleImages:
    """Génère des images en local, à partir du prompt ET d'une photo de référence."""

    def generer(
        self,
        prompt: str,
        images_reference: list[Path],
        parametres: dict,
        dossier_sortie: Path,
    ) -> list[dict]:
        dossier_sortie.mkdir(parents=True, exist_ok=True)
        chemins_reference = choisir_images_reference(images_reference)

        pipeline = _charger_pipeline()

        import torch
        from PIL import Image as ImagePIL

        images_reference_pil = [ImagePIL.open(chemin).convert("RGB") for chemin in chemins_reference]

        nb_variantes = int(parametres.get("nb_variantes", 3))
        nb_etapes = int(parametres.get("nb_etapes", 25))

        resultats = []
        for _ in range(nb_variantes):
            seed = random.randint(0, 999_999_999)
            generateur = torch.Generator(device=pipeline.device).manual_seed(seed)
            try:
                image = pipeline(
                    prompt,
                    ip_adapter_image=images_reference_pil,
                    num_inference_steps=nb_etapes,
                    generator=generateur,
                ).images[0]
            except Exception as erreur:
                raise ErreurAdaptateurGeneration(f"Échec de la génération : {erreur}") from erreur

            chemin = dossier_sortie / f"variante_{uuid.uuid4().hex[:8]}.jpg"
            image.save(chemin, quality=90)
            resultats.append({"chemin": chemin, "seed": str(seed)})
        return resultats
