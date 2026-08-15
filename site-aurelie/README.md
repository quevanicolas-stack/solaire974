# Site d'Aurélie — cours d'anglais professionnel

Site vitrine statique (HTML/CSS/JS vanilla, sans dépendance ni framework) pour une
activité de cours d'anglais professionnel en visioconférence : cours individuels,
sessions en petit groupe et formations intra-entreprise.

## Structure

```
site-aurelie/
├── index.html            Accueil : positionnement, formules, domaines, témoignages
├── cours.html            Détail des trois formules, méthode, niveaux, questions fréquentes
├── tarifs.html           Grille tarifaire individuelle, groupe et entreprise
├── a-propos.html         Portrait, parcours, approche pédagogique
├── contact.html          Formulaire de demande et coordonnées
├── mentions-legales.html Mentions légales et données personnelles
└── assets/
    ├── style.css         Feuille de styles commune
    └── script.js         Menu mobile, année du pied de page, formulaire
```

## Consulter le site

Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```
python3 -m http.server 8000 --directory site-aurelie
```

puis se rendre sur `http://localhost:8000`.

## Contenus à remplacer avant la mise en ligne

Tous les textes provisoires sont marqués par la classe `a-completer` : ils
apparaissent **surlignés en jaune avec un soulignement pointillé** dans le navigateur.
Pour les retrouver dans les fichiers :

```
grep -rn "a-completer" site-aurelie/*.html
```

Une fois un contenu remplacé par sa version définitive, supprimer la classe
`a-completer` (et, le cas échéant, la balise `<span>` devenue inutile) pour faire
disparaître le surlignage.

### Liste des éléments à fournir

| Élément | Où |
| --- | --- |
| Nom de famille d'Aurélie | En-tête et pied de page de toutes les pages |
| Adresse de courriel réelle | Pied de page, `contact.html`, attribut `data-destinataire` du formulaire |
| Numéro de téléphone | Pied de page et `contact.html` |
| Lien LinkedIn | Pied de page et `contact.html` |
| SIRET et statut juridique | Pied de page et `mentions-legales.html` |
| Photo portrait | `a-propos.html`, à déposer dans `assets/` |
| Parcours, diplômes, certifications | `a-propos.html` |
| Chiffres clés (nombre d'apprenants, ancienneté, note) | `index.html` |
| Témoignages réels | `index.html` — avec l'accord écrit des personnes citées |
| Tarifs réels de toutes les formules | `tarifs.html` |
| Outil de visioconférence utilisé | `cours.html`, questions fréquentes |
| Conditions d'annulation réelles | `cours.html` et `tarifs.html` |
| Hébergeur du site | `mentions-legales.html` |

### Points de vigilance

- **Financement de la formation.** Les mentions CPF, OPCO et plan de développement des
  compétences sont laissées en attente dans `cours.html` et `tarifs.html`. Elles ne
  doivent être activées que si l'activité est effectivement déclarée en organisme de
  formation (numéro de déclaration d'activité) et, pour le CPF, référencée Qualiopi.
- **TVA.** La page tarifs indique « nets de taxe ». À vérifier selon le régime fiscal
  réellement applicable.
- **Chiffres et témoignages.** Les valeurs présentes sont des exemples. Ne publier que
  des données vérifiables.
- **Conditions générales de vente.** Elles restent à rédiger, en particulier pour les
  prestations vendues aux entreprises.

## Formulaire de contact

Le site est statique : aucun serveur ne reçoit les messages. À la validation, le
formulaire compose un courriel pré-rempli et ouvre la messagerie du visiteur
(`mailto:`). L'adresse de destination est lue dans l'attribut `data-destinataire`
de la balise `<form>` dans `contact.html`.

Pour un envoi automatique sans passer par la messagerie du visiteur, deux options :

1. **Service tiers de formulaire** (Formspree, Web3Forms, Basin…) : remplacer
   l'attribut `action` du formulaire par l'adresse fournie par le service et retirer
   l'appel à `initFormulaire()` dans `assets/script.js`.
2. **Module de prise de rendez-vous** (Calendly, Cal.com…) : remplacer le formulaire
   par le lien de réservation, ce qui supprime l'aller-retour de prise de créneau.

Dans les deux cas, mettre à jour la section « Données personnelles » des mentions
légales : un service tiers implique une conservation de données à déclarer.

## Mise en ligne

Le site n'ayant aucune dépendance serveur, il peut être publié tel quel sur n'importe
quel hébergement statique (GitHub Pages, Netlify, Cloudflare Pages, ou un simple
hébergement mutualisé par FTP). Il suffit de déposer le contenu du dossier
`site-aurelie/`.

## Conventions de code

- Interface, contenus et commentaires de code entièrement en français.
- Aucun emoji dans l'interface.
- Aucune dépendance externe : ni CDN, ni police distante, ni bibliothèque JavaScript.
- Classes CSS nommées en français, feuille de styles unique et commune.
- Bascule responsive : grilles à 900 px, menu mobile à 720 px.
