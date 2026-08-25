# Chaîne de publication Medium + Quora

Un article source, deux diffusions, une seule commande pour tout régénérer.
Cette chaîne est indépendante du calculateur solaire : elle ne touche jamais
`solaire974_3_4_5.html`.

## Ce qui est automatisé, et ce qui ne peut pas l'être

| Étape | État | Pourquoi |
| --- | --- | --- |
| Fabrication de l'article Medium (HTML + markdown) | automatique | `outils/build.mjs` |
| Publication sur Medium | automatique **si** un jeton d'intégration existe | Medium n'en délivre plus depuis 2023 ; les anciens fonctionnent encore |
| Publication sur Medium sans jeton | manuelle, 30 secondes | import depuis l'URL canonique |
| Canevas des réponses Quora | automatique | `outils/build.mjs` |
| Rédaction des réponses Quora | manuelle (ou assistée) | une réponse doit répondre à *sa* question, pas résumer l'article |
| Publication sur Quora | **manuelle, obligatoirement** | aucune API d'écriture, et l'automatisation du clic fait bannir le compte |
| Contrôle anti-duplication | automatique | `outils/build.mjs --verifier` |
| Rappel hebdomadaire | automatique | `.github/workflows/publication-hebdo.yml` |

Le seul geste humain incompressible : coller les réponses Quora dans le
navigateur, une par jour.

## Commandes

```bash
node outils/build.mjs              # régénère publications/ pour tous les articles
node outils/build.mjs --verifier   # contrôle que les réponses Quora ne dupliquent pas l'article
node outils/build.mjs --planning   # corps de l'issue hebdomadaire (ce qui reste à publier)

MEDIUM_TOKEN=… node outils/publier-medium.mjs <slug>             # crée un brouillon Medium
MEDIUM_TOKEN=… node outils/publier-medium.mjs <slug> --publier   # publie pour de bon
```

## Écrire un nouvel article

1. Copier `_modele.md` en `<slug>.md` dans ce dossier.
2. Remplir l'en-tête : `slug`, `titre`, `canonical`, `medium_titre`,
   `quora_questions` sont obligatoires.
3. Écrire le corps en markdown sous la ligne `---`.
4. `node outils/build.mjs` → tout arrive dans `publications/<slug>/`.

### En-tête, champs utiles

| Champ | Rôle |
| --- | --- |
| `statut` | `brouillon` ou `publie` — un article `publie` sort du planning hebdomadaire |
| `date_publication` | date cible, sert à l'ordre du planning |
| `langue_source` | langue du corps ; si elle diffère de `medium_langue`, le build marque la traduction à faire |
| `canonical` | l'URL de référence de l'article — voir ci-dessous |
| `medium_url` | l'URL Medium une fois publié ; si elle est égale au canonical, le build n'envoie pas de `canonicalUrl` à l'API |
| `quora_registre` | `tutoiement` ou `vouvoiement`, reporté dans chaque canevas |

## Le canonical

Le canonical désigne la version de référence aux yeux de Google. Deux cas :

- **Pas de site à soi** (situation actuelle) : Medium est la référence.
  `canonical` = l'URL Medium, et les réponses Quora pointent vers elle.
- **Un site à soi plus tard** : publier d'abord la page, mettre son URL dans
  `canonical`, puis importer sur Medium — Medium pose alors automatiquement le
  canonical vers la page d'origine. Relancer `node outils/build.mjs` après le
  changement.

Dans les deux cas la page canonique doit être **en ligne avant** la publication
Medium, sinon l'import ne récupère rien.

## Pourquoi on ne colle pas l'article sur Quora

Une reprise mot pour mot est du contenu dupliqué : Google choisit une seule
version et déclasse l'autre, et le canonical ne protège pas une republication
sur Quora. `--verifier` compare chaque réponse rédigée à l'article par blocs de
huit mots et signale toute reprise littérale. Le contrôle tourne aussi dans le
workflow hebdomadaire.

## Cadence

- J+0 : la page canonique est en ligne.
- J+1 : Medium.
- J+3, puis une tous les deux jours : les réponses Quora, jamais deux le même
  jour, jamais plus d'un lien par réponse.
- J+14 : relever les vues et les clics, reporter dans `statut`.

Une réponse Quora sans lien de temps en temps entretient le compte sans le
faire passer pour un canal promotionnel. C'est ce que regarde la modération.

## Intégration RSS des Espaces Quora

Un Espace Quora accepte un flux RSS en source. Les liens n'y sont pas publiés :
ils arrivent dans la file « Suggestions » de la modération, à valider à la main.
Quora limite la fréquence de lecture du flux — une fois par jour au maximum,
au-delà le flux est coupé environ 24 heures. C'est utile pour alimenter un
Espace en liens, pas pour publier des réponses.
