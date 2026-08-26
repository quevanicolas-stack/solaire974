'use strict';
// Configuration globale de JARVIS : chemins, valeurs par defaut, lecture/ecriture du fichier
// de reglages utilisateur situe dans ~/.jarvis/config.json

const fs = require('fs');
const os = require('os');
const path = require('path');

const DOSSIER = process.env.JARVIS_DOSSIER || path.join(os.homedir(), '.jarvis');
const FICHIER_CONFIG = path.join(DOSSIER, 'config.json');
const FICHIER_DONNEES = path.join(DOSSIER, 'donnees.json');
const DOSSIER_AUDIO = path.join(DOSSIER, 'audio');

// Reglages par defaut. Tout ce qui touche a l'execution systeme est volontairement
// restrictif au premier demarrage : l'utilisateur ouvre les vannes lui-meme.
const DEFAUTS = {
  port: 4790,
  // Ecoute sur toutes les interfaces pour que le telephone et la tablette du meme
  // reseau local puissent rejoindre la meme session de compte.
  hote: '0.0.0.0',
  nomUtilisateur: 'Monsieur',
  voix: {
    // Voix systeme preferee (macOS : Thomas, Audrey, Amelie...). Vide = choix automatique.
    nom: '',
    langue: 'fr-FR',
    debit: 1.0,
    hauteur: 1.0,
    volume: 1.0
  },
  accueil: {
    // Salutation automatique a l'ouverture de la session
    actif: true,
    // Delai avant la premiere phrase, en millisecondes
    delaiMs: 1200,
    // Ne pas resaluer si une salutation a deja eu lieu depuis moins de N minutes
    silenceMinutes: 90
  },
  ecoute: {
    // Moteur de reconnaissance : "navigateur" (Web Speech API) ou "whisper" (binaire local)
    moteur: 'navigateur',
    // Mot de reveil ; vide = ecoute au clic ou au raccourci uniquement
    motReveil: 'jarvis',
    // Ecoute continue en arriere-plan a la recherche du mot de reveil
    veilleContinue: false
  },
  whisper: {
    // Chemin du binaire whisper.cpp (ex : /usr/local/bin/whisper-cli)
    binaire: '',
    // Chemin du modele (ex : ~/modeles/ggml-medium-fr.bin)
    modele: '',
    langue: 'fr'
  },
  execution: {
    // Toute action sensible demande une validation orale explicite
    validationOrale: true,
    // Actions considerees comme sures : executees sans confirmation si false
    validationPourActionsSures: false,
    // Autorise l'execution de commandes shell libres dictees a la voix.
    // Desactive par defaut : risque eleve, voir README.
    shellLibre: false,
    // Duree maximale d'une commande, en millisecondes
    delaiMaxMs: 20000
  },
  reacteur: {
    // Pastille bleue miniature toujours visible
    active: true,
    // Position horizontale : "gauche", "centre", "droite"
    position: 'centre',
    // Diametre en pixels
    taille: 92,
    // Marge depuis le haut de l'ecran
    margeHaut: 8,
    opaciteRepos: 0.55
  },
  raccourcis: [
    // Raccourcis nommes, declenchables a la voix : { nom, phrases[], action }
    {
      nom: 'Musique',
      phrases: ['mets de la musique', 'lance la musique', 'musique'],
      action: { type: 'application', cible: 'Music' }
    },
    {
      nom: 'Courriel',
      phrases: ['ouvre mes mails', 'ouvre le courrier', 'mes mails'],
      action: { type: 'application', cible: 'Mail' }
    }
  ]
};

function fusionner(base, ajout) {
  if (ajout === null || ajout === undefined) return base;
  if (Array.isArray(base) || typeof base !== 'object') return ajout;
  if (typeof ajout !== 'object' || Array.isArray(ajout)) return ajout;
  const sortie = Object.assign({}, base);
  for (const cle of Object.keys(ajout)) {
    sortie[cle] = fusionner(base[cle], ajout[cle]);
  }
  return sortie;
}

function assurerDossier() {
  for (const d of [DOSSIER, DOSSIER_AUDIO]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  }
}

let cache = null;

function lire() {
  if (cache) return cache;
  assurerDossier();
  let brut = {};
  if (fs.existsSync(FICHIER_CONFIG)) {
    try {
      brut = JSON.parse(fs.readFileSync(FICHIER_CONFIG, 'utf8'));
    } catch (e) {
      console.error('[config] fichier illisible, valeurs par defaut utilisees :', e.message);
      brut = {};
    }
  }
  cache = fusionner(DEFAUTS, brut);
  return cache;
}

function ecrire(nouvelle) {
  assurerDossier();
  cache = fusionner(lire(), nouvelle);
  fs.writeFileSync(FICHIER_CONFIG, JSON.stringify(cache, null, 2), { mode: 0o600 });
  return cache;
}

function reinitialiserCache() {
  cache = null;
}

module.exports = {
  DOSSIER,
  FICHIER_CONFIG,
  FICHIER_DONNEES,
  DOSSIER_AUDIO,
  DEFAUTS,
  lire,
  ecrire,
  fusionner,
  assurerDossier,
  reinitialiserCache
};
