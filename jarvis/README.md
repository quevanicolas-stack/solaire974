# JARVIS

Assistant personnel vocal. Il vous parle a l'ouverture de la session, demande sur quoi
vous travaillez, execute vos demandes apres validation orale, et affiche en permanence
une pastille bleue en haut de l'ecran qui oscille quand il parle.

Le meme compte fonctionne sur le Mac, le telephone et la tablette : conversation,
memoire et raccourcis sont partages, et le reacteur de tous les appareils oscille en
meme temps.

---

## Ce que fait JARVIS

- **Il ouvre la conversation.** A chaque session, une salutation differente, adaptee au
  moment de la journee, suivie d'une question de travail tiree au hasard : « Sur quoi
  travaille-t-on aujourd'hui ? », « On attaque quoi en premier ? », « Quelle est la
  mission du jour ? »
- **Il agit sur le systeme.** Ouvrir une application, un dossier, un fichier, un site,
  chercher sur internet, regler le son, piloter la musique, verrouiller ou eteindre la
  machine, prendre une capture d'ecran, lancer un minuteur.
- **Il attend votre accord.** Toute action sensible est reformulee a voix haute et
  n'est executee qu'apres un « oui », « vas-y » ou « je confirme ».
- **Il se souvient.** « Note que le devis part vendredi », puis plus tard « De quoi on
  parlait ? ». Le sujet du jour est rappele a la salutation suivante.
- **Il vous suit.** Une commande dictee sur le telephone apparait sur le Mac, et
  inversement.

---

## Installation sur le Mac

### 1. Prerequis

Node.js 18 ou superieur :

```sh
node --version        # doit afficher v18 ou plus
```

S'il est absent : `brew install node`, ou telechargez-le depuis nodejs.org.

### 2. Installation

```sh
cd jarvis
npm install
```

### 3. Lancement

En application (fenetre, pastille et zone de notification) :

```sh
npm start
```

Ou en serveur seul, sans Electron, pour piloter JARVIS depuis un navigateur :

```sh
npm run serveur
```

Puis ouvrez `http://localhost:4790`.

### 4. Creation du compte

Au premier lancement, choisissez « Creer un compte » : une adresse de courriel et un
mot de passe d'au moins huit caracteres. Ce compte reste sur votre machine, il n'est
envoye nulle part.

### 5. Lancement automatique a l'ouverture de session

Menu de la zone de notification (la pastille dans la barre du haut) →
**Lancer au demarrage de la session**.

JARVIS demarre alors masque, salue, et attend.

### 6. Autorisations macOS

Au premier usage, macOS demande deux autorisations. Les deux sont necessaires :

- **Microphone** — pour entendre vos commandes.
- **Automatisation** (Reglages Systeme → Confidentialite et securite → Automatisation)
  — pour piloter le volume, la musique et la mise en veille.

Si une commande reste sans effet, c'est presque toujours une autorisation refusee.

### 7. Empaquetage en application .app

```sh
npm run empaqueter
```

Le fichier `.dmg` est produit dans `dist/`. Glissez JARVIS dans le dossier
Applications.

---

## La pastille du reacteur

Une pastille bleue transparente, toujours au-dessus des autres fenetres, y compris en
plein ecran. Elle indique l'etat de JARVIS :

| Aspect | Etat |
| --- | --- |
| Bleu clair, respiration lente | au repos, en arriere-plan |
| Cyan, arcs tournants | micro ouvert, il vous ecoute |
| Bleu vif, oscillation | il parle : la couronne suit le rythme des mots |
| Violet, trois points orbitaux | il traite votre demande |
| Gris barre | liaison avec le serveur perdue |

Gestes disponibles :

- **Clic** : ouvrir ou fermer le micro
- **Double clic** : ouvrir la fenetre principale
- **Clic droit** : menu
- **Glisser** : deplacer la pastille

Position, diametre et opacite au repos se reglent dans **Reglages → Reacteur**.
Raccourci global pour parler sans quitter l'application en cours : **Option + Espace**.

---

## Ajouter le telephone ou la tablette

Le Mac heberge le service ; le telephone et la tablette s'y connectent sur le meme
reseau local (Wi-Fi de la maison ou du bureau).

1. Sur le Mac : **Reglages → Appareils → Ajouter un telephone ou une tablette**.
   Un code QR et un code a six chiffres s'affichent, valables cinq minutes.
2. Sur le telephone : scannez le code QR. Le navigateur s'ouvre sur l'interface avec
   le code deja rempli ; validez.
   Sans scanner : ouvrez l'adresse affichee (par exemple `http://192.168.1.20:4790`),
   onglet **Code d'appairage**, saisissez les six chiffres.
3. **Pour l'installer comme une application** :
   - iPhone et iPad : dans Safari, bouton Partager → **Sur l'ecran d'accueil**.
   - Android : menu de Chrome → **Installer l'application**.

L'icone du reacteur apparait alors sur l'ecran d'accueil, et JARVIS s'ouvre en plein
ecran, sans barre de navigateur.

Pour retirer un appareil perdu ou pretee : **Reglages → Appareils → Revoquer**.

> Le telephone doit etre sur le meme reseau que le Mac, et le Mac allume. Pour un
> acces depuis l'exterieur, passez par un reseau prive virtuel vers votre domicile :
> n'exposez pas ce service directement sur internet.

---

## Parler a JARVIS

### Ou la reconnaissance vocale fonctionne

| Contexte | Reconnaissance |
| --- | --- |
| Safari ou Chrome sur le Mac | Native, immediate |
| iPhone, iPad (Safari) | Native, immediate |
| Android (Chrome) | Native, immediate |
| Application JARVIS (fenetre Electron) | Necessite whisper, voir ci-dessous |

La fenetre de l'application ne dispose pas du moteur de reconnaissance des navigateurs.
Deux solutions, au choix :

- **La plus simple** : lancez `npm run serveur` et utilisez JARVIS dans Safari, en
  gardant l'application ouverte pour la pastille.
- **La plus autonome** : installez whisper.cpp, qui transcrit localement, sans reseau.

### Installer whisper (facultatif)

```sh
brew install whisper-cpp ffmpeg
curl -L -o ~/modeles/ggml-medium.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
```

Puis dans `~/.jarvis/config.json` :

```json
"whisper": {
  "binaire": "/opt/homebrew/bin/whisper-cli",
  "modele": "~/modeles/ggml-medium.bin",
  "langue": "fr"
}
```

Aucun extrait audio ne quitte la machine : l'enregistrement est transcrit puis efface.

### Mot de reveil

Par defaut, le micro s'ouvre au clic ou par **Option + Espace**. Pour une ecoute
permanente, activez **Reglages → Ecoute → Ecoute continue du mot de reveil**. JARVIS
n'agit alors que sur les phrases contenant le mot de reveil (« jarvis » par defaut).

---

## Ce que vous pouvez dire

| Vous dites | JARVIS fait |
| --- | --- |
| « Ouvre Safari », « Lance Spotify » | ouvre l'application |
| « Va sur YouTube », « Ouvre google.fr » | ouvre le site |
| « Ouvre le dossier Telechargements » | ouvre le dossier dans le Finder |
| « Ouvre le fichier ~/Documents/Devis.pdf » | ouvre le fichier |
| « Cherche la meteo a Saint-Denis » | lance la recherche |
| « Mets le volume a 40 », « Monte le son », « Coupe le son » | regle le son |
| « Morceau suivant », « Pause », « Reprends la lecture » | pilote Musique ou Spotify |
| « Mets un minuteur de dix minutes » | lance un minuteur, annonce sur tous les appareils |
| « Prends une capture d'ecran » | enregistre la capture sur le bureau |
| « Note que je dois rappeler Paul » | retient la note |
| « De quoi on parlait ? » | relit le sujet du jour et les notes |
| « On travaille sur le devis Ecologreen » | fixe le sujet du jour |
| « Quelle heure est-il ? », « Quel jour sommes-nous ? » | repond |
| « Niveau de batterie », « Etat des systemes » | fait le point |
| « Verrouille l'ecran », « Mets en veille », « Eteins l'ordinateur » | apres confirmation |
| « Ferme Spotify » | apres confirmation |
| « Que sais-tu faire ? » | enumere ses capacites |

Vos propres phrases se declarent dans **Reglages → Raccourcis vocaux** : un nom, une
ou plusieurs phrases declenchantes, et une action.

---

## Validation orale

Les actions sensibles (verrouillage, veille, extinction, fermeture d'application,
commande dictee, effacement de la memoire) sont toujours reformulees avant execution :

> — Verrouille l'ecran
> — Je verrouille l'ecran. Je confirme ?
> — Oui
> — Entendu. Ecran verrouille.

Repondez « non », « annule » ou « laisse tomber » pour abandonner. Sans reponse, la
demande expire au bout de quarante-cinq secondes.

Pour que **toutes** les actions demandent confirmation, y compris l'ouverture d'une
application : **Reglages → Execution → Demander aussi pour les actions sans risque**.

---

## Commandes dictees : ce qu'il faut savoir

L'option **Reglages → Execution → Autoriser l'execution de commandes dictees** permet
de dire « Execute la commande ... » et de faire tourner n'importe quelle commande shell.

Elle est **desactivee par defaut**, et pour une bonne raison : la commande s'execute
avec vos droits d'utilisateur, et la reconnaissance vocale se trompe. Une phrase mal
comprise peut modifier ou supprimer des fichiers. La validation orale reste exigee dans
tous les cas, mais elle ne protege que si vous ecoutez vraiment ce que JARVIS reformule.

Toutes les autres actions n'utilisent jamais de shell : les noms d'application et les
chemins sont passes comme arguments, jamais interpretes comme des commandes.

---

## Configuration

Tout est modifiable depuis **Reglages**, ou directement dans `~/.jarvis/config.json` :

| Cle | Effet |
| --- | --- |
| `port` | port d'ecoute, 4790 par defaut |
| `hote` | `0.0.0.0` pour accepter le telephone, `127.0.0.1` pour n'accepter que le Mac |
| `nomUtilisateur` | comment JARVIS vous appelle |
| `voix` | voix systeme, debit, hauteur, volume |
| `accueil` | salutation automatique, delai, duree avant de resaluer |
| `ecoute` | moteur, mot de reveil, ecoute continue |
| `execution` | validation orale, commandes dictees, duree maximale |
| `reacteur` | pastille : affichage, position, diametre, opacite |
| `raccourcis` | vos phrases personnalisees |
| `whisper` | binaire, modele et langue pour la transcription locale |

Les donnees (comptes, conversation, memoire) sont dans `~/.jarvis/donnees.json`,
en droits `600`. Rien ne sort de la machine.

---

## Organisation du code

```
jarvis/
  server/            noyau, sans aucune dependance externe
    index.js           serveur HTTP et WebSocket, routes de l'API
    config.js          reglages et valeurs par defaut
    magasin.js         persistance JSON
    authentification.js comptes, jetons, appairage
    intentions.js      analyse des phrases francaises
    cerveau.js         validation orale, memoire, minuteurs
    executeur.js       actions systeme macOS
    transcription.js   whisper local
    websocket.js       WebSocket implemente a la main (RFC 6455)
  ui/                interface commune a tous les appareils
    index.html, styles.css, app.js
    reacteur.js        rendu du reacteur arc
    voix.js            synthese, reconnaissance, niveau sonore
    client.js          API et WebSocket, reconnexion
    qr.js              encodeur de code QR
    pastille.html      fenetre du reacteur en surimpression
    sw.js, manifest.webmanifest
  desktop/           application macOS
    main.js, preload.js, preload-pastille.js
  outils/
    generer-icones.js  regenere les icones
  verification/
    verifier-qr.py        compare l'encodeur QR a une reference
    verifier-interface.mjs parcours complet dans un vrai navigateur
```

Le serveur ne depend d'aucun paquet : il demarre sur une machine hors ligne, sans
installation prealable. Seule l'application de bureau a besoin d'Electron.

---

## Verifications

```sh
node server/test-integration.js               # API, comptes, appairage, WebSocket
node verification/verifier-interface.mjs      # parcours complet au navigateur
python3 verification/verifier-qr.py           # encodeur QR (pip install qrcode)
```

---

## En cas de probleme

| Symptome | Cause habituelle |
| --- | --- |
| « Le port 4790 est deja utilise » | une instance tourne deja, ou changez `port` |
| Le telephone ne trouve pas le serveur | reseau different, ou `hote` sur `127.0.0.1` |
| JARVIS n'entend rien | autorisation micro refusee, ou fenetre Electron sans whisper |
| JARVIS ne parle pas | aucune voix francaise installee : Reglages Systeme → Accessibilite → Contenu parle |
| « Je ne trouve pas l'application » | le nom parle ne correspond pas : ajoutez un raccourci |
| Le volume ne bouge pas | autorisation d'automatisation refusee |
| La pastille a disparu | menu de la zone de notification → Afficher la pastille |
