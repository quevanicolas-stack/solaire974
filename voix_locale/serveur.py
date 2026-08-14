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
import json
import math
import shutil
import struct
import subprocess
import sys
import time
import uuid
import wave
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

RACINE = Path(__file__).resolve().parent
DOSSIER_VOIX = RACINE / "donnees" / "voix"
FREQUENCE = 24000          # fréquence d'échantillonnage de sortie, en hertz
DUREE_REFERENCE_MAX = 120  # secondes de référence conservées par voix


# ══════════════════════════════════════════════════════════════
#   OUTILS AUDIO
# ══════════════════════════════════════════════════════════════

def ffmpeg_disponible() -> bool:
    return shutil.which("ffmpeg") is not None


def convertir_en_wav(source: Path, destination: Path, secondes_max: int = 0) -> None:
    """Normalise un audio quelconque en WAV mono, via ffmpeg."""
    if not ffmpeg_disponible():
        raise RuntimeError(
            "ffmpeg est introuvable. Installez-le puis relancez le serveur "
            "(sur Mac : brew install ffmpeg)."
        )
    commande = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source)]
    if secondes_max:
        commande += ["-t", str(secondes_max)]
    commande += ["-ac", "1", "-ar", str(FREQUENCE), "-c:a", "pcm_s16le", str(destination)]
    resultat = subprocess.run(commande, capture_output=True, text=True)
    if resultat.returncode != 0:
        raise RuntimeError("Conversion audio impossible : " + resultat.stderr.strip()[:400])


def assembler_references(fichiers: list[Path], destination: Path) -> None:
    """Concatène les échantillons en une seule référence, tronquée à la durée utile."""
    if len(fichiers) == 1:
        convertir_en_wav(fichiers[0], destination, DUREE_REFERENCE_MAX)
        return

    liste = destination.parent / "liste.txt"
    intermediaires = []
    for i, f in enumerate(fichiers):
        inter = destination.parent / f"part{i}.wav"
        convertir_en_wav(f, inter)
        intermediaires.append(inter)
    liste.write_text("\n".join(f"file '{p.name}'" for p in intermediaires), encoding="utf-8")

    commande = [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", str(liste), "-t", str(DUREE_REFERENCE_MAX),
        "-ac", "1", "-ar", str(FREQUENCE), "-c:a", "pcm_s16le", str(destination),
    ]
    resultat = subprocess.run(commande, capture_output=True, text=True, cwd=destination.parent)
    if resultat.returncode != 0:
        raise RuntimeError("Assemblage des échantillons impossible : " + resultat.stderr.strip()[:400])

    for p in intermediaires:
        p.unlink(missing_ok=True)
    liste.unlink(missing_ok=True)


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
        duree_syllabe = 0.16
        total = int(FREQUENCE * syllabes * duree_syllabe)
        echantillons = []

        base = 130.0 + 40.0 * float(reglages.get("similarity_boost", 0.75))
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

    def preparer(self) -> None:
        if self.modele is not None:
            return
        try:
            from TTS.api import TTS
        except ImportError as e:
            raise RuntimeError(
                "Le moteur XTTS n'est pas installé. Lancez :\n"
                "    pip install coqui-tts\n"
                "puis relancez le serveur."
            ) from e

        peripherique = self._choisir_peripherique()
        print(f"[moteur] chargement de XTTS-v2 sur {peripherique}, patientez…", flush=True)
        debut = time.time()
        self.modele = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(peripherique)
        print(f"[moteur] modèle prêt en {time.time() - debut:.0f} s", flush=True)

    def synthetiser(self, texte: str, reference: Path, reglages: dict) -> tuple[bytes, str]:
        self.preparer()
        if not reference.exists():
            raise RuntimeError("Aucun échantillon de référence pour cette voix.")

        sortie = reference.parent / f"sortie_{uuid.uuid4().hex}.wav"
        try:
            # La stabilité de l'application pilote la température du modèle :
            # une stabilité haute donne une lecture plus régulière.
            stabilite = float(reglages.get("stability", 0.5))
            self.modele.tts_to_file(
                text=texte,
                speaker_wav=str(reference),
                language="fr",
                file_path=str(sortie),
                temperature=max(0.01, 0.9 - 0.6 * stabilite),
            )
            return sortie.read_bytes(), "audio/wav"
        finally:
            sortie.unlink(missing_ok=True)


MOTEURS = {"test": MoteurTest, "xtts": MoteurXTTS}


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

etat = {"moteur": MoteurTest(), "caracteres": 0}


def erreur(code: int, message: str) -> JSONResponse:
    """Format d'erreur identique à celui que l'application sait déjà lire."""
    return JSONResponse(status_code=code, content={"detail": {"message": message}})


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
    }


@app.get("/v1/voices")
def voix():
    return {"voices": [
        {
            "voice_id": f["voice_id"],
            "name": f["name"],
            "category": "cloned",
            "description": f.get("description", ""),
        }
        for f in lister_fiches()
    ]}


@app.post("/v1/voices/add")
async def ajouter_voix(
    name: str = Form(...),
    description: str = Form(""),
    files: list[UploadFile] = File(...),
):
    if not files:
        return erreur(422, "Aucun échantillon reçu.")
    if not ffmpeg_disponible():
        return erreur(500, "ffmpeg est introuvable sur le serveur. Sur Mac : brew install ffmpeg.")

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

        reference = dossier / "reference.wav"
        assembler_references(chemins, reference)

        secondes = duree_wav(reference)
        if secondes < 3:
            shutil.rmtree(dossier, ignore_errors=True)
            return erreur(422, f"Référence trop courte ({secondes:.0f} s). Enregistrez au moins quelques secondes.")

        fiche = {
            "voice_id": voix_id,
            "name": name,
            "description": description,
            "duree_reference": round(secondes, 1),
            "nb_echantillons": len(chemins),
            "cree_le": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "moteur": etat["moteur"].nom,
        }
        (dossier / "voix.json").write_text(
            json.dumps(fiche, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        # Les fichiers d'origine ne servent plus une fois la référence produite.
        shutil.rmtree(brut, ignore_errors=True)

        print(f"[voix] « {name} » créée : {secondes:.0f} s de référence", flush=True)
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

    reglages = corps.get("voice_settings") or {}
    debut = time.time()
    try:
        audio, mime = etat["moteur"].synthetiser(texte, dossier / "reference.wav", reglages)
    except RuntimeError as e:
        return erreur(500, str(e))
    except Exception as e:
        return erreur(500, f"Synthèse impossible : {e}")

    etat["caracteres"] += len(texte)
    print(f"[synthese] {len(texte)} caractères en {time.time() - debut:.1f} s "
          f"({fiche['name']})", flush=True)
    return Response(content=audio, media_type=mime)


@app.get("/")
def accueil():
    moteur = etat["moteur"]
    return {
        "service": "Serveur vocal local — Studio Voix",
        "moteur": moteur.nom,
        "clone_reellement": moteur.clone_reellement,
        "voix": len(lister_fiches()),
        "ffmpeg": ffmpeg_disponible(),
    }


# ══════════════════════════════════════════════════════════════
#   DÉMARRAGE
# ══════════════════════════════════════════════════════════════

def principal():
    analyseur = argparse.ArgumentParser(description="Serveur vocal local pour Studio Voix")
    analyseur.add_argument("--moteur", default="test", choices=sorted(MOTEURS),
                           help="test : signal de contrôle, aucun téléchargement. "
                                "xtts : clonage réel.")
    analyseur.add_argument("--port", type=int, default=8770)
    analyseur.add_argument("--hote", default="127.0.0.1",
                           help="127.0.0.1 limite l'accès à cette machine.")
    analyseur.add_argument("--peripherique", default="auto", choices=["auto", "cpu", "cuda", "mps"])
    args = analyseur.parse_args()

    fabrique = MOTEURS[args.moteur]
    etat["moteur"] = fabrique(args.peripherique) if fabrique is MoteurXTTS else fabrique()
    DOSSIER_VOIX.mkdir(parents=True, exist_ok=True)

    print()
    print("  Serveur vocal local — Studio Voix")
    print(f"  Moteur      : {args.moteur}", end="")
    print("" if etat["moteur"].clone_reellement else "   (signal de contrôle, ne clone pas)")
    print(f"  Adresse     : http://{args.hote}:{args.port}")
    print(f"  Voix        : {len(lister_fiches())} enregistrée(s)")
    print(f"  ffmpeg      : {'présent' if ffmpeg_disponible() else 'ABSENT — brew install ffmpeg'}")
    print()
    print(f"  Dans l'application, étape 03, choisissez « Serveur local »")
    print(f"  et indiquez l'adresse http://{args.hote}:{args.port}")
    print()

    if args.moteur == "xtts":
        try:
            etat["moteur"].preparer()
        except RuntimeError as e:
            print(f"  Erreur : {e}\n", file=sys.stderr)
            sys.exit(1)

    import uvicorn
    uvicorn.run(app, host=args.hote, port=args.port, log_level="warning")


if __name__ == "__main__":
    principal()
