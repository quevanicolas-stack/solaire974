#!/usr/bin/env python3
"""
Serveur vocal local pour Studio Voix.

Expose les mêmes routes que le service distant utilisé par clonage_voix.html,
de sorte que l'application bascule de l'un à l'autre par simple changement
d'adresse, sans modification de sa logique.

Le moteur de synthèse est interchangeable : un moteur de test qui ne demande
aucun téléchargement, et un moteur réel qui clone effectivement la voix.

Lancement :
    python serveur.py --moteur test
    python serveur.py --moteur xtts
"""

import argparse
import base64
import json
import math
import os
import re
import shutil
import tempfile
import struct
import subprocess
import sys
import time
import uuid
import wave
from io import BytesIO
from pathlib import Path

import anyio.to_thread
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

RACINE = Path(__file__).resolve().parent
DOSSIER_VOIX = RACINE / "donnees" / "voix"
VERSION = "2026.09.21c"     # affichée au démarrage et sur « / » : sert à vérifier
                           # que le fichier en place est bien le dernier
FREQUENCE = 24000          # fréquence d'échantillonnage de sortie, en hertz
"""
Durées de référence, et pourquoi elles sont ce qu'elles sont.

XTTS ne lit pas la référence comme un apprentissage. Il calcule une empreinte
de locuteur par fichier fourni, puis fait leur moyenne ; et il ne calcule cette
empreinte que sur les premières secondes de chaque fichier. Les valeurs par
défaut de la bibliothèque sont sévères : max_ref_len = 10 secondes pour
l'empreinte, gpt_cond_len = 12 secondes pour les latents de prosodie.

Conséquence, avant ce changement : la référence était concaténée en UN seul
fichier tronqué à 120 secondes, dont le moteur n'utilisait ensuite que les dix
premières. Trente minutes d'enregistrement se réduisaient à dix secondes.

D'où le découpage en tranches. Chaque tranche est un fichier, donc une
empreinte de plus dans la moyenne : la matière fournie est réellement
utilisée. Les trois valeurs ci-dessous sont transmises explicitement au moteur,
jamais laissées aux valeurs par défaut.
"""

DUREE_REFERENCE_MAX = 1800   # secondes de matière conservées par voix (30 min)
DUREE_TRANCHE = 30           # secondes par tranche de référence
TRANCHES_MAX = 20            # tranches passées au moteur, soit 10 minutes utiles
REF_EMPREINTE = 30           # secondes lues par tranche pour l'empreinte
REF_PROSODIE = 30            # secondes lues au total pour les latents de prosodie


# ══════════════════════════════════════════════════════════════
#   OUTILS AUDIO
# ══════════════════════════════════════════════════════════════

_ffmpeg_resolu = None


def chemin_ffmpeg() -> str | None:
    """
    Localise ffmpeg : d'abord celui du système, sinon la copie autonome
    fournie par le paquet imageio-ffmpeg, ce qui évite d'imposer Homebrew.
    """
    global _ffmpeg_resolu
    if _ffmpeg_resolu is not None:
        return _ffmpeg_resolu or None

    trouve = shutil.which("ffmpeg")
    if not trouve:
        try:
            import imageio_ffmpeg
            candidat = imageio_ffmpeg.get_ffmpeg_exe()
            if candidat and Path(candidat).exists():
                trouve = candidat
        except Exception:
            trouve = None

    _ffmpeg_resolu = trouve or ""
    return trouve


def ffmpeg_disponible() -> bool:
    return chemin_ffmpeg() is not None


def convertir_en_wav(source: Path, destination: Path, secondes_max: int = 0) -> None:
    """Normalise un audio quelconque en WAV mono, via ffmpeg."""
    binaire = chemin_ffmpeg()
    if not binaire:
        raise RuntimeError(
            "ffmpeg est introuvable. Installez-le avec « pip install imageio-ffmpeg », "
            "puis relancez le serveur."
        )
    commande = [binaire, "-y", "-loglevel", "error", "-i", str(source)]
    if secondes_max:
        commande += ["-t", str(secondes_max)]
    commande += ["-ac", "1", "-ar", str(FREQUENCE), "-c:a", "pcm_s16le", str(destination)]
    resultat = subprocess.run(commande, capture_output=True, text=True)
    if resultat.returncode != 0:
        raise RuntimeError("Conversion audio impossible : " + resultat.stderr.strip()[:400])


"""
Débruitage de la référence.

Un souffle ou un bruit de fond présent dans l'échantillon est appris par le
modèle au même titre que le timbre : il ressort ensuite sur chaque phrase
produite. Nettoyer la référence est donc plus efficace que nettoyer la sortie.

Le réglage reste modéré à dessein : un débruitage agressif abîme les aigus de
la voix et dégrade la ressemblance.
"""
FILTRE_DEBRUITAGE = "highpass=f=70,afftdn=nr=12:nf=-30"


"""
Débruitage de la sortie.

La porte de bruit de l'application coupe le souffle entre les mots, mais elle ne
peut rien contre le grain qui persiste sous la parole : couper là, c'est couper
la voix. Il faut pour cela un traitement spectral, qui retire le bruit à chaque
fréquence sans toucher au reste.

Les niveaux ci-dessous ont été mesurés sur un signal de contrôle comportant une
sifflante, la partie de la parole la plus exposée à ce genre de filtre :

    niveau     souffle retiré     perte sur la sifflante
    léger          12 dB                 0,3 dB
    moyen          24 dB                 0,4 dB
    fort           40 dB                 0,5 dB
    maximum        60 dB                 0,6 dB

Le suivi de bruit (tn=1) est volontairement absent : il annule presque
entièrement la réduction lorsque le plancher estimé ne correspond pas au signal.

Le filtrage relève légèrement les crêtes, de l'ordre de trois pour cent. Un
limiteur ferme la marche pour qu'un signal déjà proche du maximum ne sature
pas ; réglé à 0,98 et sans mise à niveau automatique, il est transparent tant
qu'on reste en dessous : moins d'un centième de décibel de différence, mesuré.
"""
_LIMITEUR = "alimiter=limit=0.98:level=0"
NIVEAUX_DEBRUITAGE = {
    "aucun":   None,
    "leger":   f"highpass=f=70,afftdn=nr=12:nf=-30,{_LIMITEUR}",
    "moyen":   f"highpass=f=70,afftdn=nr=24:nf=-27,{_LIMITEUR}",
    "fort":    f"highpass=f=80,afftdn=nr=40:nf=-25,{_LIMITEUR}",
    "maximum": f"highpass=f=80,afftdn=nr=70:nf=-22,{_LIMITEUR}",
}
DEBRUITAGE_DEFAUT = "moyen"


def debruiter_octets(donnees: bytes, niveau: str) -> bytes:
    """Filtre un WAV en mémoire. En cas d'échec, l'audio d'origine est conservé."""
    filtre = NIVEAUX_DEBRUITAGE.get(niveau)
    if not filtre or not ffmpeg_disponible():
        return donnees
    with tempfile.TemporaryDirectory() as dossier:
        entree = Path(dossier) / "entree.wav"
        sortie = Path(dossier) / "sortie.wav"
        entree.write_bytes(donnees)
        resultat = subprocess.run(
            [chemin_ffmpeg(), "-y", "-loglevel", "error", "-i", str(entree),
             "-af", filtre, "-ac", "1", "-ar", str(FREQUENCE),
             "-c:a", "pcm_s16le", str(sortie)],
            capture_output=True, text=True,
        )
        if resultat.returncode != 0 or not sortie.exists():
            print("[synthese] débruitage impossible, audio conservé tel quel", flush=True)
            return donnees
        return sortie.read_bytes()


def assembler_references(fichiers: list[Path], destination: Path, debruiter: bool = False) -> None:
    """Concatène les échantillons en une seule référence, tronquée à la durée utile."""
    if len(fichiers) == 1:
        convertir_en_wav(fichiers[0], destination, DUREE_REFERENCE_MAX)
        if debruiter:
            debruiter_wav(destination)
        return

    liste = destination.parent / "liste.txt"
    intermediaires = []
    for i, f in enumerate(fichiers):
        inter = destination.parent / f"part{i}.wav"
        convertir_en_wav(f, inter)
        intermediaires.append(inter)
    liste.write_text("\n".join(f"file '{p.name}'" for p in intermediaires), encoding="utf-8")

    commande = [
        chemin_ffmpeg(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", str(liste), "-t", str(DUREE_REFERENCE_MAX),
        "-ac", "1", "-ar", str(FREQUENCE), "-c:a", "pcm_s16le", str(destination),
    ]
    resultat = subprocess.run(commande, capture_output=True, text=True, cwd=destination.parent)
    if resultat.returncode != 0:
        raise RuntimeError("Assemblage des échantillons impossible : " + resultat.stderr.strip()[:400])

    for p in intermediaires:
        p.unlink(missing_ok=True)
    liste.unlink(missing_ok=True)

    if debruiter:
        debruiter_wav(destination)


def decouper_reference(reference: Path, dossier: Path) -> list[Path]:
    """
    Découpe la référence en tranches, et rend leurs chemins.

    Chaque tranche devient une empreinte de plus dans la moyenne calculée par
    le moteur. C'est la seule façon d'exploiter plus que les dix premières
    secondes : concaténer davantage dans un fichier unique n'y changerait rien,
    le moteur tronque chaque fichier.

    Les tranches trop courtes sont écartées : une fin de référence d'une
    seconde donnerait une empreinte bruitée, qui abîmerait la moyenne au lieu
    de l'affermir.
    """
    tranches_dir = dossier / "tranches"
    shutil.rmtree(tranches_dir, ignore_errors=True)
    tranches_dir.mkdir(parents=True, exist_ok=True)

    binaire = chemin_ffmpeg()
    if not binaire:
        return []

    modele = str(tranches_dir / "tranche%03d.wav")
    resultat = subprocess.run(
        [binaire, "-y", "-loglevel", "error", "-i", str(reference),
         "-f", "segment", "-segment_time", str(DUREE_TRANCHE),
         "-ac", "1", "-ar", str(FREQUENCE), "-c:a", "pcm_s16le", modele],
        capture_output=True, text=True,
    )
    if resultat.returncode != 0:
        print("[voix] découpage impossible, référence utilisée d'un bloc", flush=True)
        return []

    # Trois secondes est le plancher pratique d'une empreinte de locuteur.
    # En demander davantage écarterait la seule tranche d'une référence courte,
    # et une référence de trente secondes est parfaitement légitime.
    minimum = 3.0
    tranches = []
    for t in sorted(tranches_dir.glob("tranche*.wav")):
        if duree_wav(t) >= minimum:
            tranches.append(t)
        else:
            t.unlink(missing_ok=True)

    # Au-delà du plafond, on prélève régulièrement plutôt que de garder le
    # début : des tranches réparties sur toute la matière couvrent davantage
    # de registres qu'une suite prise au même moment.
    if len(tranches) > TRANCHES_MAX:
        pas = len(tranches) / TRANCHES_MAX
        gardees = [tranches[int(i * pas)] for i in range(TRANCHES_MAX)]
        for t in tranches:
            if t not in gardees:
                t.unlink(missing_ok=True)
        tranches = gardees

    return tranches


def tranches_reference(dossier: Path) -> list[Path]:
    """Tranches d'une voix déjà créée, ou liste vide si elle n'en a pas."""
    tranches_dir = dossier / "tranches"
    if not tranches_dir.is_dir():
        return []
    return sorted(tranches_dir.glob("tranche*.wav"))


def debruiter_wav(chemin: Path) -> None:
    """Applique le filtre de débruitage sur place, en passant par un fichier temporaire."""
    temporaire = chemin.parent / f"debruite_{uuid.uuid4().hex}.wav"
    commande = [
        chemin_ffmpeg(), "-y", "-loglevel", "error", "-i", str(chemin),
        "-af", FILTRE_DEBRUITAGE,
        "-ac", "1", "-ar", str(FREQUENCE), "-c:a", "pcm_s16le", str(temporaire),
    ]
    resultat = subprocess.run(commande, capture_output=True, text=True)
    if resultat.returncode != 0:
        # Le débruitage est un confort : son échec ne doit pas perdre la référence.
        temporaire.unlink(missing_ok=True)
        print("[voix] débruitage impossible, référence conservée telle quelle", flush=True)
        return
    temporaire.replace(chemin)
    print("[voix] référence débruitée", flush=True)


"""
Régularité du débit.

Le modèle découpe lui-même un texte long en phrases et reprend chaque phrase de
zéro : le tirage aléatoire recommence, si bien que le débit et l'intonation
changent d'une phrase à l'autre au fil d'un même enregistrement.

Le découpage est donc repris ici. L'application marque déjà les respirations par
des retours à la ligne ; chaque morceau est prononcé séparément avec exactement
les mêmes réglages et la même graine, puis les morceaux sont recollés avec des
silences de durée choisie. Le débit devient régulier et les pauses, exactes.
"""
"""
Durée des silences, selon ce qui les motive.

Quatre situations, et elles ne se valent pas. Les confondre s'entend : avant
cette distinction, une coupure faite pour tenir sous la limite du moteur
recevait le même silence qu'un changement de paragraphe, et un texte courant de
cinq phrases se voyait allonger de plus de deux secondes alors qu'il n'en
demandait aucune — le modèle enchaînait très bien tout seul.

Chaque morceau se termine par ailleurs sur un peu de silence produit par le
moteur lui-même : les valeurs ci-dessous s'ajoutent à cela, elles ne le
remplacent pas. C'est pourquoi elles sont plus courtes qu'une pause entendue.
"""
PAUSE_PROPOSITION = 0.16   # coupure à l'intérieur d'une phrase, imposée par la longueur
PAUSE_PHRASE = 0.25        # entre deux phrases d'une même ligne
PAUSE_COURTE = 0.28        # retour à la ligne : une respiration voulue
PAUSE_LONGUE = 0.55        # ligne vide : un changement de paragraphe

"""
La limite de caractères du moteur.

XTTS refuse de prononcer plus de 273 caractères en français : au-delà, il
tronque et se contente d'un avertissement dans ses journaux. Rien ne remonte
jusqu'à l'application, qui rend donc un audio incomplet sans le signaler.

Le découpage ne connaissait que les retours à la ligne. Un texte collé depuis
un traitement de texte arrive en un seul bloc : il partait entier au moteur, et
tout ce qui dépassait disparaissait. C'est la cause des générations qu'il
fallait refaire plusieurs fois.

LONGUEUR_MAX est posée sous la limite avec de la marge : le nettoyage interne
du moteur développe certaines abréviations et les nombres en toutes lettres,
ce qui rallonge le texte après notre mesure.
"""
LONGUEUR_MAX = 230

# Un point derrière l'une de ces abréviations ne termine pas une phrase.
ABREVIATIONS = {
    "m", "mm", "mme", "mmes", "mlle", "dr", "pr", "me", "mgr",
    "st", "ste", "etc", "cf", "ex", "av", "bd", "no", "nos", "art", "fig",
}


def _phrases(ligne: str) -> list[str]:
    """
    Découpe une ligne en phrases.

    Le point suivi d'une majuscule compte même sans espace : « toutes.Regardez »
    s'écrit couramment et formerait sinon une phrase à rallonge.
    """
    morceaux, debut = [], 0
    for marque in re.finditer(r"[.!?…]+", ligne):
        fin = marque.end()
        avant = ligne[:marque.start()]
        dernier = re.split(r"[\s(«\"\']", avant)[-1].strip().lower() if avant else ""
        if dernier.rstrip(".") in ABREVIATIONS:
            continue
        # Ni entre deux chiffres — 3.14, 1.500 — ni sur une initiale isolée.
        if len(dernier) == 1 and dernier.isalpha():
            continue
        if (marque.start() > 0 and ligne[marque.start() - 1].isdigit()
                and fin < len(ligne) and ligne[fin].isdigit()):
            continue
        if fin >= len(ligne):
            morceaux.append(ligne[debut:fin])
            debut = fin
            continue
        suivant = ligne[fin]
        if suivant.isspace() or suivant.isupper() or suivant in "«\"'":
            morceaux.append(ligne[debut:fin])
            debut = fin
    reste = ligne[debut:]
    if reste.strip():
        morceaux.append(reste)
    return [m.strip() for m in morceaux if m.strip()]


def _tronconner(phrase: str) -> list[str]:
    """Ramène une phrase trop longue sous la limite, sans couper au hasard."""
    if len(phrase) <= LONGUEUR_MAX:
        return [phrase]

    # D'abord aux articulations : virgule, point-virgule, deux-points. Une
    # coupure y passe inaperçue, là où une coupure au milieu d'un groupe
    # s'entend.
    parties = re.split(r"(?<=[,;:])\s+", phrase)
    groupes, courant = [], ""
    for partie in parties:
        if not courant:
            courant = partie
        elif len(courant) + 1 + len(partie) <= LONGUEUR_MAX:
            courant += " " + partie
        else:
            groupes.append(courant)
            courant = partie
    if courant:
        groupes.append(courant)

    # S'il subsiste des groupes trop longs — une phrase sans aucune ponctuation
    # interne — on coupe aux espaces, jamais au milieu d'un mot.
    sortie = []
    for groupe in groupes:
        while len(groupe) > LONGUEUR_MAX:
            coupe = groupe.rfind(" ", 0, LONGUEUR_MAX)
            if coupe <= 0:
                coupe = LONGUEUR_MAX
            sortie.append(groupe[:coupe].strip())
            groupe = groupe[coupe:].strip()
        if groupe:
            sortie.append(groupe)
    return sortie


def _lignes_utiles(bloc: str) -> list[str]:
    """
    Recolle les lignes coupées par la mise en page.

    Un retour à la ligne volontaire marque une respiration, et cela reste vrai.
    Mais un texte collé depuis un traitement de texte est replié à la largeur de
    la page : la coupure y tombe au milieu d'une phrase, et la prononcer comme
    une respiration s'entend. On ne recolle que le cas non ambigu — la ligne
    précédente ne se termine par aucune ponctuation, et la suivante commence par
    une minuscule.
    """
    lignes = [l.strip() for l in bloc.split("\n") if l.strip()]
    sorties: list[str] = []
    for ligne in lignes:
        if (sorties and not re.search(r"[.!?…,;:»\"]$", sorties[-1])
                and ligne[:1].islower()):
            sorties[-1] += " " + ligne
        else:
            sorties.append(ligne)
    return sorties


def decouper_texte(texte: str) -> list[tuple[str, float]]:
    """Rend une suite de morceaux à prononcer, chacun suivi d'un silence."""
    segments: list[list] = []
    for bloc in re.split(r"\n{2,}", texte):
        lignes = _lignes_utiles(bloc)
        for i, ligne in enumerate(lignes):
            derniere_ligne = (i == len(lignes) - 1)
            phrases = _phrases(ligne) or [ligne]
            for j, phrase in enumerate(phrases):
                derniere_phrase = (j == len(phrases) - 1)
                troncons = _tronconner(phrase)
                for k, troncon in enumerate(troncons):
                    dernier = (k == len(troncons) - 1)
                    # Une phrase tronçonnée ne doit pas s'entendre comme
                    # plusieurs phrases, ni une phrase comme un paragraphe.
                    if not dernier:
                        nature = "proposition"
                    elif not derniere_phrase:
                        nature = "phrase"
                    elif not derniere_ligne:
                        nature = "ligne"
                    else:
                        nature = "paragraphe"
                    segments.append([troncon, nature])
    if segments:
        segments[-1][1] = "fin"      # aucun silence à la toute fin
    return [(s, n) for s, n in segments]


MONTEE = 0.002   # secondes de fondu à l'entrée d'un morceau
DESCENTE = 0.008  # secondes de fondu à sa sortie


def adoucir_extremites(trame: bytes, frequence: int) -> bytes:
    """
    Ramène le début et la fin d'un morceau à zéro.

    Un morceau se termine rarement sur un zéro : recollé tel quel contre un
    silence, l'écart entre le dernier échantillon et le suivant produit une
    marche, et une marche s'entend comme un clic. Quelques millisecondes de
    fondu suffisent à l'effacer.

    La montée est plus courte que la descente : une attaque de consonne perd
    à être adoucie, une fin de voyelle non.
    """
    n = len(trame) // 2
    if n < 8:
        return trame
    valeurs = list(struct.unpack(f"<{n}h", trame[: n * 2]))

    montee = min(int(frequence * MONTEE), n // 2)
    descente = min(int(frequence * DESCENTE), n // 2)
    for i in range(montee):
        valeurs[i] = int(valeurs[i] * (i / montee))
    for i in range(descente):
        valeurs[n - 1 - i] = int(valeurs[n - 1 - i] * (i / descente))

    return struct.pack(f"<{n}h", *valeurs)


def assembler_audio(morceaux: list[tuple[bytes, float]],
                    natures: list[str] | None = None,
                    textes: list[str] | None = None) -> tuple[bytes, list[dict]]:
    """
    Recolle des WAV mono en intercalant les silences demandés.

    Rend aussi le DÉCOUPAGE : où commence et où finit chaque morceau parlé dans
    l'audio assemblé, de quelle nature est le silence qui le suit, et ce qui y
    est prononcé. Sans cette carte, l'application ne peut pas rejouer les pauses
    autrement — il lui faudrait refaire parler le moteur, donc obtenir une autre
    prononciation, donc comparer deux choses différentes.

    Le texte de chaque morceau s'y trouve pour une autre raison : il permet de
    MONTRER où le texte respire. Une coupure imposée par la longueur peut
    tomber au milieu d'une phrase, et c'est précisément celle-là qu'on veut
    voir ; sans le texte, la carte ne dit que des secondes.
    """
    trames: list[bytes] = []
    frequence, largeur = FREQUENCE, 2
    decoupe: list[dict] = []
    position = 0                       # en échantillons
    for indice, (donnees, pause) in enumerate(morceaux):
        with wave.open(BytesIO(donnees), "rb") as w:
            frequence, largeur = w.getframerate(), w.getsampwidth()
            trame = w.readframes(w.getnframes())
        trames.append(adoucir_extremites(trame, frequence) if largeur == 2 else trame)
        n = len(trame) // largeur
        silence = int(frequence * pause) if pause > 0 else 0
        decoupe.append({
            "debut": round(position / frequence, 6),
            "fin": round((position + n) / frequence, 6),
            "silence": round(silence / frequence, 6),
            "nature": (natures[indice] if natures and indice < len(natures) else "phrase"),
            "texte": (textes[indice] if textes and indice < len(textes) else ""),
        })
        position += n + silence
        if silence:
            trames.append(b"\x00" * (silence * largeur))

    tampon = BytesIO()
    with wave.open(tampon, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(largeur)
        w.setframerate(frequence)
        w.writeframes(b"".join(trames))
    return tampon.getvalue(), decoupe


def prononcer(moteur, texte: str, reference: Path,
              reglages: dict) -> tuple[bytes, str, list[dict]]:
    """
    Découpage, prononciation morceau par morceau, recollage. Aucun filtrage.

    Rend un troisième élément : le découpage, c'est-à-dire la place de chaque
    morceau parlé dans l'audio et la nature du silence qui le suit. Vide quand
    le texte n'a fait qu'un seul morceau — il n'y a alors aucune pause à
    rejouer.
    """
    segments = decouper_texte(texte)
    vitesse = max(0.5, min(2.0, float(reglages.get("speed") or 1.0)))
    # Les pauses sont réglables : l'application peut les allonger ou les
    # supprimer. Les deux réglages exposés pilotent la respiration et le
    # paragraphe ; les silences internes à une phrase suivent la respiration,
    # proportionnellement, pour qu'un réglage à zéro les emporte aussi.
    # Les quatre natures de silence sont réglables une à une. Elles ne
    # l'étaient pas : deux curseurs seulement pilotaient « ligne » et
    # « paragraphe », et les deux autres suivaient proportionnellement — de
    # sorte qu'on ne pouvait ni allonger une pause de phrase sans allonger la
    # respiration, ni raccourcir une coupure de longueur sans tout raccourcir.
    #
    # Les anciens noms restent acceptés : une page plus ancienne continue de
    # fonctionner, et retrouve exactement le comportement d'avant.
    def duree(cle, ancienne, defaut):
        valeur = reglages.get(cle)
        if valeur in (None, ""):
            valeur = reglages.get(ancienne)
        if valeur in (None, ""):
            return None
        try:
            return max(0.0, float(valeur))
        except (TypeError, ValueError):
            return None

    ligne = duree("pause_ligne", "pause_courte", PAUSE_COURTE)
    if ligne is None:
        ligne = PAUSE_COURTE
    paragraphe = duree("pause_paragraphe", "pause_longue", PAUSE_LONGUE)
    if paragraphe is None:
        paragraphe = PAUSE_LONGUE
    # Sans valeur explicite, les deux autres suivent la respiration dans la
    # proportion d'origine : un réglage des pauses à zéro emporte alors tout.
    phrase = duree("pause_phrase", "pause_phrase", PAUSE_PHRASE)
    if phrase is None:
        phrase = ligne * (PAUSE_PHRASE / PAUSE_COURTE)
    proposition = duree("pause_proposition", "pause_proposition", PAUSE_PROPOSITION)
    if proposition is None:
        proposition = ligne * (PAUSE_PROPOSITION / PAUSE_COURTE)

    courte = ligne          # conservé : la suite de la fonction s'en sert
    durees = {
        "proposition": proposition,
        "phrase":      phrase,
        "ligne":       ligne,
        "paragraphe":  paragraphe,
        "fin":         0.0,
    }

    if len(segments) <= 1:
        audio, mime = moteur.synthetiser(texte.strip(), reference, reglages)
        return audio, mime, []

    morceaux = []
    natures = []
    textes = []
    for indice, (segment, nature) in enumerate(segments):
        # Le rang du morceau décale la graine, quand il y en a une : chaque
        # morceau part alors d'un état différent du générateur, sans que la
        # génération cesse d'être reproductible.
        audio, mime = moteur.synthetiser(
            segment, reference, {**reglages, "_morceau": indice})
        if mime != "audio/wav":
            # Un moteur qui ne rend pas du WAV ne peut pas être recollé ici :
            # on repasse par une seule prononciation, sans pauses maîtrisées.
            secours, mime2 = moteur.synthetiser(texte, reference, reglages)
            return secours, mime2, []
        # Une nature inconnue ne doit pas devenir un silence nul en silence :
        # on retombe sur la respiration, qui est le cas le plus fréquent.
        duree = durees.get(nature, courte)
        morceaux.append((audio, duree / vitesse))
        natures.append(nature)
        textes.append(segment)
    audio, decoupe = assembler_audio(morceaux, natures, textes)
    return audio, "audio/wav", decoupe


def produire_audio(moteur, texte: str, reference: Path, reglages: dict) -> tuple[bytes, str]:
    """Synthèse complète : prononciation puis débruitage au niveau demandé."""
    audio, mime, _ = prononcer(moteur, texte, reference, reglages)
    niveau = str(reglages.get("denoise") or DEBRUITAGE_DEFAUT)
    return debruiter_octets(audio, niveau), mime


def mesurer_wav(donnees: bytes) -> dict:
    """
    Mesure l'audio produit, pour que la proposition de réglages repose sur le
    signal réel et non sur des valeurs décidées à l'avance.

    Le plancher de bruit est pris au premier décile des fenêtres de 50 ms : les
    silences entre les mots donnent ainsi le niveau du souffle, sans qu'aucune
    détection de parole soit nécessaire.
    """
    with wave.open(BytesIO(donnees), "rb") as w:
        frequence = w.getframerate()
        largeur = w.getsampwidth()
        brut = w.readframes(w.getnframes())

    if largeur != 2 or not brut:
        return {}

    total = len(brut) // 2
    valeurs = struct.unpack(f"<{total}h", brut[: total * 2])
    if not valeurs:
        return {}

    crete = max(abs(v) for v in valeurs) / 32768.0
    somme = sum(float(v) * v for v in valeurs)
    rms = math.sqrt(somme / total) / 32768.0

    fenetre = max(1, int(frequence * 0.05))
    niveaux = []
    for debut in range(0, total - fenetre + 1, fenetre):
        bloc = valeurs[debut : debut + fenetre]
        niveaux.append(math.sqrt(sum(float(v) * v for v in bloc) / fenetre) / 32768.0)
    niveaux.sort()
    plancher = niveaux[max(0, len(niveaux) // 10)] if niveaux else 0.0

    # Énergie des extrêmes du spectre, par deux filtres du premier ordre : assez
    # pour savoir s'il faut couper les graves ou calmer les sifflantes.
    def energie(coupure: float, passe_haut: bool) -> float:
        rc = 1.0 / (2 * math.pi * coupure)
        dt = 1.0 / frequence
        alpha = rc / (rc + dt) if passe_haut else dt / (rc + dt)
        sortie, precedent, cumul = 0.0, 0.0, 0.0
        for v in valeurs:
            x = v / 32768.0
            sortie = alpha * (sortie + x - precedent) if passe_haut else sortie + alpha * (x - sortie)
            precedent = x
            cumul += sortie * sortie
        return math.sqrt(cumul / total)

    db = lambda v: round(20 * math.log10(v), 1) if v > 1e-9 else -99.0
    graves = energie(120.0, False)
    aigus = energie(5000.0, True)

    return {
        "duree": round(total / frequence, 2),
        "frequence": frequence,
        "crete": db(crete),
        "rms": db(rms),
        "plancher": db(plancher),
        "rapport": round(db(rms) - db(plancher), 1),
        "graves": round(db(graves) - db(rms), 1),
        "aigus": round(db(aigus) - db(rms), 1),
    }


def proposer_reglages(mesures: dict) -> tuple[str, list[str]]:
    """Choisit un niveau de débruitage d'après les mesures, et dit pourquoi."""
    if not mesures:
        return DEBRUITAGE_DEFAUT, ["Mesure impossible : réglage conseillé par défaut."]

    plancher = mesures.get("plancher", -99.0)
    rapport = mesures.get("rapport", 99.0)
    raisons = []
    # Les nombres montrés à l'écran suivent l'usage français.
    nb = lambda v: f"{v:.1f}".replace(".", ",")

    if plancher <= -70:
        niveau = "aucun"
        raisons.append(f"Plancher de bruit à {nb(plancher)} dB : rien à retirer.")
    elif plancher <= -55:
        niveau = "leger"
        raisons.append(f"Souffle discret, plancher à {nb(plancher)} dB.")
    elif plancher <= -45:
        niveau = "moyen"
        raisons.append(f"Souffle audible, plancher à {nb(plancher)} dB.")
    elif plancher <= -35:
        niveau = "fort"
        raisons.append(f"Souffle marqué, plancher à {nb(plancher)} dB.")
    else:
        niveau = "maximum"
        raisons.append(f"Souffle très présent, plancher à {nb(plancher)} dB.")

    if rapport < 20 and niveau in ("fort", "maximum"):
        niveau = "fort"
        raisons.append(
            f"Écart parole/bruit de seulement {nb(rapport)} dB : le débruitage est "
            "retenu à « fort » pour ne pas creuser la voix."
        )
    return niveau, raisons


def duree_wav(chemin: Path) -> float:
    try:
        with wave.open(str(chemin), "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 0.0


def echantillons_vers_wav(echantillons: list[float], frequence: int = FREQUENCE) -> bytes:
    """Encode une suite de valeurs entre -1 et 1 en WAV 16 bits."""
    tampon = BytesIO()
    with wave.open(tampon, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(frequence)
        w.writeframes(b"".join(
            struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767)) for v in echantillons
        ))
    return tampon.getvalue()


# ══════════════════════════════════════════════════════════════
#   MOTEURS
# ══════════════════════════════════════════════════════════════

class Moteur:
    """Contrat commun à tous les moteurs de synthèse."""

    nom = "abstrait"
    clone_reellement = False

    def preparer(self) -> None:
        """Chargement paresseux du modèle, appelé au premier usage."""

    def synthetiser(self, texte: str, reference: Path, reglages: dict) -> tuple[bytes, str]:
        """Renvoie les octets audio et le type MIME correspondant."""
        raise NotImplementedError


class MoteurTest(Moteur):
    """
    Produit un signal audible sans aucun modèle ni téléchargement.

    Sert uniquement à valider la chaîne complète : envoi des échantillons,
    création de la voix, génération, lecture et téléchargement dans
    l'application. Ce n'est en aucun cas un clonage : le son produit ne
    ressemble à personne.
    """

    nom = "test"
    clone_reellement = False

    def synthetiser(self, texte: str, reference: Path, reglages: dict) -> tuple[bytes, str]:
        # Une syllabe approximative par groupe de trois caractères.
        syllabes = max(1, min(400, len(texte) // 3))
        vitesse = max(0.5, min(2.0, float(reglages.get("speed") or 1.0)))
        duree_syllabe = 0.16 / vitesse
        total = int(FREQUENCE * syllabes * duree_syllabe)
        echantillons = []

        # Hauteur fixe : ce signal ne sert qu'à valider la chaîne, et la
        # similarité dont il tirait sa hauteur n'existe plus — aucun moteur
        # local ne la lisait.
        base = 160.0
        for i in range(total):
            t = i / FREQUENCE
            position = t / duree_syllabe
            index = int(position)
            # Hauteur variable d'une syllabe à l'autre, pour éviter un bip plat.
            hauteur = base * (1.0 + 0.18 * math.sin(index * 1.7))
            # Enveloppe montante puis descendante sur chaque syllabe.
            phase = position - index
            enveloppe = math.sin(math.pi * phase) ** 2
            # Deux harmoniques donnent un timbre un peu moins artificiel.
            valeur = (
                math.sin(2 * math.pi * hauteur * t)
                + 0.35 * math.sin(4 * math.pi * hauteur * t)
                + 0.15 * math.sin(6 * math.pi * hauteur * t)
            )
            echantillons.append(0.28 * enveloppe * valeur)

        return echantillons_vers_wav(echantillons), "audio/wav"


class MoteurXTTS(Moteur):
    """
    Clonage réel par XTTS-v2.

    Attention à la licence : XTTS-v2 est diffusé sous une licence qui exclut
    l'usage commercial. Pour un usage professionnel, préférer un moteur à
    licence permissive.
    """

    nom = "xtts"
    clone_reellement = True

    def __init__(self, peripherique: str = "auto"):
        self.peripherique = peripherique
        self.modele = None

    def _choisir_peripherique(self) -> str:
        if self.peripherique != "auto":
            return self.peripherique
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
            # Sur Apple Silicon, XTTS reste plus fiable sur le processeur que
            # sur l'accélérateur graphique, dont certaines opérations manquent.
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "cpu"
        except Exception:
            pass
        return "cpu"

    def _contourner_torchcodec(self) -> None:
        """
        Supprime la dépendance à torchcodec pour la lecture de la référence.

        Depuis PyTorch 2.9, torchaudio délègue la lecture des fichiers à
        torchcodec, qui réclame les bibliothèques partagées de FFmpeg. Celles-ci
        n'existent que si FFmpeg est installé sur le système : un exécutable
        autonome, comme celui fourni par pip, ne les apporte pas.

        Or la référence est toujours un WAV PCM 16 bits que ce serveur a produit
        lui-même. La lire avec la bibliothèque standard donne exactement le même
        tenseur, sans réclamer quoi que ce soit au système.
        """
        import numpy as np
        import torch
        import torchaudio
        import TTS.tts.models.xtts as xtts

        def lire(chemin, frequence_cible):
            with wave.open(str(chemin), "rb") as w:
                canaux, largeur = w.getnchannels(), w.getsampwidth()
                frequence = w.getframerate()
                brut = w.readframes(w.getnframes())

            if largeur != 2:
                raise RuntimeError(
                    f"Référence en {largeur * 8} bits alors que 16 sont attendus : {chemin}"
                )

            donnees = np.frombuffer(brut, dtype="<i2").astype(np.float32) / 32768.0
            if canaux > 1:
                donnees = donnees.reshape(-1, canaux).mean(axis=1)

            audio = torch.from_numpy(np.ascontiguousarray(donnees)).unsqueeze(0)
            if frequence != frequence_cible:
                # Opération purement tensorielle : aucune lecture de fichier.
                audio = torchaudio.functional.resample(audio, frequence, frequence_cible)
            return audio.clip_(-1, 1)

        xtts.load_audio = lire
        # Message volontairement affirmatif : « torchcodec n'est pas sollicité »
        # se lisait comme un manque, alors que c'est le but recherché.
        print("[moteur] lecture audio autonome activée : la référence est lue "
              "par le serveur, torchcodec n'a donc rien à fournir", flush=True)

    def preparer(self) -> None:
        if self.modele is not None:
            return
        # Cet import entraîne PyTorch, transformers et librosa : il prend
        # facilement une minute, sans rien afficher. On prévient avant.
        print("[moteur] chargement des bibliothèques, environ une minute…", flush=True)
        try:
            from TTS.api import TTS
        except ImportError as e:
            # Une erreur d'import ne signifie pas forcément que le paquet manque :
            # une incompatibilité entre bibliothèques produit la même exception.
            # Le message d'origine est donc transmis tel quel, il nomme la cause.
            raise RuntimeError(
                "Le moteur XTTS n'a pas pu être chargé.\n"
                f"    Cause exacte : {e}\n"
                "Si le paquet est absent : pip install coqui-tts\n"
                "Sinon, le message ci-dessus nomme la bibliothèque en cause."
            ) from e

        self._contourner_torchcodec()

        peripherique = self._choisir_peripherique()
        print(f"[moteur] chargement de XTTS-v2 sur {peripherique}, patientez…", flush=True)
        debut = time.time()
        self.modele = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(peripherique)
        print(f"[moteur] modèle prêt en {time.time() - debut:.0f} s", flush=True)

    """
    Empreinte de la voix, calculée une fois puis relue.

    La bibliothèque sait mettre une voix en cache : « clone_voice » écrit un
    fichier .pth dans le dossier indiqué, et la synthèse le relit ensuite au
    lieu de tout recalculer. C'est ce qui rend les tranches abordables — sans
    ce cache, chaque morceau de texte relirait les vingt tranches.

    Rien n'est bloquant ici : si le calcul échoue, la synthèse repassera par
    les tranches, plus lentement mais sans erreur pour l'utilisateur.
    """

    NOM_CACHE = "empreinte"

    def voix_en_cache(self, dossier: Path) -> str | None:
        """Nom de la voix en cache si son fichier existe, sinon None."""
        if (dossier / f"{self.NOM_CACHE}.pth").exists():
            return self.NOM_CACHE
        return None

    def preparer_voix(self, dossier: Path, tranches: list[Path]) -> bool:
        """Calcule et range l'empreinte. Rend vrai si elle est utilisable."""
        if not tranches:
            return False
        try:
            self.preparer()
            modele = self.modele.synthesizer.tts_model
            modele.clone_voice(
                speaker_wav=[str(t) for t in tranches],
                speaker_id=self.NOM_CACHE,
                voice_dir=str(dossier),
                gpt_cond_len=REF_PROSODIE,
                gpt_cond_chunk_len=min(REF_PROSODIE, 6),
                max_ref_len=REF_EMPREINTE,
            )
        except Exception as e:
            print(f"[voix] empreinte non mise en cache ({e}) : "
                  "la synthèse repassera par les tranches", flush=True)
            return False
        utile = (dossier / f"{self.NOM_CACHE}.pth").exists()
        if utile:
            print(f"[voix] empreinte calculée sur {len(tranches)} tranche(s), "
                  f"soit {len(tranches) * DUREE_TRANCHE} s de référence", flush=True)
        return utile

    def synthetiser(self, texte: str, reference: Path, reglages: dict) -> tuple[bytes, str]:
        self.preparer()
        if not reference.exists():
            raise RuntimeError("Aucun échantillon de référence pour cette voix.")

        sortie = reference.parent / f"sortie_{uuid.uuid4().hex}.wav"
        try:
            # La stabilité de l'application pilote la température du modèle :
            # une stabilité haute donne une lecture plus régulière.
            stabilite = float(reglages.get("stability", 0.5))
            # Le débit est un étirement temporel appliqué par le modèle, non un
            # rééchantillonnage : la hauteur de la voix n'est pas modifiée.
            vitesse = max(0.5, min(2.0, float(reglages.get("speed") or 1.0)))

            # Graine libre par défaut.
            #
            # Elle était fixée à 1234 dès qu'aucune valeur n'arrivait, et
            # l'application en envoyait une en permanence. Même texte, mêmes
            # réglages : le moteur rendait le même audio à l'octet près. Une
            # mauvaise interprétation — une pause au milieu d'une phrase, un
            # membre de phrase répété — devenait donc définitive, et relancer
            # la génération ne pouvait rien y changer.
            #
            # Sans graine, chaque génération est un tirage neuf : relancer
            # redevient le recours. Avec une graine, la génération reste
            # reproductible.
            #
            # La graine est alors décalée d'un morceau à l'autre. La même
            # graine pour tous ne les rendait pas solidaires : deux textes
            # différents divergent dès le premier jeton. Elle faisait seulement
            # repartir chaque morceau du même état du générateur — donc, sur un
            # texte long, le même accident possible à chaque reprise.
            graine = reglages.get("seed")
            if graine not in (None, ""):
                try:
                    import torch
                    torch.manual_seed(int(graine) + int(reglages.get("_morceau") or 0))
                except Exception:
                    pass

            # La stabilité resserre aussi l'échantillonnage, pas seulement la
            # température : à stabilité haute, le modèle choisit parmi moins de
            # possibilités, donc il varie moins d'une phrase à l'autre.
            #
            # Chaque valeur déduite reste remplaçable : l'application peut
            # piloter le moteur directement, réglage par réglage.
            def choix(cle, defaut, mini, maxi, entier=False):
                valeur = reglages.get(cle)
                if valeur is None or valeur == "":
                    return defaut
                try:
                    v = float(valeur)
                except (TypeError, ValueError):
                    return defaut
                v = max(mini, min(maxi, v))
                return int(round(v)) if entier else v

            decoupe = reglages.get("split_sentences")
            # Latents en cache si la voix en a : le moteur les recalcule sinon
            # à chaque morceau de texte, sur toutes les tranches, ce qui coûte
            # bien plus cher que la synthèse elle-même.
            voix = self.voix_en_cache(reference.parent)
            if voix:
                conditionnement = {"speaker": voix, "voice_dir": str(reference.parent)}
            else:
                tranches = tranches_reference(reference.parent)
                conditionnement = {
                    "speaker_wav": [str(t) for t in tranches] if tranches else str(reference),
                    "gpt_cond_len": REF_PROSODIE,
                    "gpt_cond_chunk_len": min(REF_PROSODIE, 6),
                    "max_ref_len": REF_EMPREINTE,
                }
            self.modele.tts_to_file(
                text=texte,
                **conditionnement,
                language="fr",
                file_path=str(sortie),
                # La pente s'arrête à 0,45 et non à 0,30. Une température
                # basse ne rend pas un décodeur autorégressif plus sage : elle
                # le fait boucler, et une boucle s'entend comme un membre de
                # phrase répété. Le curseur garde toute sa course, seule la
                # pente change. Déduction raisonnée, non vérifiée à l'oreille
                # — XTTS ne tourne pas ici : réversible en une ligne.
                temperature=choix("temperature", max(0.01, 0.85 - 0.40 * stabilite), 0.01, 1.5),
                top_p=choix("top_p", max(0.50, 0.95 - 0.30 * stabilite), 0.05, 1.0),
                top_k=choix("top_k", max(10, int(50 - 30 * stabilite)), 1, 100, entier=True),
                repetition_penalty=choix("repetition_penalty", 10.0, 1.0, 20.0),
                length_penalty=choix("length_penalty", 1.0, 0.2, 3.0),
                speed=vitesse,
                # Le découpage est fait en amont, et chaque morceau tient
                # désormais sous la limite du moteur : le laisser redécouper
                # relancerait un tirage par phrase, donc un débit inégal.
                split_sentences=(bool(decoupe) if decoupe is not None
                                 else len(texte) > LONGUEUR_MAX),
            )
            return sortie.read_bytes(), "audio/wav"
        finally:
            sortie.unlink(missing_ok=True)


MOTEURS = {"test": MoteurTest, "xtts": MoteurXTTS}


# ══════════════════════════════════════════════════════════════
#   MOTEURS DE CONVERSATION
# ══════════════════════════════════════════════════════════════

PERSONNALITE = (
    "Tu es un assistant automatique qui répond à la place de Nicolas Queva. "
    "Tu parles français. Tes réponses sont lues à voix haute par une synthèse vocale : "
    "écris donc des phrases courtes, sans liste à puces, sans titre, sans code et sans "
    "caractères décoratifs, en toutes lettres pour les nombres et les abréviations. "
    "Trois phrases au maximum, sauf si l'on te demande explicitement un développement. "
    "Si l'on te demande si tu es une personne réelle, réponds sans détour que tu es un "
    "programme et que la voix est une voix de synthèse. "
    "Si tu ne sais pas, dis-le et propose de transmettre la question."
)


class MoteurChat:
    """Contrat commun à tous les moteurs de conversation."""

    nom = "abstrait"
    repond_reellement = False

    def preparer(self) -> None:
        """Vérifie que le moteur est utilisable, avant le premier échange."""

    def repondre(self, echanges: list[dict], personnalite: str) -> str:
        raise NotImplementedError


class MoteurChatTest(MoteurChat):
    """
    Répond sans clé ni réseau, à partir du seul message reçu.

    Sert à vérifier la chaîne complète — question, réponse écrite, lecture à
    voix haute — sans consommer quoi que ce soit. Les réponses sont fabriquées :
    elles ne proviennent d'aucun modèle de langage.
    """

    nom = "test"
    repond_reellement = False

    def repondre(self, echanges: list[dict], personnalite: str) -> str:
        dernier = ""
        for e in reversed(echanges):
            if e.get("role") == "user":
                dernier = str(e.get("content") or "").strip()
                break
        if not dernier:
            return "Je vous écoute."

        bas = dernier.lower()
        if any(m in bas for m in ("bonjour", "salut", "bonsoir")):
            return ("Bonjour. Je suis un assistant automatique et cette voix est une voix "
                    "de synthèse. Que puis-je faire pour vous ?")
        if "?" in dernier:
            return (f"Vous demandez : {dernier.rstrip('?').strip()}. Le moteur de conversation "
                    "réel n'est pas actif sur ce serveur, je ne peux donc pas y répondre. "
                    "Relancez le serveur avec le moteur claude pour obtenir une vraie réponse.")
        return (f"J'ai bien noté : {dernier}. Ceci est une réponse fabriquée par le moteur "
                "de contrôle, elle ne vient d'aucun modèle de langage.")


class MoteurChatClaude(MoteurChat):
    """
    Interroge le modèle chez Anthropic.

    La clé est lue dans la variable d'environnement ANTHROPIC_API_KEY et ne
    quitte jamais le serveur : contrairement à la clé du studio vocal, qui est
    personnelle et reste dans le navigateur, celle-ci serait exposée à tout
    visiteur si elle vivait dans la page.
    """

    nom = "claude"
    repond_reellement = True
    MODELE = "claude-opus-5"

    def __init__(self, modele: str | None = None):
        self.modele = modele or self.MODELE
        self.client = None

    def preparer(self) -> None:
        if self.client is not None:
            return
        try:
            import anthropic
        except ImportError:
            raise RuntimeError(
                "Le paquet anthropic n'est pas installé. Lancez « pip install anthropic » "
                "dans l'environnement du serveur, puis relancez-le."
            )
        cle = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not cle:
            raise RuntimeError(
                "La variable d'environnement ANTHROPIC_API_KEY est vide. Renseignez-la avant "
                "de lancer le serveur : export ANTHROPIC_API_KEY=\"votre-clé\"."
            )
        self.client = anthropic.Anthropic(api_key=cle)
        print(f"[chat] moteur claude prêt, modèle {self.modele}", flush=True)

    def repondre(self, echanges: list[dict], personnalite: str) -> str:
        self.preparer()
        reponse = self.client.messages.create(
            model=self.modele,
            max_tokens=2000,
            system=personnalite,
            thinking={"type": "adaptive"},
            messages=[{"role": e["role"], "content": e["content"]} for e in echanges],
        )
        # La réflexion adaptative ajoute des blocs qui ne sont pas destinés à
        # être lus : seul le texte est conservé.
        morceaux = [b.text for b in reponse.content if getattr(b, "type", "") == "text"]
        texte = "\n".join(m.strip() for m in morceaux if m and m.strip()).strip()
        return texte or "Je n'ai pas de réponse à formuler."


MOTEURS_CHAT = {"test": MoteurChatTest, "claude": MoteurChatClaude}


# ══════════════════════════════════════════════════════════════
#   RÉPERTOIRE DES VOIX
# ══════════════════════════════════════════════════════════════

def dossier_de(voix_id: str) -> Path:
    """Résout le dossier d'une voix en refusant toute échappée de répertoire."""
    if not voix_id or not all(c.isalnum() or c in "-_" for c in voix_id):
        raise HTTPException(status_code=422, detail={"message": "Identifiant de voix invalide."})
    return DOSSIER_VOIX / voix_id


def lire_fiche(dossier: Path) -> dict | None:
    fiche = dossier / "voix.json"
    if not fiche.exists():
        return None
    try:
        return json.loads(fiche.read_text(encoding="utf-8"))
    except Exception:
        return None


def lister_fiches() -> list[dict]:
    if not DOSSIER_VOIX.exists():
        return []
    fiches = []
    for d in sorted(DOSSIER_VOIX.iterdir()):
        if d.is_dir():
            fiche = lire_fiche(d)
            if fiche:
                fiches.append(fiche)
    return fiches


# ══════════════════════════════════════════════════════════════
#   APPLICATION
# ══════════════════════════════════════════════════════════════

app = FastAPI(title="Serveur vocal local — Studio Voix")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # page ouverte en local, y compris en file://
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

etat = {
    "moteur": MoteurTest(),
    "caracteres": 0,
    "chat": MoteurChatTest(),
    "personnalite": PERSONNALITE,
    "voix_chat": None,          # voix imposée à l'assistant, sinon la première trouvée
    "echanges": 0,
}

# Garde-fous d'usage. Ils sont modestes tant que le service reste interne, mais
# ils existent dès maintenant : le jour où la page est exposée publiquement, il
# est trop tard pour les ajouter.
LIMITES = {
    "caracteres_par_message": 1000,
    "messages_par_session": 30,       # sur la fenêtre ci-dessous
    "fenetre_secondes": 3600,
    "echanges_transmis": 20,          # historique renvoyé au modèle
}

_journal_usage: dict[str, list[float]] = {}


def quota_restant(session: str) -> int:
    """Décompte glissant des messages d'une session, sur la fenêtre configurée."""
    maintenant = time.time()
    passages = [t for t in _journal_usage.get(session, [])
                if maintenant - t < LIMITES["fenetre_secondes"]]
    _journal_usage[session] = passages
    return max(0, LIMITES["messages_par_session"] - len(passages))


def consommer_quota(session: str) -> None:
    _journal_usage.setdefault(session, []).append(time.time())


def erreur(code: int, message: str) -> JSONResponse:
    """Format d'erreur identique à celui que l'application sait déjà lire."""
    return JSONResponse(status_code=code, content={"detail": {"message": message}})


#   Nombre de travaux bloquants en cours. Il sert à l'arrêt : lui seul permet
#   de dire à l'utilisateur s'il y a réellement quelque chose à attendre.
_en_cours = {"n": 0}


async def au_fil(fonction, *arguments):
    """
    Exécute un travail bloquant hors de la boucle d'événements.

    Une route `async def` s'exécute dans la boucle elle-même : tant qu'elle n'a
    pas rendu la main, le serveur ne fait plus rien d'autre. Mesuré sur une
    synthèse réelle : sans ce renvoi, « /v1/user » n'obtient aucune réponse
    pendant tout le traitement — pas même la page, le serveur paraît éteint ;
    avec lui, elle arrive en 0,1 s.

    C'est aussi ce qui rendait Ctrl+C sans effet : le gestionnaire de signal
    d'uvicorn est une fonction de la boucle, et une boucle arrêtée ne le fait
    pas tourner.
    """
    _en_cours["n"] += 1
    try:
        return await anyio.to_thread.run_sync(fonction, *arguments)
    finally:
        _en_cours["n"] -= 1


@app.get("/v1/user")
def utilisateur():
    moteur = etat["moteur"]
    return {
        "subscription": {
            "tier": f"Serveur local — moteur {moteur.nom}"
                    + ("" if moteur.clone_reellement else " (ne clone pas)"),
            "character_count": etat["caracteres"],
        },
        "moteur": moteur.nom,
        "clone_reellement": moteur.clone_reellement,
        "ffmpeg": ffmpeg_disponible(),
        "version": VERSION,
        "debruitage": sorted(NIVEAUX_DEBRUITAGE),
        "debruitage_defaut": DEBRUITAGE_DEFAUT,
    }


@app.get("/v1/voices")
def voix():
    return {"voices": [
        {
            "voice_id": f["voice_id"],
            "name": f["name"],
            "category": "cloned",
            "description": f.get("description", ""),
            # Ces trois-là répondent à une question légitime : « ma matière
            # est-elle vraiment utilisée ? ». Sans elles, l'utilisateur ne peut
            # que supposer.
            "duree_reference": f.get("duree_reference"),
            "nb_tranches": f.get("nb_tranches", 0),
            "duree_utilisee": f.get("duree_utilisee"),
        }
        for f in lister_fiches()
    ]}


@app.post("/v1/voices/add")
async def ajouter_voix(
    name: str = Form(...),
    description: str = Form(""),
    remove_background_noise: str = Form(""),
    files: list[UploadFile] = File(...),
):
    if not files:
        return erreur(422, "Aucun échantillon reçu.")
    if not ffmpeg_disponible():
        return erreur(500, "ffmpeg est introuvable sur le serveur. Lancez « pip install imageio-ffmpeg » "
                           "dans l'environnement du serveur, puis relancez-le.")

    voix_id = uuid.uuid4().hex[:16]
    dossier = DOSSIER_VOIX / voix_id
    brut = dossier / "brut"
    brut.mkdir(parents=True, exist_ok=True)

    try:
        chemins = []
        for i, f in enumerate(files):
            contenu = await f.read()
            if not contenu:
                continue
            suffixe = Path(f.filename or "").suffix or ".bin"
            cible = brut / f"echantillon{i}{suffixe}"
            cible.write_bytes(contenu)
            chemins.append(cible)

        if not chemins:
            shutil.rmtree(dossier, ignore_errors=True)
            return erreur(422, "Les échantillons reçus sont vides.")

        debruiter = str(remove_background_noise).lower() in ("1", "true", "vrai", "on", "yes")
        reference = dossier / "reference.wav"
        # ffmpeg sur plusieurs prises : bloquant, donc hors de la boucle.
        await au_fil(assembler_references, chemins, reference, debruiter)

        secondes = duree_wav(reference)
        if secondes < 3:
            shutil.rmtree(dossier, ignore_errors=True)
            return erreur(422, f"Référence trop courte ({secondes:.0f} s). Enregistrez au moins quelques secondes.")

        # Le découpage en tranches est ce qui rend la matière réellement
        # utilisable : sans lui, le moteur ne lit que le début de la référence.
        tranches = await au_fil(decouper_reference, reference, dossier)
        empreinte = False
        if tranches and hasattr(etat["moteur"], "preparer_voix"):
            # Le calcul de l'empreinte fait tourner le modèle : plusieurs
            # dizaines de secondes sur une vingtaine de tranches.
            empreinte = await au_fil(etat["moteur"].preparer_voix, dossier, tranches)

        fiche = {
            "voice_id": voix_id,
            "name": name,
            "description": description,
            "duree_reference": round(secondes, 1),
            "nb_tranches": len(tranches),
            "duree_utilisee": round(min(len(tranches) * DUREE_TRANCHE, secondes), 1),
            "empreinte_en_cache": empreinte,
            "nb_echantillons": len(chemins),
            "debruitee": debruiter,
            "cree_le": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "moteur": etat["moteur"].nom,
        }
        (dossier / "voix.json").write_text(
            json.dumps(fiche, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        # Les fichiers d'origine ne servent plus une fois la référence produite.
        shutil.rmtree(brut, ignore_errors=True)

        print(f"[voix] « {name} » créée : {secondes:.0f} s de matière, "
              f"{len(tranches)} tranche(s) exploitées", flush=True)
        return {"voice_id": voix_id, "requires_verification": False}

    except RuntimeError as e:
        shutil.rmtree(dossier, ignore_errors=True)
        return erreur(500, str(e))
    except Exception as e:
        shutil.rmtree(dossier, ignore_errors=True)
        return erreur(500, f"Création impossible : {e}")


@app.delete("/v1/voices/{voix_id}")
def supprimer_voix(voix_id: str):
    dossier = dossier_de(voix_id)
    if not dossier.exists():
        return erreur(404, "Voix introuvable.")
    shutil.rmtree(dossier, ignore_errors=True)
    return {"status": "ok"}


@app.post("/v1/text-to-speech/{voix_id}")
async def synthese(voix_id: str, requete: Request):
    dossier = dossier_de(voix_id)
    fiche = lire_fiche(dossier)
    if not fiche:
        return erreur(404, "Voix introuvable sur ce serveur.")

    try:
        corps = await requete.json()
    except Exception:
        return erreur(422, "Requête illisible.")

    texte = (corps.get("text") or "").strip()
    if not texte:
        return erreur(422, "Texte absent.")
    if len(texte) > 5000:
        return erreur(422, "Texte trop long : 5 000 caractères au maximum.")

    reglages = dict(corps.get("voice_settings") or {})
    # Le niveau de débruitage peut arriver à la racine ou dans les réglages.
    if corps.get("denoise") and not reglages.get("denoise"):
        reglages["denoise"] = corps["denoise"]

    debut = time.time()

    # Trois versions à comparer, pour une seule prononciation : la synthèse est
    # la partie coûteuse, le filtrage ne l'est pas. Demander trois fois le même
    # texte au modèle serait à la fois lent et trompeur, chaque prononciation
    # étant légèrement différente.
    if corps.get("variantes"):
        try:
            brut, mime, decoupe = await au_fil(
                prononcer, etat["moteur"], texte, dossier / "reference.wav", reglages)
        except RuntimeError as e:
            return erreur(500, str(e))
        except Exception as e:
            return erreur(500, f"Synthèse impossible : {e}")

        mesures = await au_fil(mesurer_wav, brut) if mime == "audio/wav" else {}
        demande = str(reglages.get("denoise") or DEBRUITAGE_DEFAUT)
        conseille, raisons = proposer_reglages(mesures)

        etat["caracteres"] += len(texte)
        print(f"[synthese] {len(texte)} caractères en {time.time() - debut:.1f} s "
              f"({fiche['name']}, trois versions, conseil « {conseille} »)", flush=True)

        # Le débruitage appelle ffmpeg : bloquant lui aussi.
        traite = await au_fil(debruiter_octets, brut, demande)
        propose = (traite if conseille == demande
                   else await au_fil(debruiter_octets, brut, conseille))

        encoder = lambda d: base64.b64encode(d).decode("ascii")
        return {
            "mime": mime,
            "mesures": mesures,
            # Carte des morceaux : elle rend les pauses rejouables dans la page,
            # sans refaire parler le moteur.
            "decoupe": decoupe,
            "versions": {
                "brut":    {"audio": encoder(brut), "debruitage": "aucun"},
                "traite":  {"audio": encoder(traite), "debruitage": demande},
                "propose": {"audio": encoder(propose),
                            "debruitage": conseille, "raisons": raisons},
            },
        }

    try:
        audio, mime = await au_fil(
            produire_audio, etat["moteur"], texte, dossier / "reference.wav", reglages)
    except RuntimeError as e:
        return erreur(500, str(e))
    except Exception as e:
        return erreur(500, f"Synthèse impossible : {e}")

    etat["caracteres"] += len(texte)
    print(f"[synthese] {len(texte)} caractères en {time.time() - debut:.1f} s "
          f"({fiche['name']})", flush=True)
    return Response(content=audio, media_type=mime)


# ══════════════════════════════════════════════════════════════
#   CONVERSATION
# ══════════════════════════════════════════════════════════════

ANNONCE = ("Assistant automatique. Les réponses sont produites par un programme "
           "et lues par une voix de synthèse.")


def voix_de_lassistant() -> dict | None:
    """La voix imposée au lancement, sinon la première voix disponible."""
    fiches = lister_fiches()
    if not fiches:
        return None
    impose = etat["voix_chat"]
    if impose:
        for f in fiches:
            if f["voice_id"] == impose or f["name"] == impose:
                return f
        return None
    return fiches[0]


@app.get("/v1/chat/config")
def configuration_chat():
    """
    Tout ce dont le composant embarqué a besoin pour démarrer.

    Aucune clé n'y figure : les identifiants du modèle restent sur le serveur.
    """
    chat = etat["chat"]
    voix = voix_de_lassistant()
    return {
        "moteur": chat.nom,
        "repond_reellement": chat.repond_reellement,
        "annonce": ANNONCE,
        "voix": ({"voice_id": voix["voice_id"], "name": voix["name"]} if voix else None),
        "synthese": etat["moteur"].nom,
        "clone_reellement": etat["moteur"].clone_reellement,
        "limites": {
            "caracteres_par_message": LIMITES["caracteres_par_message"],
            "messages_par_session": LIMITES["messages_par_session"],
            "fenetre_secondes": LIMITES["fenetre_secondes"],
        },
    }


@app.post("/v1/chat")
async def conversation(requete: Request):
    try:
        corps = await requete.json()
    except Exception:
        return erreur(422, "Requête illisible.")

    echanges = corps.get("messages")
    if not isinstance(echanges, list) or not echanges:
        return erreur(422, "Aucun message reçu.")

    propres = []
    for e in echanges:
        if not isinstance(e, dict):
            continue
        role = e.get("role")
        contenu = str(e.get("content") or "").strip()
        if role in ("user", "assistant") and contenu:
            propres.append({"role": role, "content": contenu})
    if not propres or propres[-1]["role"] != "user":
        return erreur(422, "Le dernier message doit venir de l'utilisateur.")
    if len(propres[-1]["content"]) > LIMITES["caracteres_par_message"]:
        return erreur(422, f"Message trop long : {LIMITES['caracteres_par_message']} "
                           "caractères au maximum.")

    # L'historique est borné : au-delà, les tours les plus anciens sont oubliés.
    propres = propres[-LIMITES["echanges_transmis"]:]
    if propres[0]["role"] != "user":
        propres = propres[1:]

    session = str(corps.get("session") or "")[:64] or (requete.client.host if requete.client else "anonyme")
    if quota_restant(session) <= 0:
        return erreur(429, "Limite d'échanges atteinte pour cette session. Réessayez plus tard.")

    # La personnalité vient du serveur et jamais de la page : sans cela, un
    # visiteur pourrait réécrire les consignes de l'assistant depuis sa console.
    debut = time.time()
    try:
        reponse = await au_fil(etat["chat"].repondre, propres, etat["personnalite"])
    except RuntimeError as e:
        return erreur(500, str(e))
    except Exception as e:
        return erreur(500, f"Conversation impossible : {e}")

    consommer_quota(session)
    etat["echanges"] += 1
    print(f"[chat] réponse en {time.time() - debut:.1f} s "
          f"({len(reponse)} caractères, moteur {etat['chat'].nom})", flush=True)

    voix = voix_de_lassistant()
    return {
        "reply": reponse,
        "moteur": etat["chat"].nom,
        "repond_reellement": etat["chat"].repond_reellement,
        "voice_id": voix["voice_id"] if voix else None,
        "restant": quota_restant(session),
        "annonce": ANNONCE,
    }


# ══════════════════════════════════════════════════════════════
#   CERTIFICAT POUR LE MICRO DES TÉLÉPHONES
# ══════════════════════════════════════════════════════════════

"""
Pourquoi un certificat.

Les navigateurs refusent l'accès au microphone sur une adresse en http : ils
l'exigent en https, ou sur la machine elle-même. Depuis un téléphone, qui
arrive forcément par le réseau, l'enregistrement est donc impossible tant que
le serveur parle en clair.

Le certificat produit ici est auto-signé : aucune autorité ne le garantit, et
le navigateur affichera un avertissement à la première visite. C'est normal et
sans danger sur votre propre réseau — vous savez qui est en face, c'est votre
Mac. Une fois l'exception acceptée, le microphone fonctionne.

L'adresse du Mac est inscrite dans le certificat : sans cela, le navigateur le
rejetterait même après acceptation.
"""

DOSSIER_CERT = RACINE / "certificat"


def adresse_locale() -> str:
    """Adresse du Mac sur le réseau, telle qu'un téléphone la verra."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Aucune donnée n'est envoyée : on demande seulement au système par
        # quelle interface il sortirait, ce qui donne l'adresse utile.
        s.connect(("192.0.2.1", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def preparer_certificat(adresse: str) -> tuple[Path, Path] | None:
    """Rend (certificat, clé), en les créant au besoin. None si impossible."""
    DOSSIER_CERT.mkdir(parents=True, exist_ok=True)
    cert = DOSSIER_CERT / "certificat.pem"
    cle = DOSSIER_CERT / "cle.pem"

    # Un certificat déjà émis pour une autre adresse ne servirait à rien.
    marque = DOSSIER_CERT / "adresse.txt"
    if cert.exists() and cle.exists() and marque.exists():
        if marque.read_text(encoding="utf-8").strip() == adresse:
            return cert, cle

    binaire = shutil.which("openssl")
    if not binaire:
        print("  openssl est introuvable : impossible de produire un certificat.",
              file=sys.stderr)
        return None

    resultat = subprocess.run(
        [binaire, "req", "-x509", "-newkey", "rsa:2048", "-sha256",
         "-days", "825", "-nodes",
         "-keyout", str(cle), "-out", str(cert),
         "-subj", "/CN=Studio Voix",
         "-addext", f"subjectAltName=IP:{adresse},IP:127.0.0.1,DNS:localhost"],
        capture_output=True, text=True,
    )
    if resultat.returncode != 0:
        print("  Certificat impossible : " + resultat.stderr.strip()[:300], file=sys.stderr)
        return None

    marque.write_text(adresse, encoding="utf-8")
    print(f"  Certificat créé pour {adresse}, valable 825 jours.")
    return cert, cle


def page_application() -> Path | None:
    """Localise clonage_voix.html, à côté du serveur ou dans le dossier parent."""
    for candidat in (RACINE.parent / "clonage_voix.html", RACINE / "clonage_voix.html"):
        if candidat.exists():
            return candidat
    return None


def page_chatbot() -> Path | None:
    """Localise chatbot_voix.html, à côté du serveur ou dans le dossier parent."""
    for candidat in (RACINE.parent / "chatbot_voix.html", RACINE / "chatbot_voix.html"):
        if candidat.exists():
            return candidat
    return None


@app.get("/app")
def application():
    """
    Sert l'application depuis le serveur lui-même.

    Cela évite d'avoir à lancer un second serveur web, et place la page et
    l'interface de programmation sur la même origine : le navigateur n'a
    alors plus aucune raison de bloquer les appels.
    """
    page = page_application()
    if not page:
        return erreur(404, "clonage_voix.html est introuvable. Placez-le dans le dossier "
                           "parent de voix_locale, ou servez-le par vos propres moyens.")
    return FileResponse(page, media_type="text/html; charset=utf-8")


@app.get("/chat")
def chatbot():
    """Sert le composant conversationnel, sur la même origine que le service."""
    page = page_chatbot()
    if not page:
        return erreur(404, "chatbot_voix.html est introuvable. Placez-le dans le dossier "
                           "parent de voix_locale.")
    return FileResponse(page, media_type="text/html; charset=utf-8")


@app.get("/")
def accueil():
    moteur = etat["moteur"]
    return {
        "service": "Serveur vocal local — Studio Voix",
        "version": VERSION,
        "moteur": moteur.nom,
        "clone_reellement": moteur.clone_reellement,
        "chat": etat["chat"].nom,
        "voix": len(lister_fiches()),
        "ffmpeg": ffmpeg_disponible(),
        "application": "/app" if page_application() else None,
        "assistant": "/chat" if page_chatbot() else None,
    }


# ══════════════════════════════════════════════════════════════
#   DÉMARRAGE
# ══════════════════════════════════════════════════════════════


class ServeurArretable(uvicorn.Server):
    """
    Un serveur que Ctrl+C arrête vraiment, et qui le dit.

    Ce que faisait le serveur avant, mesuré pendant une génération : le premier
    Ctrl+C n'affichait que « ^C » et ne rendait la main qu'à la fin du
    traitement ; le second produisait une trace d'erreur — un `CancelledError`
    qui ne nomme rien — et n'accélérait rien. D'où « Ctrl+C donne une erreur et
    n'arrête plus le serveur ». Avec XTTS, où une génération se compte en
    minutes, cela revient à un serveur qui ne s'arrête plus.

    La cause est que rien ne peut interrompre un traitement en cours : ni un
    signal, ni l'annulation d'une tâche. Le seul arrêt immédiat est la sortie du
    processus. Elle n'est donc pas décidée à la place de l'utilisateur : le
    premier Ctrl+C demande l'arrêt et explique l'attente, le second — un geste
    délibéré — sort tout de suite.

    Mesuré après correction, sur une génération de 8,7 s : arrêt 1,5 s après le
    second Ctrl+C — c'est-à-dire aussitôt — sans aucune trace d'erreur.
    `verifier_moteur.py` impose les deux moitiés : que le premier Ctrl+C attende
    et le dise, que le second n'attende pas.
    """

    def handle_exit(self, sig, frame):
        if self.should_exit:
            print("\n  Arrêt immédiat.\n", flush=True)
            sys.stdout.flush()
            sys.stderr.flush()
            os._exit(0)

        # Ne parler d'attente que s'il y a vraiment quelque chose à attendre :
        # annoncer un traitement en cours quand il n'y en a aucun serait le même
        # défaut, à l'envers.
        if _en_cours["n"]:
            print("\n  Arrêt demandé. Un traitement est en cours et ne peut pas être\n"
                  "  interrompu en chemin : il doit d'abord se terminer.\n"
                  "  Ctrl+C une seconde fois pour arrêter sans attendre.\n", flush=True)
        else:
            print("\n  Arrêt en cours…\n", flush=True)
        super().handle_exit(sig, frame)


def principal():
    analyseur = argparse.ArgumentParser(description="Serveur vocal local pour Studio Voix")
    analyseur.add_argument("--moteur", default="test", choices=sorted(MOTEURS),
                           help="test : signal de contrôle, aucun téléchargement. "
                                "xtts : clonage réel.")
    analyseur.add_argument("--port", type=int, default=8770)
    analyseur.add_argument("--hote", default="127.0.0.1",
                           help="127.0.0.1 limite l'accès à cette machine.")
    analyseur.add_argument("--peripherique", default="auto", choices=["auto", "cpu", "cuda", "mps"])
    analyseur.add_argument("--chat", default="test", choices=sorted(MOTEURS_CHAT),
                           help="test : réponses fabriquées, aucune clé. "
                                "claude : réponses du modèle, clé dans ANTHROPIC_API_KEY.")
    analyseur.add_argument("--personnalite", default=None,
                           help="Fichier texte décrivant l'assistant. À défaut, la "
                                "personnalité par défaut est utilisée.")
    analyseur.add_argument("--https", action="store_true",
                           help="Sert en https avec un certificat auto-signé. "
                                "Indispensable pour enregistrer au micro depuis un téléphone.")
    analyseur.add_argument("--voix-assistant", default=None,
                           help="Nom ou identifiant de la voix que prend l'assistant. "
                                "À défaut, la première voix enregistrée.")
    args = analyseur.parse_args()

    fabrique = MOTEURS[args.moteur]
    etat["moteur"] = fabrique(args.peripherique) if fabrique is MoteurXTTS else fabrique()
    etat["chat"] = MOTEURS_CHAT[args.chat]()
    etat["voix_chat"] = args.voix_assistant
    if args.personnalite:
        fichier = Path(args.personnalite)
        if not fichier.exists():
            print(f"  Erreur : personnalité introuvable ({fichier}).\n", file=sys.stderr)
            sys.exit(1)
        etat["personnalite"] = fichier.read_text(encoding="utf-8").strip()
    DOSSIER_VOIX.mkdir(parents=True, exist_ok=True)

    print()
    print(f"  Serveur vocal local — Studio Voix   (version {VERSION})")
    print(f"  Moteur      : {args.moteur}", end="")
    print("" if etat["moteur"].clone_reellement else "   (signal de contrôle, ne clone pas)")
    print(f"  Conversation: {args.chat}", end="")
    print("" if etat["chat"].repond_reellement else "   (réponses fabriquées)")
    protocole = "https" if args.https else "http"
    affichee = adresse_locale() if args.hote == "0.0.0.0" else args.hote
    print(f"  Adresse     : {protocole}://{affichee}:{args.port}")
    print(f"  Voix        : {len(lister_fiches())} enregistrée(s)")
    binaire = chemin_ffmpeg()
    print(f"  ffmpeg      : {binaire if binaire else 'ABSENT — pip install imageio-ffmpeg'}")
    print()
    if args.moteur == "xtts":
        print("  Le modèle doit d'abord être chargé : patientez jusqu'au message")
        print("  « modèle prêt » avant d'ouvrir l'application.")
        print()
    if page_application():
        print(f"  Ouvrez l'application ici : {protocole}://{affichee}:{args.port}/app")
        if page_chatbot():
            print(f"  Assistant conversationnel : {protocole}://{affichee}:{args.port}/chat")
        if args.https:
            print()
            print("  Le navigateur signalera un certificat non vérifié : c'est attendu.")
            print("  Acceptez l'exception une fois, le microphone fonctionnera ensuite.")
        elif args.hote == "0.0.0.0":
            print()
            print("  Sans --https, les navigateurs refuseront le micro depuis un téléphone.")
        print(f"  Aucun autre serveur n'est nécessaire.")
    else:
        print(f"  clonage_voix.html est introuvable : servez-le de votre côté, puis")
        print(f"  à l'étape 03 choisissez « Serveur local » sur http://{args.hote}:{args.port}")
    print()

    if args.chat == "claude":
        try:
            etat["chat"].preparer()
        except RuntimeError as e:
            print(f"  Erreur : {e}\n", file=sys.stderr)
            sys.exit(1)

    if args.moteur == "xtts":
        try:
            etat["moteur"].preparer()
        except RuntimeError as e:
            print(f"  Erreur : {e}\n", file=sys.stderr)
            sys.exit(1)
        except KeyboardInterrupt:
            # Le chargement du modèle dure une minute et son premier
            # téléchargement bien davantage : Ctrl+C y est un geste normal, et
            # ne doit pas répondre par une trace de PyTorch.
            print("\n  Chargement interrompu, le serveur n'a pas démarré.\n")
            sys.exit(0)

    options = dict(host=args.hote, port=args.port, log_level="warning")
    if args.https:
        certificat = preparer_certificat(adresse_locale())
        if not certificat:
            print("  Lancement en http : le micro restera inaccessible depuis un téléphone.\n",
                  file=sys.stderr)
        else:
            cert, cle = certificat
            options.update(ssl_certfile=str(cert), ssl_keyfile=str(cle))

    try:
        ServeurArretable(uvicorn.Config(app, **options)).run()
    except KeyboardInterrupt:
        # uvicorn rejoue le signal après avoir rendu le gestionnaire d'origine :
        # sans ce filet, l'arrêt normal se terminait sur une trace d'erreur.
        pass
    print("  Serveur arrêté.\n", flush=True)


if __name__ == "__main__":
    principal()
