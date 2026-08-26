'use strict';
// Analyse d'une phrase francaise dictee, vers une intention exploitable.
// Approche a base de regles : aucun appel reseau, aucune cle d'API, tout reste
// sur la machine. Les regles sont ordonnees de la plus specifique a la plus large.

// Normalisation pour la comparaison : minuscules, sans accents, ponctuation et
// traits d'union ramenes a des espaces. On conserve une carte d'indices vers le
// texte d'origine, ce qui permet de recuperer plus loin le fragment exact dicte
// (accents et majuscules compris) pour les notes, les recherches et les chemins.
const CARACTERES_UTILES = /[a-z0-9%:\/.~_]/;

function normaliserAvecCarte(texte) {
  const source = String(texte || '');
  let sortie = '';
  const carte = [];
  let dernierEstEspace = true;
  for (let i = 0; i < source.length; i++) {
    const decompose = source[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const c of decompose) {
      if (CARACTERES_UTILES.test(c)) {
        sortie += c;
        carte.push(i);
        dernierEstEspace = false;
      } else if (!dernierEstEspace) {
        sortie += ' ';
        carte.push(i);
        dernierEstEspace = true;
      }
    }
  }
  if (dernierEstEspace && sortie.length) {
    sortie = sortie.slice(0, -1);
    carte.pop();
  }
  return { texte: sortie, carte, source };
}

function normaliser(texte) {
  return normaliserAvecCarte(texte).texte;
}

const OUI = ['oui', 'ouais', 'confirme', 'je confirme', 'vas y', 'va y', 'valide', 'd accord',
  'daccord', 'ok', 'okay', 'c est bon', 'exact', 'affirmatif', 'fais le', 'lance', 'yes'];
const NON = ['non', 'annule', 'annuler', 'laisse tomber', 'stop', 'arrete', 'negatif',
  'surtout pas', 'oublie', 'oublie ca', 'pas maintenant'];

// Sites courants reconnus par leur nom parle.
const SITES = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  github: 'https://github.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  linkedin: 'https://www.linkedin.com',
  twitter: 'https://twitter.com',
  x: 'https://twitter.com',
  wikipedia: 'https://fr.wikipedia.org',
  leboncoin: 'https://www.leboncoin.fr',
  amazon: 'https://www.amazon.fr',
  netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com',
  maps: 'https://maps.google.com',
  drive: 'https://drive.google.com',
  chatgpt: 'https://chat.openai.com',
  claude: 'https://claude.ai'
};

// Applications macOS : nom parle -> nom reel de l'application.
const APPLICATIONS = {
  safari: 'Safari',
  chrome: 'Google Chrome',
  'google chrome': 'Google Chrome',
  firefox: 'Firefox',
  mail: 'Mail',
  courrier: 'Mail',
  messages: 'Messages',
  whatsapp: 'WhatsApp',
  musique: 'Music',
  music: 'Music',
  itunes: 'Music',
  spotify: 'Spotify',
  photos: 'Photos',
  notes: 'Notes',
  calendrier: 'Calendar',
  agenda: 'Calendar',
  rappels: 'Reminders',
  plans: 'Maps',
  finder: 'Finder',
  terminal: 'Terminal',
  iterm: 'iTerm',
  xcode: 'Xcode',
  'visual studio code': 'Visual Studio Code',
  vscode: 'Visual Studio Code',
  code: 'Visual Studio Code',
  pages: 'Pages',
  numbers: 'Numbers',
  keynote: 'Keynote',
  aperçu: 'Preview',
  apercu: 'Preview',
  preview: 'Preview',
  calculette: 'Calculator',
  calculatrice: 'Calculator',
  reglages: 'System Settings',
  preferences: 'System Settings',
  zoom: 'zoom.us',
  slack: 'Slack',
  discord: 'Discord',
  teams: 'Microsoft Teams',
  excel: 'Microsoft Excel',
  word: 'Microsoft Word'
};

// Dossiers usuels : nom parle -> chemin relatif au dossier personnel.
const DOSSIERS = {
  telechargements: 'Downloads',
  telechargement: 'Downloads',
  downloads: 'Downloads',
  documents: 'Documents',
  document: 'Documents',
  bureau: 'Desktop',
  desktop: 'Desktop',
  images: 'Pictures',
  photos: 'Pictures',
  musiques: 'Music',
  videos: 'Movies',
  films: 'Movies',
  applications: '/Applications',
  personnel: '~',
  maison: '~'
};


// Recupere dans le texte d'origine le fragment correspondant a un groupe capture,
// en s'appuyant sur la carte d'indices produite par la normalisation. Les
// expressions concernees portent le drapeau "d" qui expose la position des groupes.
function brutGroupe(contexteNorme, correspondance, indiceGroupe) {
  const positions = correspondance.indices && correspondance.indices[indiceGroupe];
  if (!positions || !contexteNorme) return correspondance[indiceGroupe];
  const [debut, fin] = positions;
  const carte = contexteNorme.carte;
  if (debut >= carte.length || fin <= debut) return correspondance[indiceGroupe];
  const depart = carte[debut];
  const arrivee = carte[Math.min(fin, carte.length) - 1];
  return contexteNorme.source.slice(depart, arrivee + 1).trim().replace(/[.,;!?]+$/, '');
}

function contient(texte, liste) {
  return liste.some((mot) => texte === mot || texte.startsWith(mot + ' ') || texte.endsWith(' ' + mot) || texte.includes(' ' + mot + ' '));
}

function nettoyerCible(reste) {
  return String(reste || '')
    .replace(/^(l |la |le |les |mon |ma |mes |un |une |du |de la |de |d )+/i, '')
    .replace(/\s+(s il te plait|s il vous plait|stp|svp|maintenant|tout de suite)$/i, '')
    .trim();
}

// Convertit une duree parlee en secondes : "10 minutes", "une heure et demie", "30 s".
const NOMBRES = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30,
  quarante: 40, cinquante: 50, soixante: 60, cent: 100
};

function lireNombre(mot) {
  if (mot === undefined || mot === null) return null;
  const brut = String(mot).trim();
  if (/^\d+$/.test(brut)) return parseInt(brut, 10);
  if (NOMBRES[brut] !== undefined) return NOMBRES[brut];
  return null;
}

function analyserDuree(texte) {
  const m = texte.match(/(\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante)\s*(secondes?|s|minutes?|min|mn|heures?|h)\b/);
  if (!m) return null;
  const valeur = lireNombre(m[1]);
  if (valeur === null) return null;
  const unite = m[2];
  let secondes = valeur;
  if (/^(minutes?|min|mn)$/.test(unite)) secondes = valeur * 60;
  else if (/^(heures?|h)$/.test(unite)) secondes = valeur * 3600;
  if (/et demie?/.test(texte)) {
    if (/^(heures?|h)$/.test(unite)) secondes += 1800;
    else if (/^(minutes?|min|mn)$/.test(unite)) secondes += 30;
  }
  return secondes;
}

function trouverApplication(cible) {
  const c = normaliser(cible);
  if (!c) return null;
  if (APPLICATIONS[c]) return APPLICATIONS[c];
  // Correspondance partielle : "ouvre visual studio" doit trouver "Visual Studio Code".
  const cle = Object.keys(APPLICATIONS).find((k) => k === c || k.startsWith(c) || c.startsWith(k));
  if (cle) return APPLICATIONS[cle];
  return null;
}

function trouverSite(cible) {
  const c = normaliser(cible).replace(/^(www |site |le site )/, '');
  if (SITES[c]) return SITES[c];
  const cle = Object.keys(SITES).find((k) => c === k || c.startsWith(k + ' ') || c === k + ' point com');
  if (cle) return SITES[cle];
  if (/^[a-z0-9-]+\.[a-z]{2,}([\/].*)?$/.test(c.replace(/ /g, ''))) {
    return 'https://' + c.replace(/ /g, '');
  }
  return null;
}

// Raccourcis definis par l'utilisateur dans la configuration.
function trouverRaccourci(texte, raccourcis) {
  if (!Array.isArray(raccourcis)) return null;
  for (const r of raccourcis) {
    const phrases = (r.phrases || []).map(normaliser).filter(Boolean);
    if (phrases.some((p) => texte === p || texte.includes(p))) return r;
  }
  return null;
}

// Resultat : { intention, action, reponse, sensible, sur }
// - sensible : demande une validation orale avant execution
// - sur      : action inoffensive, executable sans confirmation si l'utilisateur l'a choisi
function analyser(texteBrut, contexte) {
  const ctx = contexte || {};
  const norme = normaliserAvecCarte(texteBrut);
  const t = norme.texte;
  if (!t) return { intention: 'vide', sur: true };

  // --- Reponses courtes a une demande de confirmation ---------------------
  if (contient(t, OUI)) return { intention: 'confirmer', sur: true };
  if (contient(t, NON)) return { intention: 'refuser', sur: true };

  // --- Politesse et fin de session ---------------------------------------
  if (/^(merci|merci beaucoup|c est parfait|parfait)\b/.test(t)) {
    return { intention: 'remerciement', sur: true };
  }
  if (/^(au revoir|a plus|bonne nuit|bonne soiree|salut jarvis|ciao)\b/.test(t)) {
    return { intention: 'au revoir', sur: true };
  }
  if (/^(bonjour|bonsoir|salut|coucou|hey jarvis|jarvis)$/.test(t)) {
    return { intention: 'salutation', sur: true };
  }

  // --- Raccourcis personnels : prioritaires sur les regles generiques -----
  const raccourci = trouverRaccourci(t, ctx.raccourcis);
  if (raccourci) {
    return {
      intention: 'raccourci',
      action: raccourci.action,
      reponse: raccourci.nom,
      sensible: raccourci.action && raccourci.action.type === 'shell',
      sur: !(raccourci.action && raccourci.action.type === 'shell')
    };
  }

  // --- Interrogations simples --------------------------------------------
  if (/(quelle heure|il est quelle heure|l heure qu il est)/.test(t)) {
    return { intention: 'heure', sur: true };
  }
  if (/(quel jour|quelle date|on est quel jour|la date du jour)/.test(t)) {
    return { intention: 'date', sur: true };
  }
  if (/(quel est ton nom|qui es tu|tu es qui|comment tu t appelles)/.test(t)) {
    return { intention: 'identite', sur: true };
  }
  if (/(que sais tu faire|tes capacites|tu sais faire quoi|aide moi|liste des commandes|que peux tu faire)/.test(t)) {
    return { intention: 'aide', sur: true };
  }
  if (/(niveau de batterie|combien de batterie|etat de la batterie|batterie restante)/.test(t)) {
    return { intention: 'batterie', sur: true };
  }
  if (/(etat des systemes|rapport de statut|diagnostic|tout va bien)/.test(t)) {
    return { intention: 'diagnostic', sur: true };
  }

  // --- Memoire de travail -------------------------------------------------
  let m = t.match(/^(?:note|retiens|souviens toi|memorise|rappelle toi)(?: que| de| :)?\s+(.+)$/d);
  if (m) return { intention: 'retenir', action: { texte: brutGroupe(norme, m, 1) }, sur: true };

  if (/(de quoi on parlait|qu est ce que je t ai dit|rappelle moi|tes notes|mes notes|ce que tu as retenu)/.test(t)) {
    return { intention: 'rappeler', sur: true };
  }
  if (/(oublie tout|efface tes notes|vide ta memoire|efface la memoire)/.test(t)) {
    return { intention: 'oublier', sensible: true };
  }

  // --- Sujet de travail du jour (reponse a la question d ouverture) -------
  m = t.match(/^(?:aujourd hui |ce matin |cet apres midi |ce soir )?(?:on (?:va )?(?:travaille[r]?|bosse[r]?)|je (?:travaille|bosse)|on s occupe)\s+(?:sur|de|d|du|des|avec)\s+(.+)$/d);
  if (m) return { intention: 'sujetDuJour', action: { sujet: nettoyerCible(brutGroupe(norme, m, 1)) }, sur: true };

  // --- Minuteur -----------------------------------------------------------
  if (/(minuteur|minuterie|chrono|compte a rebours|reveille moi dans|previens moi dans)/.test(t)) {
    const secondes = analyserDuree(t);
    if (secondes) return { intention: 'minuteur', action: { secondes }, sur: true };
    return { intention: 'minuteur', action: null, sur: true };
  }

  // --- Son ----------------------------------------------------------------
  m = t.match(/(?:mets le |mettre le |regle le |met le )?(?:volume|son)\s*(?:a|sur)?\s*(\d{1,3})\s*(?:%|pour cent)?/);
  if (m && /volume|son/.test(t) && !/monte|baisse|coupe/.test(t)) {
    return { intention: 'volume', action: { niveau: Math.min(100, parseInt(m[1], 10)) }, sur: true };
  }
  if (/(monte le son|augmente le son|monte le volume|plus fort|augmente le volume)/.test(t)) {
    return { intention: 'volume', action: { delta: 15 }, sur: true };
  }
  if (/(baisse le son|diminue le son|baisse le volume|moins fort|diminue le volume)/.test(t)) {
    return { intention: 'volume', action: { delta: -15 }, sur: true };
  }
  if (/(coupe le son|muet|silence|mute)/.test(t)) {
    return { intention: 'volume', action: { muet: true }, sur: true };
  }
  if (/(remets le son|retablis le son|plus muet)/.test(t)) {
    return { intention: 'volume', action: { muet: false }, sur: true };
  }

  // --- Lecture multimedia -------------------------------------------------
  if (/^(pause|mets en pause|arrete la musique|stoppe la musique)$/.test(t)) {
    return { intention: 'media', action: { commande: 'pause' }, sur: true };
  }
  if (/(reprends la lecture|relance la musique|remets la musique|continue la musique)/.test(t)) {
    return { intention: 'media', action: { commande: 'lecture' }, sur: true };
  }
  if (/(morceau suivant|chanson suivante|piste suivante|suivant)/.test(t)) {
    return { intention: 'media', action: { commande: 'suivant' }, sur: true };
  }
  if (/(morceau precedent|chanson precedente|piste precedente|precedent)/.test(t)) {
    return { intention: 'media', action: { commande: 'precedent' }, sur: true };
  }

  // --- Ecran et session ---------------------------------------------------
  if (/(verrouille (l ecran|la session|le mac)|bloque l ecran|ferme la session)/.test(t)) {
    return { intention: 'verrouiller', sensible: true };
  }
  if (/(mets? (le mac |l ordinateur )?en veille|endors (le mac|l ordinateur))/.test(t)) {
    return { intention: 'veille', sensible: true };
  }
  if (/(eteins (le mac|l ordinateur)|arrete (le mac|l ordinateur))/.test(t)) {
    return { intention: 'eteindre', sensible: true };
  }
  if (/(redemarre (le mac|l ordinateur))/.test(t)) {
    return { intention: 'redemarrer', sensible: true };
  }
  if (/(capture d ecran|fais une capture|prends une capture|screenshot)/.test(t)) {
    return { intention: 'capture', sur: true };
  }

  // --- Recherche ----------------------------------------------------------
  m = t.match(/^(?:cherche|recherche|trouve|google|regarde)\s+(?:moi\s+)?(.+?)(?:\s+(?:sur|dans)\s+(?:internet|le web|google))?$/d);
  if (m && !/^(?:le fichier|le dossier|mes fichiers)/.test(m[1])) {
    return { intention: 'recherche', action: { requete: brutGroupe(norme, m, 1) }, sur: true };
  }
  m = t.match(/^(?:c est quoi|qu est ce que|qui est|definition de)\s+(.+)$/d);
  if (m) return { intention: 'recherche', action: { requete: brutGroupe(norme, m, 1) }, sur: true };

  // --- Ouverture de dossier ----------------------------------------------
  m = t.match(/^(?:ouvre|ouvrir|montre|affiche|va dans|accede a)\s+(?:le |la |mes |mon |ma )?(?:dossier|repertoire)\s+(.+)$/d);
  if (m) {
    const nom = normaliser(nettoyerCible(m[1]));
    const chemin = DOSSIERS[nom] || nettoyerCible(brutGroupe(norme, m, 1));
    return { intention: 'dossier', action: { chemin }, sur: true };
  }

  // --- Ouverture de fichier ----------------------------------------------
  m = t.match(/^(?:ouvre|ouvrir|affiche|montre)\s+(?:le |la |mon |ma )?fichier\s+(.+)$/d);
  if (m) return { intention: 'fichier', action: { chemin: nettoyerCible(brutGroupe(norme, m, 1)) }, sur: true };

  // --- Site web -----------------------------------------------------------
  m = t.match(/^(?:ouvre|ouvrir|va sur|lance|affiche|amene moi sur|connecte toi a)\s+(?:le site |la page |le lien )?(.+)$/d);
  if (m) {
    const cibleBrute = nettoyerCible(brutGroupe(norme, m, 1));
    const cible = nettoyerCible(m[1]);
    const site = trouverSite(cible);
    const application = trouverApplication(cible);
    // Une application installee prime sur un site du meme nom.
    if (application) return { intention: 'application', action: { nom: application }, sur: true };
    if (site) return { intention: 'site', action: { url: site }, sur: true };
    // Chemin explicite : fichier ou dossier.
    if (/^(~|\/|\.\/)/.test(cibleBrute)) return { intention: 'fichier', action: { chemin: cibleBrute }, sur: true };
    const dossier = DOSSIERS[normaliser(cible)];
    if (dossier) return { intention: 'dossier', action: { chemin: dossier }, sur: true };
    // Dernier recours : on tente d'ouvrir une application portant ce nom.
    return { intention: 'application', action: { nom: cibleBrute, incertain: true }, sur: true };
  }

  // --- Fermeture d'application -------------------------------------------
  m = t.match(/^(?:ferme|quitte|arrete)\s+(.+)$/d);
  if (m) {
    const application = trouverApplication(nettoyerCible(m[1]));
    if (application) return { intention: 'fermerApplication', action: { nom: application }, sensible: true };
  }

  // --- Commande shell libre ----------------------------------------------
  m = t.match(/^(?:execute|lance|tape|joue)\s+(?:la\s+)?commande\s+(.+)$/);
  if (m) {
    // On repart du texte d'origine : la normalisation abime les commandes.
    const commande = String(texteBrut).replace(/^.*?commande\s+/i, '').trim();
    return { intention: 'shell', action: { commande }, sensible: true };
  }

  return { intention: 'inconnu', action: { texte: texteBrut }, sur: true };
}

module.exports = {
  analyser,
  normaliser,
  normaliserAvecCarte,
  analyserDuree,
  trouverApplication,
  trouverSite,
  APPLICATIONS,
  SITES,
  DOSSIERS,
  OUI,
  NON
};
