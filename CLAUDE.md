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

# Studio Voix — Clonage et synthèse vocale

## Contexte
Seconde application du dépôt, indépendante du calculateur solaire.
Fichier unique : `clonage_voix.html` (HTML/CSS/JS vanilla, même charte graphique que l'appli solaire).
4 pages : consentement, voix (connexion, enregistrement, création), synthèse, bibliothèque.
Serveur local optionnel : `voix_locale/serveur.py` (FastAPI), qui expose les mêmes routes que le service distant et sert aussi la page sur `/app`.

## Règles verrouillées — ne jamais modifier sans demande explicite
- Page 01 = verrou de consentement. Elle bloque l'accès à toutes les autres pages tant qu'elle n'est pas validée : ne jamais la contourner, la rendre optionnelle ni la retirer.
- Les quatre engagements de la page 01 sont obligatoires et cumulatifs.
- Bandeau permanent « Contenu synthétique » en haut de l'application.
- Les fichiers générés portent le préfixe `voix-synthetique_` dans leur nom : ne pas le retirer.
- La clé d'accès reste côté navigateur (`sessionStorage`, ou `localStorage` sur choix explicite). Ne jamais l'écrire en dur dans le fichier ni la transmettre ailleurs qu'au fournisseur.
- Le mode démonstration doit toujours annoncer qu'il n'utilise pas la voix enregistrée.
- Responsive : bascule mobile à ≤ 860 px.

## Contraintes de code
- Mêmes règles que l'appli solaire : tout en français, pas d'emojis, vanilla JS, fichier unique.
- Exception à la règle « aucun réseau » : le clonage et la synthèse appellent `api.elevenlabs.io`. Aucune autre dépendance distante, aucun CDN.
- Stockage local des échantillons et des audios générés en IndexedDB (base `studio_voix`).

## Notes techniques
- Le clonage instantané exige un abonnement payant chez le fournisseur ; les offres gratuites le refusent.
- Ouvert en `file://`, le navigateur bloque les appels distants : servir la page par un serveur local (`npx http-server`) pour tester le clonage réel.
- Le mode démonstration (voix du navigateur) fonctionne sans clé ni réseau.

---

# Assistant vocal — chatbot embarquable

## Contexte
Troisième brique du dépôt, adossée au serveur local du Studio Voix.
Fichier unique : `chatbot_voix.html`, servi par `serveur.py` sur `/chat`, intégrable dans une autre application par une balise `iframe`.
Le serveur porte les routes `/v1/chat` et `/v1/chat/config` et deux moteurs de conversation : `test` (réponses fabriquées, aucune clé) et `claude` (modèle `claude-opus-5`, réflexion adaptative).

## Règles verrouillées — ne jamais modifier sans demande explicite
- La clé du modèle reste **côté serveur**, lue dans `ANTHROPIC_API_KEY`. Ne jamais l'exposer dans la page ni l'accepter depuis le navigateur : contrairement à la clé du studio vocal, elle serait lisible par tout visiteur.
- La personnalité de l'assistant vient du serveur seul. La page n'envoie jamais de consigne système : elle serait réécrite depuis la console du navigateur.
- Bandeau permanent « Voix synthétique » et message d'accueil annonçant qu'il s'agit d'un programme. C'est ce qui distingue un assistant d'une usurpation : ne pas le retirer.
- Le moteur `test` doit toujours signaler, sur chaque réponse, qu'elle est fabriquée et qu'aucun modèle n'a été interrogé.
- Garde-fous d'usage actifs par défaut (`LIMITES` dans `serveur.py`) : longueur de message, quota par session, historique borné.
- Responsive : bascule mobile à ≤ 860 px.

## Contraintes de code
- Mêmes règles que les autres applis : tout en français, pas d'emojis, vanilla JS, fichier unique et autonome.
- La page ne connaît que son serveur : aucune dépendance distante, aucun CDN.
- Réglages transmissibles par l'adresse (`serveur`, `voix`, `titre`, `micro`, `accueil`), pour intégrer le composant sans le modifier.

## Notes techniques
- Dictée par la reconnaissance vocale du navigateur : optionnelle, absente hors Chrome et Safari, le bouton se masque alors de lui-même.
- La lecture automatique peut être refusée par le navigateur sans geste préalable de l'utilisateur ; les commandes du lecteur restent le recours.
- Les réponses sont lues avec les réglages du style « conversation » du studio.
