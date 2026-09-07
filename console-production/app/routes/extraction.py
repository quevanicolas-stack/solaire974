"""Extraction des images de la vidéo, tri par netteté, sélection manuelle."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.config import configuration
from app.db import obtenir_connexion
from app.services.extraction_video import (
    ErreurExtractionVideo,
    enregistrer_selection_extraits,
    extraire_et_filtrer,
)

routeur = APIRouter(prefix="/commandes/{numero}/extraction")
templates = Jinja2Templates(directory="app/templates")


def _dossier_commande(numero: str) -> Path:
    return configuration.dossier_commandes / numero


def _url_fichier(chemin: str) -> str:
    chemin_relatif = Path(chemin).relative_to(configuration.dossier_commandes)
    return f"/fichiers/commandes/{chemin_relatif.as_posix()}"


def _charger_contexte(connexion, numero: str, erreur: str | None = None) -> dict:
    commande = connexion.execute("SELECT * FROM commandes WHERE numero = ?", (numero,)).fetchone()
    video = connexion.execute(
        "SELECT * FROM fichiers_sources WHERE commande_numero = ? AND type = 'video'", (numero,)
    ).fetchone()
    photos_detail = [
        {**dict(ligne), "url": _url_fichier(ligne["chemin"])}
        for ligne in connexion.execute(
            "SELECT * FROM fichiers_sources WHERE commande_numero = ? AND type = 'photo'", (numero,)
        ).fetchall()
    ]
    candidats = [
        {**dict(ligne), "url": _url_fichier(ligne["chemin"])}
        for ligne in connexion.execute(
            "SELECT * FROM extraits_images WHERE commande_numero = ? ORDER BY score_nettete DESC", (numero,)
        ).fetchall()
    ]
    return {
        "commande": commande,
        "video": video,
        "photos_detail": photos_detail,
        "candidats": candidats,
        "nb_images_defaut": configuration.extraction_nb_images,
        "seuil_defaut": configuration.extraction_seuil_nettete,
        "erreur": erreur,
    }


@routeur.get("")
def afficher_page_extraction(request: Request, numero: str):
    with obtenir_connexion() as connexion:
        contexte = _charger_contexte(connexion, numero)
    return templates.TemplateResponse(request, "extraction.html", contexte)


@routeur.post("/lancer")
def lancer_extraction(
    request: Request,
    numero: str,
    nb_images: int = Form(...),
    seuil_nettete: float = Form(...),
):
    with obtenir_connexion() as connexion:
        video = connexion.execute(
            "SELECT * FROM fichiers_sources WHERE commande_numero = ? AND type = 'video'", (numero,)
        ).fetchone()
        if video is None:
            contexte = _charger_contexte(connexion, numero, erreur="Aucune vidéo enregistrée pour cette commande.")
            return templates.TemplateResponse(request, "extraction.html", contexte)

        dossier_candidats = _dossier_commande(numero) / "extraits" / "candidats"
        connexion.execute("DELETE FROM extraits_images WHERE commande_numero = ?", (numero,))
        for ancien_fichier in dossier_candidats.glob("*.jpg"):
            ancien_fichier.unlink(missing_ok=True)

        try:
            candidats = extraire_et_filtrer(
                Path(video["chemin"]),
                dossier_candidats,
                nb_images=nb_images,
                seuil_nettete=seuil_nettete,
            )
        except ErreurExtractionVideo as erreur:
            contexte = _charger_contexte(connexion, numero, erreur=str(erreur))
            return templates.TemplateResponse(request, "extraction.html", contexte)

        for candidat in candidats:
            connexion.execute(
                """
                INSERT INTO extraits_images (commande_numero, source, chemin, score_nettete, horodatage_video_s, retenue)
                VALUES (?, 'video', ?, ?, ?, 0)
                """,
                (numero, str(candidat["chemin"]), candidat["score"], candidat["horodatage_s"]),
            )

        if not candidats:
            contexte = _charger_contexte(
                connexion,
                numero,
                erreur="Aucune image ne dépasse le seuil de netteté. Essayez de le baisser.",
            )
            return templates.TemplateResponse(request, "extraction.html", contexte)

    return RedirectResponse(f"/commandes/{numero}/extraction", status_code=303)


@routeur.post("/selection")
def enregistrer_selection(numero: str, retenues: list[int] = Form([])):
    with obtenir_connexion() as connexion:
        enregistrer_selection_extraits(
            connexion,
            commande_numero=numero,
            dossier_extraits=_dossier_commande(numero) / "extraits",
            ids_retenus=set(retenues),
        )
    return RedirectResponse(f"/commandes/{numero}/extraction", status_code=303)
