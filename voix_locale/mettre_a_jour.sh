#!/bin/sh
#
# Met à jour les fichiers du Studio Voix depuis GitHub.
#
# Pourquoi un script plutôt qu'une commande à retaper : la commande a été
# redemandée quatre fois, et deux mises à jour se sont écrites au mauvais
# endroit parce qu'un « find » avait trouvé le dossier de sauvegarde avant le
# bon. Ici, rien n'est cherché : le script ne travaille que dans le dossier où
# se trouve serveur.py, et refuse de s'exécuter ailleurs.
#
# Usage, depuis le dossier qui contient serveur.py :
#     sh mettre_a_jour.sh
#     sh mettre_a_jour.sh nom-de-branche      (pour une version en préparation)
#
# Les fichiers ne sont remplacés qu'après vérification : un téléchargement
# interrompu ou une page d'erreur GitHub ne doit pas écraser un serveur qui
# fonctionne.

set -e

DEPOT="quevanicolas-stack/solaire974"
BRANCHE="${1:-main}"
BASE="https://raw.githubusercontent.com/$DEPOT/$BRANCHE"

if [ ! -f "serveur.py" ]; then
  echo "serveur.py est introuvable dans le dossier courant."
  echo "Placez-vous dans le dossier du serveur, puis relancez :"
  echo "    cd ~/Desktop/Studio-voix/voix_locale"
  echo "    sh mettre_a_jour.sh"
  exit 1
fi

TEMPO="$(mktemp -d)"
trap 'rm -rf "$TEMPO"' EXIT

# clonage_voix.html vit à côté de serveur.py ou dans le dossier parent : le
# serveur regarde aux deux endroits. On met à jour celui qui existe déjà, pour
# ne pas laisser deux copies divergentes.
if [ -f "../clonage_voix.html" ]; then
  PAGE="../clonage_voix.html"
else
  PAGE="clonage_voix.html"
fi

FICHIERS="serveur.py verifier.js verifier_moteur.py NOTICE.md preparer_corpus.py texte_a_lire.txt"

echo "Mise à jour depuis la branche « $BRANCHE »."
echo

telecharger() {
  # $1 = chemin dans le dépôt, $2 = fichier local d'arrivée
  curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
       -o "$TEMPO/$(basename "$2")" "$BASE/$1" || return 1
  [ -s "$TEMPO/$(basename "$2")" ] || return 1
  return 0
}

echec=0

for f in $FICHIERS; do
  if ! telecharger "voix_locale/$f" "$f"; then
    echo "  ECHEC    $f — non téléchargé, l'ancien est conservé"
    echec=1
    continue
  fi
  # Un fichier Python qui ne compile pas ne doit jamais remplacer un fichier
  # qui tourne : l'erreur ne se verrait qu'au prochain lancement.
  case "$f" in
    *.py)
      if ! python3 -m py_compile "$TEMPO/$f" 2>/dev/null; then
        echo "  ECHEC    $f — fichier incomplet, l'ancien est conservé"
        echec=1
        continue
      fi
      ;;
  esac
  cp "$TEMPO/$f" "$f"
  echo "  à jour   $f"
done

if telecharger "clonage_voix.html" "$PAGE" &&
   grep -q "Studio Voix" "$TEMPO/clonage_voix.html"; then
  cp "$TEMPO/clonage_voix.html" "$PAGE"
  echo "  à jour   $PAGE"
else
  echo "  ECHEC    $PAGE — non téléchargé, l'ancien est conservé"
  echec=1
fi

rm -rf __pycache__ 2>/dev/null || true

echo
VERSION=$(grep -m1 '^VERSION = ' serveur.py | cut -d'"' -f2)
echo "Version de serveur.py en place : $VERSION"
echo
if [ "$echec" -eq 0 ]; then
  echo "Relancez le serveur, puis rechargez la page dans le navigateur :"
else
  echo "Au moins un fichier n'a pas été mis à jour. Relancez le script."
  echo "Ensuite, pour démarrer :"
fi
echo "    sh lancer.sh"
echo
echo "La version affichée au démarrage doit être $VERSION."

exit "$echec"
