'use strict';
// Transcription vocale cote serveur, via whisper.cpp installe localement.
// Ce chemin sert aux clients qui n'ont pas la reconnaissance vocale du navigateur,
// notamment la fenetre Electron sur macOS. Tout reste sur la machine : aucun audio
// n'est envoye a un service tiers.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const config = require('./config');

function reglagesWhisper() {
  const r = config.lire().whisper;
  return {
    binaire: developper(r.binaire),
    modele: developper(r.modele),
    langue: r.langue || 'fr'
  };
}

function developper(chemin) {
  if (!chemin) return '';
  if (chemin.startsWith('~/')) return path.join(os.homedir(), chemin.slice(2));
  return chemin;
}

function estDisponible() {
  const w = reglagesWhisper();
  if (!w.binaire || !w.modele) return false;
  try {
    fs.accessSync(w.binaire, fs.constants.X_OK);
    fs.accessSync(w.modele, fs.constants.R_OK);
    return true;
  } catch (e) {
    return false;
  }
}

// Convertit l'audio recu en WAV 16 kHz mono, format attendu par whisper.cpp.
function convertir(source, destination) {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-y', '-i', source, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', destination],
      { timeout: 60000 },
      (erreur) => resolve(!erreur && fs.existsSync(destination)));
  });
}

function executerWhisper(fichierWav) {
  const w = reglagesWhisper();
  return new Promise((resolve) => {
    execFile(w.binaire, [
      '-m', w.modele,
      '-f', fichierWav,
      '-l', w.langue,
      '-nt',        // sans horodatage
      '-np',        // sans messages de progression
      '-otxt', '-of', fichierWav.replace(/\.wav$/, '')
    ], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (erreur, sortie) => {
      if (erreur) return resolve({ ok: false, erreur: erreur.message });
      const fichierTexte = fichierWav.replace(/\.wav$/, '') + '.txt';
      let texte = '';
      if (fs.existsSync(fichierTexte)) {
        texte = fs.readFileSync(fichierTexte, 'utf8');
        try { fs.unlinkSync(fichierTexte); } catch (e) { /* sans importance */ }
      } else {
        texte = String(sortie || '');
      }
      resolve({ ok: true, texte: nettoyer(texte) });
    });
  });
}

// whisper.cpp ajoute parfois des annotations entre crochets ou parentheses.
function nettoyer(texte) {
  return String(texte || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function transcrire(audio, typeMime) {
  if (!estDisponible()) {
    return {
      ok: false,
      erreur: 'Transcription locale indisponible. Renseignez le binaire et le modele whisper dans les reglages.'
    };
  }
  config.assurerDossier();
  const identifiant = crypto.randomBytes(8).toString('hex');
  const extension = /wav/i.test(typeMime || '') ? '.wav'
    : /ogg/i.test(typeMime || '') ? '.ogg'
      : /mp4|m4a|aac/i.test(typeMime || '') ? '.m4a' : '.webm';
  const entree = path.join(config.DOSSIER_AUDIO, identifiant + extension);
  const wav = path.join(config.DOSSIER_AUDIO, identifiant + '.wav');

  fs.writeFileSync(entree, audio, { mode: 0o600 });

  const nettoyage = () => {
    for (const f of [entree, wav]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* sans importance */ }
    }
  };

  try {
    let fichierWav = entree;
    if (extension !== '.wav') {
      const converti = await convertir(entree, wav);
      if (!converti) {
        nettoyage();
        return { ok: false, erreur: 'Conversion audio impossible : ffmpeg est-il installe ?' };
      }
      fichierWav = wav;
    }
    const resultat = await executerWhisper(fichierWav);
    nettoyage();
    if (!resultat.ok) return { ok: false, erreur: 'Transcription echouee : ' + resultat.erreur };
    if (!resultat.texte) return { ok: false, erreur: 'Aucune parole detectee.' };
    return { ok: true, texte: resultat.texte };
  } catch (erreur) {
    nettoyage();
    return { ok: false, erreur: erreur.message };
  }
}

module.exports = { transcrire, estDisponible, nettoyer };
