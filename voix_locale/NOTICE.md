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

Le serveur affiche son adresse, par défaut `http://127.0.0.1:8770`. Laissez cette
fenêtre de Terminal ouverte.

Dans une **seconde** fenêtre de Terminal, servez l'application :

```
cd ..
npx http-server . -p 8080
```

Ouvrez ensuite `http://localhost:8080/clonage_voix.html`, puis :

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
pip install coqui-tts
python serveur.py --moteur xtts
```

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

## 5. Options utiles

```
python serveur.py --moteur test --port 8771     # changer de port
python serveur.py --moteur xtts --peripherique cpu
python serveur.py --hote 0.0.0.0                # exposer sur le réseau local
```

`--hote 0.0.0.0` rend le serveur accessible aux autres appareils du réseau, y compris un
téléphone. À n'utiliser que sur un réseau de confiance : le serveur n'a aucune
authentification.

---

## 6. Où sont les données

```
voix_locale/donnees/voix/<identifiant>/
    reference.wav   échantillon normalisé servant de modèle vocal
    voix.json       nom, description, durée, date de création
```

Ce dossier est exclu du dépôt git : ces enregistrements sont des données personnelles et
ne doivent pas être versionnés. Supprimer une voix depuis l'étape 04 efface le dossier
correspondant.

---

## 7. En cas de problème

**« Le serveur local ne répond pas »** — vérifiez que la fenêtre de Terminal du serveur
est toujours ouverte, et que l'adresse de l'étape 03 correspond à celle affichée au
démarrage.

**« ffmpeg est introuvable »** — `pip install imageio-ffmpeg`, puis relancez le serveur.
Au démarrage, le serveur affiche le chemin du ffmpeg qu'il a retenu.

**« Le moteur XTTS n'est pas installé »** — `source venv/bin/activate` puis
`pip install coqui-tts`.

**Le port est déjà utilisé** — relancez avec `--port 8771` et corrigez l'adresse dans
l'application.

---

## 8. Rappel sur le consentement

Le verrou de l'étape 01 reste la seule protection en mode local : les garde-fous du
fournisseur distant n'existent plus ici. Le consentement de la personne dont la voix est
reproduite reste requis, et les productions doivent toujours être présentées comme des
voix de synthèse.
