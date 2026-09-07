# Console de production — œuvres animalières personnalisées

Outil interne, utilisateur unique, exécuté en local. Il ne contient
aucune interface client, aucun code de paiement, et n'est jamais
exposé sur internet.

Le site e-commerce (développé dans un autre projet) encaisse le
paiement puis dépose les fichiers du client. Cet outil vient
les **récupérer** (mode pull, voir `CONTRAT_INGESTION.md`), puis
gère tout le pipeline de production : extraction, génération,
sélection, export.

État actuel : **étape 1** du pipeline (ingestion + mode manuel) et
la brique de création de commande qu'elle nécessite. Les étapes
suivantes (extraction vidéo, prompts, génération, export, suivi)
seront ajoutées une par une.

## Prérequis

- Python 3.11+
- ffmpeg installé et accessible dans le PATH (nécessaire à partir de
  l'étape 3 — extraction vidéo)

## Installation

```bash
cd console-production
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Éditer `.env` :
- `NOM_MARQUE` : le nom de marque (peut rester à `À_DEFINIR` pour l'instant)
- `URL_SITE` et `JETON_SITE` : uniquement nécessaires pour utiliser le
  bouton "Récupérer les nouvelles commandes". Le mode manuel fonctionne
  sans eux.

## Lancement

```bash
source .venv/bin/activate
uvicorn app.main:app --reload
```

Puis ouvrir http://127.0.0.1:8000

## Tests

```bash
source .venv/bin/activate
python -m pytest tests/ -v
```

## Structure

Voir l'arborescence dans le code. Chaque commande vit dans
`commandes/{numero}/` avec quatre sous-dossiers : `sources/` (fichiers
reçus), `extraits/` (images retenues depuis la vidéo), `variantes/`
(propositions générées), `livrables/` (fichiers finaux — aperçu,
impression, fond d'écran).

Le fichier **impression** (haute résolution) n'est jamais placé dans
un export destiné au client : c'est une règle imposée par le code,
pas seulement une convention.

## Mode manuel

Le site n'existe pas encore, ou vous avez reçu des fichiers hors
circuit normal (mail, clé USB...) : la page "Nouvelle commande" permet
de créer une commande à la main et d'y déposer les fichiers depuis
votre disque. Ce mode reste disponible même une fois le site en place.

Numérotation en mode manuel : `MAN-{AAAAMMJJ}-{compteur}`, pour la
distinguer visuellement des commandes venant du site (`CMD-...`).
