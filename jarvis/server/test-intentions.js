'use strict';
// Verification de l'analyse des phrases. Contient notamment les cas ou une reponse
// courte (« oui », « arrete ») ne doit pas etre confondue avec une commande qui
// commence par le meme mot (« lance Spotify », « arrete la musique »).

const intentions = require('./intentions');

const RACCOURCIS = [
  { nom: 'Musique', phrases: ['mets de la musique'], action: { type: 'application', cible: 'Music' } }
];

// [phrase, intention attendue, extrait attendu de l'action (facultatif)]
const CAS = [
  // Commandes qui commencent par un mot d'acquiescement ou de refus
  ['lance Spotify', 'application', { nom: 'Spotify' }],
  ['arrete la musique', 'media', { commande: 'pause' }],
  ['stoppe la musique', 'media', { commande: 'pause' }],
  ['ferme Safari', 'fermerApplication', { nom: 'Safari' }],
  ['oublie tout', 'oublier'],

  // Reponses a une demande de confirmation
  ['oui', 'confirmer'],
  ['Oui !', 'confirmer'],
  ['vas-y', 'confirmer'],
  ['je confirme', 'confirmer'],
  ["d'accord", 'confirmer'],
  ['jarvis oui s il te plait', 'confirmer'],
  ['non', 'refuser'],
  ['annule', 'refuser'],
  ['laisse tomber', 'refuser'],
  ['non merci', 'refuser'],
  ['plus tard', 'refuser'],

  // Ouvertures
  ['ouvre Safari', 'application', { nom: 'Safari' }],
  ['va sur youtube', 'site', { url: 'https://www.youtube.com' }],
  ['ouvre le dossier Telechargements', 'dossier', { chemin: 'Downloads' }],
  ['ouvre ~/Documents/Rapport Été.pdf', 'fichier', { chemin: '~/Documents/Rapport Été.pdf' }],

  // Recherche : accents et majuscules conserves
  ['cherche la météo à Saint-Denis', 'recherche', { requete: 'la météo à Saint-Denis' }],
  ["c'est quoi la loi d'Ohm", 'recherche', { requete: "la loi d'Ohm" }],

  // Son et multimedia
  ['mets le volume à 40', 'volume', { niveau: 40 }],
  ['monte le son', 'volume', { delta: 15 }],
  ['coupe le son', 'volume', { muet: true }],
  ['morceau suivant', 'media', { commande: 'suivant' }],

  // Memoire
  ['Note que je dois rappeler Paul à 14h', 'retenir', { texte: 'je dois rappeler Paul à 14h' }],
  ['de quoi on parlait', 'rappeler'],
  ['on travaille sur le devis Écologreen', 'sujetDuJour', { sujet: 'devis Écologreen' }],

  // Actions sensibles
  ["verrouille l'écran", 'verrouiller'],
  ['éteins le mac', 'eteindre'],
  ['execute la commande ls -la ~/Documents', 'shell', { commande: 'ls -la ~/Documents' }],

  // Divers
  ['quelle heure est-il', 'heure'],
  ['qui es-tu ?', 'identite'],
  ['mets un minuteur de 10 minutes', 'minuteur', { secondes: 600 }],
  ['niveau de batterie', 'batterie'],
  ['mets de la musique', 'raccourci'],
  ['blabla incomprehensible', 'inconnu']
];

// Les intentions sensibles doivent toutes exiger une validation orale.
const SENSIBLES = ['verrouille l\'écran', 'éteins le mac', 'redémarre le mac',
  'mets le mac en veille', 'ferme Spotify', 'execute la commande rm -rf /tmp/x'];

function executer() {
  let echecs = 0;

  for (const [phrase, attendue, action] of CAS) {
    const resultat = intentions.analyser(phrase, { raccourcis: RACCOURCIS });
    let ok = resultat.intention === attendue;
    let detail = resultat.intention;
    if (ok && action) {
      for (const [cle, valeur] of Object.entries(action)) {
        if (resultat.action[cle] !== valeur) {
          ok = false;
          detail = cle + ' = ' + JSON.stringify(resultat.action[cle])
            + ' au lieu de ' + JSON.stringify(valeur);
        }
      }
    }
    if (!ok) echecs++;
    console.log((ok ? '  OK  ' : ' ECHEC ') + JSON.stringify(phrase) + ' -> ' + detail);
  }

  for (const phrase of SENSIBLES) {
    const resultat = intentions.analyser(phrase, { raccourcis: RACCOURCIS });
    const ok = !!resultat.sensible;
    if (!ok) echecs++;
    console.log((ok ? '  OK  ' : ' ECHEC ') + 'validation orale exigee : ' + JSON.stringify(phrase));
  }

  console.log('\n' + (echecs
    ? 'RESULTAT : ' + echecs + ' cas en echec'
    : 'RESULTAT : ' + (CAS.length + SENSIBLES.length) + ' cas verifies, aucun echec'));
  process.exit(echecs ? 1 : 0);
}

if (require.main === module) executer();
