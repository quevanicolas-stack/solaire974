# Checklist de publication — 50 Prompts ChatGPT pour Email Marketing : Augmente Tes Conversions en 2026

Date cible : 2026-08-01 · slug : `50-prompts-email-marketing`

## J+0 — source

- [ ] Page canonique en ligne : https://medium.com/@nqueva4/boost-your-conversions-in-2026-04b444f36d88
- [ ] Vérifier que la page répond avant de publier ailleurs (le canonical
      doit exister au moment où Medium importe).

## J+1 — Medium

- [ ] Si un jeton d'intégration existe : `MEDIUM_TOKEN=… node outils/publier-medium.mjs 50-prompts-email-marketing`
- [ ] Sinon : Medium › Write › Import a story, coller https://medium.com/@nqueva4/boost-your-conversions-in-2026-04b444f36d88,
      puis remplacer le corps par `publications/50-prompts-email-marketing/medium.md`
- [ ] Contrôler que le canonical pointe bien vers la page source
- [ ] Tags : email marketing, chatgpt, conversion, prompts, prospection

## Quora — une réponse tous les deux jours, jamais deux le même jour

- [ ] J+3 — Quora 01 : Comment utiliser ChatGPT pour écrire des objets d'email qui font ouvrir ?
- [ ] J+5 — Quora 02 : Pourquoi mes cold emails générés par ChatGPT ne reçoivent aucune réponse ?
- [ ] J+7 — Quora 03 : Comment construire une séquence de relance efficace après un premier email sans réponse ?
- [ ] J+9 — Quora 04 : ChatGPT peut-il analyser les résultats d'un test A/B sur une campagne emailing ?
- [ ] J+11 — Quora 05 : Quel canal offre le meilleur retour sur investissement en marketing en 2026 ?

Pour chaque réponse : rédiger le `-final.md`, lancer
`node outils/build.mjs --verifier`, publier à la main depuis le navigateur.
Aucune automatisation du clic : Quora n'a pas d'API d'écriture et bannit les
comptes qui publient par robot.

## J+14 — mesure

- [ ] Vues Medium, vues Quora, clics vers https://medium.com/@nqueva4/boost-your-conversions-in-2026-04b444f36d88
- [ ] Reporter le résultat dans l'en-tête de `contenus/50-prompts-email-marketing.md` (champ `statut`)
