#!/usr/bin/env python3
"""
Préparation du corpus d'entraînement — Studio Voix.

Le clonage instantané regarde quelques secondes de référence et improvise.
L'affinage, lui, modifie les poids du modèle sur des dizaines de minutes de
voix : c'est le seul moyen d'obtenir une ressemblance qui tienne sur la durée.

Mais un modèle affiné apprend tout ce qu'on lui donne, défauts compris. Une
réverbération présente dans le corpus devient irréversible : elle passe de la
référence, qu'on peut changer, aux poids du modèle, qu'on ne peut plus
corriger. Ce programme existe pour l'empêcher.

Il mesure chaque prise, refuse celles qui abîmeraient le modèle, découpe les
bonnes en phrases, et rend un corpus prêt à l'entraînement.

    python preparer_corpus.py --entree ~/Desktop/prises
    python preparer_corpus.py --entree ~/Desktop/prises --script texte_a_lire.txt
"""

import argparse
import csv
import math
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path

RACINE = Path(__file__).resolve().parent
FREQUENCE = 24000          # fréquence attendue par le moteur
DUREE_MIN = 1.5            # secondes : en dessous, un segment n'apprend rien
DUREE_MAX = 12.0           # au-dessus, il coûte trop de mémoire à l'entraînement
SILENCE_MIN = 0.35         # durée de silence qui sépare deux phrases

# Seuils de recevabilité, en décibels. Ils viennent de ce qu'un modèle affiné
# reproduit : au-delà, le défaut est appris au même titre que le timbre.
RT60_EXCELLENT = 150       # millisecondes
RT60_ACCEPTABLE = 250
PLANCHER_EXCELLENT = -60
PLANCHER_ACCEPTABLE = -50


# ══════════════════════════════════════════════════════════════
#   OUTILS
# ══════════════════════════════════════════════════════════════

def chemin_ffmpeg() -> str | None:
    trouve = shutil.which("ffmpeg")
    if trouve:
        return trouve
    try:
        import imageio_ffmpeg
        candidat = imageio_ffmpeg.get_ffmpeg_exe()
        return candidat if candidat and Path(candidat).exists() else None
    except Exception:
        return None


def convertir(source: Path, destination: Path) -> bool:
    binaire = chemin_ffmpeg()
    if not binaire:
        print("  ffmpeg est introuvable : pip install imageio-ffmpeg", file=sys.stderr)
        return False
    r = subprocess.run(
        [binaire, "-y", "-loglevel", "error", "-i", str(source),
         "-ac", "1", "-ar", str(FREQUENCE), "-c:a", "pcm_s16le", str(destination)],
        capture_output=True, text=True,
    )
    return r.returncode == 0


def lire(chemin: Path) -> tuple[list[float], int]:
    with wave.open(str(chemin), "rb") as w:
        fe, n = w.getframerate(), w.getnframes()
        brut = w.readframes(n)
    valeurs = struct.unpack(f"<{len(brut)//2}h", brut[: (len(brut) // 2) * 2])
    return [v / 32768.0 for v in valeurs], fe


def ecrire(chemin: Path, donnees: list[float], frequence: int) -> None:
    with wave.open(str(chemin), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(frequence)
        w.writeframes(b"".join(
            struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767)) for v in donnees
        ))


def db(v: float) -> float:
    return 20 * math.log10(v) if v > 1e-12 else -99.0


def enveloppe(x: list[float], fe: int, pas: float = 0.01) -> tuple[list[float], int]:
    f = max(1, int(fe * pas))
    nb = len(x) // f
    env = []
    for k in range(nb):
        bloc = x[k * f:(k + 1) * f]
        env.append(math.sqrt(sum(v * v for v in bloc) / f))
    return env, f


# ══════════════════════════════════════════════════════════════
#   MESURES
# ══════════════════════════════════════════════════════════════

def mesurer(x: list[float], fe: int) -> dict:
    """
    Relève ce qui décide de la valeur d'une prise pour l'entraînement.

    La traîne est mesurée en T20 — le temps mis pour perdre vingt décibels
    après une fin de mot — et non par une descente jusqu'au plancher : le
    plancher dépend du bruit, ce que l'on veut justement mesurer à part.
    """
    if not x:
        return {}
    env, f = enveloppe(x, fe, 0.005)
    if len(env) < 20:
        return {}
    niveaux = sorted(db(v) for v in env)
    plancher = niveaux[len(niveaux) // 10]
    haut = niveaux[int(len(niveaux) * 0.9)]
    crete = max(abs(v) for v in x)
    satures = sum(1 for v in x if abs(v) >= 0.999)

    edb = [db(v) for v in env]
    temps = []
    i = 4
    while i < len(edb) - 60:
        if edb[i - 1] > haut - 15 >= edb[i]:
            cible = edb[i] - 20
            j = i
            while j < min(i + 60, len(edb)) and edb[j] > cible:
                j += 1
            if i < j < min(i + 60, len(edb)):
                temps.append((j - i) * 0.005)
                i = j
        i += 1
    temps.sort()
    t20 = temps[len(temps) // 2] if temps else 0.0

    return {
        "duree": len(x) / fe,
        "plancher": plancher,
        "parole": haut,
        "rapport": haut - plancher,
        "crete": db(crete),
        "satures": satures,
        "rt60": t20 * 3 * 1000,
        "fins_de_mot": len(temps),
    }


def juger(m: dict) -> tuple[bool, list[str]]:
    """Rend un verdict et les motifs. Refuser tôt vaut mieux qu'entraîner mal."""
    motifs = []
    recevable = True

    if not m:
        return False, ["Prise illisible ou trop courte."]

    if m["fins_de_mot"] < 5:
        motifs.append(f"Traîne non mesurable ({m['fins_de_mot']} fins de mot exploitables).")
    elif m["rt60"] <= RT60_EXCELLENT:
        motifs.append(f"Pièce mate : traîne de {m['rt60']:.0f} ms.")
    elif m["rt60"] <= RT60_ACCEPTABLE:
        motifs.append(f"Pièce un peu vivante : traîne de {m['rt60']:.0f} ms, acceptable.")
    else:
        motifs.append(f"REFUS — traîne de {m['rt60']:.0f} ms : la réverbération serait "
                      "apprise par le modèle et deviendrait irréversible.")
        recevable = False

    if m["plancher"] <= PLANCHER_EXCELLENT:
        motifs.append(f"Fond sonore négligeable : {m['plancher']:.0f} dB.")
    elif m["plancher"] <= PLANCHER_ACCEPTABLE:
        motifs.append(f"Léger souffle : {m['plancher']:.0f} dB, acceptable.")
    else:
        motifs.append(f"REFUS — fond sonore à {m['plancher']:.0f} dB : il serait appris "
                      "au même titre que la voix.")
        recevable = False

    if m["satures"] > 0:
        motifs.append(f"REFUS — {m['satures']} échantillons saturés : la forme d'onde "
                      "est détruite, aucun traitement ne la rend.")
        recevable = False
    elif m["crete"] > -1:
        motifs.append(f"Crête à {m['crete']:.1f} dBFS : très près de la saturation.")
    elif m["crete"] < -24:
        motifs.append(f"Prise faible, crête à {m['crete']:.1f} dBFS : montez le gain "
                      "d'entrée plutôt que de corriger après coup.")

    if m["rapport"] < 30:
        motifs.append(f"Écart voix/fond de seulement {m['rapport']:.0f} dB : "
                      "rapprochez-vous du micro.")

    return recevable, motifs


# ══════════════════════════════════════════════════════════════
#   DÉCOUPAGE
# ══════════════════════════════════════════════════════════════

def decouper(x: list[float], fe: int, plancher_db: float) -> list[tuple[int, int]]:
    """
    Découpe la prise en phrases, sur les silences.

    Le seuil suit le fond sonore mesuré plutôt qu'une valeur fixe : une prise
    propre et une prise bruitée n'ont pas le même silence.
    """
    env, f = enveloppe(x, fe, 0.01)
    seuil = math.pow(10, (plancher_db + 10) / 20)
    parle = [v > seuil for v in env]

    fenetres_silence = max(1, int(SILENCE_MIN / 0.01))
    segments = []
    debut = None
    silence = 0
    for i, actif in enumerate(parle):
        if actif:
            if debut is None:
                debut = i
            silence = 0
        elif debut is not None:
            silence += 1
            if silence >= fenetres_silence:
                segments.append((debut * f, (i - silence + 1) * f))
                debut = None
    if debut is not None:
        segments.append((debut * f, len(x)))

    # Une marge de part et d'autre évite de rogner les attaques et les fins.
    marge = int(fe * 0.08)
    ajustes = []
    for a, b in segments:
        a = max(0, a - marge)
        b = min(len(x), b + marge)
        if DUREE_MIN <= (b - a) / fe <= DUREE_MAX:
            ajustes.append((a, b))
    return ajustes


def adoucir(seg: list[float], fe: int) -> list[float]:
    """Quelques millisecondes de fondu : un segment ne doit pas claquer."""
    n = len(seg)
    r = min(int(fe * 0.005), n // 2)
    for i in range(r):
        seg[i] *= i / r
        seg[n - 1 - i] *= i / r
    return seg


# ══════════════════════════════════════════════════════════════
#   PROGRAMME
# ══════════════════════════════════════════════════════════════

def principal():
    a = argparse.ArgumentParser(description="Prépare un corpus d'entraînement vocal")
    a.add_argument("--entree", required=True, help="Dossier des prises, ou fichier unique")
    a.add_argument("--sortie", default=str(RACINE / "corpus"), help="Dossier du corpus produit")
    a.add_argument("--script", default=None,
                   help="Texte lu, une phrase par ligne : sert de transcription")
    a.add_argument("--forcer", action="store_true",
                   help="Conserver les prises refusées. À n'utiliser qu'en connaissance de cause.")
    args = a.parse_args()

    entree = Path(args.entree).expanduser()
    sortie = Path(args.sortie).expanduser()
    if not entree.exists():
        print(f"Introuvable : {entree}", file=sys.stderr)
        sys.exit(1)

    fichiers = [entree] if entree.is_file() else sorted(
        p for p in entree.iterdir()
        if p.suffix.lower() in (".wav", ".aiff", ".aif", ".m4a", ".mp3", ".flac", ".mp4", ".mov")
    )
    if not fichiers:
        print(f"Aucun fichier audio dans {entree}", file=sys.stderr)
        sys.exit(1)

    lignes = []
    if args.script:
        chemin = Path(args.script).expanduser()
        if not chemin.exists():
            print(f"Script introuvable : {chemin}", file=sys.stderr)
            sys.exit(1)
        lignes = [l.strip() for l in chemin.read_text(encoding="utf-8").splitlines()
                  if l.strip() and not l.strip().startswith("#")]

    wavs = sortie / "wavs"
    wavs.mkdir(parents=True, exist_ok=True)
    temporaire = sortie / "_conversion.wav"

    print()
    print("  Préparation du corpus")
    print(f"  Prises      : {len(fichiers)}")
    print(f"  Corpus      : {sortie}")
    print(f"  Transcription : {'script fourni, ' + str(len(lignes)) + ' lignes' if lignes else 'à compléter à la main'}")
    print()

    entrees = []
    total = 0.0
    refusees = 0

    for fichier in fichiers:
        print(f"  {fichier.name}")
        if not convertir(fichier, temporaire):
            print("     conversion impossible, prise ignorée")
            continue
        x, fe = lire(temporaire)
        m = mesurer(x, fe)
        recevable, motifs = juger(m)
        for motif in motifs:
            print(f"     {motif}")

        if not recevable and not args.forcer:
            refusees += 1
            print("     prise écartée")
            print()
            continue

        segments = decouper(x, fe, m["plancher"])
        print(f"     {len(segments)} phrases retenues sur {m['duree']:.0f} s")
        for a0, b0 in segments:
            seg = adoucir(list(x[a0:b0]), fe)
            nom = f"{fichier.stem}_{len(entrees):04d}.wav"
            ecrire(wavs / nom, seg, fe)
            texte = lignes[len(entrees)] if len(entrees) < len(lignes) else ""
            entrees.append((nom, texte))
            total += (b0 - a0) / fe
        print()

    temporaire.unlink(missing_ok=True)

    if not entrees:
        print("  Aucun segment retenu : rien à entraîner.")
        print("  Refaites la prise dans un endroit plus mat, plus près du micro.")
        sys.exit(1)

    fiche = sortie / "metadata.csv"
    with open(fiche, "w", encoding="utf-8", newline="") as f:
        # Format attendu par l'entraînement de coqui : nom | texte | texte
        ecrivain = csv.writer(f, delimiter="|", quoting=csv.QUOTE_NONE, escapechar="\\")
        for nom, texte in entrees:
            ecrivain.writerow([f"wavs/{nom}", texte, texte])

    sans_texte = sum(1 for _, t in entrees if not t)
    minutes = total / 60

    print("  " + "-" * 56)
    print(f"  {len(entrees)} phrases, {minutes:.1f} minutes retenues")
    if refusees:
        print(f"  {refusees} prise(s) écartée(s)")
    if sans_texte:
        print(f"  {sans_texte} phrases sans transcription : complétez {fiche.name}")
    print()
    if minutes < 10:
        print("  Moins de dix minutes : trop peu pour un affinage utile.")
        print("  Visez vingt à trente minutes de voix nette.")
    elif minutes < 20:
        print("  Entre dix et vingt minutes : un affinage est possible, le gain")
        print("  restera modeste. Vingt à trente minutes valent mieux.")
    else:
        print("  Durée suffisante pour un affinage.")
    print()


if __name__ == "__main__":
    principal()
