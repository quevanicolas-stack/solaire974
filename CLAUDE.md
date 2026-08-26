# solaire974 — Calculateur d'autonomie solaire (La Réunion)

## Contexte
Application autonome d'étude photovoltaïque et de devis pour Ecologreen (SIRET 945 359 909 00013).
Fichier unique : `solaire974_3_4_5.html` (2,6 Mo, ~2100 lignes de code applicatif, HTML/CSS/JS vanilla, Chart.js 4.4.0 embarqué en local).
6 pages : client, étude de site, dimensionnement PV, financement, rentabilité 20 ans, synthèse & devis.

## Règles verrouillées — ne jamais modifier sans demande explicite
- Convention 500 Wc par panneau dans TOUS les calculs. 520 Wc uniquement en note informative.
- Profil de production hémisphère sud : pic novembre–février, creux juin–août.
- Modèle TVA/remise validé : équation quadratique pour dériver le HT brut depuis la cible TTC. TVA 2,1 % proratisée à la main-d'œuvre (MO 135 € HT/unité, 2,5 unités par panneau).
- Remise Formation : 1 500 € (sans batterie) / 3 000 € (avec batterie).
- Devis : réplique exacte du format document Ecologreen.
- `getFactApres()` : double comptage corrigé — ne pas réintroduire.
- Cas taux d'intérêt 0 % : géré — ne pas casser.
- Validation des champs requis : classe `.req-err` bloque la navigation tant que non remplis.
- Responsive : bascule mobile à ≤ 860 px.

## Contraintes de code
- Tout en français : libellés, boutons, messages système, commentaires de code.
- Pas d'emojis dans l'interface.
- Fichier unique autonome : ne pas scinder, aucune dépendance CDN ou réseau.
- Vanilla JS uniquement, pas de framework.
- Ne jamais lire ni modifier le bloc Chart.js embarqué : travailler uniquement sur le code applicatif.

## Workflow
- Branche : `main`. Messages de commit en français, atomiques.
- Avant tout commit : ouvrir le fichier dans un navigateur et vérifier les 6 pages + la génération du devis.
- Commit avant chaque série de modifications importantes (point de restauration).

---

# jarvis/ — Assistant vocal JARVIS

Sous-projet indépendant du calculateur solaire. Aucune interaction avec
`solaire974_3_4_5.html` : les règles ci-dessus ne s'y appliquent pas, sauf celles de
langue (tout en français, pas d'emojis dans l'interface).

## Contexte
Assistant personnel vocal : salutation aléatoire à l'ouverture de session, exécution
d'actions système après validation orale, pastille « réacteur arc » toujours visible.
Un compte unique partagé entre le Mac, le téléphone et la tablette.

## Architecture
- `server/` — noyau Node.js **sans aucune dépendance externe** (WebSocket implémenté
  à la main). Doit pouvoir démarrer hors ligne, sans `npm install`.
- `ui/` — interface unique servie à tous les appareils (vanilla JS, PWA).
- `desktop/` — coque Electron macOS (seul endroit où une dépendance est admise).

## Règles verrouillées
- Aucune dépendance externe dans `server/` et `ui/`.
- L'exécution système passe toujours par `execFile` avec arguments séparés ; jamais
  d'interpolation dans un shell, sauf l'intention `shell`, désactivée par défaut.
- Les actions sensibles exigent une validation orale : ne pas retirer ce garde-fou.
- Reconnaissance oui/non par correspondance **exacte** sur la phrase entière : un
  préfixe ferait passer « lance Spotify » pour un « oui ». Régression déjà survenue.
- L'analyse conserve le texte brut (accents, majuscules, chemins) via la carte
  d'indices de `normaliserAvecCarte`.
- Aucun envoi de données à un service tiers : la transcription reste locale.

## Vérifications avant commit
```sh
node jarvis/server/test-intentions.js          # 44 cas d'analyse
node jarvis/server/test-integration.js         # API, comptes, appairage, WebSocket
node jarvis/verification/verifier-interface.mjs # parcours complet au navigateur
python3 jarvis/verification/verifier-qr.py     # encodeur QR contre une référence
```
