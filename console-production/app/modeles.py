"""Constantes et petites structures de données partagées."""

from __future__ import annotations

ESPECES = ("chien", "chat", "autre")
FORMATS = ("30x40", "50x70")

STATUTS = (
    "recue",
    "en_production",
    "apercu_envoye",
    "revision_demandee",
    "validee",
    "envoyee_impression",
    "terminee",
)

LIBELLES_STATUTS = {
    "recue": "Reçue",
    "en_production": "En production",
    "apercu_envoye": "Aperçu envoyé",
    "revision_demandee": "Révision demandée",
    "validee": "Validée",
    "envoyee_impression": "Envoyée à l'impression",
    "terminee": "Terminée",
}

TYPES_FICHIERS_SOURCES = ("video", "photo", "photo_objet")

ORIGINE_MANUELLE = "manuelle"
ORIGINE_SITE = "site"
