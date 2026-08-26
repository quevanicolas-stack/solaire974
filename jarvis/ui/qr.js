'use strict';
// Encodeur de code QR autonome, en mode octet, niveau de correction M, versions 1 a 10.
// Sert a l'appairage : le telephone scanne l'adresse du Mac et le code, sans rien saisir.
// Ecrit ici plutot qu'importe pour que l'application reste sans dependance reseau.

(function (global) {
  // Nombre total de mots de code par version.
  const TOTAL_MOTS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  // Niveau M : [mots de correction par bloc, [nombre de blocs, mots de donnees par bloc], ...]
  const BLOCS_M = [
    null,
    [10, [[1, 16]]],
    [16, [[1, 28]]],
    [26, [[1, 44]]],
    [18, [[2, 32]]],
    [24, [[2, 43]]],
    [16, [[4, 27]]],
    [18, [[4, 31]]],
    [22, [[2, 38], [2, 39]]],
    [22, [[3, 36], [2, 37]]],
    [26, [[4, 43], [1, 44]]]
  ];
  // Centres des motifs d'alignement par version.
  const ALIGNEMENTS = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  // --- Arithmetique dans le corps de Galois GF(256) -----------------------
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initialiserGalois() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d; // polynome generateur du corps
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function multiplier(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // Polynome generateur de Reed-Solomon pour n mots de correction : produit des
  // (x - alpha^i). Les coefficients sont ranges du degre le plus eleve au plus bas,
  // ce qu'attend la division synthetique ci-dessous.
  function polynomeGenerateur(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const suivant = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        suivant[j] ^= g[j];                          // decalage d'un degre
        suivant[j + 1] ^= multiplier(g[j], EXP[i]);  // terme constant
      }
      g = suivant;
    }
    return g;
  }

  function motsCorrection(donnees, nombre) {
    const generateur = polynomeGenerateur(nombre);
    const reste = new Array(donnees.length + nombre).fill(0);
    for (let i = 0; i < donnees.length; i++) reste[i] = donnees[i];
    for (let i = 0; i < donnees.length; i++) {
      const facteur = reste[i];
      if (facteur === 0) continue;
      for (let j = 0; j < generateur.length; j++) {
        reste[i + j] ^= multiplier(generateur[j], facteur);
      }
    }
    return reste.slice(donnees.length);
  }

  // --- Encodage des donnees -----------------------------------------------
  function encoderTexte(texte) {
    // UTF-8 : les adresses peuvent contenir des caracteres accentues.
    if (global.TextEncoder) return Array.from(new TextEncoder().encode(texte));
    return Array.from(unescape(encodeURIComponent(texte))).map((c) => c.charCodeAt(0));
  }

  function capaciteDonnees(version) {
    const [ec, groupes] = BLOCS_M[version];
    let total = 0;
    for (const [nombre, mots] of groupes) total += nombre * mots;
    return total;
  }

  function choisirVersion(longueurOctets) {
    for (let v = 1; v <= 10; v++) {
      const enTete = 4 + (v < 10 ? 8 : 16);
      if (capaciteDonnees(v) * 8 >= enTete + longueurOctets * 8) return v;
    }
    throw new Error('Contenu trop long pour un code QR de version 10.');
  }

  function construireDonnees(octets, version) {
    const bits = [];
    const ajouter = (valeur, longueur) => {
      for (let i = longueur - 1; i >= 0; i--) bits.push((valeur >> i) & 1);
    };
    ajouter(0b0100, 4); // mode octet
    ajouter(octets.length, version < 10 ? 8 : 16);
    for (const octet of octets) ajouter(octet, 8);

    const capacite = capaciteDonnees(version) * 8;
    // Terminateur, puis alignement sur un multiple de 8 bits.
    for (let i = 0; i < 4 && bits.length < capacite; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const mots = [];
    for (let i = 0; i < bits.length; i += 8) {
      let octet = 0;
      for (let j = 0; j < 8; j++) octet = (octet << 1) | bits[i + j];
      mots.push(octet);
    }
    // Remplissage alterne impose par la norme.
    const remplissage = [0xec, 0x11];
    let indice = 0;
    while (mots.length < capaciteDonnees(version)) {
      mots.push(remplissage[indice++ % 2]);
    }
    return mots;
  }

  // Entrelacement des blocs de donnees et de correction.
  function entrelacer(mots, version) {
    const [nombreEc, groupes] = BLOCS_M[version];
    const blocsDonnees = [];
    const blocsCorrection = [];
    let position = 0;
    for (const [nombre, taille] of groupes) {
      for (let i = 0; i < nombre; i++) {
        const bloc = mots.slice(position, position + taille);
        position += taille;
        blocsDonnees.push(bloc);
        blocsCorrection.push(motsCorrection(bloc, nombreEc));
      }
    }
    const sortie = [];
    const maxDonnees = Math.max(...blocsDonnees.map((b) => b.length));
    for (let i = 0; i < maxDonnees; i++) {
      for (const bloc of blocsDonnees) if (i < bloc.length) sortie.push(bloc[i]);
    }
    for (let i = 0; i < nombreEc; i++) {
      for (const bloc of blocsCorrection) sortie.push(bloc[i]);
    }
    return sortie;
  }

  // --- Construction de la matrice -----------------------------------------
  function creerMatrice(version) {
    const taille = version * 4 + 17;
    const modules = [];
    const reserve = [];
    for (let i = 0; i < taille; i++) {
      modules.push(new Array(taille).fill(0));
      reserve.push(new Array(taille).fill(false));
    }

    const poserMotifDetection = (ligne, colonne) => {
      for (let dl = -1; dl <= 7; dl++) {
        for (let dc = -1; dc <= 7; dc++) {
          const l = ligne + dl;
          const c = colonne + dc;
          if (l < 0 || l >= taille || c < 0 || c >= taille) continue;
          const dansCarre = (dl >= 0 && dl <= 6 && (dc === 0 || dc === 6))
            || (dc >= 0 && dc <= 6 && (dl === 0 || dl === 6))
            || (dl >= 2 && dl <= 4 && dc >= 2 && dc <= 4);
          modules[l][c] = dansCarre ? 1 : 0;
          reserve[l][c] = true;
        }
      }
    };
    poserMotifDetection(0, 0);
    poserMotifDetection(0, taille - 7);
    poserMotifDetection(taille - 7, 0);

    // Motifs de synchronisation.
    for (let i = 8; i < taille - 8; i++) {
      const valeur = i % 2 === 0 ? 1 : 0;
      modules[6][i] = valeur; reserve[6][i] = true;
      modules[i][6] = valeur; reserve[i][6] = true;
    }

    // Motifs d'alignement.
    const centres = ALIGNEMENTS[version];
    for (const ligne of centres) {
      for (const colonne of centres) {
        // Ils ne recouvrent jamais les motifs de detection.
        if ((ligne <= 8 && colonne <= 8)
          || (ligne <= 8 && colonne >= taille - 9)
          || (ligne >= taille - 9 && colonne <= 8)) continue;
        for (let dl = -2; dl <= 2; dl++) {
          for (let dc = -2; dc <= 2; dc++) {
            const bord = Math.max(Math.abs(dl), Math.abs(dc));
            modules[ligne + dl][colonne + dc] = (bord === 1) ? 0 : 1;
            reserve[ligne + dl][colonne + dc] = true;
          }
        }
      }
    }

    // Module toujours sombre.
    modules[taille - 8][8] = 1;
    reserve[taille - 8][8] = true;

    // Zones reservees a l'information de format.
    for (let i = 0; i < 9; i++) {
      if (!reserve[8][i]) { reserve[8][i] = true; modules[8][i] = 0; }
      if (!reserve[i][8]) { reserve[i][8] = true; modules[i][8] = 0; }
    }
    for (let i = 0; i < 8; i++) {
      reserve[8][taille - 1 - i] = true;
      reserve[taille - 1 - i][8] = true;
    }

    // Zones reservees a l'information de version, a partir de la version 7.
    if (version >= 7) {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          reserve[i][taille - 11 + j] = true;
          reserve[taille - 11 + j][i] = true;
        }
      }
    }

    return { modules, reserve, taille };
  }

  // Parcours en zigzag depuis le coin inferieur droit.
  function placerDonnees(matrice, mots) {
    const { modules, reserve, taille } = matrice;
    const bits = [];
    for (const mot of mots) {
      for (let i = 7; i >= 0; i--) bits.push((mot >> i) & 1);
    }
    let indice = 0;
    let montant = true;
    for (let colonne = taille - 1; colonne > 0; colonne -= 2) {
      if (colonne === 6) colonne--; // la colonne de synchronisation est ignoree
      for (let pas = 0; pas < taille; pas++) {
        const ligne = montant ? taille - 1 - pas : pas;
        for (let decalage = 0; decalage < 2; decalage++) {
          const c = colonne - decalage;
          if (reserve[ligne][c]) continue;
          modules[ligne][c] = indice < bits.length ? bits[indice] : 0;
          indice++;
        }
      }
      montant = !montant;
    }
  }

  const MASQUES = [
    (l, c) => (l + c) % 2 === 0,
    (l) => l % 2 === 0,
    (l, c) => c % 3 === 0,
    (l, c) => (l + c) % 3 === 0,
    (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0,
    (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
    (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0,
    (l, c) => (((l + c) % 2) + ((l * c) % 3)) % 2 === 0
  ];

  function appliquerMasque(matrice, numero) {
    const { modules, reserve, taille } = matrice;
    const copie = modules.map((ligne) => ligne.slice());
    for (let l = 0; l < taille; l++) {
      for (let c = 0; c < taille; c++) {
        if (reserve[l][c]) continue;
        if (MASQUES[numero](l, c)) copie[l][c] ^= 1;
      }
    }
    return copie;
  }

  // Penalites definies par la norme : on retient le masque le moins penalise.
  function penalite(modules) {
    const taille = modules.length;
    let score = 0;

    // Regle 1 : suites de cinq modules identiques ou plus.
    for (let l = 0; l < taille; l++) {
      for (const sens of ['ligne', 'colonne']) {
        let precedent = -1;
        let compte = 0;
        for (let c = 0; c < taille; c++) {
          const valeur = sens === 'ligne' ? modules[l][c] : modules[c][l];
          if (valeur === precedent) {
            compte++;
          } else {
            if (compte >= 5) score += compte - 2;
            precedent = valeur;
            compte = 1;
          }
        }
        if (compte >= 5) score += compte - 2;
      }
    }

    // Regle 2 : blocs de deux par deux de meme couleur.
    for (let l = 0; l < taille - 1; l++) {
      for (let c = 0; c < taille - 1; c++) {
        const v = modules[l][c];
        if (v === modules[l][c + 1] && v === modules[l + 1][c] && v === modules[l + 1][c + 1]) {
          score += 3;
        }
      }
    }

    // Regle 3 : motifs ressemblant aux reperes de detection.
    const motifA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const motifB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const correspond = (obtenir, depart, motif) => {
      for (let i = 0; i < motif.length; i++) {
        if (obtenir(depart + i) !== motif[i]) return false;
      }
      return true;
    };
    for (let l = 0; l < taille; l++) {
      for (let c = 0; c <= taille - 11; c++) {
        const ligne = (i) => modules[l][i];
        const colonne = (i) => modules[i][l];
        if (correspond(ligne, c, motifA) || correspond(ligne, c, motifB)) score += 40;
        if (correspond(colonne, c, motifA) || correspond(colonne, c, motifB)) score += 40;
      }
    }

    // Regle 4 : desequilibre entre modules clairs et sombres.
    let sombres = 0;
    for (let l = 0; l < taille; l++) {
      for (let c = 0; c < taille; c++) sombres += modules[l][c];
    }
    const proportion = (sombres * 100) / (taille * taille);
    score += Math.floor(Math.abs(proportion - 50) / 5) * 10;

    return score;
  }

  function poserFormat(modules, numeroMasque) {
    const taille = modules.length;
    // Niveau M = 00, suivi des trois bits du masque, puis 10 bits de correction BCH.
    const donnees = (0b00 << 3) | numeroMasque;
    let reste = donnees;
    for (let i = 0; i < 10; i++) {
      reste = (reste << 1) ^ ((reste >>> 9) * 0x537);
    }
    const format = (((donnees << 10) | (reste & 0x3ff)) ^ 0x5412);
    const bit = (i) => (format >> i) & 1;

    // Premiere copie, en L autour du repere superieur gauche.
    for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
    modules[7][8] = bit(6);
    modules[8][8] = bit(7);
    modules[8][7] = bit(8);
    for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);

    // Seconde copie, repartie sous le repere superieur droit et a droite du repere
    // inferieur gauche : elle permet la lecture meme si un coin est abime.
    for (let i = 0; i < 8; i++) modules[8][taille - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) modules[taille - 15 + i][8] = bit(i);

    // Module toujours sombre, impose par la norme.
    modules[taille - 8][8] = 1;
  }

  function poserVersion(modules, version) {
    if (version < 7) return;
    const taille = modules.length;
    let reste = version << 12;
    for (let i = 5; i >= 0; i--) {
      if (reste & (1 << (i + 12))) reste ^= 0b1111100100101 << i;
    }
    const information = (version << 12) | reste;
    for (let i = 0; i < 18; i++) {
      const bit = (information >> i) & 1;
      const ligne = Math.floor(i / 3);
      const colonne = i % 3;
      modules[ligne][taille - 11 + colonne] = bit;
      modules[taille - 11 + colonne][ligne] = bit;
    }
  }

  // Renvoie la matrice de modules (1 = sombre) pour le texte donne.
  function encoder(texte) {
    const octets = encoderTexte(String(texte));
    const version = choisirVersion(octets.length);
    const mots = entrelacer(construireDonnees(octets, version), version);
    const matrice = creerMatrice(version);
    placerDonnees(matrice, mots);

    let meilleur = null;
    for (let numero = 0; numero < 8; numero++) {
      const candidat = appliquerMasque(matrice, numero);
      poserFormat(candidat, numero);
      poserVersion(candidat, version);
      const score = penalite(candidat);
      if (!meilleur || score < meilleur.score) meilleur = { modules: candidat, score, numero };
    }
    return { modules: meilleur.modules, version, masque: meilleur.numero, taille: meilleur.modules.length };
  }

  // Dessine le code dans un canvas, avec la marge blanche exigee par la norme.
  function dessiner(canvas, texte, options) {
    const opts = options || {};
    const resultat = encoder(texte);
    const marge = opts.marge !== undefined ? opts.marge : 4;
    const modules = resultat.taille + marge * 2;
    const densite = global.devicePixelRatio || 1;
    const cotePixels = (opts.taille || 220);
    const echelle = Math.max(1, Math.floor((cotePixels * densite) / modules));
    const cote = modules * echelle;

    canvas.width = cote;
    canvas.height = cote;
    canvas.style.width = Math.round(cote / densite) + 'px';
    canvas.style.height = Math.round(cote / densite) + 'px';

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.fond || '#ffffff';
    ctx.fillRect(0, 0, cote, cote);
    ctx.fillStyle = opts.encre || '#001019';
    for (let l = 0; l < resultat.taille; l++) {
      for (let c = 0; c < resultat.taille; c++) {
        if (resultat.modules[l][c]) {
          ctx.fillRect((c + marge) * echelle, (l + marge) * echelle, echelle, echelle);
        }
      }
    }
    return resultat;
  }

  global.CodeQR = { encoder, dessiner };
  if (typeof module !== 'undefined' && module.exports) module.exports = { encoder, dessiner };
})(typeof window !== 'undefined' ? window : globalThis);
