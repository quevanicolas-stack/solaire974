'use strict';
// Serveur JARVIS : sert l'interface, expose l'API du compte et diffuse en temps reel
// la parole et l'amplitude du reacteur a tous les appareils connectes au meme compte.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('./config');
const magasin = require('./magasin');
const auth = require('./authentification');
const cerveau = require('./cerveau');
const executeur = require('./executeur');
const websocket = require('./websocket');
const transcription = require('./transcription');

const RACINE_UI = path.join(__dirname, '..', 'ui');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// --- Connexions actives, groupees par compte ------------------------------
const connexionsParCompte = new Map();

function inscrire(compteId, connexion) {
  if (!connexionsParCompte.has(compteId)) connexionsParCompte.set(compteId, new Set());
  connexionsParCompte.get(compteId).add(connexion);
}

function retirer(compteId, connexion) {
  const groupe = connexionsParCompte.get(compteId);
  if (!groupe) return;
  groupe.delete(connexion);
  if (!groupe.size) connexionsParCompte.delete(compteId);
}

// Diffuse un message a tous les appareils du compte, en excluant eventuellement
// l'emetteur (utile pour l'amplitude : l'appareil qui parle s'anime deja seul).
function diffuser(compteId, message, sauf) {
  const groupe = connexionsParCompte.get(compteId);
  if (!groupe) return 0;
  let envoyes = 0;
  for (const connexion of groupe) {
    if (connexion === sauf || connexion.fermee) continue;
    connexion.envoyer(message);
    envoyes++;
  }
  return envoyes;
}

function annoncerA(compteId) {
  // Rappel de minuteur : JARVIS parle de lui-meme sur tous les appareils.
  return (texte) => diffuser(compteId, { type: 'annonce', texte, date: Date.now() });
}

// --- Utilitaires HTTP -----------------------------------------------------
function repondreJson(reponse, code, corps) {
  const charge = JSON.stringify(corps);
  reponse.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(charge),
    'Cache-Control': 'no-store'
  });
  reponse.end(charge);
}

function lireCorps(requete, tailleMax) {
  const limite = tailleMax || 1024 * 1024;
  return new Promise((resolve, reject) => {
    const morceaux = [];
    let total = 0;
    requete.on('data', (m) => {
      total += m.length;
      if (total > limite) {
        reject(Object.assign(new Error('Corps de requete trop volumineux.'), { code: 413 }));
        requete.destroy();
        return;
      }
      morceaux.push(m);
    });
    requete.on('end', () => resolve(Buffer.concat(morceaux)));
    requete.on('error', reject);
  });
}

async function lireJson(requete) {
  const corps = await lireCorps(requete);
  if (!corps.length) return {};
  try {
    return JSON.parse(corps.toString('utf8'));
  } catch (e) {
    throw Object.assign(new Error('Corps JSON invalide.'), { code: 400 });
  }
}

function jetonDeRequete(requete) {
  const entete = requete.headers.authorization || '';
  if (entete.startsWith('Bearer ')) return entete.slice(7).trim();
  return null;
}

function exigerCompte(requete) {
  const compte = auth.compteDepuisJeton(jetonDeRequete(requete));
  if (!compte) throw Object.assign(new Error('Authentification requise.'), { code: 401 });
  return compte;
}

// Reglages exposes aux clients : jamais de secret ni d'empreinte.
function reglagesPublics() {
  const r = config.lire();
  return {
    nomUtilisateur: r.nomUtilisateur,
    voix: r.voix,
    accueil: r.accueil,
    ecoute: r.ecoute,
    execution: {
      validationOrale: r.execution.validationOrale,
      validationPourActionsSures: r.execution.validationPourActionsSures,
      shellLibre: r.execution.shellLibre
    },
    reacteur: r.reacteur,
    raccourcis: r.raccourcis,
    whisperPret: transcription.estDisponible()
  };
}

// Adresses par lesquelles le telephone ou la tablette peuvent rejoindre le Mac.
function adressesReseau() {
  const port = config.lire().port;
  const interfaces = os.networkInterfaces();
  const adresses = [];
  for (const nom of Object.keys(interfaces)) {
    for (const details of interfaces[nom] || []) {
      if (details.family !== 'IPv4' || details.internal) continue;
      adresses.push({ interface: nom, url: 'http://' + details.address + ':' + port });
    }
  }
  return adresses;
}

// --- Fichiers statiques ---------------------------------------------------
function servirFichier(reponse, cheminRelatif) {
  const demande = cheminRelatif === '/' || cheminRelatif === '' ? '/index.html' : cheminRelatif;
  const complet = path.normalize(path.join(RACINE_UI, decodeURIComponent(demande)));
  // Empeche toute sortie du dossier de l'interface.
  if (!complet.startsWith(RACINE_UI)) {
    reponse.writeHead(403).end('Acces refuse');
    return;
  }
  fs.readFile(complet, (erreur, contenu) => {
    if (erreur) {
      reponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }
    const type = TYPES[path.extname(complet).toLowerCase()] || 'application/octet-stream';
    reponse.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': demande === '/index.html' ? 'no-cache' : 'public, max-age=300'
    });
    reponse.end(contenu);
  });
}

// --- Routes API -----------------------------------------------------------
async function router(requete, reponse, chemin) {
  const methode = requete.method;

  if (chemin === '/api/sante' && methode === 'GET') {
    return repondreJson(reponse, 200, {
      ok: true,
      version: 1,
      comptes: auth.nombreComptes(),
      plateforme: process.platform
    });
  }

  if (chemin === '/api/compte' && methode === 'POST') {
    const corps = await lireJson(requete);
    const compte = auth.creerCompte(corps.courriel, corps.motDePasse);
    const jeton = auth.enregistrerAppareil(compte.id, corps.appareil, corps.plateforme);
    return repondreJson(reponse, 201, { jeton, courriel: compte.courriel });
  }

  if (chemin === '/api/connexion' && methode === 'POST') {
    const corps = await lireJson(requete);
    const compte = auth.verifier(corps.courriel, corps.motDePasse);
    const jeton = auth.enregistrerAppareil(compte.id, corps.appareil, corps.plateforme);
    return repondreJson(reponse, 200, { jeton, courriel: compte.courriel });
  }

  if (chemin === '/api/appairage' && methode === 'POST') {
    const compte = exigerCompte(requete);
    const appairage = auth.creerAppairage(compte.id);
    return repondreJson(reponse, 200, {
      code: appairage.code,
      expire: appairage.expire,
      adresses: adressesReseau()
    });
  }

  if (chemin === '/api/appairage/rejoindre' && methode === 'POST') {
    const corps = await lireJson(requete);
    const jeton = auth.consommerAppairage(corps.code, corps.appareil, corps.plateforme);
    return repondreJson(reponse, 200, { jeton });
  }

  if (chemin === '/api/etat' && methode === 'GET') {
    const compte = exigerCompte(requete);
    return repondreJson(reponse, 200, {
      courriel: compte.courriel,
      reglages: reglagesPublics(),
      historique: magasin.historique(compte.id, 60),
      memoire: magasin.memoire(compte.id),
      attente: cerveau.actionEnAttente(compte.id),
      adresses: adressesReseau(),
      appareils: auth.listerAppareils(compte.id)
    });
  }

  if (chemin === '/api/salutation' && methode === 'POST') {
    const compte = exigerCompte(requete);
    const corps = await lireJson(requete);
    const parole = corps.forcer
      ? require('./salutations').accueil(config.lire().nomUtilisateur, {})
      : cerveau.salutationOuverture(compte.id);
    return repondreJson(reponse, 200, { parole });
  }

  if (chemin === '/api/dire' && methode === 'POST') {
    const compte = exigerCompte(requete);
    const corps = await lireJson(requete);
    const reponseCerveau = await cerveau.traiter(compte.id, corps.texte, {
      annoncer: annoncerA(compte.id)
    });
    // Les autres appareils du compte suivent la conversation en direct.
    diffuser(compte.id, {
      type: 'echange',
      utilisateur: corps.texte,
      jarvis: reponseCerveau.parole,
      intention: reponseCerveau.intention
    });
    return repondreJson(reponse, 200, reponseCerveau);
  }

  if (chemin === '/api/reglages' && methode === 'GET') {
    exigerCompte(requete);
    return repondreJson(reponse, 200, reglagesPublics());
  }

  if (chemin === '/api/reglages' && methode === 'PUT') {
    exigerCompte(requete);
    const corps = await lireJson(requete);
    // On n'accepte que les sections connues : le fichier de configuration ne doit
    // pas pouvoir etre pollue depuis un client.
    const autorisees = ['nomUtilisateur', 'voix', 'accueil', 'ecoute', 'execution', 'reacteur', 'raccourcis', 'whisper', 'port'];
    const filtre = {};
    for (const cle of autorisees) {
      if (corps[cle] !== undefined) filtre[cle] = corps[cle];
    }
    config.ecrire(filtre);
    const publics = reglagesPublics();
    // Chaque compte connecte est prevenu du changement pour se rafraichir.
    for (const compteId of connexionsParCompte.keys()) {
      diffuser(compteId, { type: 'reglages', reglages: publics });
    }
    return repondreJson(reponse, 200, publics);
  }

  if (chemin === '/api/appareils' && methode === 'GET') {
    const compte = exigerCompte(requete);
    return repondreJson(reponse, 200, { appareils: auth.listerAppareils(compte.id) });
  }

  if (chemin.startsWith('/api/appareils/') && methode === 'DELETE') {
    const compte = exigerCompte(requete);
    const reference = chemin.slice('/api/appareils/'.length);
    const retire = auth.revoquerAppareil(compte.id, reference);
    return repondreJson(reponse, retire ? 200 : 404, { retire });
  }

  if (chemin === '/api/historique' && methode === 'DELETE') {
    const compte = exigerCompte(requete);
    magasin.viderHistorique(compte.id);
    diffuser(compte.id, { type: 'historiqueVide' });
    return repondreJson(reponse, 200, { ok: true });
  }

  if (chemin === '/api/transcrire' && methode === 'POST') {
    const compte = exigerCompte(requete);
    const audio = await lireCorps(requete, 25 * 1024 * 1024);
    const resultat = await transcription.transcrire(audio, requete.headers['content-type']);
    if (!resultat.ok) return repondreJson(reponse, 503, resultat);
    return repondreJson(reponse, 200, { texte: resultat.texte, compte: compte.courriel });
  }

  if (chemin === '/api/diagnostic' && methode === 'GET') {
    exigerCompte(requete);
    const rapport = await executeur.diagnostic();
    return repondreJson(reponse, 200, rapport);
  }

  return repondreJson(reponse, 404, { erreur: 'Route inconnue.' });
}

// --- Serveur --------------------------------------------------------------
const serveur = http.createServer(async (requete, reponse) => {
  const url = new URL(requete.url, 'http://' + (requete.headers.host || 'localhost'));
  const chemin = url.pathname;

  // L'interface est servie a la meme origine : pas de CORS a ouvrir.
  reponse.setHeader('X-Content-Type-Options', 'nosniff');
  reponse.setHeader('Referrer-Policy', 'no-referrer');

  if (!chemin.startsWith('/api/')) {
    return servirFichier(reponse, chemin);
  }

  try {
    await router(requete, reponse, chemin);
  } catch (erreur) {
    const code = erreur.code && Number.isInteger(erreur.code) ? erreur.code : 500;
    if (code === 500) console.error('[serveur]', erreur);
    repondreJson(reponse, code, { erreur: erreur.message || 'Erreur interne.' });
  }
});

// --- WebSocket ------------------------------------------------------------
websocket.attacher(serveur, (connexion) => {
  let compte = null;

  const minuterieAuth = setTimeout(() => {
    if (!compte) connexion.fermer(4401, 'Authentification absente');
  }, 10000);

  connexion.on('message', async (brut) => {
    let message;
    try {
      message = JSON.parse(brut);
    } catch (e) {
      return connexion.envoyer({ type: 'erreur', message: 'Message illisible.' });
    }

    if (message.type === 'authentifier') {
      compte = auth.compteDepuisJeton(message.jeton);
      if (!compte) return connexion.fermer(4401, 'Jeton invalide');
      clearTimeout(minuterieAuth);
      connexion.contexte.compteId = compte.id;
      connexion.contexte.appareil = message.appareil || 'Appareil';
      inscrire(compte.id, connexion);
      connexion.envoyer({
        type: 'pret',
        courriel: compte.courriel,
        reglages: reglagesPublics(),
        historique: magasin.historique(compte.id, 40),
        memoire: magasin.memoire(compte.id),
        attente: cerveau.actionEnAttente(compte.id)
      });
      return;
    }

    if (!compte) return connexion.fermer(4401, 'Authentification requise');

    switch (message.type) {
      case 'dire': {
        const reponse = await cerveau.traiter(compte.id, message.texte, {
          annoncer: annoncerA(compte.id)
        });
        connexion.envoyer({ type: 'reponse', ...reponse, utilisateur: message.texte });
        diffuser(compte.id, {
          type: 'echange',
          utilisateur: message.texte,
          jarvis: reponse.parole,
          intention: reponse.intention
        }, connexion);
        break;
      }

      case 'salutation': {
        const parole = cerveau.salutationOuverture(compte.id);
        connexion.envoyer({ type: 'salutation', parole });
        break;
      }

      // Amplitude de la voix, relayee aux autres appareils pour que leur reacteur
      // oscille en meme temps que celui qui parle.
      case 'niveau':
        diffuser(compte.id, {
          type: 'niveau',
          valeur: Math.max(0, Math.min(1, Number(message.valeur) || 0))
        }, connexion);
        break;

      case 'parole':
        diffuser(compte.id, {
          type: 'parole',
          etat: message.etat === 'debut' ? 'debut' : 'fin',
          texte: message.texte || ''
        }, connexion);
        break;

      case 'ecoute':
        diffuser(compte.id, { type: 'ecoute', actif: !!message.actif }, connexion);
        break;

      case 'ping':
        connexion.envoyer({ type: 'pong', date: Date.now() });
        break;

      default:
        connexion.envoyer({ type: 'erreur', message: 'Type de message inconnu.' });
    }
  });

  connexion.on('fermeture', () => {
    clearTimeout(minuterieAuth);
    if (compte) retirer(compte.id, connexion);
  });
});

function demarrer() {
  const reglages = config.lire();
  auth.nettoyer();
  serveur.listen(reglages.port, reglages.hote, () => {
    console.log('[JARVIS] Serveur en ecoute sur http://localhost:' + reglages.port);
    for (const adresse of adressesReseau()) {
      console.log('[JARVIS] Accessible depuis le reseau local : ' + adresse.url);
    }
    if (!auth.nombreComptes()) {
      console.log('[JARVIS] Aucun compte : ouvrez l\'interface pour en creer un.');
    }
  });
  serveur.on('error', (erreur) => {
    if (erreur.code === 'EADDRINUSE') {
      console.error('[JARVIS] Le port ' + reglages.port + ' est deja utilise.');
      process.exit(1);
    }
    console.error('[JARVIS]', erreur);
  });
  return serveur;
}

if (require.main === module) demarrer();

module.exports = { demarrer, serveur, diffuser, adressesReseau };
