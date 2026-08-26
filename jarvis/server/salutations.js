'use strict';
// Phrases d'accueil. JARVIS ouvre toujours la conversation par une formule tiree
// au hasard, adaptee au moment de la journee, puis une question de travail.

function moment(date) {
  const h = (date || new Date()).getHours();
  if (h < 5) return 'nuit';
  if (h < 12) return 'matin';
  if (h < 18) return 'apresMidi';
  return 'soir';
}

const OUVERTURES = {
  matin: [
    'Bonjour {nom}.',
    'Bonjour {nom}, systemes en ligne.',
    'Bonjour {nom}. Tous les systemes repondent.',
    'Bonjour {nom}, je suis a vous.',
    'Bonjour {nom}. Reacteur stable, je vous ecoute.'
  ],
  apresMidi: [
    'Bon apres-midi {nom}.',
    'Rebonjour {nom}, je reprends du service.',
    'Bon apres-midi {nom}, systemes operationnels.',
    'A votre disposition {nom}.'
  ],
  soir: [
    'Bonsoir {nom}.',
    'Bonsoir {nom}, tout est en ordre.',
    'Bonsoir {nom}, je veille.',
    'Bonsoir {nom}, systemes en ligne.'
  ],
  nuit: [
    'Il est tard, {nom}.',
    'Bonsoir {nom}. La maison est calme.',
    'Encore debout, {nom} ?',
    'Je reste eveille avec vous, {nom}.'
  ]
};

// Le coeur de la demande : une question de travail differente a chaque ouverture.
const QUESTIONS = [
  'Sur quoi travaille-t-on aujourd\'hui ?',
  'Qu\'est-ce qu\'on fait aujourd\'hui ?',
  'On attaque quoi en premier ?',
  'Quel est le programme ?',
  'Par quoi commence-t-on ?',
  'Sur quel dossier je vous suis ?',
  'Qu\'est-ce que je vous prepare ?',
  'De quoi avez-vous besoin ?',
  'On reprend ou on demarre autre chose ?',
  'Quelle est la mission du jour ?',
  'Dites-moi ou l\'on va.',
  'Qu\'est-ce qui vous occupe aujourd\'hui ?',
  'Je vous ecoute : on travaille sur quoi ?',
  'A quoi je m\'attelle ?'
];

const RETOURS = [
  'Content de vous revoir, {nom}.',
  'Vous m\'avez manque, {nom}.',
  'De retour parmi nous, {nom}.'
];

const CONFIRMATIONS = [
  'Tres bien.', 'Entendu.', 'C\'est parti.', 'Immediatement.',
  'Je m\'en occupe.', 'Compris.', 'A l\'instant.', 'Voila.'
];

const ATTENTES = [
  'Je vous ecoute.', 'Oui ?', 'A vous.', 'Je suis la.'
];

const INCOMPRIS = [
  'Je n\'ai pas saisi. Pouvez-vous reformuler ?',
  'Desole, je n\'ai pas compris la demande.',
  'Ca m\'echappe. Redites-moi ca autrement.',
  'Je ne connais pas encore cette commande.'
];

const ANNULATIONS = [
  'Annule.', 'Tres bien, j\'abandonne.', 'J\'oublie ca.', 'Comme vous voudrez.'
];

function tirer(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

// Evite de repeter deux fois de suite la meme phrase : on retire la derniere utilisee.
function tirerDifferent(liste, derniere) {
  if (liste.length < 2) return liste[0];
  const filtree = liste.filter((p) => p !== derniere);
  return tirer(filtree);
}

const dernieres = {};

function accueil(nom, options) {
  const opts = options || {};
  const cle = moment(opts.date);
  const ouverture = tirerDifferent(OUVERTURES[cle], dernieres.ouverture);
  const question = tirerDifferent(QUESTIONS, dernieres.question);
  dernieres.ouverture = ouverture;
  dernieres.question = question;
  const morceaux = [ouverture.replace('{nom}', nom)];
  // Apres une longue absence, JARVIS glisse une phrase de retrouvailles.
  if (opts.longueAbsence) {
    morceaux.push(tirer(RETOURS).replace('{nom}', nom));
  }
  morceaux.push(question);
  return morceaux.join(' ');
}

module.exports = {
  moment,
  accueil,
  confirmation: () => tirer(CONFIRMATIONS),
  attente: () => tirer(ATTENTES),
  incompris: () => tirer(INCOMPRIS),
  annulation: () => tirer(ANNULATIONS),
  QUESTIONS,
  OUVERTURES
};
