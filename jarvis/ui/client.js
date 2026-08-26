'use strict';
// Liaison avec le serveur JARVIS : appels d'API, WebSocket temps reel et
// reconnexion automatique. Le jeton du compte est conserve localement pour que
// l'appareil se reconnecte seul au demarrage suivant.

(function (global) {
  const CLE_JETON = 'jarvis.jeton';
  const CLE_SERVEUR = 'jarvis.serveur';

  function stockage() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  function lireStockage(cle) {
    const s = stockage();
    if (!s) return null;
    try { return s.getItem(cle); } catch (e) { return null; }
  }

  function ecrireStockage(cle, valeur) {
    const s = stockage();
    if (!s) return;
    try {
      if (valeur === null) s.removeItem(cle); else s.setItem(cle, valeur);
    } catch (e) { /* mode prive : on continue sans persistance */ }
  }

  class Client {
    constructor() {
      this.jeton = lireStockage(CLE_JETON);
      // Par defaut on parle au serveur qui a servi la page ; un appareil appaire
      // peut viser explicitement l'adresse du Mac sur le reseau local.
      this.base = lireStockage(CLE_SERVEUR) || '';
      this.socket = null;
      this.connecte = false;
      this.tentatives = 0;
      this.ecouteurs = new Map();
      this.nomAppareil = this._devinerNomAppareil();
      this.plateforme = this._devinerPlateforme();
      this._fermetureVoulue = false;
    }

    // --- Evenements --------------------------------------------------------
    sur(type, rappel) {
      if (!this.ecouteurs.has(type)) this.ecouteurs.set(type, new Set());
      this.ecouteurs.get(type).add(rappel);
      return () => this.ecouteurs.get(type).delete(rappel);
    }

    _emettre(type, donnees) {
      const groupe = this.ecouteurs.get(type);
      if (groupe) groupe.forEach((rappel) => {
        try { rappel(donnees); } catch (e) { console.error('[client]', e); }
      });
      const tous = this.ecouteurs.get('*');
      if (tous) tous.forEach((rappel) => rappel({ type, donnees }));
    }

    // --- Identification de l'appareil --------------------------------------
    _devinerPlateforme() {
      const ua = (global.navigator && navigator.userAgent) || '';
      if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ipados';
      if (/iPhone|iPod/i.test(ua)) return 'ios';
      if (/Android/i.test(ua)) return 'android';
      if (/Electron/i.test(ua)) return 'macos-application';
      if (/Macintosh/i.test(ua)) return 'macos';
      if (/Windows/i.test(ua)) return 'windows';
      return 'inconnue';
    }

    _devinerNomAppareil() {
      const p = this._devinerPlateforme();
      const noms = {
        ios: 'iPhone', ipados: 'iPad', android: 'Telephone Android',
        'macos-application': 'Mac (application)', macos: 'Mac (navigateur)',
        windows: 'PC Windows', inconnue: 'Appareil'
      };
      return noms[p] || 'Appareil';
    }

    definirServeur(adresse) {
      this.base = String(adresse || '').replace(/\/+$/, '');
      ecrireStockage(CLE_SERVEUR, this.base || null);
    }

    definirJeton(jeton) {
      this.jeton = jeton;
      ecrireStockage(CLE_JETON, jeton || null);
    }

    get authentifie() {
      return !!this.jeton;
    }

    // --- API HTTP ----------------------------------------------------------
    async appeler(chemin, options) {
      const opts = options || {};
      const entetes = Object.assign({}, opts.entetes || {});
      if (this.jeton) entetes.Authorization = 'Bearer ' + this.jeton;
      let corps = opts.corps;
      if (corps !== undefined && !(corps instanceof Blob) && typeof corps !== 'string') {
        entetes['Content-Type'] = 'application/json';
        corps = JSON.stringify(corps);
      }
      const reponse = await fetch(this.base + chemin, {
        method: opts.methode || 'GET',
        headers: entetes,
        body: corps
      });
      let donnees = null;
      const type = reponse.headers.get('content-type') || '';
      if (type.includes('application/json')) donnees = await reponse.json();
      if (!reponse.ok) {
        const message = (donnees && donnees.erreur) || 'Erreur ' + reponse.status;
        // Un jeton refuse signifie que l'appareil a ete revoque : on repart a zero.
        if (reponse.status === 401 && this.jeton) this.definirJeton(null);
        throw Object.assign(new Error(message), { statut: reponse.status });
      }
      return donnees;
    }

    creerCompte(courriel, motDePasse) {
      return this.appeler('/api/compte', {
        methode: 'POST',
        corps: { courriel, motDePasse, appareil: this.nomAppareil, plateforme: this.plateforme }
      }).then((r) => { this.definirJeton(r.jeton); return r; });
    }

    seConnecter(courriel, motDePasse) {
      return this.appeler('/api/connexion', {
        methode: 'POST',
        corps: { courriel, motDePasse, appareil: this.nomAppareil, plateforme: this.plateforme }
      }).then((r) => { this.definirJeton(r.jeton); return r; });
    }

    rejoindreParCode(code) {
      return this.appeler('/api/appairage/rejoindre', {
        methode: 'POST',
        corps: { code, appareil: this.nomAppareil, plateforme: this.plateforme }
      }).then((r) => { this.definirJeton(r.jeton); return r; });
    }

    creerAppairage() { return this.appeler('/api/appairage', { methode: 'POST' }); }
    etat() { return this.appeler('/api/etat'); }
    reglages() { return this.appeler('/api/reglages'); }
    enregistrerReglages(reglages) {
      return this.appeler('/api/reglages', { methode: 'PUT', corps: reglages });
    }
    appareils() { return this.appeler('/api/appareils'); }
    revoquerAppareil(reference) {
      return this.appeler('/api/appareils/' + encodeURIComponent(reference), { methode: 'DELETE' });
    }
    viderHistorique() { return this.appeler('/api/historique', { methode: 'DELETE' }); }
    salutation(forcer) {
      return this.appeler('/api/salutation', { methode: 'POST', corps: { forcer: !!forcer } });
    }
    dire(texte) {
      return this.appeler('/api/dire', { methode: 'POST', corps: { texte } });
    }
    transcrire(blob) {
      return this.appeler('/api/transcrire', {
        methode: 'POST',
        corps: blob,
        entetes: { 'Content-Type': blob.type || 'audio/webm' }
      });
    }

    // --- WebSocket ---------------------------------------------------------
    connecter() {
      if (!this.jeton || this.socket) return;
      this._fermetureVoulue = false;
      const base = this.base || (global.location ? global.location.origin : '');
      const url = base.replace(/^http/, 'ws') + '/ws';
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (e) {
        this._planifierReconnexion();
        return;
      }
      this.socket = socket;

      socket.onopen = () => {
        this.tentatives = 0;
        socket.send(JSON.stringify({
          type: 'authentifier',
          jeton: this.jeton,
          appareil: this.nomAppareil
        }));
      };

      socket.onmessage = (evenement) => {
        let message;
        try { message = JSON.parse(evenement.data); } catch (e) { return; }
        if (message.type === 'pret') {
          this.connecte = true;
          this._emettre('connexion', message);
        }
        this._emettre(message.type, message);
      };

      socket.onclose = (evenement) => {
        this.connecte = false;
        this.socket = null;
        this._emettre('deconnexion', { code: evenement.code });
        // 4401 : jeton refuse, inutile d'insister.
        if (evenement.code === 4401) {
          this.definirJeton(null);
          this._emettre('jetonInvalide', {});
          return;
        }
        if (!this._fermetureVoulue) this._planifierReconnexion();
      };

      socket.onerror = () => { /* onclose prend le relais */ };
    }

    // Reconnexion avec attente croissante, plafonnee a 15 secondes.
    _planifierReconnexion() {
      if (this._minuterie) return;
      this.tentatives++;
      const attente = Math.min(15000, 800 * Math.pow(1.7, Math.min(this.tentatives, 8)));
      this._minuterie = setTimeout(() => {
        this._minuterie = null;
        this.connecter();
      }, attente);
      this._emettre('reconnexionPrevue', { attente, tentatives: this.tentatives });
    }

    deconnecter() {
      this._fermetureVoulue = true;
      if (this._minuterie) { clearTimeout(this._minuterie); this._minuterie = null; }
      if (this.socket) {
        try { this.socket.close(1000, 'Fermeture demandee'); } catch (e) { /* deja fermee */ }
        this.socket = null;
      }
      this.connecte = false;
    }

    envoyer(message) {
      if (!this.socket || this.socket.readyState !== 1) return false;
      this.socket.send(JSON.stringify(message));
      return true;
    }

    // Raccourcis de diffusion, utilises par l'interface et la pastille.
    diffuserNiveau(valeur) { return this.envoyer({ type: 'niveau', valeur }); }
    diffuserParole(etat, texte) { return this.envoyer({ type: 'parole', etat, texte }); }
    diffuserEcoute(actif) { return this.envoyer({ type: 'ecoute', actif }); }

    seDeconnecterDuCompte() {
      this.deconnecter();
      this.definirJeton(null);
    }
  }

  global.ClientJarvis = Client;
})(typeof window !== 'undefined' ? window : globalThis);
