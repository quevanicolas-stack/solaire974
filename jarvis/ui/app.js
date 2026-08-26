'use strict';
// Application JARVIS : assemble le reacteur, la voix, le client reseau et l'interface.
// Le meme fichier sert sur le Mac (fenetre Electron ou navigateur), sur le telephone
// et sur la tablette ; seule la taille de l'ecran change.

(function () {
  const $ = (selecteur) => document.querySelector(selecteur);
  const $$ = (selecteur) => Array.from(document.querySelectorAll(selecteur));

  const client = new ClientJarvis();

  const reacteurs = {};
  let voix = null;
  let reglages = null;
  let derniereEcouteVolontaire = false;
  let salutationFaite = false;

  // ---------------------------------------------------------------------
  // Reacteurs
  // ---------------------------------------------------------------------
  function creerReacteurs() {
    const definitions = [
      ['connexion', '#reacteur-connexion', {}],
      ['barre', '#reacteur-barre', { compact: true }],
      ['principal', '#reacteur-principal', {}]
    ];
    for (const [cle, selecteur, options] of definitions) {
      const canvas = $(selecteur);
      if (!canvas) continue;
      reacteurs[cle] = new Reacteur(canvas, options);
      reacteurs[cle].demarrer();
    }
    window.addEventListener('resize', () => {
      Object.values(reacteurs).forEach((r) => r.redimensionner());
    });
  }

  function etatReacteur(etat) {
    Object.values(reacteurs).forEach((r) => r.definirEtat(etat));
    // Dans l'application macOS, la pastille en surimpression suit le meme etat.
    if (window.jarvisBureau) window.jarvisBureau.signalerEtat(etat);
  }

  function niveauReacteur(valeur) {
    Object.values(reacteurs).forEach((r) => r.definirNiveau(valeur));
    if (window.jarvisBureau) window.jarvisBureau.signalerNiveau(valeur);
  }

  // ---------------------------------------------------------------------
  // Conversation
  // ---------------------------------------------------------------------
  function heureCourte(horodatage) {
    return new Date(horodatage || Date.now())
      .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function ajouterEchange(echange) {
    const liste = $('#liste-echanges');
    if (!liste) return;
    const element = document.createElement('li');
    element.className = 'echange';

    if (echange.utilisateur) {
      const bulle = document.createElement('div');
      bulle.className = 'bulle utilisateur';
      bulle.textContent = echange.utilisateur;
      element.appendChild(bulle);
    }
    if (echange.jarvis) {
      const bulle = document.createElement('div');
      bulle.className = 'bulle jarvis';
      if (echange.ok === false) bulle.classList.add('echec');
      if (echange.attente) bulle.classList.add('attente');
      bulle.textContent = echange.jarvis;
      element.appendChild(bulle);
    }
    const horodatage = document.createElement('span');
    horodatage.className = 'horodatage';
    // Un message venu de l'utilisateur seul est aligne a droite, comme sa bulle.
    if (echange.utilisateur && !echange.jarvis) horodatage.classList.add('droite');
    horodatage.textContent = heureCourte(echange.date);
    element.appendChild(horodatage);

    liste.appendChild(element);
    faireDefiler();
  }

  function faireDefiler() {
    const zone = document.querySelector('.conversation');
    if (zone) zone.scrollTop = zone.scrollHeight;
  }

  function rendreHistorique(historique) {
    const liste = $('#liste-echanges');
    if (!liste) return;
    liste.textContent = '';
    (historique || []).forEach(ajouterEchange);
  }

  // ---------------------------------------------------------------------
  // Parole
  // ---------------------------------------------------------------------
  async function direParJarvis(texte, options) {
    if (!texte) return;
    const opts = options || {};
    $('#phrase-active').textContent = texte;
    $('#phrase-provisoire').textContent = '';
    etatReacteur('parole');
    client.diffuserParole('debut', texte);
    await voix.parler(texte, opts);
    client.diffuserParole('fin', '');
    client.diffuserNiveau(0);
    // Apres avoir parle, JARVIS revient a l'ecoute s'il y etait.
    etatReacteur(voix.enEcoute ? 'ecoute' : 'repos');
  }

  // ---------------------------------------------------------------------
  // Envoi d'une commande
  // ---------------------------------------------------------------------
  async function envoyer(texte) {
    const contenu = String(texte || '').trim();
    if (!contenu) return;
    // Si la fenetre etait restee masquee au demarrage de la session, la premiere
    // reponse de l'utilisateur la fait apparaitre.
    if (window.jarvisBureau && window.jarvisBureau.montrerFenetre) {
      window.jarvisBureau.montrerFenetre();
    }
    ajouterEchange({ utilisateur: contenu, date: Date.now() });
    $('#phrase-provisoire').textContent = '';
    etatReacteur('reflexion');

    try {
      if (client.connecte) {
        // La reponse arrivera par le WebSocket.
        client.envoyer({ type: 'dire', texte: contenu });
      } else {
        const reponse = await client.dire(contenu);
        traiterReponse(Object.assign({ utilisateur: contenu }, reponse));
      }
    } catch (erreur) {
      etatReacteur('repos');
      ajouterEchange({ jarvis: 'Liaison interrompue : ' + erreur.message, ok: false, date: Date.now() });
    }
  }

  function traiterReponse(message) {
    ajouterEchange({
      jarvis: message.parole,
      ok: message.resultat ? message.resultat.ok : null,
      attente: message.attente,
      date: Date.now()
    });
    direParJarvis(message.parole);
  }

  // ---------------------------------------------------------------------
  // Ecoute
  // ---------------------------------------------------------------------
  function motReveilPresent(texte) {
    const mot = (reglages && reglages.ecoute && reglages.ecoute.motReveil) || '';
    if (!mot) return true;
    const normalise = texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return normalise.includes(mot.toLowerCase());
  }

  function retirerMotReveil(texte) {
    const mot = (reglages && reglages.ecoute && reglages.ecoute.motReveil) || '';
    if (!mot) return texte;
    const expression = new RegExp('^\\s*' + mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s,.!?]*', 'i');
    return texte.replace(expression, '').trim() || texte;
  }

  function basculerMicro() {
    if (!voix) return;
    voix.debloquerAudio();
    const actif = voix.basculerEcoute();
    derniereEcouteVolontaire = actif;
    majBoutonMicro(actif);
    client.diffuserEcoute(actif);
  }

  function majBoutonMicro(actif) {
    const bouton = $('#bouton-micro');
    if (!bouton) return;
    bouton.setAttribute('aria-pressed', actif ? 'true' : 'false');
    $('#libelle-micro').textContent = actif ? 'A l\'ecoute' : 'Parler';
  }

  // ---------------------------------------------------------------------
  // Reglages
  // ---------------------------------------------------------------------
  function appliquerReglages(nouveaux) {
    reglages = nouveaux;
    if (voix) voix.appliquerReglages(reglages.voix);
    const opacite = reglages.reacteur ? reglages.reacteur.opaciteRepos : 1;
    Object.values(reacteurs).forEach((r) => { r.opaciteRepos = opacite; });
    remplirFormulaireReglages();
    // La fenetre Electron applique la position et la taille de la pastille.
    if (window.jarvisBureau && window.jarvisBureau.appliquerReacteur) {
      window.jarvisBureau.appliquerReacteur(reglages.reacteur);
    }
  }

  function remplirFormulaireReglages() {
    if (!reglages) return;
    const definir = (selecteur, valeur) => {
      const element = $(selecteur);
      if (element) element.value = valeur;
    };
    const cocher = (selecteur, valeur) => {
      const element = $(selecteur);
      if (element) element.checked = !!valeur;
    };

    definir('#reglage-nom', reglages.nomUtilisateur || '');
    definir('#reglage-debit', reglages.voix.debit);
    definir('#reglage-hauteur', reglages.voix.hauteur);
    definir('#reglage-volume', reglages.voix.volume);
    cocher('#reglage-accueil-actif', reglages.accueil.actif);
    definir('#reglage-silence', reglages.accueil.silenceMinutes);
    cocher('#reglage-veille', reglages.ecoute.veilleContinue);
    definir('#reglage-mot-reveil', reglages.ecoute.motReveil || '');
    cocher('#reglage-validation', reglages.execution.validationOrale);
    cocher('#reglage-validation-sures', reglages.execution.validationPourActionsSures);
    cocher('#reglage-shell', reglages.execution.shellLibre);
    definir('#reglage-position', reglages.reacteur.position);
    definir('#reglage-taille', reglages.reacteur.taille);
    definir('#reglage-opacite', reglages.reacteur.opaciteRepos);

    majSorties();
    remplirListeVoix();
    remplirRaccourcis();

    const etat = $('#etat-reconnaissance');
    if (etat) {
      etat.textContent = voix && voix.reconnaissanceDisponible
        ? 'Reconnaissance vocale du navigateur disponible sur cet appareil.'
        : (reglages.whisperPret
          ? 'Reconnaissance assuree par whisper, installe sur le Mac.'
          : 'Aucune reconnaissance vocale sur cet appareil : utilisez la saisie ecrite, ou installez whisper.');
    }
  }

  function majSorties() {
    const paires = [
      ['#reglage-debit', '#valeur-debit', (v) => Number(v).toFixed(2)],
      ['#reglage-hauteur', '#valeur-hauteur', (v) => Number(v).toFixed(2)],
      ['#reglage-volume', '#valeur-volume', (v) => Math.round(v * 100) + ' %'],
      ['#reglage-taille', '#valeur-taille', (v) => v + ' px'],
      ['#reglage-opacite', '#valeur-opacite', (v) => Math.round(v * 100) + ' %']
    ];
    for (const [entree, sortie, format] of paires) {
      const champ = $(entree);
      const cible = $(sortie);
      if (champ && cible) cible.textContent = format(champ.value);
    }
  }

  function remplirListeVoix() {
    const selection = $('#reglage-voix');
    // L'evenement "voiceschanged" peut survenir avant que les reglages soient charges.
    if (!selection || !voix || !reglages) return;
    const disponibles = voix.listerVoix();
    selection.textContent = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Choix automatique';
    selection.appendChild(auto);
    for (const v of disponibles) {
      const option = document.createElement('option');
      option.value = v.nom;
      option.textContent = v.nom + (v.locale ? '' : ' (en ligne)');
      selection.appendChild(option);
    }
    selection.value = reglages.voix.nom || '';
  }

  function remplirRaccourcis() {
    const liste = $('#liste-raccourcis');
    if (!liste) return;
    liste.textContent = '';
    (reglages.raccourcis || []).forEach((raccourci, indice) => {
      const ligne = document.createElement('li');
      ligne.className = 'ligne-liste';
      const texte = document.createElement('div');
      const titre = document.createElement('div');
      titre.textContent = raccourci.nom;
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = (raccourci.phrases || []).join(' ; ') + ' — '
        + raccourci.action.type + ' : ' + raccourci.action.cible;
      texte.appendChild(titre);
      texte.appendChild(detail);
      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'bouton-retirer';
      retirer.textContent = 'Retirer';
      retirer.addEventListener('click', () => {
        reglages.raccourcis.splice(indice, 1);
        enregistrerReglages({ raccourcis: reglages.raccourcis });
      });
      ligne.appendChild(texte);
      ligne.appendChild(retirer);
      liste.appendChild(ligne);
    });
  }

  async function remplirAppareils() {
    const liste = $('#liste-appareils');
    if (!liste) return;
    let appareils = [];
    try {
      appareils = (await client.appareils()).appareils;
    } catch (e) {
      return;
    }
    liste.textContent = '';
    for (const appareil of appareils) {
      const ligne = document.createElement('li');
      ligne.className = 'ligne-liste';
      const texte = document.createElement('div');
      const titre = document.createElement('div');
      titre.textContent = appareil.nom;
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = appareil.plateforme + ' — vu le '
        + new Date(appareil.dernierAcces).toLocaleString('fr-FR');
      texte.appendChild(titre);
      texte.appendChild(detail);
      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'bouton-retirer';
      retirer.textContent = 'Revoquer';
      retirer.addEventListener('click', async () => {
        await client.revoquerAppareil(appareil.reference);
        remplirAppareils();
      });
      ligne.appendChild(texte);
      ligne.appendChild(retirer);
      liste.appendChild(ligne);
    }
  }

  async function enregistrerReglages(partiel) {
    try {
      const nouveaux = await client.enregistrerReglages(partiel);
      appliquerReglages(nouveaux);
      messageReglages('Reglages enregistres.', true);
    } catch (erreur) {
      messageReglages(erreur.message, false);
    }
  }

  let minuterieMessage = null;
  function messageReglages(texte, succes) {
    const element = $('#message-reglages');
    if (!element) return;
    element.textContent = texte;
    element.classList.toggle('succes', !!succes);
    if (minuterieMessage) clearTimeout(minuterieMessage);
    minuterieMessage = setTimeout(() => { element.textContent = ''; }, 3200);
  }

  // Regroupe les modifications rapprochees (curseurs) en un seul enregistrement.
  let minuterieEnregistrement = null;
  function enregistrerPlusTard(construire) {
    if (minuterieEnregistrement) clearTimeout(minuterieEnregistrement);
    minuterieEnregistrement = setTimeout(() => {
      minuterieEnregistrement = null;
      enregistrerReglages(construire());
    }, 500);
  }

  // ---------------------------------------------------------------------
  // Appairage
  // ---------------------------------------------------------------------
  async function lancerAppairage() {
    try {
      const appairage = await client.creerAppairage();
      const bloc = $('#bloc-appairage');
      bloc.classList.remove('masque');
      $('#code-appairage').textContent = appairage.code;
      const adresse = (appairage.adresses && appairage.adresses[0])
        ? appairage.adresses[0].url
        : window.location.origin;
      $('#adresse-appairage').textContent = adresse;
      CodeQR.dessiner($('#qr-appairage'), adresse + '/#code=' + appairage.code, { taille: 200 });

      // Le code expire : on retire l'affichage au bon moment.
      const restant = appairage.expire - Date.now();
      setTimeout(() => {
        bloc.classList.add('masque');
        $('#code-appairage').textContent = '';
      }, Math.max(1000, restant));
    } catch (erreur) {
      messageReglages(erreur.message, false);
    }
  }

  // ---------------------------------------------------------------------
  // Ecrans
  // ---------------------------------------------------------------------
  function montrerEcran(nom) {
    $('#ecran-connexion').classList.toggle('masque', nom !== 'connexion');
    $('#ecran-principal').classList.toggle('masque', nom !== 'principal');
  }

  function ouvrirReglages() {
    $('#panneau-reglages').classList.remove('masque');
    $('#voile').classList.remove('masque');
    remplirAppareils();
  }

  function fermerReglages() {
    $('#panneau-reglages').classList.add('masque');
    $('#voile').classList.add('masque');
  }

  function majEtatLiaison(texte, classe) {
    const element = $('#etat-liaison');
    if (!element) return;
    element.textContent = texte;
    element.classList.remove('connecte', 'perdu');
    if (classe) element.classList.add(classe);
  }

  // ---------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------
  async function ouvrirSession() {
    montrerEcran('principal');
    majEtatLiaison('Connexion en cours');
    client.connecter();

    // Repli si le WebSocket tarde : on charge au moins l'etat par l'API.
    try {
      const etat = await client.etat();
      appliquerReglages(etat.reglages);
      rendreHistorique(etat.historique);
      const courriel = $('#courriel-compte');
      if (courriel) courriel.textContent = etat.courriel;
    } catch (erreur) {
      if (erreur.statut === 401) return montrerEcran('connexion');
    }
  }

  async function saluer(forcer) {
    if (salutationFaite && !forcer) return;
    salutationFaite = true;
    try {
      const reponse = await client.salutation(forcer);
      if (!reponse.parole) return;
      ajouterEchange({ jarvis: reponse.parole, date: Date.now() });
      await direParJarvis(reponse.parole);
      // JARVIS a pose une question : il ouvre le micro pour la reponse.
      if (voix.reconnaissanceDisponible && !voix.enEcoute) {
        voix.demarrerEcoute();
        majBoutonMicro(true);
      }
    } catch (erreur) {
      // Une salutation manquee n'empeche pas d'utiliser l'application.
    }
  }

  // ---------------------------------------------------------------------
  // Branchements
  // ---------------------------------------------------------------------
  function brancherClient() {
    client.sur('connexion', (message) => {
      majEtatLiaison('En ligne', 'connecte');
      appliquerReglages(message.reglages);
      rendreHistorique(message.historique);
      const courriel = $('#courriel-compte');
      if (courriel) courriel.textContent = message.courriel;
      if (reglages.accueil.actif) {
        setTimeout(() => saluer(false), reglages.accueil.delaiMs || 1000);
      }
    });

    client.sur('deconnexion', () => {
      majEtatLiaison('Liaison perdue', 'perdu');
      etatReacteur('horsLigne');
    });

    client.sur('reconnexionPrevue', (donnees) => {
      majEtatLiaison('Nouvelle tentative dans ' + Math.round(donnees.attente / 1000) + ' s', 'perdu');
    });

    client.sur('jetonInvalide', () => {
      montrerEcran('connexion');
      $('#message-connexion').textContent = 'Cet appareil a ete revoque. Reconnectez-vous.';
    });

    client.sur('reponse', (message) => traiterReponse(message));

    // Echange venu d'un autre appareil du compte.
    client.sur('echange', (message) => {
      ajouterEchange({ utilisateur: message.utilisateur, jarvis: message.jarvis, date: Date.now() });
    });

    // Amplitude venue de l'appareil qui parle.
    client.sur('niveau', (message) => {
      if (voix && (voix.enParole || voix.enEcoute)) return;
      niveauReacteur(message.valeur);
    });

    client.sur('parole', (message) => {
      if (voix && voix.enParole) return;
      etatReacteur(message.etat === 'debut' ? 'parole' : 'repos');
    });

    client.sur('annonce', (message) => {
      ajouterEchange({ jarvis: message.texte, date: Date.now() });
      direParJarvis(message.texte);
    });

    client.sur('reglages', (message) => appliquerReglages(message.reglages));

    client.sur('historiqueVide', () => rendreHistorique([]));

    client.sur('salutation', (message) => {
      if (!message.parole) return;
      ajouterEchange({ jarvis: message.parole, date: Date.now() });
      direParJarvis(message.parole);
    });
  }

  function brancherFormulaires() {
    // Onglets de l'ecran de connexion.
    $$('.onglet').forEach((onglet) => {
      onglet.addEventListener('click', () => {
        $$('.onglet').forEach((o) => o.classList.toggle('actif', o === onglet));
        $$('.panneau-onglet').forEach((p) => {
          p.classList.toggle('actif', p.dataset.panneau === onglet.dataset.onglet);
        });
        $('#message-connexion').textContent = '';
      });
    });

    const erreurConnexion = (erreur) => {
      $('#message-connexion').textContent = erreur.message || 'Connexion impossible.';
    };

    $('#formulaire-connexion').addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      const donnees = new FormData(evenement.target);
      try {
        await client.seConnecter(donnees.get('courriel'), donnees.get('motDePasse'));
        ouvrirSession();
      } catch (erreur) { erreurConnexion(erreur); }
    });

    $('#formulaire-creation').addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      const donnees = new FormData(evenement.target);
      try {
        await client.creerCompte(donnees.get('courriel'), donnees.get('motDePasse'));
        ouvrirSession();
      } catch (erreur) { erreurConnexion(erreur); }
    });

    $('#formulaire-appairage').addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      const donnees = new FormData(evenement.target);
      const serveur = String(donnees.get('serveur') || '').trim();
      if (serveur) client.definirServeur(serveur);
      try {
        await client.rejoindreParCode(String(donnees.get('code') || '').trim());
        ouvrirSession();
      } catch (erreur) { erreurConnexion(erreur); }
    });

    $('#formulaire-commande').addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      const champ = $('#champ-commande');
      const texte = champ.value;
      champ.value = '';
      if (voix) voix.debloquerAudio();
      envoyer(texte);
    });

    $('#bouton-micro').addEventListener('click', basculerMicro);
    $('#reacteur-principal').addEventListener('click', basculerMicro);
    $('#bouton-reveil').addEventListener('click', () => {
      if (voix) voix.debloquerAudio();
      saluer(true);
    });
    $('#bouton-reglages').addEventListener('click', ouvrirReglages);
    $('#fermer-reglages').addEventListener('click', fermerReglages);
    $('#voile').addEventListener('click', fermerReglages);

    document.addEventListener('keydown', (evenement) => {
      if (evenement.key === 'Escape') fermerReglages();
      // Barre d'espace hors saisie : ouvre ou ferme le micro.
      if (evenement.code === 'Space' && evenement.target === document.body) {
        evenement.preventDefault();
        basculerMicro();
      }
    });
  }

  function brancherReglages() {
    const surChangement = (selecteur, construire, immediat) => {
      const element = $(selecteur);
      if (!element) return;
      element.addEventListener(immediat ? 'change' : 'input', () => {
        majSorties();
        if (immediat) enregistrerReglages(construire());
        else enregistrerPlusTard(construire);
      });
    };

    surChangement('#reglage-nom', () => ({ nomUtilisateur: $('#reglage-nom').value.trim() || 'Monsieur' }));
    surChangement('#reglage-voix', () => ({ voix: Object.assign({}, reglages.voix, { nom: $('#reglage-voix').value }) }), true);
    surChangement('#reglage-debit', () => ({ voix: Object.assign({}, reglages.voix, { debit: Number($('#reglage-debit').value) }) }));
    surChangement('#reglage-hauteur', () => ({ voix: Object.assign({}, reglages.voix, { hauteur: Number($('#reglage-hauteur').value) }) }));
    surChangement('#reglage-volume', () => ({ voix: Object.assign({}, reglages.voix, { volume: Number($('#reglage-volume').value) }) }));
    surChangement('#reglage-accueil-actif', () => ({ accueil: Object.assign({}, reglages.accueil, { actif: $('#reglage-accueil-actif').checked }) }), true);
    surChangement('#reglage-silence', () => ({ accueil: Object.assign({}, reglages.accueil, { silenceMinutes: Number($('#reglage-silence').value) }) }));
    surChangement('#reglage-veille', () => ({ ecoute: Object.assign({}, reglages.ecoute, { veilleContinue: $('#reglage-veille').checked }) }), true);
    surChangement('#reglage-mot-reveil', () => ({ ecoute: Object.assign({}, reglages.ecoute, { motReveil: $('#reglage-mot-reveil').value.trim() }) }));
    surChangement('#reglage-validation', () => ({ execution: Object.assign({}, reglages.execution, { validationOrale: $('#reglage-validation').checked }) }), true);
    surChangement('#reglage-validation-sures', () => ({ execution: Object.assign({}, reglages.execution, { validationPourActionsSures: $('#reglage-validation-sures').checked }) }), true);
    surChangement('#reglage-position', () => ({ reacteur: Object.assign({}, reglages.reacteur, { position: $('#reglage-position').value }) }), true);
    surChangement('#reglage-taille', () => ({ reacteur: Object.assign({}, reglages.reacteur, { taille: Number($('#reglage-taille').value) }) }));
    surChangement('#reglage-opacite', () => ({ reacteur: Object.assign({}, reglages.reacteur, { opaciteRepos: Number($('#reglage-opacite').value) }) }));

    // L'execution de commandes libres merite une confirmation explicite.
    $('#reglage-shell').addEventListener('change', (evenement) => {
      if (evenement.target.checked) {
        const accepte = window.confirm(
          'Autoriser JARVIS a executer les commandes que vous dictez ?\n\n'
          + 'Elles s\'executeront avec vos droits d\'utilisateur. Une phrase mal comprise '
          + 'peut modifier ou supprimer des fichiers. Chaque commande restera soumise a '
          + 'une validation orale.'
        );
        if (!accepte) { evenement.target.checked = false; return; }
      }
      enregistrerReglages({
        execution: Object.assign({}, reglages.execution, { shellLibre: evenement.target.checked })
      });
    });

    $('#bouton-essai-voix').addEventListener('click', () => {
      voix.debloquerAudio();
      voix.appliquerReglages({
        nom: $('#reglage-voix').value,
        debit: Number($('#reglage-debit').value),
        hauteur: Number($('#reglage-hauteur').value),
        volume: Number($('#reglage-volume').value)
      });
      direParJarvis('Voici ma voix. Sur quoi travaille-t-on aujourd\'hui ?');
    });

    $('#ajouter-raccourci').addEventListener('click', () => {
      const nom = $('#raccourci-nom').value.trim();
      const phrases = $('#raccourci-phrases').value.split(',').map((p) => p.trim()).filter(Boolean);
      const cible = $('#raccourci-cible').value.trim();
      if (!nom || !phrases.length || !cible) {
        return messageReglages('Renseignez un nom, au moins une phrase et une cible.', false);
      }
      const raccourcis = (reglages.raccourcis || []).concat([{
        nom, phrases, action: { type: $('#raccourci-type').value, cible }
      }]);
      $('#raccourci-nom').value = '';
      $('#raccourci-phrases').value = '';
      $('#raccourci-cible').value = '';
      enregistrerReglages({ raccourcis });
    });

    $('#bouton-appairer').addEventListener('click', lancerAppairage);

    $('#bouton-vider').addEventListener('click', async () => {
      if (!window.confirm('Effacer toute la conversation enregistree ?')) return;
      await client.viderHistorique();
      rendreHistorique([]);
      messageReglages('Conversation effacee.', true);
    });

    $('#bouton-deconnexion').addEventListener('click', () => {
      if (!window.confirm('Deconnecter cet appareil du compte ?')) return;
      client.seDeconnecterDuCompte();
      fermerReglages();
      montrerEcran('connexion');
    });
  }

  function creerVoix() {
    voix = new Voix({
      langue: 'fr-FR',
      surNiveau: (valeur) => {
        niveauReacteur(valeur);
        client.diffuserNiveau(valeur);
      },
      surEtat: (etat) => etatReacteur(etat),
      surTexteProvisoire: (texte) => { $('#phrase-provisoire').textContent = texte; },
      surErreur: (message) => {
        $('#phrase-provisoire').textContent = message;
        majBoutonMicro(voix.enEcoute);
      }
    });

    // Phrase finale entendue : on l'envoie, en respectant le mot de reveil.
    voix.surTexteEntendu = (texte) => {
      const veille = reglages && reglages.ecoute && reglages.ecoute.veilleContinue;
      // En veille continue, seule une phrase contenant le mot de reveil est prise.
      if (veille && !derniereEcouteVolontaire && !motReveilPresent(texte)) return;
      envoyer(retirerMotReveil(texte));
    };

    // Repli de transcription quand le navigateur n'a pas de reconnaissance.
    voix.transcrire = async (blob) => {
      try {
        const reponse = await client.transcrire(blob);
        return reponse.texte;
      } catch (erreur) {
        $('#phrase-provisoire').textContent = erreur.message;
        return null;
      }
    };
  }

  // Un appareil qui arrive avec "#code=123456" dans l'adresse est un telephone
  // qui vient de scanner le code QR : on preremplit et on bascule sur l'onglet.
  function lireCodeDansAdresse() {
    const fragment = window.location.hash || '';
    const correspondance = fragment.match(/code=(\d{6})/);
    if (!correspondance) return;
    const onglet = document.querySelector('.onglet[data-onglet="appairage"]');
    if (onglet) onglet.click();
    const champ = document.querySelector('#formulaire-appairage input[name="code"]');
    if (champ) champ.value = correspondance[1];
    history.replaceState(null, '', window.location.pathname);
  }

  function enregistrerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Uniquement en contexte sur : le service worker sert a l'installation sur mobile.
    if (!window.isSecureContext && window.location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('sw.js').catch(() => { /* installation facultative */ });
  }

  function demarrer() {
    creerReacteurs();
    creerVoix();
    brancherClient();
    brancherFormulaires();
    brancherReglages();
    lireCodeDansAdresse();
    enregistrerServiceWorker();

    if (client.authentifie) ouvrirSession();
    else montrerEcran('connexion');

    // Sur mobile, la synthese exige un geste : le premier contact la debloque.
    const debloquer = () => {
      if (voix) voix.debloquerAudio();
      document.removeEventListener('pointerdown', debloquer);
    };
    document.addEventListener('pointerdown', debloquer);

    // Raccourci global du systeme et clic sur la pastille : ouverture du micro.
    if (window.jarvisBureau && window.jarvisBureau.surBasculerEcoute) {
      window.jarvisBureau.surBasculerEcoute(basculerMicro);
    }

    // La liste des voix arrive parfois apres le chargement.
    if (window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', remplirListeVoix);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }
})();
