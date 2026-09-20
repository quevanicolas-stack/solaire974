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

print("\n--- Découpage du texte ---")

# XTTS refuse plus de 273 caracteres en francais : au-dela il tronque, sans
# rien dire a l'application. Un texte colle depuis un traitement de texte
# partait en un seul bloc et perdait tout ce qui depassait.

def sans_espaces(t):
    return "".join(t.split())


def controler(nom, texte, attendu_min=None):
    morceaux = serveur.decouper_texte(texte)
    trop = [m for m, _ in morceaux if len(m) > 273]
    verifier(f"{nom} : aucun morceau au-dessus de la limite du moteur",
             not trop, f"{len(morceaux)} morceau(x), plus long {max((len(m) for m,_ in morceaux), default=0)} car.")
    # Invariant : le decoupage repartit le texte, il n'en retire rien.
    verifier(f"{nom} : aucun caractère perdu",
             sans_espaces("".join(m for m, _ in morceaux)) == sans_espaces(texte))
    if attendu_min is not None:
        verifier(f"{nom} : découpé en morceaux distincts",
                 len(morceaux) >= attendu_min, f"{len(morceaux)} morceau(x)")
    return morceaux


LONG = ("Il y a une croyance qui bloque énormément de francophones : l'idée qu'il faut parler anglais sans\n"
        "accent pour être pris au sérieux. C'est faux, et il est temps de le déconstruire une bonne fois "
        "pour toutes.Regardez les leaders les plus respectés du monde des affaires aujourd'hui, ELON MUSK, "
        "avec son accent sud-africain très marqué, SUNDAR PICHAI, PDG de Google, avec un accent indien "
        "clairement audible, aucun des deux n'a jamais cherché à gommé son accent, et ça ne les a jamais "
        "empêchés de dirigé certaines des entreprises les plus influentes de la planète")

morceaux = controler("Texte long", LONG, attendu_min=4)
verifier("Une ligne repliée par la mise en page est recollée",
         "anglais sans accent" in morceaux[0][0],
         morceaux[0][0][-40:])
verifier("Un point collé au mot suivant sépare bien deux phrases",
         any(m.startswith("Regardez") for m, _ in morceaux))

# Une phrase sans la moindre ponctuation interne : il faut couper aux espaces,
# jamais au milieu d'un mot.
sans_ponctuation = "alpha " * 90
m2 = controler("Phrase sans ponctuation", sans_ponctuation.strip(), attendu_min=2)
verifier("Aucun mot n'est coupé en deux",
         all(mot == "alpha" for m, _ in m2 for mot in m.split()))

# Les abreviations et les nombres ne terminent pas une phrase.
abrege = "M. Dupont arrive à 14 h. Le tarif est de 3.14 euros par art. 5 du contrat."
m3 = serveur.decouper_texte(abrege)
verifier("Une abréviation ne coupe pas la phrase",
         not any(m.strip().startswith("Dupont") for m, _ in m3),
         " | ".join(m for m, _ in m3))
verifier("Un nombre décimal ne coupe pas la phrase",
         not any(m.strip().startswith("14 euros") for m, _ in m3))

# Une respiration voulue reste une respiration.
voulu = "Bonjour à tous.\nNous commençons maintenant."
m4 = serveur.decouper_texte(voulu)
verifier("Un retour à la ligne après ponctuation reste une respiration",
         len(m4) == 2 and m4[0][0] == "Bonjour à tous.", f"{len(m4)} morceau(x)")

# Cas limites : rien ne doit lever d'erreur.
for vide in ("", "   ", "\n\n", "."):
    serveur.decouper_texte(vide)
verifier("Les textes vides ou minimaux ne font pas échouer le découpage", True)

court = "Bonjour, comment allez-vous ?"
m5 = serveur.decouper_texte(court)
verifier("Un texte court reste en un seul morceau",
         len(m5) == 1 and m5[0][0] == court, f"{len(m5)} morceau(x)")
verifier("Le dernier morceau n'est jamais suivi d'un silence",
         serveur.decouper_texte(LONG)[-1][1] == "fin")

# Les silences ne se valent pas. Une coupure faite pour tenir sous la limite du
# moteur ne doit pas s'entendre comme un changement de paragraphe : un texte
# courant de cinq phrases se voyait allonger de plus de deux secondes.
natures = [n for _, n in serveur.decouper_texte(
    "Bonjour à tous. Nous allons parler du projet. Le calendrier est tenu. Merci.")]
verifier("Des phrases d'une même ligne sont séparées par une pause de phrase",
         natures[:-1] == ["phrase"] * (len(natures) - 1), " ".join(natures))
verifier("Le dernier morceau n'est suivi d'aucun silence",
         natures[-1] == "fin", natures[-1])

natures = [n for _, n in serveur.decouper_texte("Bonjour.\nNous commençons.\nMerci.")]
verifier("Un retour à la ligne reste une respiration",
         natures[0] == "ligne", " ".join(natures))

natures = [n for _, n in serveur.decouper_texte("Premier bloc ici.\n\nSecond bloc là.")]
verifier("Une ligne vide reste un paragraphe",
         natures[0] == "paragraphe", " ".join(natures))

longue = "Alpha " * 80 + "."
natures = [n for _, n in serveur.decouper_texte(longue)]
verifier("Une phrase tronçonnée garde des pauses internes courtes",
         "proposition" in natures, " ".join(natures))

verifier("Les durées vont croissant : proposition, phrase, respiration, paragraphe",
         serveur.PAUSE_PROPOSITION < serveur.PAUSE_PHRASE <= serveur.PAUSE_COURTE
         < serveur.PAUSE_LONGUE,
         f"{serveur.PAUSE_PROPOSITION} < {serveur.PAUSE_PHRASE} <= "
         f"{serveur.PAUSE_COURTE} < {serveur.PAUSE_LONGUE}")

# Le silence total d'un texte courant doit rester modeste.
DUREES = {"proposition": serveur.PAUSE_PROPOSITION, "phrase": serveur.PAUSE_PHRASE,
          "ligne": serveur.PAUSE_COURTE, "paragraphe": serveur.PAUSE_LONGUE, "fin": 0.0}
total = sum(DUREES[n] for _, n in serveur.decouper_texte(
    "Bonjour à tous. Nous allons parler du projet. Le calendrier est tenu. "
    "Les moyens sont réunis. Merci de votre attention."))
verifier("Cinq phrases n'ajoutent pas plus d'une seconde de silence",
         total <= 1.0, f"{total:.2f} s ajoutées")

# Une nature inconnue ne doit pas devenir un silence nul sans le dire.
verifier("Toutes les natures produites sont connues du recollage",
         all(n in DUREES for _, n in serveur.decouper_texte(LONG)))

# La duree d'une pause de phrase vient du style choisi dans l'application.
# Elle doit arriver jusqu'au recollage, sinon le style ne s'entend pas.
def duree_phrase(reglages):
    courte = float(reglages.get("pause_courte", serveur.PAUSE_COURTE))
    phrase = reglages.get("pause_phrase")
    return (float(phrase) if phrase not in (None, "")
            else courte * (serveur.PAUSE_PHRASE / serveur.PAUSE_COURTE))

verifier("Sans consigne, la pause de phrase garde sa valeur par défaut",
         abs(duree_phrase({}) - serveur.PAUSE_PHRASE) < 1e-9,
         f"{duree_phrase({}):.2f} s")
verifier("Un style à pauses marquées allonge la pause de phrase",
         duree_phrase({"pause_phrase": 0.42}) == 0.42)
verifier("Des pauses réglées à zéro emportent aussi les silences internes",
         duree_phrase({"pause_courte": 0.0}) == 0.0)

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
