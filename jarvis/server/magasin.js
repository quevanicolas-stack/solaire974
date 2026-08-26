'use strict';
// Magasin de donnees : comptes, appareils appaires, historique de conversation et
// memoire longue. Un seul fichier JSON dans ~/.jarvis, ecrit de maniere atomique.

const fs = require('fs');
const config = require('./config');

const VIDE = {
  version: 1,
  comptes: {},   // identifiant -> { id, courriel, sel, empreinte, cree }
  appareils: {}, // jeton -> { jeton, compteId, nom, plateforme, cree, dernierAcces }
  sessions: {},  // compteId -> { historique: [], memoire: {}, derniereSalutation: 0 }
  appairages: {} // code -> { code, compteId, expire }
};

let donnees = null;
let ecritureEnAttente = null;

function charger() {
  if (donnees) return donnees;
  config.assurerDossier();
  if (fs.existsSync(config.FICHIER_DONNEES)) {
    try {
      donnees = Object.assign({}, VIDE, JSON.parse(fs.readFileSync(config.FICHIER_DONNEES, 'utf8')));
    } catch (e) {
      console.error('[magasin] fichier corrompu, redemarrage a vide :', e.message);
      donnees = JSON.parse(JSON.stringify(VIDE));
    }
  } else {
    donnees = JSON.parse(JSON.stringify(VIDE));
  }
  return donnees;
}

// Ecriture differee : evite de reecrire le fichier a chaque message de conversation.
function sauver(immediat) {
  charger();
  if (immediat) {
    if (ecritureEnAttente) { clearTimeout(ecritureEnAttente); ecritureEnAttente = null; }
    return ecrireMaintenant();
  }
  if (ecritureEnAttente) return;
  ecritureEnAttente = setTimeout(() => {
    ecritureEnAttente = null;
    ecrireMaintenant();
  }, 400);
}

function ecrireMaintenant() {
  const temporaire = config.FICHIER_DONNEES + '.tmp';
  fs.writeFileSync(temporaire, JSON.stringify(donnees, null, 2), { mode: 0o600 });
  fs.renameSync(temporaire, config.FICHIER_DONNEES);
}

function session(compteId) {
  const d = charger();
  if (!d.sessions[compteId]) {
    d.sessions[compteId] = { historique: [], memoire: {}, derniereSalutation: 0 };
  }
  return d.sessions[compteId];
}

// L'historique est borne : au-dela on oublie les plus anciens echanges.
const MAX_HISTORIQUE = 300;

function ajouterEchange(compteId, echange) {
  const s = session(compteId);
  s.historique.push(echange);
  if (s.historique.length > MAX_HISTORIQUE) {
    s.historique = s.historique.slice(-MAX_HISTORIQUE);
  }
  sauver();
  return echange;
}

function historique(compteId, limite) {
  const s = session(compteId);
  const n = limite || 60;
  return s.historique.slice(-n);
}

function viderHistorique(compteId) {
  session(compteId).historique = [];
  sauver(true);
}

function memoire(compteId) {
  return session(compteId).memoire;
}

function retenir(compteId, cle, valeur) {
  session(compteId).memoire[cle] = { valeur, date: Date.now() };
  sauver(true);
}

function oublier(compteId, cle) {
  delete session(compteId).memoire[cle];
  sauver(true);
}

module.exports = {
  charger,
  sauver,
  session,
  ajouterEchange,
  historique,
  viderHistorique,
  memoire,
  retenir,
  oublier,
  get donnees() { return charger(); }
};
