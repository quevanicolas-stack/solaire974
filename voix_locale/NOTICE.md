# Serveur vocal local — notice d'installation

Ce serveur permet à Studio Voix de cloner et de synthétiser une voix **sans service
distant, sans abonnement et sans que les enregistrements quittent la machine**.

Il expose exactement les mêmes routes que le service distant : l'application bascule
de l'un à l'autre par un simple choix à l'étape 03.

Notice rédigée pour **Mac Apple Silicon** (M1 à M4).

---

## 1. Prérequis

Ouvrez le Terminal et vérifiez que Python est présent :

```
python3 --version
```

Il faut la version 3.10 ou supérieure. Si la commande échoue, installez Python depuis
python.org.

C'est tout. **Homebrew n'est pas nécessaire** : ffmpeg, qui sert à normaliser les
enregistrements, est installé par `pip` à l'étape suivante. Si un ffmpeg est déjà présent
sur le système, le serveur l'utilisera en priorité.

---

## 2. Installation du serveur

Depuis le dossier du projet :

```
cd voix_locale
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

L'environnement `venv` isole ces bibliothèques du reste du système. **Il faudra
retaper `source venv/bin/activate` à chaque nouveau Terminal.**

---

## 3. Premier lancement — moteur de test

Commencez toujours par là. Ce moteur ne télécharge rien et produit un signal sonore
qui ne ressemble à personne : il sert uniquement à vérifier que toute la chaîne
fonctionne avant d'installer le modèle de deux gigaoctets.

```
python serveur.py --moteur test
```

Le serveur affiche son adresse et indique où ouvrir l'application, par défaut
`http://127.0.0.1:8770/app`. Laissez cette fenêtre de Terminal ouverte.

**Un seul serveur suffit** : il sert aussi la page. Ouvrez donc simplement
`http://127.0.0.1:8770/app` dans le navigateur, puis :

1. étape 01, remplissez le consentement ;
2. étape 02, enregistrez quelques secondes ;
3. étape 03, choisissez **Serveur local** et cliquez sur **Tester la connexion** —
   l'application doit répondre « Connexion établie » et signaler qu'il s'agit du
   moteur de contrôle ;
4. étapes 04 et 05, créez la voix puis générez un audio.

Si vous entendez le signal de test, la chaîne est bonne de bout en bout.

---

## 4. Passage au clonage réel

```
pip install torch torchaudio "coqui-tts[codec]" "transformers>=4.57,<5"
COQUI_TOS_AGREED=1 python serveur.py --moteur xtts
```

Aucune de ces deux précisions n'est facultative. La borne sur `transformers` évite la
version 5, qui a supprimé une fonction que XTTS importe encore. L'extra `[codec]`
installe `torchcodec`, exigé pour la lecture audio depuis PyTorch 2.9. La variable
`COQUI_TOS_AGREED` répond à la demande d'acceptation de la licence affichée au premier
téléchargement ; lancez sans elle si vous préférez lire la licence et répondre vous-même.

Le premier lancement télécharge environ deux gigaoctets, puis charge le modèle : comptez
plusieurs minutes. Les lancements suivants sont rapides. Rien d'autre ne change dans
l'application : recréez simplement la voix à l'étape 04, car la référence doit être
analysée par le nouveau moteur.

**Vitesse attendue sur Apple Silicon** : le serveur utilise volontairement le processeur
plutôt que l'accélérateur graphique, dont certaines opérations manquent encore pour ce
modèle. Comptez quelques secondes pour une phrase courte.

### Licence — point important

XTTS-v2 est diffusé sous une licence qui **exclut l'usage commercial**. Il convient pour
essayer, comparer et pour un usage privé. Pour des vidéos d'entreprise, il faudra basculer
sur un modèle à licence permissive : c'est la raison pour laquelle le moteur est
interchangeable dans `serveur.py`.

---

## 5. Assistant conversationnel

Le même serveur porte un assistant qui répond aux questions **avec votre voix**. Il est
servi à l'adresse `http://127.0.0.1:8770/chat` et s'intègre dans vos propres applications
par une simple balise `iframe` (bouton **Intégrer** de la page).

### Essai sans rien installer

```
python serveur.py --moteur test --chat test
```

Les réponses sont alors fabriquées par le serveur, sans aucun modèle : chaque réponse le
signale à l'écran. Cela permet de vérifier toute la chaîne — question, réponse écrite,
lecture à voix haute — avant d'engager quoi que ce soit.

### Réponses réelles

```
pip install anthropic
export ANTHROPIC_API_KEY="votre-clé"
python serveur.py --moteur xtts --chat claude
```

**La clé reste sur le serveur.** C'est la différence essentielle avec la clé du studio
vocal, qui vous est personnelle et vit dans votre navigateur : celle-ci serait lisible par
n'importe quel visiteur si elle se trouvait dans la page. Le composant ne la voit jamais,
et n'a d'ailleurs aucun moyen de la demander.

### Régler l'assistant

```
python serveur.py --chat claude --personnalite consignes.txt
python serveur.py --chat claude --voix-assistant Nicolas
```

`--personnalite` remplace les consignes données au modèle par le contenu d'un fichier
texte. Ces consignes viennent **toujours** du serveur : la page ne peut pas les réécrire,
sans quoi un visiteur le ferait depuis la console de son navigateur.

`--voix-assistant` impose la voix employée ; à défaut, c'est la première voix enregistrée.

### Garde-fous en place

Ils sont modestes tant que l'usage reste interne, mais ils existent dès maintenant :
mille caractères par message, trente échanges par heure et par session, historique borné
à vingt tours. Ils se règlent dans `LIMITES`, au début de `serveur.py`.

La mention « assistant automatique, voix de synthèse » est affichée en permanence et
répétée dans le message d'accueil. Elle n'est pas un ornement : c'est ce qui distingue un
assistant d'une usurpation. Ne la retirez pas avant d'exposer la page à des tiers.

**Ce qui manque encore pour un usage public.** Le serveur n'a aucune authentification et
accepte les appels de n'importe quelle origine. Tant qu'il n'écoute que sur `127.0.0.1`,
cela reste sans conséquence. Avant de l'ouvrir sur internet il faudra, au minimum, le
placer derrière un domaine à vous, restreindre les origines autorisées et rattacher le
quota à autre chose qu'un identifiant fourni par le navigateur.

---

## 6. Qualité de la sortie

### Le grain de fond

Le moteur laisse un léger souffle sous la parole. La porte de bruit de
l'application ne peut rien contre lui : elle coupe entre les mots, et couper
sous la parole reviendrait à couper la voix. Un traitement spectral est donc
appliqué par le serveur, réglable à l'étape Synthèse sous **Suppression du bruit
de fond**.

| Niveau  | Souffle retiré | Perte sur les sifflantes |
|---------|----------------|--------------------------|
| léger   | 12 dB          | 0,3 dB                   |
| moyen   | 24 dB          | 0,4 dB                   |
| fort    | 40 dB          | 0,5 dB                   |
| maximum | 60 dB          | 0,6 dB                   |

**Moyen** est le réglage par défaut. Au-delà de **fort**, les aigus commencent à
se ternir sur certaines voix : jugez à l'oreille, la comparaison avant/après
reste affichée sous chaque génération.

Cela ne dispense pas d'une référence propre : un souffle présent dans
l'enregistrement est appris par le modèle et ressort à chaque phrase. Pour le
traiter à la source, cochez « Retirer le bruit de fond » à l'étape Voix et
recréez la voix.

### Trois versions à chaque génération

Le serveur ne prononce le texte qu'une fois, puis en filtre trois copies. Les
trois sont écoutables côte à côte, téléchargeables séparément, et conservées en
bibliothèque :

- **Non traité** — exactement ce que le moteur a produit, sans aucun filtre.
- **Vos réglages** — le débruitage, le nettoyage et la chaîne radio que vous avez choisis.
- **Proposition** — une chaîne déduite des mesures de l'audio réellement produit,
  accompagnée du détail de chaque décision : plancher de bruit, énergie des graves,
  place des sifflantes, écart entre crête et niveau moyen.

Demander trois fois le même texte au modèle serait à la fois plus lent et
trompeur : chaque prononciation diffère légèrement, et la comparaison ne
porterait plus sur le seul traitement.

### Commande directe du moteur

L'étape Synthèse expose, sous **Commande directe du moteur**, tout ce que le
modèle accepte : température, diversité (`top_p`), nombre de choix examinés
(`top_k`), pénalités de répétition et de longueur, découpage interne, durée des
deux pauses et graine.

La graine mérite une mention : à réglages égaux, deux générations de même graine
donnent le même audio. En changer donne une autre interprétation du même texte
sans rien modifier d'autre — c'est le moyen propre de relancer un essai qui ne
convient pas.

Ces valeurs sont normalement déduites des curseurs de rendu. La case « piloter
le moteur à la main » court-circuite cette déduction ; un bouton rétablit les
valeurs déduites.

### Le niveau sonore, et le plafond de qualité

L'étape Synthèse propose une mise au niveau en **LUFS**, la mesure du volume
perçu employée en télévision, au cinéma et sur les plateformes : -23 LUFS pour
la norme EBU R128, -16 pour l'écoute en ligne, -14 pour les plateformes
musicales. Elle agit en tout dernier, après le traitement, et respecte un
plafond de crête pour ne jamais saturer.

C'est ce qui manquait pour que deux phrases générées séparément s'entendent au
même niveau : la normalisation sur la crête, elle, ne dit rien du volume perçu.

**Ce qu'aucun réglage ne rattrapera.** XTTS-v2 produit du 24 kHz. Rien n'existe
donc au-dessus de 12 kHz, et convertir en 48 kHz ne crée pas cette information :
mesurée sur une conversion, la bande 13-23 kHz est 51 dB sous la bande utile,
c'est-à-dire vide. Un dialogue de cinéma porte du contenu jusque vers 20 kHz.
Pour franchir ce plafond il faut changer de modèle, pas de réglage.

### L'égaliseur

Les cinq bandes de l'étape Synthèse sont réglables en **gain, fréquence et
largeur**, et les deux extrêmes basculent entre plateau et cloche. Cette
distinction compte : une résonance de pièce se loge vers 180 Hz, au-dessus du
coupe-bas, et un plateau ne peut pas l'atteindre — seule une cloche le peut.

Un préréglage **« Voix claire »** reprend une correction établie en mesurant une
génération réelle : coupe-bas à 110 Hz, creux de 9 dB à 180 Hz, bas-médiums
dégagés de 4 dB à 300 Hz, bande des consonnes remontée de 5 dB à 3,2 kHz. Sur
la génération qui a servi de cas d'école, le bourdonnement passe de +10,9 à
+6,8 dB au-dessus de la voix et la présence de -26,6 à -16,9 dB.

Les quatre préréglages d'origine portent désormais leurs fréquences en toutes
lettres, aux valeurs qui étaient inscrites dans le code : ils sonnent comme
avant.

**Une limite à connaître.** L'égaliseur corrige un déséquilibre de timbre, pas
une réverbération. Si l'enregistrement de référence a été fait dans une pièce
vivante, la traîne est apprise par le modèle et ressort à chaque phrase ; tout
réglage qui la réduit vraiment supprime aussi les consonnes, mesures à l'appui.
Il faut alors refaire la référence dans une pièce mate.

### La régularité du débit

Sur un texte de plusieurs phrases, le modèle reprenait chaque phrase de zéro :
le débit et l'intonation changeaient en cours de route. Le serveur découpe
désormais lui-même le texte sur les respirations posées par le style
d'élocution, prononce chaque morceau avec les mêmes réglages et la même graine,
puis recolle avec des silences de durée choisie — 0,28 s entre propositions,
0,55 s entre phrases, raccourcis à proportion quand le débit augmente.

---

## 7. Options utiles

```
python serveur.py --moteur test --port 8771     # changer de port
python serveur.py --moteur xtts --peripherique cpu
python serveur.py --hote 0.0.0.0                # exposer sur le réseau local
```

`--hote 0.0.0.0` rend le serveur accessible aux autres appareils du réseau, y compris un
téléphone. À n'utiliser que sur un réseau de confiance : le serveur n'a aucune
authentification.

---

## 8. Où sont les données

```
voix_locale/donnees/voix/<identifiant>/
    reference.wav   échantillon normalisé servant de modèle vocal
    voix.json       nom, description, durée, date de création
```

Ce dossier est exclu du dépôt git : ces enregistrements sont des données personnelles et
ne doivent pas être versionnés. Supprimer une voix depuis l'étape 04 efface le dossier
correspondant.

---

## 9. En cas de problème

**« Le serveur local ne répond pas »** — vérifiez que la fenêtre de Terminal du serveur
est toujours ouverte, et que l'adresse de l'étape 03 correspond à celle affichée au
démarrage.

**« ffmpeg est introuvable »** — `pip install imageio-ffmpeg`, puis relancez le serveur.
Au démarrage, le serveur affiche le chemin du ffmpeg qu'il a retenu.

**« Could not load libtorchcodec » ou « Library not loaded: libavutil »** — torchcodec
réclame les bibliothèques partagées de FFmpeg, qu'un exécutable autonome n'apporte pas.
Le serveur contourne ce point en lisant lui-même la référence : vous devez voir au
démarrage la ligne « lecture audio autonome activée ». Si elle manque, votre `serveur.py`
est antérieur à ce correctif.

**« Le moteur XTTS n'est pas installé »** — `source venv/bin/activate` puis
`pip install coqui-tts`.

**Le port est déjà utilisé** — relancez avec `--port 8771` et corrigez l'adresse dans
l'application.

**« Not Found » en ouvrant /chat** — le `serveur.py` en place est antérieur à
l'assistant. Vérifiez la version affichée au démarrage, ou ouvrez
`http://127.0.0.1:8770/` : le champ `version` doit être présent. Si la ligne
manque, refaites la mise à jour des fichiers.

**« Le paquet anthropic n'est pas installé »** — `source venv/bin/activate` puis
`pip install anthropic`. Sans lui, lancez avec `--chat test`.

**« ANTHROPIC_API_KEY est vide »** — `export ANTHROPIC_API_KEY="votre-clé"` dans le même
Terminal, avant de lancer le serveur. La variable disparaît à la fermeture du Terminal.

**L'assistant répond mais reste muet** — aucune voix n'est enregistrée sur le serveur, ou
celle demandée n'existe pas. Créez-la dans le studio, page Voix, puis rouvrez `/chat`.

**« Limite d'échanges atteinte »** — le garde-fou de trente échanges par heure. Modifiez
`LIMITES` dans `serveur.py` si l'usage le justifie.

---

## 10. Rappel sur le consentement

Le verrou de l'étape 01 reste la seule protection en mode local : les garde-fous du
fournisseur distant n'existent plus ici. Le consentement de la personne dont la voix est
reproduite reste requis, et les productions doivent toujours être présentées comme des
voix de synthèse.
