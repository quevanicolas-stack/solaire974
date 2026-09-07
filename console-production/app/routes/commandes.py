"""Création manuelle de commande et consultation du détail.

Le site e-commerce n'existe pas encore : ce mode manuel permet de
tester tout le pipeline sans lui, et reste utile ensuite pour les cas
particuliers (fichiers reçus autrement, litige, etc.).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.db import obtenir_connexion
from app.modeles import ESPECES, FORMATS, LIBELLES_STATUTS
from app.services.gestion_commandes import (
    ErreurValidationCommande,
    creer_commande,
    creer_dossiers_commande,
    enregistrer_fichier_source,
    enregistrer_photo_objet,
    generer_numero_manuel,
)

routeur = APIRouter(prefix="/commandes")
templates = Jinja2Templates(directory="app/templates")

EXTENSIONS_VIDEO = (".mp4", ".mov")
EXTENSIONS_PHOTO = (".jpg", ".jpeg", ".png")


class ErreurFichierUpload(ValueError):
    pass


def _valider_extension(nom_fichier: str, extensions_autorisees: tuple[str, ...]) -> None:
    suffixe = Path(nom_fichier).suffix.lower()
    if suffixe not in extensions_autorisees:
        raise ErreurFichierUpload(
            f"Format de fichier non supporté ({suffixe or 'inconnu'}). "
            f"Attendu : {', '.join(extensions_autorisees)}."
        )


def _sauvegarder_upload(upload: UploadFile, destination: Path) -> Path:
    try:
        destination.write_bytes(upload.file.read())
    except OSError as erreur:
        raise ErreurFichierUpload(f"Impossible d'enregistrer {upload.filename} (disque plein ?) : {erreur}") from erreur
    return destination


@routeur.get("/nouvelle")
def afficher_formulaire_nouvelle_commande(request: Request):
    return templates.TemplateResponse(
        request,
        "commande_nouvelle.html",
        {"especes": ESPECES, "formats": FORMATS, "erreur": None},
    )


@routeur.post("/nouvelle")
def creer_commande_manuelle(
    request: Request,
    prenom_animal: str = Form(...),
    espece: str = Form(...),
    espece_autre: str = Form(""),
    objet_prefere: str = Form(...),
    note_identite: str = Form(""),
    format_choisi: str = Form(..., alias="format"),
    video: UploadFile = File(...),
    photos: list[UploadFile] = File(...),
    photo_objet: UploadFile | None = File(None),
):
    contexte_erreur = {"especes": ESPECES, "formats": FORMATS}

    if len(photos) < 2 or len(photos) > 3:
        return templates.TemplateResponse(
            request,
            "commande_nouvelle.html",
            {**contexte_erreur, "erreur": "Il faut déposer entre 2 et 3 photos rapprochées."},
        )

    try:
        _valider_extension(video.filename or "", EXTENSIONS_VIDEO)
        for photo in photos:
            _valider_extension(photo.filename or "", EXTENSIONS_PHOTO)
        if photo_objet is not None and photo_objet.filename:
            _valider_extension(photo_objet.filename, EXTENSIONS_PHOTO)
    except ErreurFichierUpload as erreur:
        return templates.TemplateResponse(
            request, "commande_nouvelle.html", {**contexte_erreur, "erreur": str(erreur)}
        )

    try:
        with obtenir_connexion() as connexion:
            numero = generer_numero_manuel(connexion)
            creer_commande(
                connexion,
                numero=numero,
                prenom_animal=prenom_animal,
                espece=espece,
                espece_autre=espece_autre,
                objet_prefere=objet_prefere,
                note_identite=note_identite,
                format_choisi=format_choisi,
                origine="manuelle",
            )
            dossier_sources = creer_dossiers_commande(numero) / "sources"

            destination_video = _sauvegarder_upload(video, dossier_sources / video.filename)
            enregistrer_fichier_source(
                connexion, commande_numero=numero, type_fichier="video", chemin=destination_video
            )

            for photo in photos:
                destination_photo = _sauvegarder_upload(photo, dossier_sources / photo.filename)
                enregistrer_fichier_source(
                    connexion, commande_numero=numero, type_fichier="photo", chemin=destination_photo
                )

            if photo_objet is not None and photo_objet.filename:
                destination_objet = _sauvegarder_upload(photo_objet, dossier_sources / photo_objet.filename)
                enregistrer_photo_objet(connexion, commande_numero=numero, chemin=destination_objet)
    except (ErreurValidationCommande, ErreurFichierUpload) as erreur:
        return templates.TemplateResponse(
            request, "commande_nouvelle.html", {**contexte_erreur, "erreur": str(erreur)}
        )

    return RedirectResponse(f"/commandes/{numero}", status_code=303)


@routeur.get("/{numero}")
def afficher_detail_commande(request: Request, numero: str):
    with obtenir_connexion() as connexion:
        commande = connexion.execute(
            "SELECT * FROM commandes WHERE numero = ?", (numero,)
        ).fetchone()
        fichiers = connexion.execute(
            "SELECT * FROM fichiers_sources WHERE commande_numero = ?", (numero,)
        ).fetchall()
    return templates.TemplateResponse(
        request,
        "commande_detail.html",
        {
            "commande": commande,
            "fichiers": fichiers,
            "libelles_statuts": LIBELLES_STATUTS,
        },
    )
