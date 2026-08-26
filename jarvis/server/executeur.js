'use strict';
// Execution des actions systeme. Toutes les commandes passent par execFile avec des
// arguments separes : le texte dicte n'est jamais interprete par un shell, sauf pour
// l'intention "shell" que l'utilisateur doit activer explicitement dans la configuration.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');

const MAC = process.platform === 'darwin';

function lancer(commande, args, options) {
  const opts = Object.assign({ timeout: config.lire().execution.delaiMaxMs, maxBuffer: 4 * 1024 * 1024 }, options || {});
  return new Promise((resolve) => {
    execFile(commande, args, opts, (erreur, sortie, erreurSortie) => {
      if (erreur) {
        resolve({ ok: false, sortie: String(sortie || ''), erreur: String(erreurSortie || erreur.message).trim() });
      } else {
        resolve({ ok: true, sortie: String(sortie || '').trim(), erreur: '' });
      }
    });
  });
}

function osascript(script) {
  if (!MAC) return Promise.resolve({ ok: false, erreur: 'AppleScript indisponible sur cette plateforme.' });
  return lancer('osascript', ['-e', script]);
}

// Resout ~, les chemins relatifs au dossier personnel et les noms de dossiers usuels.
function resoudreChemin(brut) {
  let c = String(brut || '').trim();
  if (!c) return null;
  if (c === '~') return os.homedir();
  if (c.startsWith('~/')) c = path.join(os.homedir(), c.slice(2));
  if (!path.isAbsolute(c)) c = path.join(os.homedir(), c);
  return path.normalize(c);
}

function existe(chemin) {
  try { fs.accessSync(chemin); return true; } catch (e) { return false; }
}

// Recherche tolerante d'un fichier ou dossier dont le nom a ete dicte.
function chercherDansDossiersUsuels(nom) {
  const racines = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music']
    .map((d) => path.join(os.homedir(), d))
    .filter(existe);
  const recherche = String(nom).toLowerCase();
  for (const racine of racines) {
    let entrees;
    try { entrees = fs.readdirSync(racine); } catch (e) { continue; }
    const trouve = entrees.find((e) => e.toLowerCase() === recherche)
      || entrees.find((e) => e.toLowerCase().startsWith(recherche))
      || entrees.find((e) => e.toLowerCase().includes(recherche));
    if (trouve) return path.join(racine, trouve);
  }
  return null;
}

async function ouvrirApplication(nom) {
  if (!MAC) return { ok: false, message: 'L\'ouverture d\'applications n\'est prise en charge que sur macOS.' };
  const r = await lancer('open', ['-a', String(nom)]);
  if (r.ok) return { ok: true, message: nom + ' est ouvert.' };
  return { ok: false, message: 'Je ne trouve pas l\'application ' + nom + '.' };
}

async function fermerApplication(nom) {
  const r = await osascript('tell application "' + String(nom).replace(/"/g, '') + '" to quit');
  return r.ok
    ? { ok: true, message: nom + ' est ferme.' }
    : { ok: false, message: 'Impossible de fermer ' + nom + '.' };
}

async function ouvrirUrl(url) {
  const propre = String(url);
  if (!/^https?:\/\//i.test(propre)) return { ok: false, message: 'Adresse invalide.' };
  const commande = MAC ? 'open' : 'xdg-open';
  const r = await lancer(commande, [propre]);
  return r.ok
    ? { ok: true, message: 'La page est ouverte.' }
    : { ok: false, message: 'Je n\'ai pas pu ouvrir la page.' };
}

async function ouvrirChemin(brut) {
  let chemin = resoudreChemin(brut);
  if (!chemin || !existe(chemin)) {
    const alternatif = chercherDansDossiersUsuels(String(brut).replace(/^.*\//, ''));
    if (alternatif) chemin = alternatif;
  }
  if (!chemin || !existe(chemin)) {
    return { ok: false, message: 'Je ne trouve pas ' + brut + '.' };
  }
  const commande = MAC ? 'open' : 'xdg-open';
  const r = await lancer(commande, [chemin]);
  return r.ok
    ? { ok: true, message: path.basename(chemin) + ' est ouvert.', details: { chemin } }
    : { ok: false, message: 'Ouverture impossible : ' + r.erreur };
}

async function rechercherSurLeWeb(requete) {
  const url = 'https://www.google.com/search?q=' + encodeURIComponent(String(requete));
  const r = await ouvrirUrl(url);
  return r.ok
    ? { ok: true, message: 'Voici ce que j\'ai trouve sur ' + requete + '.' }
    : r;
}

async function reglerVolume(action) {
  if (!MAC) return { ok: false, message: 'Reglage du volume indisponible sur cette plateforme.' };
  if (action.muet !== undefined) {
    const r = await osascript('set volume ' + (action.muet ? 'with' : 'without') + ' output muted');
    return r.ok
      ? { ok: true, message: action.muet ? 'Son coupe.' : 'Son retabli.' }
      : { ok: false, message: 'Reglage impossible.' };
  }
  let niveau = action.niveau;
  if (niveau === undefined) {
    const actuel = await osascript('output volume of (get volume settings)');
    const base = parseInt(actuel.sortie, 10);
    niveau = Math.max(0, Math.min(100, (isNaN(base) ? 50 : base) + (action.delta || 0)));
  }
  const r = await osascript('set volume output volume ' + Math.round(niveau));
  return r.ok
    ? { ok: true, message: 'Volume a ' + Math.round(niveau) + ' pour cent.' }
    : { ok: false, message: 'Reglage impossible.' };
}

// Pilote l'application musicale active : Spotify si elle tourne, sinon Musique.
async function commanderMedia(commande) {
  if (!MAC) return { ok: false, message: 'Commandes multimedia indisponibles sur cette plateforme.' };
  const enCours = await osascript('tell application "System Events" to (name of processes) contains "Spotify"');
  const application = enCours.sortie === 'true' ? 'Spotify' : 'Music';
  const scripts = {
    lecture: 'tell application "' + application + '" to play',
    pause: 'tell application "' + application + '" to pause',
    suivant: 'tell application "' + application + '" to next track',
    precedent: 'tell application "' + application + '" to previous track'
  };
  const script = scripts[commande];
  if (!script) return { ok: false, message: 'Commande multimedia inconnue.' };
  const r = await osascript(script);
  const libelles = { lecture: 'Lecture.', pause: 'En pause.', suivant: 'Morceau suivant.', precedent: 'Morceau precedent.' };
  return r.ok
    ? { ok: true, message: libelles[commande] }
    : { ok: false, message: 'Aucun lecteur ne repond.' };
}

async function verrouiller() {
  if (!MAC) return { ok: false, message: 'Verrouillage indisponible sur cette plateforme.' };
  const r = await lancer('pmset', ['displaysleepnow']);
  return r.ok
    ? { ok: true, message: 'Ecran verrouille.' }
    : { ok: false, message: 'Verrouillage impossible.' };
}

async function mettreEnVeille() {
  const r = await osascript('tell application "System Events" to sleep');
  return r.ok ? { ok: true, message: 'Mise en veille.' } : { ok: false, message: 'Mise en veille impossible.' };
}

async function eteindre() {
  const r = await osascript('tell application "System Events" to shut down');
  return r.ok ? { ok: true, message: 'Extinction en cours.' } : { ok: false, message: 'Extinction impossible.' };
}

async function redemarrer() {
  const r = await osascript('tell application "System Events" to restart');
  return r.ok ? { ok: true, message: 'Redemarrage en cours.' } : { ok: false, message: 'Redemarrage impossible.' };
}

async function capturerEcran() {
  if (!MAC) return { ok: false, message: 'Capture indisponible sur cette plateforme.' };
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destination = path.join(os.homedir(), 'Desktop', 'capture-' + horodatage + '.png');
  const r = await lancer('screencapture', ['-x', destination]);
  return r.ok
    ? { ok: true, message: 'Capture enregistree sur le bureau.', details: { chemin: destination } }
    : { ok: false, message: 'Capture impossible.' };
}

async function niveauBatterie() {
  if (!MAC) return { ok: false, message: 'Information de batterie indisponible.' };
  const r = await lancer('pmset', ['-g', 'batt']);
  const m = r.sortie.match(/(\d+)%/);
  if (!m) return { ok: true, message: 'Aucune batterie detectee, vous etes sur secteur.' };
  const surSecteur = /AC Power/.test(r.sortie);
  return {
    ok: true,
    message: 'Batterie a ' + m[1] + ' pour cent' + (surSecteur ? ', en charge.' : '.'),
    details: { pourcentage: parseInt(m[1], 10), surSecteur }
  };
}

async function diagnostic() {
  const charge = os.loadavg()[0].toFixed(2);
  const libre = Math.round((os.freemem() / os.totalmem()) * 100);
  const duree = Math.round(os.uptime() / 3600);
  const batterie = await niveauBatterie();
  const morceaux = [
    'Charge processeur ' + charge + '.',
    'Memoire disponible ' + libre + ' pour cent.',
    'Machine allumee depuis ' + duree + ' heures.'
  ];
  if (batterie.details) morceaux.push(batterie.message);
  return { ok: true, message: morceaux.join(' ') };
}

// Execution d'une commande shell dictee : refusee tant que l'utilisateur ne l'a pas
// autorisee dans la configuration, et toujours precedee d'une validation orale.
async function executerShell(commande) {
  const reglages = config.lire();
  if (!reglages.execution.shellLibre) {
    return {
      ok: false,
      message: 'L\'execution de commandes libres est desactivee. Activez-la dans les reglages si vous le souhaitez.'
    };
  }
  const shell = process.env.SHELL || '/bin/sh';
  const r = await lancer(shell, ['-lc', String(commande)]);
  const sortie = (r.sortie || r.erreur || '').split('\n').slice(0, 20).join('\n');
  return {
    ok: r.ok,
    message: r.ok ? 'Commande executee.' : 'La commande a echoue.',
    details: { commande, sortie }
  };
}

// Point d'entree unique : recoit une intention analysee, renvoie un compte rendu.
async function executer(intention, action) {
  const a = action || {};
  switch (intention) {
    case 'application': return ouvrirApplication(a.nom);
    case 'fermerApplication': return fermerApplication(a.nom);
    case 'site': return ouvrirUrl(a.url);
    case 'fichier':
    case 'dossier': return ouvrirChemin(a.chemin);
    case 'recherche': return rechercherSurLeWeb(a.requete);
    case 'volume': return reglerVolume(a);
    case 'media': return commanderMedia(a.commande);
    case 'verrouiller': return verrouiller();
    case 'veille': return mettreEnVeille();
    case 'eteindre': return eteindre();
    case 'redemarrer': return redemarrer();
    case 'capture': return capturerEcran();
    case 'batterie': return niveauBatterie();
    case 'diagnostic': return diagnostic();
    case 'shell': return executerShell(a.commande);
    case 'raccourci': return executerRaccourci(a);
    default:
      return { ok: false, message: 'Action inconnue.' };
  }
}

// Un raccourci porte lui-meme le type d'action a declencher.
async function executerRaccourci(action) {
  switch (action.type) {
    case 'application': return ouvrirApplication(action.cible);
    case 'site': return ouvrirUrl(action.cible);
    case 'fichier':
    case 'dossier': return ouvrirChemin(action.cible);
    case 'shell': return executerShell(action.cible);
    case 'recherche': return rechercherSurLeWeb(action.cible);
    default: return { ok: false, message: 'Type de raccourci inconnu : ' + action.type };
  }
}

module.exports = {
  executer,
  lancer,
  osascript,
  resoudreChemin,
  ouvrirApplication,
  ouvrirUrl,
  ouvrirChemin,
  diagnostic,
  MAC
};
