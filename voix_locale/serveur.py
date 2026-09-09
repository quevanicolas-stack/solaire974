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
import os
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
from fastapi.responses import FileResponse, JSONResponse, Response

RACINE = Path(__file__).resolve().parent
DOSSIER_VOIX = RACINE / "donnees" / "voix"
FREQUENCE = 24000          # fréquence d'échantillonnage de sortie, en hertz
DUREE_REFERENCE_MAX = 120  # secondes de référence conservées par voix


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
        print("[moteur] lecture audio autonome activée, torchcodec n'est pas sollicité", flush=True)

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
            self.modele.tts_to_file(
                text=texte,
                speaker_wav=str(reference),
                language="fr",
                file_path=str(sortie),
                temperature=max(0.01, 0.9 - 0.6 * stabilite),
                speed=vitesse,
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
        assembler_references(chemins, reference, debruiter)

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
            "debruitee": debruiter,
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
        reponse = etat["chat"].repondre(propres, etat["personnalite"])
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
    print("  Serveur vocal local — Studio Voix")
    print(f"  Moteur      : {args.moteur}", end="")
    print("" if etat["moteur"].clone_reellement else "   (signal de contrôle, ne clone pas)")
    print(f"  Conversation: {args.chat}", end="")
    print("" if etat["chat"].repond_reellement else "   (réponses fabriquées)")
    print(f"  Adresse     : http://{args.hote}:{args.port}")
    print(f"  Voix        : {len(lister_fiches())} enregistrée(s)")
    binaire = chemin_ffmpeg()
    print(f"  ffmpeg      : {binaire if binaire else 'ABSENT — pip install imageio-ffmpeg'}")
    print()
    if args.moteur == "xtts":
        print("  Le modèle doit d'abord être chargé : patientez jusqu'au message")
        print("  « modèle prêt » avant d'ouvrir l'application.")
        print()
    if page_application():
        print(f"  Ouvrez l'application ici : http://{args.hote}:{args.port}/app")
        if page_chatbot():
            print(f"  Assistant conversationnel : http://{args.hote}:{args.port}/chat")
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

    import uvicorn
    uvicorn.run(app, host=args.hote, port=args.port, log_level="warning")


if __name__ == "__main__":
    principal()
