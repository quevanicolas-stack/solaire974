"""Tests de parsing et de vérification du contrat d'ingestion.

Ne touchent ni au réseau ni à un vrai serveur : uniquement les
fonctions pures qui interprètent le JSON défini par
CONTRAT_INGESTION.md.
"""

import pytest

from app.services.client_ingestion import (
    ErreurIngestion,
    extraire_hachage,
    fichier_deja_present,
    parser_commande,
)

COMMANDE_JSON_EXEMPLE = {
    "numero": "CMD-2026-0042",
    "date_paiement": "2026-09-01T10:15:00Z",
    "animal": {"prenom": "Nala", "espece": "chien"},
    "objet_prefere": "sa balle rouge",
    "photo_objet_presente": True,
    "note_identite": "une tache noire sur l'oreille gauche",
    "format": "30x40",
    "fichiers": [
        {
            "id": "f1",
            "type": "video",
            "nom_fichier": "nala_video.mp4",
            "url": "https://site.example.com/api/fichiers/f1",
            "somme_controle": "sha256:9f86d0",
            "taille_octets": 15234000,
        }
    ],
}


def test_parser_commande_extrait_les_champs_attendus():
    champs = parser_commande(COMMANDE_JSON_EXEMPLE)
    assert champs["numero"] == "CMD-2026-0042"
    assert champs["prenom_animal"] == "Nala"
    assert champs["espece"] == "chien"
    assert champs["espece_autre"] is None
    assert champs["format_choisi"] == "30x40"
    assert len(champs["fichiers"]) == 1


def test_parser_commande_espece_hors_liste_devient_autre():
    commande = {**COMMANDE_JSON_EXEMPLE, "animal": {"prenom": "Kiwi", "espece": "furet"}}
    champs = parser_commande(commande)
    assert champs["espece"] == "autre"
    assert champs["espece_autre"] == "furet"


def test_parser_commande_champ_manquant_leve_une_erreur():
    commande_incomplete = {k: v for k, v in COMMANDE_JSON_EXEMPLE.items() if k != "format"}
    with pytest.raises(ErreurIngestion):
        parser_commande(commande_incomplete)


def test_extraire_hachage_retire_le_prefixe_algorithme():
    assert extraire_hachage("sha256:abcd1234") == "abcd1234"
    assert extraire_hachage("abcd1234") == "abcd1234"


def test_fichier_deja_present_absent_du_disque(tmp_path):
    chemin = tmp_path / "inexistant.mp4"
    assert fichier_deja_present(chemin, 100, "sha256:abcd") is False


def test_fichier_deja_present_intact_ne_redeclenche_pas_le_telechargement(tmp_path):
    chemin = tmp_path / "video.mp4"
    contenu = b"contenu-de-test"
    chemin.write_bytes(contenu)

    import hashlib

    somme = hashlib.sha256(contenu).hexdigest()
    assert fichier_deja_present(chemin, len(contenu), f"sha256:{somme}") is True


def test_fichier_deja_present_taille_incorrecte_redeclenche_le_telechargement(tmp_path):
    chemin = tmp_path / "video.mp4"
    chemin.write_bytes(b"contenu-tronque")
    assert fichier_deja_present(chemin, 999999, "sha256:peu-importe") is False
