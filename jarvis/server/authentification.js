'use strict';
// Comptes et jetons. Un compte unique sert sur le Mac, le telephone et la tablette :
// c'est lui qui porte l'historique, la memoire et les raccourcis partages.

const crypto = require('crypto');
const magasin = require('./magasin');
const config = require('./config');

const DUREE_JETON_MS = 1000 * 60 * 60 * 24 * 365; // un an : appareils personnels
const DUREE_APPAIRAGE_MS = 1000 * 60 * 5;         // code d'appairage valable 5 minutes

function secretServeur() {
  const d = magasin.charger();
  if (!d.secret) {
    d.secret = crypto.randomBytes(32).toString('hex');
    magasin.sauver(true);
  }
  return d.secret;
}

function empreinte(motDePasse, sel) {
  return crypto.scryptSync(motDePasse, sel, 64).toString('hex');
}

function comparerConstant(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function normaliserCourriel(courriel) {
  return String(courriel || '').trim().toLowerCase();
}

function creerCompte(courriel, motDePasse) {
  const d = magasin.charger();
  const adresse = normaliserCourriel(courriel);
  if (!adresse || !adresse.includes('@')) {
    throw Object.assign(new Error('Adresse de courriel invalide.'), { code: 400 });
  }
  if (!motDePasse || String(motDePasse).length < 8) {
    throw Object.assign(new Error('Le mot de passe doit contenir au moins 8 caracteres.'), { code: 400 });
  }
  if (Object.values(d.comptes).some((c) => c.courriel === adresse)) {
    throw Object.assign(new Error('Un compte existe deja pour cette adresse.'), { code: 409 });
  }
  const sel = crypto.randomBytes(16).toString('hex');
  const compte = {
    id: crypto.randomUUID(),
    courriel: adresse,
    sel,
    empreinte: empreinte(motDePasse, sel),
    cree: Date.now()
  };
  d.comptes[compte.id] = compte;
  magasin.sauver(true);
  return compte;
}

function verifier(courriel, motDePasse) {
  const d = magasin.charger();
  const adresse = normaliserCourriel(courriel);
  const compte = Object.values(d.comptes).find((c) => c.courriel === adresse);
  if (!compte) throw Object.assign(new Error('Compte inconnu.'), { code: 401 });
  if (!comparerConstant(empreinte(motDePasse, compte.sel), compte.empreinte)) {
    throw Object.assign(new Error('Mot de passe incorrect.'), { code: 401 });
  }
  return compte;
}

// Jeton signe : charge utile en base64url + signature HMAC. Suffisant pour un
// serveur personnel qui ne quitte pas le reseau domestique.
function signerJeton(charge) {
  const corps = Buffer.from(JSON.stringify(charge)).toString('base64url');
  const signature = crypto.createHmac('sha256', secretServeur()).update(corps).digest('base64url');
  return corps + '.' + signature;
}

function lireJeton(jeton) {
  if (!jeton || typeof jeton !== 'string' || !jeton.includes('.')) return null;
  const [corps, signature] = jeton.split('.');
  const attendue = crypto.createHmac('sha256', secretServeur()).update(corps).digest('base64url');
  if (!comparerConstant(signature, attendue)) return null;
  let charge;
  try {
    charge = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!charge.expire || charge.expire < Date.now()) return null;
  return charge;
}

function enregistrerAppareil(compteId, nom, plateforme) {
  const d = magasin.charger();
  const jeton = signerJeton({
    compteId,
    appareil: crypto.randomUUID(),
    expire: Date.now() + DUREE_JETON_MS
  });
  d.appareils[jeton] = {
    jeton,
    compteId,
    nom: nom || 'Appareil',
    plateforme: plateforme || 'inconnue',
    cree: Date.now(),
    dernierAcces: Date.now()
  };
  magasin.sauver(true);
  return jeton;
}

function compteDepuisJeton(jeton) {
  const charge = lireJeton(jeton);
  if (!charge) return null;
  const d = magasin.charger();
  const compte = d.comptes[charge.compteId];
  if (!compte) return null;
  if (d.appareils[jeton]) d.appareils[jeton].dernierAcces = Date.now();
  return compte;
}

function listerAppareils(compteId) {
  const d = magasin.charger();
  return Object.values(d.appareils)
    .filter((a) => a.compteId === compteId)
    .map((a) => ({
      nom: a.nom,
      plateforme: a.plateforme,
      cree: a.cree,
      dernierAcces: a.dernierAcces,
      // On n'expose jamais le jeton complet, seulement une empreinte courte.
      reference: crypto.createHash('sha256').update(a.jeton).digest('hex').slice(0, 12)
    }));
}

function revoquerAppareil(compteId, reference) {
  const d = magasin.charger();
  for (const [jeton, appareil] of Object.entries(d.appareils)) {
    if (appareil.compteId !== compteId) continue;
    const ref = crypto.createHash('sha256').update(jeton).digest('hex').slice(0, 12);
    if (ref === reference) {
      delete d.appareils[jeton];
      magasin.sauver(true);
      return true;
    }
  }
  return false;
}

// Appairage : le Mac affiche un code court (et un QR code) que le telephone saisit
// pour recevoir un jeton du meme compte, sans retaper le mot de passe.
function creerAppairage(compteId) {
  const d = magasin.charger();
  const code = String(crypto.randomInt(100000, 999999));
  d.appairages[code] = { code, compteId, expire: Date.now() + DUREE_APPAIRAGE_MS };
  magasin.sauver(true);
  return { code, expire: d.appairages[code].expire };
}

function consommerAppairage(code, nomAppareil, plateforme) {
  const d = magasin.charger();
  const entree = d.appairages[String(code || '').trim()];
  if (!entree) throw Object.assign(new Error('Code d\'appairage inconnu.'), { code: 401 });
  if (entree.expire < Date.now()) {
    delete d.appairages[entree.code];
    magasin.sauver(true);
    throw Object.assign(new Error('Code d\'appairage expire.'), { code: 401 });
  }
  delete d.appairages[entree.code];
  magasin.sauver(true);
  return enregistrerAppareil(entree.compteId, nomAppareil, plateforme);
}

function nettoyer() {
  const d = magasin.charger();
  let modifie = false;
  for (const [code, entree] of Object.entries(d.appairages)) {
    if (entree.expire < Date.now()) { delete d.appairages[code]; modifie = true; }
  }
  for (const [jeton] of Object.entries(d.appareils)) {
    if (!lireJeton(jeton)) { delete d.appareils[jeton]; modifie = true; }
  }
  if (modifie) magasin.sauver(true);
}

function nombreComptes() {
  return Object.keys(magasin.charger().comptes).length;
}

module.exports = {
  creerCompte,
  verifier,
  signerJeton,
  lireJeton,
  enregistrerAppareil,
  compteDepuisJeton,
  listerAppareils,
  revoquerAppareil,
  creerAppairage,
  consommerAppairage,
  nettoyer,
  nombreComptes
};
