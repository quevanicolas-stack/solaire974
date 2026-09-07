# Contrat d'ingestion — Site e-commerce ↔ Outil de production

Ce document décrit l'interface que le site e-commerce doit exposer pour
que l'outil de production puisse récupérer les commandes payées, en
mode PULL exclusivement (l'outil tourne en local, il n'est jamais
joignable depuis internet). Le site n'a besoin de rien connaître de
l'outil au-delà de ce contrat.

## Authentification

Toutes les requêtes portent un en-tête :

    Authorization: Bearer <JETON>

Le jeton est une chaîne opaque générée côté site, communiquée une fois
à l'outil et stockée dans son `.env`. Le site doit rejeter toute requête
sans jeton valide avec un code 401.

## Endpoint 1 — Lister les commandes prêtes

    GET /api/commandes/pretes?depuis=<ISO8601>&limite=<n>

Paramètres (facultatifs) :
- `depuis` : ne retourne que les commandes créées/payées après cette
  date ISO 8601. Absent = toutes les commandes non encore récupérées.
- `limite` : nombre maximum de commandes retournées (défaut 20).

Ne retourne QUE les commandes payées, avec fichiers uploadés côté
client, et non encore marquées comme récupérées (voir endpoint 3).

Réponse 200 :

```json
{
  "commandes": [
    {
      "numero": "CMD-2026-0042",
      "date_paiement": "2026-09-01T10:15:00Z",
      "animal": {
        "prenom": "Nala",
        "espece": "chien"
      },
      "objet_prefere": "sa balle rouge",
      "photo_objet_presente": true,
      "note_identite": "une tache noire sur l'oreille gauche",
      "format": "30x40",
      "fichiers": [
        {
          "id": "f1",
          "type": "video",
          "nom_fichier": "nala_video.mp4",
          "url": "https://site.example.com/api/fichiers/f1",
          "somme_controle": "sha256:9f86d0...",
          "taille_octets": 15234000
        },
        {
          "id": "f2",
          "type": "photo",
          "nom_fichier": "nala_photo1.jpg",
          "url": "https://site.example.com/api/fichiers/f2",
          "somme_controle": "sha256:3c9909...",
          "taille_octets": 2100000
        },
        {
          "id": "f3",
          "type": "photo_objet",
          "nom_fichier": "balle_rouge.jpg",
          "url": "https://site.example.com/api/fichiers/f3",
          "somme_controle": "sha256:1a2b3c...",
          "taille_octets": 800000
        }
      ]
    }
  ]
}
```

Champs `type` de fichier possibles : `video`, `photo`, `photo_objet`
(cette dernière facultative). `espece` : `chien`, `chat`, ou toute
autre chaîne libre (espèce non listée).

## Endpoint 2 — Télécharger un fichier

    GET /api/fichiers/{id}

Réponse 200 : flux binaire du fichier, avec en-tête `Content-Length`.
L'outil calcule le sha256 du contenu reçu et le compare à
`somme_controle` fourni dans l'endpoint 1. En cas de désaccord, le
fichier est rejeté et le téléchargement retenté au prochain cycle.

Formats acceptés : vidéo `mp4` ou `mov`, photos `jpg`/`jpeg`/`png`.

## Endpoint 3 — Marquer une commande comme récupérée

    POST /api/commandes/{numero}/recuperee

Appelé UNIQUEMENT après téléchargement réussi et vérifié (somme de
contrôle correcte) de TOUS les fichiers de la commande. Idempotent :
un second appel sur une commande déjà marquée retourne 200 sans effet
de bord (pas d'erreur).

Réponse 200 : `{"statut": "ok"}`

## Codes d'erreur

| Code | Signification                                        |
|------|-------------------------------------------------------|
| 401  | Jeton absent ou invalide                               |
| 404  | Commande ou fichier introuvable                        |
| 409  | Commande déjà marquée récupérée (sur un autre appel)   |
| 422  | Commande incomplète côté site (fichiers manquants)     |
| 500  | Erreur serveur site                                    |

L'outil considère toute erreur réseau (timeout, connexion refusée,
5xx) comme transitoire : la commande reste dans la liste des commandes
à récupérer, retentée au cycle suivant sans duplication de fichiers
déjà présents et intègres sur disque.

## Reprise après coupure

Avant de télécharger un fichier, l'outil vérifie s'il existe déjà en
local avec la même taille et la même somme de contrôle. Si oui, il
passe au suivant sans retélécharger. Un fichier partiel (taille ou
somme incorrecte) est retéléchargé intégralement.

## Ce que le site n'a pas besoin de savoir

Le site ignore tout du pipeline de production (extraction, génération,
export). Son seul rôle : exposer ces trois endpoints et stocker l'état
"récupérée" par commande.
