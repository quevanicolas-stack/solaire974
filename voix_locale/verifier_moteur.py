#!/usr/bin/env python3
"""
Vérifications du moteur XTTS sans XTTS.

XTTS réclame plusieurs gigaoctets de modèle et un téléchargement : on ne peut
pas l'exécuter à chaque contrôle. Or c'est précisément le chemin où une erreur
ne se voit pas — elle ne se manifeste que chez l'utilisateur, au moment de
générer, et fait échouer la génération entière.

On remplace donc le modèle par un objet factice qui note ce qu'on lui demande.
Cela ne dit rien de la qualité du son produit, et ce n'est pas le but : cela
dit que les bons arguments partent au bon endroit.

Lancement :
    python verifier_moteur.py
"""

import sys
import tempfile
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import serveur

resultats = []


def verifier(nom, ok, detail=""):
    resultats.append(ok)
    print(("  OK   " if ok else "  ECHEC") + " | " + nom + (" — " + str(detail) if detail else ""))


class ModeleFactice:
    """Note les appels au lieu de synthétiser."""

    def __init__(self):
        self.appels_clone = []
        self.appels_synthese = []
        self.synthesizer = type("S", (), {"tts_model": self})()

    def clone_voice(self, **kwargs):
        self.appels_clone.append(kwargs)
        dossier = Path(kwargs["voice_dir"])
        dossier.mkdir(parents=True, exist_ok=True)
        (dossier / f"{kwargs['speaker_id']}.pth").write_bytes(b"empreinte factice")
        return {}

    def tts_to_file(self, **kwargs):
        self.appels_synthese.append(kwargs)
        Path(kwargs["file_path"]).write_bytes(wav_muet(0.5))


def wav_muet(secondes: float) -> bytes:
    import io
    tampon = io.BytesIO()
    with wave.open(tampon, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(serveur.FREQUENCE)
        w.writeframes(b"\x00\x00" * int(serveur.FREQUENCE * secondes))
    return tampon.getvalue()


def moteur_factice():
    moteur = serveur.MoteurXTTS.__new__(serveur.MoteurXTTS)
    moteur.modele = ModeleFactice()
    moteur.preparer = lambda: None
    return moteur


print("--- Empreinte mise en cache ---")

with tempfile.TemporaryDirectory() as tmp:
    dossier = Path(tmp) / "voix"
    dossier.mkdir()
    tranches = []
    for i in range(3):
        t = dossier / f"tranche{i:03d}.wav"
        t.write_bytes(wav_muet(30))
        tranches.append(t)

    moteur = moteur_factice()
    verifier("Sans empreinte, le cache est vide", moteur.voix_en_cache(dossier) is None)

    ok = moteur.preparer_voix(dossier, tranches)
    verifier("L'empreinte est calculée et rangée", ok)
    verifier("Le cache est désormais trouvé", moteur.voix_en_cache(dossier) == "empreinte")

    appel = moteur.modele.appels_clone[0]
    verifier("Toutes les tranches sont transmises, pas seulement la première",
             len(appel["speaker_wav"]) == 3, f"{len(appel['speaker_wav'])} tranche(s)")
    # Les valeurs par defaut de la bibliotheque sont 10 s pour l'empreinte et
    # 12 s pour la prosodie : les laisser revient a n'utiliser que le debut.
    verifier("La durée lue pour l'empreinte dépasse les 10 s par défaut",
             appel["max_ref_len"] > 10, f"{appel['max_ref_len']} s")
    verifier("La durée lue pour la prosodie dépasse les 12 s par défaut",
             appel["gpt_cond_len"] > 12, f"{appel['gpt_cond_len']} s")
    verifier("Le découpage interne reste inférieur ou égal à la fenêtre",
             appel["gpt_cond_chunk_len"] <= appel["gpt_cond_len"])

print("\n--- Conditionnement au moment de la synthèse ---")

with tempfile.TemporaryDirectory() as tmp:
    dossier = Path(tmp) / "voix"
    dossier.mkdir()
    reference = dossier / "reference.wav"
    reference.write_bytes(wav_muet(90))
    tranchesdir = dossier / "tranches"
    tranchesdir.mkdir()
    for i in range(3):
        (tranchesdir / f"tranche{i:03d}.wav").write_bytes(wav_muet(30))

    # Sans empreinte : les tranches doivent partir, avec les durées explicites.
    moteur = moteur_factice()
    moteur.synthetiser("Bonjour.", reference, {})
    a = moteur.modele.appels_synthese[0]
    verifier("Sans empreinte, les tranches sont passées au moteur",
             isinstance(a.get("speaker_wav"), list) and len(a["speaker_wav"]) == 3,
             f"{len(a.get('speaker_wav') or [])} tranche(s)")
    verifier("Sans empreinte, les durées sont transmises explicitement",
             a.get("max_ref_len") == serveur.REF_EMPREINTE
             and a.get("gpt_cond_len") == serveur.REF_PROSODIE)
    verifier("Sans empreinte, aucune voix en cache n'est réclamée",
             "speaker" not in a)

    # Avec empreinte : plus aucune tranche ne doit etre relue.
    moteur2 = moteur_factice()
    moteur2.preparer_voix(dossier, sorted(tranchesdir.glob("*.wav")))
    moteur2.modele.appels_synthese.clear()
    moteur2.synthetiser("Bonjour.", reference, {})
    b = moteur2.modele.appels_synthese[0]
    verifier("Avec empreinte, la voix en cache est réclamée",
             b.get("speaker") == "empreinte" and b.get("voice_dir") == str(dossier))
    verifier("Avec empreinte, aucune tranche n'est relue à chaque phrase",
             "speaker_wav" not in b)

    # Une voix d'avant ce changement n'a pas de tranches : elle doit continuer
    # de fonctionner, sur sa reference d'un bloc.
    ancien = Path(tmp) / "ancienne"
    ancien.mkdir()
    ref2 = ancien / "reference.wav"
    ref2.write_bytes(wav_muet(60))
    moteur3 = moteur_factice()
    moteur3.synthetiser("Bonjour.", ref2, {})
    c = moteur3.modele.appels_synthese[0]
    verifier("Une voix créée avant ce changement fonctionne encore",
             c.get("speaker_wav") == str(ref2), c.get("speaker_wav"))

print("\n--- Découpage de la référence ---")

if not serveur.ffmpeg_disponible():
    verifier("ffmpeg présent pour le découpage", False, "ffmpeg absent")
else:
    with tempfile.TemporaryDirectory() as tmp:
        dossier = Path(tmp)
        reference = dossier / "reference.wav"
        reference.write_bytes(wav_muet(155))
        tranches = serveur.decouper_reference(reference, dossier)
        verifier("Une référence de 155 s donne six tranches de 30 s",
                 len(tranches) == 6, f"{len(tranches)} tranche(s)")
        verifier("Les tranches sont relues par tranches_reference",
                 len(serveur.tranches_reference(dossier)) == len(tranches))

        # Une reference courte ne doit pas se retrouver sans aucune tranche :
        # trente secondes de reference sont parfaitement legitimes.
        courte = dossier / "courte.wav"
        courte.write_bytes(wav_muet(12))
        tc = serveur.decouper_reference(courte, dossier)
        verifier("Une référence courte garde sa tranche unique",
                 len(tc) == 1, f"{len(tc)} tranche(s)")

        # Un tronçon d'une seconde donnerait une empreinte bruitee.
        limite = dossier / "limite.wav"
        limite.write_bytes(wav_muet(31))
        tl = serveur.decouper_reference(limite, dossier)
        verifier("Le reliquat trop court est écarté",
                 len(tl) == 1, f"{len(tl)} tranche(s) pour 31 s")

        # Au-dela du plafond, on preleve regulierement.
        longue = dossier / "longue.wav"
        longue.write_bytes(wav_muet(serveur.DUREE_TRANCHE * (serveur.TRANCHES_MAX + 8)))
        tlg = serveur.decouper_reference(longue, dossier)
        verifier("Le nombre de tranches est plafonné",
                 len(tlg) == serveur.TRANCHES_MAX, f"{len(tlg)} tranche(s)")

print(f"\nRESULTAT : {sum(resultats)}/{len(resultats)} vérifications réussies")
sys.exit(0 if all(resultats) else 1)
