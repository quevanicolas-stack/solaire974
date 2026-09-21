#!/bin/sh
#
# Démarre le serveur du Studio Voix.
#
# Pourquoi un script. Le lancement demandait deux commandes : activer
# l'environnement Python, puis appeler le serveur. Séparées, elles échouent dès
# qu'on ouvre une nouvelle fenêtre de Terminal — celle-ci s'ouvre dans le
# dossier personnel, où il n'y a ni venv ni serveur.py, et les deux lignes
# répondent « no such file or directory » puis « command not found: python ».
# C'est arrivé deux fois. Le script se place lui-même au bon endroit.
#
# Usage :
#     sh lancer.sh                 moteur réel, réseau et https
#     sh lancer.sh test            moteur de contrôle, sans rien télécharger
#     sh lancer.sh --port 8771     toute option passée au serveur
#
# Le venv n'est pas « activé » : on appelle directement son interpréteur. Le
# résultat est le même et ne dépend pas du shell employé.

set -e

# Se placer dans le dossier du script, quel que soit l'endroit d'où on l'appelle.
cd "$(dirname "$0")"

if [ ! -f "serveur.py" ]; then
  echo "serveur.py est introuvable à côté de ce script."
  echo "Le script a peut-être été déplacé ; remettez-le dans le dossier voix_locale."
  exit 1
fi

if [ -x "venv/bin/python" ]; then
  PYTHON="venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  echo "L'environnement venv est absent : lancement avec le Python du système."
  echo "Si des bibliothèques manquent, recréez-le :"
  echo "    python3 -m venv venv && venv/bin/pip install -r requirements.txt"
  echo
  PYTHON="python3"
else
  echo "Python est introuvable. Installez-le depuis python.org, puis relancez."
  exit 1
fi

# Premier argument « test » : raccourci vers le moteur de contrôle, qui ne
# télécharge rien et sert à vérifier la chaîne avant d'engager le vrai modèle.
if [ "$1" = "test" ]; then
  shift
  set -- --moteur test --chat test "$@"
elif [ $# -eq 0 ]; then
  set -- --moteur xtts --hote 0.0.0.0 --https
fi

# La licence de XTTS est acceptée une fois pour toutes ici : sans cette
# variable, le premier téléchargement s'arrête sur une question.
COQUI_TOS_AGREED=1
export COQUI_TOS_AGREED

echo "Lancement : $PYTHON serveur.py $*"
echo "Laissez cette fenêtre ouverte."
echo "Ctrl+C pour arrêter — et une seconde fois si une génération est en cours."
echo
exec "$PYTHON" serveur.py "$@"
