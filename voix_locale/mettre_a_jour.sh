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
# La branche employée est retenue dans « .branche » : les fois suivantes, la
# commande sans argument reprend la même. Sans ce rappel, un « sh
# mettre_a_jour.sh » machinal ramenait main, c'est-à-dire une version
# antérieure — une mise à jour qui recule est pire que pas de mise à jour.
#
# Les fichiers ne sont remplacés qu'après vérification : un téléchargement
# interrompu ou une page d'erreur GitHub ne doit pas écraser un serveur qui
# fonctionne.

set -e

DEPOT="quevanicolas-stack/solaire974"

# --forcer, à n'importe quelle place, autorise un retour à une version
# antérieure. Sans lui, le script refuse de reculer.
FORCER="non"
for a in "$@"; do
  [ "$a" = "--forcer" ] && FORCER="oui"
done
set -- $(for a in "$@"; do [ "$a" = "--forcer" ] || printf '%s ' "$a"; done)

if [ -n "$1" ]; then
  BRANCHE="$1"
elif [ -f ".branche" ]; then
  BRANCHE="$(cat .branche)"
else
  BRANCHE="main"
fi
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

# lancer.sh fait partie du lot : il a longtemps manqué, et « sh lancer.sh »
# répondait alors « No such file or directory » à qui venait de mettre à jour.
# Un outil de mise à jour qui ne livre pas l'outil de lancement ne sert qu'à
# moitié.
FICHIERS="serveur.py verifier.js verifier_moteur.py NOTICE.md preparer_corpus.py texte_a_lire.txt lancer.sh"

echo "Mise à jour depuis la branche « $BRANCHE »."
echo

telecharger() {
  # $1 = chemin dans le dépôt, $2 = fichier local d'arrivée
  curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
       -o "$TEMPO/$(basename "$2")" "$BASE/$1" || return 1
  [ -s "$TEMPO/$(basename "$2")" ] || return 1
  return 0
}

version_de() {
  grep -m1 '^VERSION = ' "$1" 2>/dev/null | cut -d'"' -f2
}

# Une mise à jour ne doit jamais reculer.
#
# Constaté : un « sh mettre_a_jour.sh » sans argument reprenait main, plus
# ancienne que la version installée, et remplaçait sans rien dire un serveur
# qui marchait par un serveur d'avant. On compare donc les versions, et on
# refuse le retour en arrière sauf demande explicite.
AVANT="$(version_de serveur.py)"
if [ -n "$AVANT" ] && telecharger "voix_locale/serveur.py" "serveur.py"; then
  APRES="$(version_de "$TEMPO/serveur.py")"
  if [ -n "$APRES" ] && [ "$APRES" != "$AVANT" ]; then
    PLUS_ANCIENNE="$(printf '%s\n%s\n' "$AVANT" "$APRES" | sort | head -1)"
    if [ "$PLUS_ANCIENNE" = "$APRES" ] && [ "$FORCER" != "oui" ]; then
      echo "REFUS : la branche « $BRANCHE » porte la version $APRES,"
      echo "        plus ancienne que la version installée $AVANT."
      echo
      echo "Rien n'a été modifié. Cette branche n'est pas celle de votre version."
      if [ -f ".branche" ]; then
        echo "Branche retenue la dernière fois : $(cat .branche)"
      fi
      echo
      echo "Pour revenir volontairement en arrière :"
      echo "    sh mettre_a_jour.sh $BRANCHE --forcer"
      exit 1
    fi
  fi
fi

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
  case "$f" in *.sh) chmod +x "$f" 2>/dev/null || true ;; esac
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

# Le script se met à jour lui-même en dernier, et par « mv » : renommer ne
# touche pas au fichier déjà ouvert par le shell en cours d'exécution, là où
# une copie par-dessus ferait lire la suite au mauvais endroit.
if telecharger "voix_locale/mettre_a_jour.sh" "mettre_a_jour.sh" &&
   grep -q "^DEPOT=" "$TEMPO/mettre_a_jour.sh"; then
  mv "$TEMPO/mettre_a_jour.sh" "mettre_a_jour.sh.nouveau"
  chmod +x "mettre_a_jour.sh.nouveau" 2>/dev/null || true
  mv "mettre_a_jour.sh.nouveau" "mettre_a_jour.sh"
  echo "  à jour   mettre_a_jour.sh"
fi

# La branche retenue, pour que la prochaine fois n'ait pas besoin de la retaper.
printf '%s\n' "$BRANCHE" > .branche

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
