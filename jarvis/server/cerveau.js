'use strict';
// Le cerveau relie l'analyse d'intention, la validation orale et l'execution.
// Il conserve, par compte, l'action en attente de confirmation et les minuteurs.

const config = require('./config');
const magasin = require('./magasin');
const intentions = require('./intentions');
const executeur = require('./executeur');
const salutations = require('./salutations');

// Action en attente de "oui" / "non", par compte.
const enAttente = new Map();
// Minuteurs actifs, par compte.
const minuteurs = new Map();

const DELAI_CONFIRMATION_MS = 45000;

function formaterHeure(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  return h + ' heure' + (h > 1 ? 's' : '') + (m ? ' ' + m : '');
}

function formaterDate(date) {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function formaterDuree(secondes) {
  if (secondes >= 3600) {
    const h = Math.floor(secondes / 3600);
    const m = Math.round((secondes % 3600) / 60);
    return h + ' heure' + (h > 1 ? 's' : '') + (m ? ' et ' + m + ' minutes' : '');
  }
  if (secondes >= 60) {
    const m = Math.floor(secondes / 60);
    const s = secondes % 60;
    return m + ' minute' + (m > 1 ? 's' : '') + (s ? ' et ' + s + ' secondes' : '');
  }
  return secondes + ' secondes';
}

// Phrase lue a l'utilisateur pour lui demander de valider une action sensible.
function phraseDeConfirmation(analyse) {
  const a = analyse.action || {};
  switch (analyse.intention) {
    case 'shell': return 'Je vais executer : ' + a.commande + '. Je confirme ?';
    case 'eteindre': return 'Vous voulez que j\'eteigne la machine. Je confirme ?';
    case 'redemarrer': return 'Vous voulez que je redemarre la machine. Je confirme ?';
    case 'veille': return 'Mise en veille de la machine. Je confirme ?';
    case 'verrouiller': return 'Je verrouille l\'ecran. Je confirme ?';
    case 'fermerApplication': return 'Je ferme ' + a.nom + '. Je confirme ?';
    case 'oublier': return 'J\'efface tout ce que j\'ai retenu. Je confirme ?';
    case 'raccourci': return 'Je lance le raccourci ' + (analyse.reponse || '') + '. Je confirme ?';
    default: return 'Je m\'apprete a agir. Je confirme ?';
  }
}

function decrireAide() {
  return [
    'Je peux ouvrir vos applications, vos dossiers et vos sites,',
    'chercher sur internet, regler le son, piloter la musique,',
    'verrouiller ou eteindre la machine, prendre une capture d\'ecran,',
    'lancer un minuteur, retenir vos notes et executer vos raccourcis.',
    'Dites simplement ce que vous voulez.'
  ].join(' ');
}

function libellerMemoire(compteId) {
  const memoire = magasin.memoire(compteId);
  const cles = Object.keys(memoire);
  if (!cles.length) return 'Je n\'ai rien retenu pour l\'instant.';
  const notes = cles
    .filter((c) => c.startsWith('note:'))
    .map((c) => memoire[c].valeur)
    .slice(-5);
  const sujet = memoire.sujetDuJour ? memoire.sujetDuJour.valeur : null;
  const morceaux = [];
  if (sujet) morceaux.push('Aujourd\'hui, nous travaillons sur ' + sujet + '.');
  if (notes.length) morceaux.push('J\'ai note : ' + notes.join(' ; ') + '.');
  if (!morceaux.length) return 'Je n\'ai aucune note en cours.';
  return morceaux.join(' ');
}

// Lance un minuteur ; le rappel est transmis via la fonction "annoncer".
function demarrerMinuteur(compteId, secondes, annoncer) {
  const liste = minuteurs.get(compteId) || [];
  const identifiant = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const poignee = setTimeout(() => {
    const restants = (minuteurs.get(compteId) || []).filter((m) => m.identifiant !== identifiant);
    minuteurs.set(compteId, restants);
    if (typeof annoncer === 'function') {
      annoncer('Le minuteur de ' + formaterDuree(secondes) + ' est termine.');
    }
  }, secondes * 1000);
  liste.push({ identifiant, secondes, echeance: Date.now() + secondes * 1000, poignee });
  minuteurs.set(compteId, liste);
  return identifiant;
}

function annulerMinuteurs(compteId) {
  const liste = minuteurs.get(compteId) || [];
  liste.forEach((m) => clearTimeout(m.poignee));
  minuteurs.set(compteId, []);
  return liste.length;
}

// Traite une phrase et renvoie { parole, intention, execute, resultat, attente }
async function traiter(compteId, texte, options) {
  const opts = options || {};
  const reglages = config.lire();
  const nom = reglages.nomUtilisateur;

  const attente = enAttente.get(compteId);
  const analyse = intentions.analyser(texte, { raccourcis: reglages.raccourcis });

  // --- Reponse a une demande de confirmation -----------------------------
  if (attente) {
    if (Date.now() > attente.expire) {
      enAttente.delete(compteId);
    } else if (analyse.intention === 'confirmer') {
      enAttente.delete(compteId);
      return finaliser(compteId, attente.analyse, texte, opts, true);
    } else if (analyse.intention === 'refuser') {
      enAttente.delete(compteId);
      return journaliser(compteId, texte, {
        parole: salutations.annulation(),
        intention: 'annulation',
        execute: false
      });
    }
    // Toute autre phrase remplace la demande en attente.
    enAttente.delete(compteId);
  }

  // --- Intentions purement conversationnelles ----------------------------
  const conversation = await repondreSansAgir(compteId, analyse, nom, opts);
  if (conversation) return journaliser(compteId, texte, conversation);

  // --- Intentions qui declenchent une action systeme ----------------------
  const besoinValidation = reglages.execution.validationOrale
    && (analyse.sensible || reglages.execution.validationPourActionsSures);

  if (besoinValidation && !opts.dejaValide) {
    const question = phraseDeConfirmation(analyse);
    enAttente.set(compteId, { analyse, expire: Date.now() + DELAI_CONFIRMATION_MS });
    return journaliser(compteId, texte, {
      parole: question,
      intention: analyse.intention,
      execute: false,
      attente: true
    });
  }

  return finaliser(compteId, analyse, texte, opts, false);
}

// Repond aux intentions qui ne touchent pas au systeme. Renvoie null si l'intention
// necessite une execution.
async function repondreSansAgir(compteId, analyse, nom, opts) {
  const a = analyse.action || {};
  switch (analyse.intention) {
    case 'vide':
      return { parole: salutations.attente(), intention: 'vide', execute: false };

    case 'salutation':
      return { parole: salutations.accueil(nom, {}), intention: 'salutation', execute: false };

    case 'remerciement':
      return { parole: 'Je vous en prie, ' + nom + '.', intention: 'remerciement', execute: false };

    case 'au revoir':
      return { parole: 'A tout moment, ' + nom + '. Je reste en veille.', intention: 'au revoir', execute: false };

    case 'identite':
      return {
        parole: 'Je suis JARVIS, votre assistant. Je tourne sur cette machine et je vous suis sur vos autres appareils.',
        intention: 'identite',
        execute: false
      };

    case 'aide':
      return { parole: decrireAide(), intention: 'aide', execute: false };

    case 'heure':
      return { parole: 'Il est ' + formaterHeure(new Date()) + '.', intention: 'heure', execute: false };

    case 'date':
      return { parole: 'Nous sommes le ' + formaterDate(new Date()) + '.', intention: 'date', execute: false };

    case 'retenir': {
      const cle = 'note:' + Date.now();
      magasin.retenir(compteId, cle, a.texte);
      return { parole: 'C\'est note.', intention: 'retenir', execute: true, resultat: { ok: true } };
    }

    case 'sujetDuJour':
      magasin.retenir(compteId, 'sujetDuJour', a.sujet);
      return {
        parole: salutations.confirmation() + ' Nous travaillons sur ' + a.sujet + '. Dites-moi ce dont vous avez besoin.',
        intention: 'sujetDuJour',
        execute: true,
        resultat: { ok: true }
      };

    case 'rappeler':
      return { parole: libellerMemoire(compteId), intention: 'rappeler', execute: false };

    case 'minuteur': {
      if (!a || !a.secondes) {
        return { parole: 'Pour combien de temps ?', intention: 'minuteur', execute: false };
      }
      demarrerMinuteur(compteId, a.secondes, opts.annoncer);
      return {
        parole: 'Minuteur lance pour ' + formaterDuree(a.secondes) + '.',
        intention: 'minuteur',
        execute: true,
        resultat: { ok: true }
      };
    }

    case 'confirmer':
      return { parole: 'Je n\'avais rien en attente.', intention: 'confirmer', execute: false };

    case 'refuser':
      return { parole: salutations.annulation(), intention: 'refuser', execute: false };

    case 'inconnu':
      return { parole: salutations.incompris(), intention: 'inconnu', execute: false };

    default:
      return null;
  }
}

// Execute reellement l'action puis formule la reponse parlee.
async function finaliser(compteId, analyse, texte, opts, apresConfirmation) {
  if (analyse.intention === 'oublier') {
    const memoire = magasin.memoire(compteId);
    Object.keys(memoire).forEach((cle) => magasin.oublier(compteId, cle));
    return journaliser(compteId, texte, {
      parole: 'Memoire effacee.',
      intention: 'oublier',
      execute: true,
      resultat: { ok: true }
    });
  }

  const resultat = await executeur.executer(analyse.intention, analyse.action);
  const prefixe = apresConfirmation ? salutations.confirmation() + ' ' : '';
  const parole = resultat.ok
    ? prefixe + (resultat.message || 'C\'est fait.')
    : (resultat.message || 'Je n\'ai pas reussi.');

  return journaliser(compteId, texte, {
    parole,
    intention: analyse.intention,
    execute: true,
    resultat
  });
}

function journaliser(compteId, texte, reponse) {
  magasin.ajouterEchange(compteId, {
    date: Date.now(),
    utilisateur: texte,
    jarvis: reponse.parole,
    intention: reponse.intention,
    execute: !!reponse.execute,
    ok: reponse.resultat ? !!reponse.resultat.ok : null
  });
  return reponse;
}

// Salutation d'ouverture de session, avec anti-repetition.
function salutationOuverture(compteId) {
  const reglages = config.lire();
  const session = magasin.session(compteId);
  const maintenant = Date.now();
  const ecoule = maintenant - (session.derniereSalutation || 0);
  const seuil = reglages.accueil.silenceMinutes * 60 * 1000;
  if (session.derniereSalutation && ecoule < seuil) return null;

  const longueAbsence = !!session.derniereSalutation && ecoule > 12 * 3600 * 1000;
  session.derniereSalutation = maintenant;
  magasin.sauver(true);

  let parole = salutations.accueil(reglages.nomUtilisateur, { longueAbsence });
  // Si un sujet de travail est en cours depuis moins de 12 heures, JARVIS le rappelle.
  const memoire = magasin.memoire(compteId);
  if (memoire.sujetDuJour && (maintenant - memoire.sujetDuJour.date) < 12 * 3600 * 1000) {
    parole += ' Nous en etions a ' + memoire.sujetDuJour.valeur + '.';
  }
  return parole;
}

function actionEnAttente(compteId) {
  const attente = enAttente.get(compteId);
  if (!attente || Date.now() > attente.expire) return null;
  return { intention: attente.analyse.intention, expire: attente.expire };
}

module.exports = {
  traiter,
  salutationOuverture,
  actionEnAttente,
  demarrerMinuteur,
  annulerMinuteurs,
  formaterDuree,
  decrireAide
};
