'use strict';
// Voix de JARVIS : synthese vocale, reconnaissance vocale et mesure du niveau sonore.
// Le niveau alimente le reacteur : a l'ecoute il vient du microphone, a la parole il
// est reconstruit a partir des mots prononces (la synthese du navigateur n'expose
// aucun signal audio analysable).

(function (global) {
  const SynthRecon = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  class Voix {
    constructor(options) {
      const opts = options || {};
      this.synthese = global.speechSynthesis || null;
      this.langue = opts.langue || 'fr-FR';
      this.nomVoix = opts.nomVoix || '';
      this.debit = opts.debit || 1;
      this.hauteur = opts.hauteur || 1;
      this.volume = opts.volume !== undefined ? opts.volume : 1;

      // Rappels fournis par l'application.
      this.surNiveau = opts.surNiveau || function () {};
      this.surEtat = opts.surEtat || function () {};
      this.surTexte = opts.surTexte || function () {};
      this.surTexteProvisoire = opts.surTexteProvisoire || function () {};
      this.surErreur = opts.surErreur || function () {};

      this.enParole = false;
      this.enEcoute = false;
      this.audioDebloque = false;
      this.fileAttente = [];

      this._voixDisponibles = [];
      this._chargerVoix();
      if (this.synthese && typeof this.synthese.addEventListener === 'function') {
        this.synthese.addEventListener('voiceschanged', () => this._chargerVoix());
      }

      this._preparerReconnaissance();
    }

    // --- Synthese ---------------------------------------------------------
    _chargerVoix() {
      if (!this.synthese) return;
      this._voixDisponibles = this.synthese.getVoices() || [];
    }

    listerVoix() {
      this._chargerVoix();
      return this._voixDisponibles
        .filter((v) => v.lang && v.lang.toLowerCase().startsWith('fr'))
        .map((v) => ({ nom: v.name, langue: v.lang, locale: v.localService }));
    }

    _choisirVoix() {
      if (!this._voixDisponibles.length) this._chargerVoix();
      const francaises = this._voixDisponibles.filter((v) => v.lang && v.lang.toLowerCase().startsWith('fr'));
      if (this.nomVoix) {
        const exacte = this._voixDisponibles.find((v) => v.name === this.nomVoix);
        if (exacte) return exacte;
      }
      // A defaut de choix explicite, on privilegie une voix francaise locale.
      return francaises.find((v) => v.localService) || francaises[0] || this._voixDisponibles[0] || null;
    }

    // Sur mobile, la synthese ne demarre qu'apres une interaction. On profite du
    // premier geste de l'utilisateur pour prononcer un enonce vide et lever le verrou.
    debloquerAudio() {
      if (this.audioDebloque || !this.synthese) return;
      try {
        const silence = new SpeechSynthesisUtterance(' ');
        silence.volume = 0;
        this.synthese.speak(silence);
        this.audioDebloque = true;
      } catch (e) {
        // Sans importance : la premiere phrase reelle debloquera l'audio.
      }
    }

    parler(texte, options) {
      const opts = options || {};
      return new Promise((resolve) => {
        const contenu = String(texte || '').trim();
        if (!contenu) return resolve(false);
        if (!this.synthese) {
          this.surErreur('La synthese vocale n\'est pas disponible sur cet appareil.');
          this.surTexte(contenu);
          return resolve(false);
        }

        // On coupe l'ecoute pendant que JARVIS parle, pour ne pas s'entendre lui-meme.
        const reprendreEcoute = this.enEcoute && !opts.sansReprise;
        if (this.enEcoute) this.arreterEcoute({ silencieux: true });

        const enonce = new SpeechSynthesisUtterance(contenu);
        const voix = this._choisirVoix();
        if (voix) enonce.voice = voix;
        enonce.lang = this.langue;
        enonce.rate = this.debit;
        enonce.pitch = this.hauteur;
        enonce.volume = this.volume;

        const mots = contenu.split(/\s+/).filter(Boolean);
        let indexMot = 0;

        enonce.onstart = () => {
          this.enParole = true;
          this.surEtat('parole');
          this._demarrerEnveloppe(mots);
        };

        // Chaque frontiere de mot relance une bouffee d'amplitude : le reacteur suit
        // le rythme reel de la phrase.
        enonce.onboundary = (evenement) => {
          if (evenement.name && evenement.name !== 'word') return;
          const mot = mots[indexMot] || '';
          indexMot++;
          this._impulsion(mot.length);
        };

        const terminer = () => {
          this.enParole = false;
          this._arreterEnveloppe();
          this.surEtat('repos');
          if (reprendreEcoute) {
            // Court delai : laisse le temps au haut-parleur de se taire.
            setTimeout(() => this.demarrerEcoute(), 350);
          }
          resolve(true);
        };

        enonce.onend = terminer;
        enonce.onerror = (evenement) => {
          const code = evenement && evenement.error;
          // "interrupted" et "canceled" surviennent quand on coupe volontairement.
          // Les autres pannes tiennent a l'appareil (aucune voix installee) : les
          // repeter a chaque phrase n'apporte rien, on ne signale que la premiere.
          if (code && !/interrupted|canceled/.test(code) && !this._erreurSyntheseSignalee) {
            this._erreurSyntheseSignalee = true;
            this.surErreur('Synthese vocale indisponible sur cet appareil (' + code
              + '). Les reponses restent affichees a l\'ecran.');
          }
          terminer();
        };

        this.surTexte(contenu);
        this.synthese.speak(enonce);
        this.audioDebloque = true;
      });
    }

    taire() {
      if (this.synthese) {
        try { this.synthese.cancel(); } catch (e) { /* deja arrete */ }
      }
      this.enParole = false;
      this._arreterEnveloppe();
    }

    // --- Enveloppe d'amplitude simulee -------------------------------------
    // Sinusoide syllabique amortie, relancee a chaque mot : visuellement fidele au
    // debit de parole sans acces au signal audio.
    _demarrerEnveloppe(mots) {
      this._arreterEnveloppe();
      this._energie = 0.55;
      this._phase = 0;
      const debutMoyen = Math.max(1, (mots.join(' ').length / Math.max(1, mots.length)));
      this._enveloppe = setInterval(() => {
        this._phase += 0.42 + Math.min(0.35, debutMoyen / 26);
        // Deux oscillations superposees : une syllabique, une plus lente.
        const syllabe = 0.5 + 0.5 * Math.sin(this._phase);
        const souffle = 0.5 + 0.5 * Math.sin(this._phase * 0.31 + 1.2);
        const bruit = 0.88 + Math.random() * 0.12;
        const valeur = this._energie * (0.45 + syllabe * 0.4 + souffle * 0.15) * bruit;
        this._energie = Math.max(0.16, this._energie * 0.965);
        this.surNiveau(Math.max(0, Math.min(1, valeur)));
      }, 40);
    }

    _impulsion(longueurMot) {
      // Un mot long relance plus d'energie qu'un mot court.
      const apport = 0.5 + Math.min(0.5, (longueurMot || 3) / 12);
      this._energie = Math.min(1, (this._energie || 0.3) * 0.4 + apport);
    }

    _arreterEnveloppe() {
      if (this._enveloppe) {
        clearInterval(this._enveloppe);
        this._enveloppe = null;
      }
      this._energie = 0;
      this.surNiveau(0);
    }

    // --- Reconnaissance vocale ---------------------------------------------
    get reconnaissanceDisponible() {
      return !!SynthRecon;
    }

    _preparerReconnaissance() {
      if (!SynthRecon) return;
      const reconnaissance = new SynthRecon();
      reconnaissance.lang = this.langue;
      reconnaissance.continuous = true;
      reconnaissance.interimResults = true;
      reconnaissance.maxAlternatives = 1;

      reconnaissance.onresult = (evenement) => {
        let provisoire = '';
        for (let i = evenement.resultIndex; i < evenement.results.length; i++) {
          const resultat = evenement.results[i];
          const texte = resultat[0].transcript.trim();
          if (resultat.isFinal) {
            if (texte) this.surTexteEntendu(texte);
          } else {
            provisoire += texte + ' ';
          }
        }
        if (provisoire.trim()) this.surTexteProvisoire(provisoire.trim());
      };

      reconnaissance.onerror = (evenement) => {
        const code = evenement.error;
        if (code === 'no-speech' || code === 'aborted') return;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.enEcoute = false;
          this.surEtat('repos');
          this.surErreur('Acces au microphone refuse. Autorisez-le dans les reglages du systeme.');
          return;
        }
        this.surErreur('Reconnaissance vocale : ' + code);
      };

      // Le navigateur coupe l'ecoute continue au bout d'un moment : on la relance.
      reconnaissance.onend = () => {
        if (this.enEcoute && !this.enParole) {
          try { reconnaissance.start(); } catch (e) { /* deja en cours */ }
        }
      };

      this.reconnaissance = reconnaissance;
    }

    // Remplace par l'application : recoit chaque phrase finale.
    surTexteEntendu(texte) {
      this.surTexte(texte, true);
    }

    async demarrerEcoute() {
      if (this.enEcoute || this.enParole) return false;
      this.enEcoute = true;
      this.surEtat('ecoute');
      await this._demarrerMesureMicro();
      if (this.reconnaissance) {
        try {
          this.reconnaissance.lang = this.langue;
          this.reconnaissance.start();
          return true;
        } catch (e) {
          // Deja demarree : sans consequence.
          return true;
        }
      }
      // Sans reconnaissance native, on enregistre pour transcription locale.
      return this._demarrerEnregistrement();
    }

    arreterEcoute(options) {
      const opts = options || {};
      this.enEcoute = false;
      if (this.reconnaissance) {
        try { this.reconnaissance.stop(); } catch (e) { /* deja arretee */ }
      }
      if (this._enregistreur && this._enregistreur.state === 'recording') {
        this._enregistreur.stop();
      }
      this._arreterMesureMicro();
      if (!opts.silencieux) this.surEtat('repos');
    }

    basculerEcoute() {
      if (this.enEcoute) {
        this.arreterEcoute();
        return false;
      }
      this.demarrerEcoute();
      return true;
    }

    // --- Niveau du microphone ----------------------------------------------
    async _demarrerMesureMicro() {
      if (this._analyseur) return true;
      if (!global.navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
      try {
        this._flux = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ContexteAudio = global.AudioContext || global.webkitAudioContext;
        this._contexteAudio = new ContexteAudio();
        const source = this._contexteAudio.createMediaStreamSource(this._flux);
        this._analyseur = this._contexteAudio.createAnalyser();
        this._analyseur.fftSize = 512;
        this._analyseur.smoothingTimeConstant = 0.65;
        source.connect(this._analyseur);
        this._donneesAudio = new Uint8Array(this._analyseur.frequencyBinCount);
        this._mesurer();
        return true;
      } catch (e) {
        this.surErreur('Microphone inaccessible : ' + (e.message || e.name));
        return false;
      }
    }

    _mesurer() {
      if (!this._analyseur) return;
      this._analyseur.getByteTimeDomainData(this._donneesAudio);
      // Valeur efficace du signal, ramenee sur une echelle exploitable.
      let somme = 0;
      for (let i = 0; i < this._donneesAudio.length; i++) {
        const ecart = (this._donneesAudio[i] - 128) / 128;
        somme += ecart * ecart;
      }
      const efficace = Math.sqrt(somme / this._donneesAudio.length);
      if (!this.enParole) {
        this.surNiveau(Math.max(0, Math.min(1, efficace * 4.2)));
      }
      this._mesureEnCours = global.requestAnimationFrame(() => this._mesurer());
    }

    _arreterMesureMicro() {
      if (this._mesureEnCours) {
        global.cancelAnimationFrame(this._mesureEnCours);
        this._mesureEnCours = null;
      }
      if (this._flux) {
        this._flux.getTracks().forEach((piste) => piste.stop());
        this._flux = null;
      }
      if (this._contexteAudio) {
        try { this._contexteAudio.close(); } catch (e) { /* deja ferme */ }
        this._contexteAudio = null;
      }
      this._analyseur = null;
      if (!this.enParole) this.surNiveau(0);
    }

    // --- Enregistrement pour transcription locale ---------------------------
    async _demarrerEnregistrement() {
      if (!this._flux || !global.MediaRecorder) {
        this.surErreur('Aucun moteur de reconnaissance vocale disponible sur cet appareil.');
        this.enEcoute = false;
        this.surEtat('repos');
        return false;
      }
      const morceaux = [];
      const type = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      this._enregistreur = new MediaRecorder(this._flux, type ? { mimeType: type } : undefined);
      this._enregistreur.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data); };
      this._enregistreur.onstop = async () => {
        const blob = new Blob(morceaux, { type: this._enregistreur.mimeType || 'audio/webm' });
        if (blob.size < 2000) return; // trop court pour contenir de la parole
        if (typeof this.transcrire === 'function') {
          const texte = await this.transcrire(blob);
          if (texte) this.surTexteEntendu(texte);
        }
      };
      this._enregistreur.start();
      return true;
    }

    appliquerReglages(voix) {
      if (!voix) return;
      if (voix.langue) this.langue = voix.langue;
      if (voix.nom !== undefined) this.nomVoix = voix.nom;
      if (voix.debit) this.debit = voix.debit;
      if (voix.hauteur) this.hauteur = voix.hauteur;
      if (voix.volume !== undefined) this.volume = voix.volume;
      if (this.reconnaissance) this.reconnaissance.lang = this.langue;
    }
  }

  global.Voix = Voix;
})(typeof window !== 'undefined' ? window : globalThis);
