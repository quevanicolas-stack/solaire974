"""Extraction d'images depuis une vidéo, via ffmpeg/ffprobe en subprocess.

La vidéo client est la source de COUVERTURE : le visage de l'animal
n'occupe qu'une petite partie du cadre, contrairement aux photos
rapprochées (source de DÉTAIL, gérées séparément).
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

from app.services.scoring_nettete import calculer_score_nettete


class ErreurExtractionVideo(Exception):
    """Erreur d'extraction : ffmpeg absent, vidéo illisible, format non supporté."""


def verifier_ffmpeg_disponible() -> None:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise ErreurExtractionVideo(
            "ffmpeg (et ffprobe) doivent être installés et accessibles dans le PATH."
        )


def obtenir_duree_video(chemin_video: Path) -> float:
    verifier_ffmpeg_disponible()
    try:
        resultat = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json",
                str(chemin_video),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired as erreur:
        raise ErreurExtractionVideo(f"ffprobe n'a pas répondu à temps sur {chemin_video}") from erreur

    if resultat.returncode != 0:
        raise ErreurExtractionVideo(f"Vidéo illisible ou format non supporté : {chemin_video}")

    try:
        duree = float(json.loads(resultat.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as erreur:
        raise ErreurExtractionVideo(f"Durée introuvable pour {chemin_video}") from erreur

    if duree <= 0:
        raise ErreurExtractionVideo(f"Durée de vidéo invalide pour {chemin_video}")
    return duree


def calculer_horodatages(duree_s: float, nb_images: int) -> list[float]:
    """Répartit nb_images horodatages sur la durée, en évitant les tout premiers/derniers instants."""
    if nb_images < 1:
        raise ValueError("nb_images doit être au moins 1")
    return [duree_s * (i + 0.5) / nb_images for i in range(nb_images)]


def extraire_image_a_horodatage(chemin_video: Path, horodatage_s: float, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        resultat = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(horodatage_s),
                "-i", str(chemin_video),
                "-frames:v", "1",
                "-vf", "scale=640:-1",
                "-q:v", "3",
                str(destination),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired as erreur:
        raise ErreurExtractionVideo(f"ffmpeg n'a pas répondu à temps pour l'image à {horodatage_s:.1f}s") from erreur

    if resultat.returncode != 0 or not destination.exists():
        raise ErreurExtractionVideo(
            f"Échec de l'extraction à {horodatage_s:.1f}s : {resultat.stderr.strip()[-300:]}"
        )


def extraire_et_filtrer(
    chemin_video: Path,
    dossier_candidats: Path,
    *,
    nb_images: int,
    seuil_nettete: float,
) -> list[dict]:
    """Extrait nb_images images, calcule leur score de netteté, écarte celles sous le seuil.

    Retourne la liste des images retenues (score >= seuil), triées par
    netteté décroissante. Les images écartées sont supprimées du disque
    (ce sont des candidats intermédiaires, pas les fichiers sources).
    """
    verifier_ffmpeg_disponible()
    dossier_candidats.mkdir(parents=True, exist_ok=True)
    duree = obtenir_duree_video(chemin_video)
    horodatages = calculer_horodatages(duree, nb_images)

    candidats: list[dict] = []
    for index, horodatage in enumerate(horodatages):
        destination = dossier_candidats / f"frame_{index:03d}.jpg"
        extraire_image_a_horodatage(chemin_video, horodatage, destination)
        score = calculer_score_nettete(destination)
        if score < seuil_nettete:
            destination.unlink(missing_ok=True)
            continue
        candidats.append({"chemin": destination, "horodatage_s": horodatage, "score": score})

    candidats.sort(key=lambda c: c["score"], reverse=True)
    return candidats


def enregistrer_selection_extraits(
    connexion: sqlite3.Connection, *, commande_numero: str, dossier_extraits: Path, ids_retenus: set[int]
) -> None:
    """Copie dans extraits/ les candidats cochés, retire ceux décochés, met à jour la base."""
    dossier_extraits.mkdir(parents=True, exist_ok=True)
    lignes = connexion.execute(
        "SELECT id, chemin FROM extraits_images WHERE commande_numero = ?", (commande_numero,)
    ).fetchall()

    for ligne in lignes:
        chemin_candidat = Path(ligne["chemin"])
        destination_finale = dossier_extraits / chemin_candidat.name
        est_retenue = ligne["id"] in ids_retenus
        if est_retenue:
            shutil.copyfile(chemin_candidat, destination_finale)
        else:
            destination_finale.unlink(missing_ok=True)
        connexion.execute(
            "UPDATE extraits_images SET retenue = ? WHERE id = ?", (1 if est_retenue else 0, ligne["id"])
        )
