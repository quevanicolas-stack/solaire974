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
- `voix_locale/preparer_corpus.py` prépare un corpus d'affinage : il mesure chaque prise et refuse celles qui abîmeraient le modèle (traîne > 250 ms, fond > -50 dB, moindre saturation). Ne jamais assouplir ces seuils sans demande : un défaut appris par les poids devient irréversible, là où un défaut de référence se corrige en changeant de référence.
- `voix_locale/texte_a_lire.txt` couvre les sons du français et plusieurs registres. Il ne dure que quatre minutes : c'est un noyau, pas un corpus.
- L'affinage lui-même n'est pas outillé : il demande un GPU loué, et il n'y a aucun intérêt à l'écrire avant d'avoir un corpus qui le mérite.
- Suppression du bruit de fond : traitement spectral côté serveur (`NIVEAUX_DEBRUITAGE`), cinq niveaux, « moyen » par défaut. Ne jamais ajouter `tn=1` à `afftdn` : le suivi de bruit annule la réduction.
- Régularité du débit et limite du moteur : XTTS refuse plus de **273 caractères en français** — au-delà il tronque et se contente d'un avertissement dans ses journaux, rien ne remonte à l'application. `decouper_texte()` découpe donc en phrases, puis aux articulations (virgule, point-virgule, deux-points), puis aux espaces, sous `LONGUEUR_MAX` = 230. Chaque morceau est prononcé avec la même graine puis recollé avec des silences (`PAUSE_COURTE`, `PAUSE_LONGUE`). Ne jamais revenir à un découpage sur les seuls retours à la ligne : un texte collé arrive en un bloc et perd tout ce qui dépasse. `split_sentences` reste faux sous `LONGUEUR_MAX`.
- Une ligne repliée par la mise en page est recollée à la précédente quand celle-ci ne finit par aucune ponctuation et que la suivante commence par une minuscule : sinon la coupure d'un traitement de texte s'entend comme une respiration au milieu d'une phrase. Un retour à la ligne après ponctuation reste une respiration voulue.
- `_phrases()` coupe aussi sur un point collé au mot suivant (« toutes.Regardez »), mais jamais après une abréviation de `ABREVIATIONS`, ni entre deux chiffres, ni après une initiale isolée.
- Lexique de prononciation appliqué dans `preparerTexte`, avant la mise en forme du style : le texte saisi et celui conservé en bibliothèque restent intacts. Bornes de mot posées à la main (`\p{L}`), les bornes `\b` ignorant les accents.
- XTTS n'a **aucune entrée phonétique** : ni alphabet phonétique, ni espeak, ni conversion graphème-phonème. Le texte nettoyé (minuscules, nombres et sept abréviations développés) va directement au tokeniseur BPE. Impossible donc de lui fournir un dictionnaire phonétique : le seul levier est l'orthographe. Ne jamais promettre le contraire.
- `LEXIQUE_BASE` = `VERBES_ER` + `SIGLES` + `ANGLICISMES`, chaque liste désactivable, chaque entrée écartable. Les mots de l'utilisateur passent **avant** : une entrée de base portant le même mot est retirée.
- `VERBES_ER` est une liste nommée de verbes, jamais une règle sur la terminaison : « hiver », « cher », « mer », « papier », « premier » finissent aussi par -er et seraient abîmés. « reporter » et « supporter » en sont exclus — ce sont aussi des noms dont le R se prononce, la correction serait fautive une fois sur deux. `verifier.js` impose ces deux points.
- Les prononciations du lexique de base n'ont pas pu être vérifiées à l'oreille : XTTS ne tourne pas dans l'environnement de développement. Elles reposent sur le comportement connu du moteur, et restent réversibles une à une.
- Tout morceau recollé par `assembler_audio` passe par `adoucir_extremites` : sans ce fondu, la jonction contre le silence forme une marche qui s'entend comme un clic.
- Égaliseur paramétrique à cinq bandes : gain, fréquence et largeur réglables, plateau ou cloche aux extrêmes. `BANDES_ORIGINE` fige les fréquences d'avant pour que les préréglages historiques sonnent à l'identique.
- Tout réglage passé à `appliquerTraitement` doit décrire ses bandes au complet : une fréquence absente devient NaN et le navigateur refuse le filtre, ce qui fait échouer la génération entière. `chaineProposee` les décrit toutes, et `bande()` retombe sur des valeurs sûres.
- `messageReseau` distingue une panne réseau d'une erreur de traitement locale : confondre les deux fait chercher la panne du mauvais côté.
- Mise au niveau en LUFS (UIT-R BS.1770) implémentée dans la page, en dernier maillon : toute correction postérieure ferait manquer la cible. Mesure vérifiée contre `ebur128` de ffmpeg, écart inférieur à 0,05 LUFS.
- Plafond de qualité assumé : le moteur sort du 24 kHz, donc rien au-dessus de 12 kHz. Ne jamais présenter une conversion en 48 kHz comme un gain de finesse.
- Trois versions par génération (non traitée, vos réglages, proposition) pour une seule prononciation : le drapeau `variantes` fait renvoyer du JSON base64. Ne jamais synthétiser trois fois le même texte pour comparer, chaque prononciation diffère.
- La proposition est déduite des mesures (`mesurer_wav` côté serveur, `mesurerAudio` côté page) et motivée à l'écran, valeur par valeur. Aucun réglage n'y est décidé à l'avance.
- La commande directe du moteur expose tous les paramètres d'inférence. Ils ne sont transmis que si l'utilisateur prend la main ; sinon le serveur les déduit de la stabilité.
- `VERSION` dans `serveur.py` est exposée sur `/` et `/v1/user` : c'est le moyen de vérifier quel fichier tourne réellement chez l'utilisateur.
- Le clonage instantané exige un abonnement payant chez le fournisseur ; les offres gratuites le refusent.
- Ouvert en `file://`, le navigateur bloque les appels distants : servir la page par un serveur local (`npx http-server`) pour tester le clonage réel.
- Micro depuis un téléphone : `--hote 0.0.0.0` ne suffit pas, les navigateurs n'ouvrent `getUserMedia` que sur un contexte sûr. `--https` émet un certificat auto-signé portant l'adresse du Mac en `subjectAltName` — sans cette extension, le navigateur le rejette même après acceptation de l'exception.
- Matière de référence : XTTS calcule une empreinte **par fichier** fourni et en fait la moyenne, en ne lisant que le début de chacun (`max_ref_len` = 10 s, `gpt_cond_len` = 12 s par défaut). Une référence concaténée en un seul fichier se réduit donc à dix secondes, quelle que soit sa longueur. D'où `decouper_reference()` : la référence est découpée en tranches de 30 s, chaque tranche devient une empreinte de plus, et les trois durées sont transmises explicitement (`REF_EMPREINTE`, `REF_PROSODIE`). Ne jamais revenir à un fichier unique ni laisser les valeurs par défaut.
- L'empreinte est mise en cache par `clone_voice(speaker_id=…, voice_dir=…)`, qui écrit un `.pth` relu à chaque synthèse. Sans ce cache, les vingt tranches seraient relues à chaque morceau de texte, ce qui coûte plus cher que la synthèse. Le repli sur les tranches puis sur `reference.wav` doit rester : il fait fonctionner les voix créées avant ce changement.
- Plafonds de prise : 5 min par prise (arrêt automatique), 30 min cumulées, cible d'affichage à 5 min. Le cumul au-delà de la cible n'est pas perdu — il sert à l'affinage — et la page doit continuer de le dire au lieu d'affirmer que le surplus est inutile.
- Détection du grondement : elle s'appuie sur la fondamentale **mesurée** de la voix, jamais sur un seuil fixe. L'ancienne règle comparait l'énergie sous 120 Hz au niveau général à travers un filtre du premier ordre ; sur une voix à 198 Hz elle mesurait la fondamentale et posait alors un creux de 7 dB à 180 Hz, c'est-à-dire sur la voix. Vérifié : effacer tout ce qui se trouvait sous 150 Hz ne changeait la mesure que de 0,02 dB. Le coupe-bas et le creux restent sous la fondamentale — `verifier.js` l'impose.
- `voix_locale/verifier_moteur.py` contrôle le chemin XTTS avec un modèle factice : XTTS ne peut pas tourner à chaque vérification, et c'est pourtant là qu'une erreur ne se voit qu'au moment de générer.
- `voix_locale/verifier.js` est la suite de vérification : elle pilote un navigateur réel et couvre d'abord les règles verrouillées, puis la chaîne complète et les pièges déjà rencontrés. La lancer avant tout commit sur le Studio Voix ou l'assistant. Les anciennes suites vivaient hors du dépôt et un redémarrage les a perdues : ne jamais en écrire une ailleurs qu'ici.
- Conversion de fréquence à l'export : `reechantillonner()` fait jouer le tampon à travers un `OfflineAudioContext`, et l'interpolation du navigateur laisse passer des images au-dessus de la demi-fréquence du moteur. Mesuré sur une génération en 44,1 kHz : bande 13–16 kHz à −14/−20 dB sous la référence, miroir du contenu sous 12 kHz (corrélation 0,993 après suppression de la tendance). « Celle du moteur — aucune conversion » reste le choix sain tant qu'un passe-bas n'a pas été ajouté après conversion.
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
