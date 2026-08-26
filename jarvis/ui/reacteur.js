'use strict';
// Reacteur arc : la pastille bleue qui signale que JARVIS tourne. Elle respire au
// repos et oscille a chaque parole. Dessin en canvas 2D, sans aucune dependance,
// utilise a la fois dans l'interface principale et dans la pastille en surimpression.

(function (global) {
  const TAU = Math.PI * 2;

  // Palettes par etat. Chaque etat change la teinte sans changer le dessin.
  const PALETTES = {
    repos:      { vif: '#38bdf8', clair: '#bae6fd', sombre: '#0c4a6e', halo: '56, 189, 248' },
    ecoute:     { vif: '#22d3ee', clair: '#cffafe', sombre: '#155e75', halo: '34, 211, 238' },
    parole:     { vif: '#60a5fa', clair: '#dbeafe', sombre: '#1e3a8a', halo: '96, 165, 250' },
    reflexion:  { vif: '#818cf8', clair: '#e0e7ff', sombre: '#312e81', halo: '129, 140, 248' },
    horsLigne:  { vif: '#64748b', clair: '#cbd5e1', sombre: '#1e293b', halo: '100, 116, 139' }
  };

  const NOMBRE_BOBINES = 10;
  const TAILLE_HISTORIQUE = 72;

  class Reacteur {
    constructor(canvas, options) {
      const opts = options || {};
      this.canvas = canvas;
      this.contexte = canvas.getContext('2d');
      this.etat = 'repos';
      this.palette = PALETTES.repos;

      // Niveau vise (0 a 1) et niveau affiche, lisse pour eviter les a-coups.
      this.niveauCible = 0;
      this.niveau = 0;
      // Montee rapide, descente plus lente : la voix parait naturelle.
      this.attaque = opts.attaque || 0.35;
      this.relachement = opts.relachement || 0.08;

      this.angle = 0;
      this.temps = 0;
      this.opaciteRepos = opts.opaciteRepos !== undefined ? opts.opaciteRepos : 1;
      this.compact = !!opts.compact; // pastille miniature : dessin allege

      // Historique des amplitudes, dessine en couronne autour du coeur.
      this.historique = new Array(TAILLE_HISTORIQUE).fill(0);
      this.curseur = 0;

      this.anime = false;
      this._boucle = this._boucle.bind(this);
      this.redimensionner();
    }

    redimensionner() {
      const densite = global.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      const largeur = Math.max(1, Math.round((rect.width || this.canvas.width) * densite));
      const hauteur = Math.max(1, Math.round((rect.height || this.canvas.height) * densite));
      if (this.canvas.width !== largeur || this.canvas.height !== hauteur) {
        this.canvas.width = largeur;
        this.canvas.height = hauteur;
      }
      this.densite = densite;
    }

    definirNiveau(valeur) {
      const v = Number(valeur);
      this.niveauCible = isNaN(v) ? 0 : Math.max(0, Math.min(1, v));
    }

    definirEtat(etat) {
      const cle = PALETTES[etat] ? etat : 'repos';
      this.etat = cle;
      this.palette = PALETTES[cle];
      if (cle !== 'parole') this.niveauCible = 0;
    }

    demarrer() {
      if (this.anime) return;
      this.anime = true;
      this.dernierTemps = 0;
      global.requestAnimationFrame(this._boucle);
    }

    arreter() {
      this.anime = false;
    }

    _boucle(horodatage) {
      if (!this.anime) return;
      const delta = this.dernierTemps ? Math.min(64, horodatage - this.dernierTemps) : 16;
      this.dernierTemps = horodatage;
      this.temps += delta;

      // Lissage exponentiel du niveau.
      const facteur = this.niveauCible > this.niveau ? this.attaque : this.relachement;
      this.niveau += (this.niveauCible - this.niveau) * facteur;
      if (this.niveau < 0.001) this.niveau = 0;

      this.historique[this.curseur] = this.niveau;
      this.curseur = (this.curseur + 1) % TAILLE_HISTORIQUE;

      // Rotation plus vive quand JARVIS parle.
      const vitesse = this.etat === 'parole' ? 0.00042 : this.etat === 'ecoute' ? 0.00030 : 0.00016;
      this.angle = (this.angle + delta * vitesse * (1 + this.niveau * 1.4)) % TAU;

      this._dessiner();
      global.requestAnimationFrame(this._boucle);
    }

    _dessiner() {
      const ctx = this.contexte;
      const l = this.canvas.width;
      const h = this.canvas.height;
      const cx = l / 2;
      const cy = h / 2;
      const rayon = Math.min(l, h) / 2;
      const p = this.palette;

      ctx.clearRect(0, 0, l, h);
      ctx.save();
      ctx.translate(cx, cy);

      // Respiration lente au repos, pulsation vive a la parole.
      const respiration = 0.5 + 0.5 * Math.sin(this.temps / 1400);
      const pulsation = this.etat === 'parole'
        ? this.niveau
        : this.etat === 'ecoute'
          ? 0.18 + respiration * 0.22
          : respiration * 0.12;

      const opacite = this.etat === 'repos' ? this.opaciteRepos : 1;
      ctx.globalAlpha = opacite;

      this._halo(ctx, rayon, pulsation, p);
      if (!this.compact) this._anneauExterieur(ctx, rayon, p);
      this._bobines(ctx, rayon, pulsation, p);
      this._couronneAmplitude(ctx, rayon, p);
      this._coeur(ctx, rayon, pulsation, p);
      if (this.etat === 'ecoute') this._arcEcoute(ctx, rayon, p);
      if (this.etat === 'reflexion') this._arcReflexion(ctx, rayon, p);
      if (this.etat === 'horsLigne') this._barreHorsLigne(ctx, rayon, p);

      ctx.restore();
    }

    // Halo diffus : donne l'impression de lumiere emise plutot que dessinee.
    _halo(ctx, rayon, pulsation, p) {
      const portee = rayon * (0.82 + pulsation * 0.18);
      const degrade = ctx.createRadialGradient(0, 0, rayon * 0.05, 0, 0, portee);
      degrade.addColorStop(0, 'rgba(' + p.halo + ',' + (0.42 + pulsation * 0.34) + ')');
      degrade.addColorStop(0.45, 'rgba(' + p.halo + ',' + (0.14 + pulsation * 0.16) + ')');
      degrade.addColorStop(1, 'rgba(' + p.halo + ',0)');
      ctx.fillStyle = degrade;
      ctx.beginPath();
      ctx.arc(0, 0, portee, 0, TAU);
      ctx.fill();
    }

    _anneauExterieur(ctx, rayon, p) {
      ctx.save();
      ctx.rotate(-this.angle * 0.45);
      ctx.strokeStyle = 'rgba(' + p.halo + ',0.35)';
      ctx.lineWidth = Math.max(1, rayon * 0.018);
      ctx.beginPath();
      ctx.arc(0, 0, rayon * 0.93, 0, TAU);
      ctx.stroke();

      // Graduations facon instrument de bord.
      ctx.strokeStyle = 'rgba(' + p.halo + ',0.55)';
      ctx.lineWidth = Math.max(1, rayon * 0.014);
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * TAU;
        const longueur = i % 9 === 0 ? rayon * 0.10 : rayon * 0.05;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * rayon * 0.93, Math.sin(a) * rayon * 0.93);
        ctx.lineTo(Math.cos(a) * (rayon * 0.93 - longueur), Math.sin(a) * (rayon * 0.93 - longueur));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Les bobines trapezoidales caracteristiques du reacteur.
    _bobines(ctx, rayon, pulsation, p) {
      const interieur = rayon * 0.44;
      const exterieur = rayon * 0.76;
      ctx.save();
      ctx.rotate(this.angle);
      for (let i = 0; i < NOMBRE_BOBINES; i++) {
        const a = (i / NOMBRE_BOBINES) * TAU;
        // Chaque bobine s'illumine a son tour, plus vite quand la voix monte.
        const phase = Math.sin(this.temps / 520 - i * 0.62);
        const intensite = 0.32 + Math.max(0, phase) * (0.30 + pulsation * 0.38);

        const demiInterieur = (TAU / NOMBRE_BOBINES) * 0.30;
        const demiExterieur = (TAU / NOMBRE_BOBINES) * 0.40;

        ctx.beginPath();
        ctx.moveTo(Math.cos(a - demiInterieur) * interieur, Math.sin(a - demiInterieur) * interieur);
        ctx.lineTo(Math.cos(a - demiExterieur) * exterieur, Math.sin(a - demiExterieur) * exterieur);
        ctx.lineTo(Math.cos(a + demiExterieur) * exterieur, Math.sin(a + demiExterieur) * exterieur);
        ctx.lineTo(Math.cos(a + demiInterieur) * interieur, Math.sin(a + demiInterieur) * interieur);
        ctx.closePath();

        const degrade = ctx.createLinearGradient(
          Math.cos(a) * interieur, Math.sin(a) * interieur,
          Math.cos(a) * exterieur, Math.sin(a) * exterieur
        );
        degrade.addColorStop(0, 'rgba(' + p.halo + ',' + intensite + ')');
        degrade.addColorStop(1, 'rgba(' + p.halo + ',' + (intensite * 0.22) + ')');
        ctx.fillStyle = degrade;
        ctx.fill();

        ctx.strokeStyle = 'rgba(' + p.halo + ',' + (intensite * 0.75) + ')';
        ctx.lineWidth = Math.max(0.5, rayon * 0.008);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Couronne d'amplitude : trace de la voix des dernieres secondes.
    _couronneAmplitude(ctx, rayon, p) {
      const base = rayon * 0.40;
      ctx.save();
      ctx.rotate(-this.angle * 0.8);
      ctx.strokeStyle = 'rgba(' + p.halo + ',0.85)';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, rayon * 0.022);
      for (let i = 0; i < TAILLE_HISTORIQUE; i++) {
        const indice = (this.curseur + i) % TAILLE_HISTORIQUE;
        const valeur = this.historique[indice];
        if (valeur < 0.02) continue;
        const a = (i / TAILLE_HISTORIQUE) * TAU;
        // Les echantillons anciens s'estompent.
        const fraicheur = i / TAILLE_HISTORIQUE;
        ctx.globalAlpha = 0.20 + fraicheur * 0.75;
        const longueur = rayon * 0.30 * valeur;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * base, Math.sin(a) * base);
        ctx.lineTo(Math.cos(a) * (base - longueur), Math.sin(a) * (base - longueur));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    _coeur(ctx, rayon, pulsation, p) {
      const rayonCoeur = rayon * (0.20 + pulsation * 0.12);

      const degrade = ctx.createRadialGradient(0, 0, 0, 0, 0, rayonCoeur * 1.9);
      degrade.addColorStop(0, '#ffffff');
      degrade.addColorStop(0.32, p.clair);
      degrade.addColorStop(0.68, p.vif);
      degrade.addColorStop(1, 'rgba(' + p.halo + ',0)');
      ctx.fillStyle = degrade;
      ctx.beginPath();
      ctx.arc(0, 0, rayonCoeur * 1.9, 0, TAU);
      ctx.fill();

      // Triangle interne, clin d'oeil au reacteur d'origine.
      if (!this.compact) {
        ctx.save();
        ctx.rotate(-this.angle * 1.6);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + pulsation * 0.45) + ')';
        ctx.lineWidth = Math.max(1, rayon * 0.012);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU - Math.PI / 2;
          const x = Math.cos(a) * rayonCoeur * 0.72;
          const y = Math.sin(a) * rayonCoeur * 0.72;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = 'rgba(255,255,255,' + (0.85 + pulsation * 0.15) + ')';
      ctx.beginPath();
      ctx.arc(0, 0, rayonCoeur * 0.34, 0, TAU);
      ctx.fill();
    }

    // Arc tournant, signale que le micro est ouvert.
    _arcEcoute(ctx, rayon, p) {
      ctx.save();
      ctx.rotate(this.angle * 2.4);
      ctx.strokeStyle = 'rgba(' + p.halo + ',0.9)';
      ctx.lineWidth = Math.max(1.5, rayon * 0.035);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, rayon * 0.86, 0, Math.PI * 0.42);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, rayon * 0.86, Math.PI, Math.PI * 1.42);
      ctx.stroke();
      ctx.restore();
    }

    // Trois points orbitaux pendant le traitement d'une demande.
    _arcReflexion(ctx, rayon, p) {
      ctx.save();
      ctx.rotate(this.angle * 3);
      ctx.fillStyle = 'rgba(' + p.halo + ',0.95)';
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rayon * 0.86, Math.sin(a) * rayon * 0.86, rayon * 0.045, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // Barre oblique quand la liaison avec le serveur est perdue.
    _barreHorsLigne(ctx, rayon, p) {
      ctx.save();
      ctx.strokeStyle = 'rgba(' + p.halo + ',0.8)';
      ctx.lineWidth = Math.max(1.5, rayon * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-rayon * 0.44, -rayon * 0.44);
      ctx.lineTo(rayon * 0.44, rayon * 0.44);
      ctx.stroke();
      ctx.restore();
    }
  }

  global.Reacteur = Reacteur;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Reacteur };
})(typeof window !== 'undefined' ? window : globalThis);
