/*
 * Banc de mesure du rendu — Studio Voix
 *
 * Pourquoi ce fichier existe.
 *
 * Une relecture de code ne voit pas ce qu'une chaîne de traitement coûte. Le
 * grésillement entendu sous la voix ne venait de l'erreur d'aucune ligne : le
 * compresseur faisait exactement ce qui était écrit, l'égaliseur aussi, la
 * mise au niveau aussi. Le défaut naissait de leur composition — onze
 * décibels de séparation voix / souffle perdus — et rien dans les
 * vérifications ne demandait « combien ça coûte ».
 *
 * Ce banc fait passer un signal connu dans la chaîne complète et chiffre, pour
 * chaque étage, ce qu'il apporte et ce qu'il coûte. Un étage dont l'apport ne
 * se chiffre pas est suspect ; un réglage par défaut dont le chiffre ne se
 * montre pas l'est aussi.
 *
 * Lancement, serveur de test démarré à côté :
 *     python serveur.py --moteur test --chat test
 *     node banc.js                 bulletin complet
 *     node banc.js --signal        contrôle du signal d'essai seul
 *
 * Il rend un code de sortie non nul si un seuil est franchi : il peut donc
 * garder un commit, comme les autres vérifications.
 */

const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT ||
  '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(CHEMIN_PLAYWRIGHT);

const BASE = process.env.BASE || 'http://127.0.0.1:8770';
const SIGNAL_SEUL = process.argv.includes('--signal');

/* --reel <fichier.wav> : mesure une vraie génération non traitée au lieu du
   signal fabriqué. Un signal de synthèse dit ce que la chaîne fait ; un vrai
   fichier dit ce qu'elle fait À VOTRE VOIX. Les deux sont nécessaires : le
   premier est reproductible, le second est vrai. */
const iReel = process.argv.indexOf('--reel');
const FICHIER_REEL = iReel >= 0 ? process.argv[iReel + 1] : null;

/* ══════════════════════════════════════════════════════
   LE SIGNAL D'ESSAI
   ══════════════════════════════════════════════════════

   Trois pièges déjà payés, qui dictent sa forme.

   1. Attaques douces. Coupée net, une voix fabrique des clics que les filtres
      font sonner dans les silences : on mesure alors la traîne des filtres en
      croyant mesurer le souffle. Une mesure faussée ainsi a conclu qu'un
      traitement utile ne servait à rien.

   2. Du signal dans TOUTES les bandes mesurées. Avec des harmoniques
      s'arrêtant à 5 kHz, les bandes hautes ne comparent que du bruit de
      calcul, et le contrôle annonce une dérive inexistante.

   3. Des silences véritables entre les phrases, assez longs pour que le
      souffle s'y mesure seul, et assez longs pour que le compresseur ait fini
      de relâcher (0,25 s de release).

   Le signal porte en plus une enveloppe spectrale connue : une pente de
   -6 dB par octave, celle d'une voix. On peut donc mesurer ce que la chaîne
   fait au timbre, et pas seulement au souffle.  */

const FE = 24000;
const F0 = 190;            // fondamentale, dans la plage d'une voix féminine
const PENTE = -6;          // dB par octave, enveloppe d'une voix
const SOUFFLE = 0.004;     // amplitude du souffle ajouté
const CYCLE = 2.0;         // secondes : une phrase et son silence
const PART_PAROLE = 0.45;  // part du cycle où l'on parle
const MONTEE = 0.08;       // secondes de fondu à l'attaque et à la chute

/* Bandes de mesure. Elles s'arrêtent à 11 kHz : au-dessus, la demi-fréquence
   du moteur (12 kHz) rend toute mesure douteuse. */
const BANDES = [[80,160],[160,300],[300,600],[600,1000],[1000,2000],
                [2000,4000],[4000,6000],[6000,8000],[8000,11000]];
const NOMS_BANDES = ['80-160','160-300','300-600','600-1k','1-2k',
                     '2-4k','4-6k','6-8k','8-11k'];

/* ══════════════════════════════════════════════════════
   BULLETIN
   ══════════════════════════════════════════════════════ */

const alertes = [];
const lignes = [];

function dire(texte) { console.log(texte); }

function titre(t) {
  console.log('\n' + t);
  console.log('─'.repeat(t.length));
}

/* Un constat chiffré. `bon` peut être null : on montre alors le chiffre sans
   le juger — c'est une mesure d'information, pas un seuil. */
function constat(quoi, valeur, unite, bon, explication) {
  const v = (typeof valeur === 'number')
    ? (Math.abs(valeur) >= 1000 ? valeur.toFixed(0) : valeur.toFixed(2))
    : String(valeur);
  const marque = bon === null ? '     ' : (bon ? '  ok ' : ' ALER');
  console.log(marque + ' | ' + quoi.padEnd(52) + ' ' + (v + ' ' + unite).padStart(12) +
              (explication ? '   ' + explication : ''));
  if (bon === false) alertes.push(quoi + ' : ' + v + ' ' + unite +
                                  (explication ? ' — ' + explication : ''));
  lignes.push({quoi, valeur, unite, bon});
}

function dB(x) { return (x >= 0 ? '+' : '') + x.toFixed(1); }

/* ══════════════════════════════════════════════════════
   CE QUI EST MESURÉ DANS LA PAGE
   ══════════════════════════════════════════════════════

   Tout se passe dans le navigateur : c'est là que vit la chaîne, et mesurer
   ailleurs mesurerait autre chose. */

const MESURES = `
(() => {
  const FE = ${FE}, F0 = ${F0}, PENTE = ${PENTE}, SOUFFLE = ${SOUFFLE};
  const CYCLE = ${CYCLE}, PART_PAROLE = ${PART_PAROLE}, MONTEE = ${MONTEE};
  const BANDES = ${JSON.stringify(BANDES)};

  /* ─── Le signal d'essai ─────────────────────────────────────────── */
  window.bancSignal = function (secondes, avecSouffle) {
    const n = Math.round(FE * secondes);
    const d = new Float32Array(n);
    const harmoniques = Math.floor(11000 / F0);   // jusqu'à 11 kHz
    for (let i = 0; i < n; i++) {
      const t = i / FE;
      const phase = (t / CYCLE) % 1;
      let env = 0;
      if (phase < PART_PAROLE) {
        const dedans = phase * CYCLE;
        const reste = (PART_PAROLE - phase) * CYCLE;
        env = Math.min(1, Math.min(dedans, reste) / MONTEE);
        env = Math.max(0, env);
      }
      let v = 0;
      for (let h = 1; h <= harmoniques; h++) {
        /* Enveloppe en pente : amplitude proportionnelle à h^(pente/6,02),
           soit -6 dB par octave pour PENTE = -6. */
        v += Math.pow(h, PENTE / 6.0206) * Math.sin(2*Math.PI*F0*h*t + h*1.7);
      }
      d[i] = 0.16 * env * v + (avecSouffle ? SOUFFLE * (Math.random()*2 - 1) : 0);
    }
    return d;
  };

  /* Les fenêtres de mesure évitent les transitions : on mesure au coeur de la
     phrase et au coeur du silence, jamais sur les fondus. */
  window.bancZone = function (d, quoi) {
    const bornes = quoi === 'parole' ? [0.12, 0.33] : [0.62, 0.95];
    const sortie = [];
    for (let i = 0; i < d.length; i++) {
      const ph = ((i / FE) / CYCLE) % 1;
      if (ph > bornes[0] && ph < bornes[1]) sortie.push(d[i]);
    }
    return Float32Array.from(sortie);
  };

  window.bancRms = function (d) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i]*d[i];
    return 20 * Math.log10(Math.sqrt(s / Math.max(1, d.length)) + 1e-12);
  };

  window.bancCrete = function (d) {
    let c = 0;
    for (let i = 0; i < d.length; i++) c = Math.max(c, Math.abs(d[i]));
    return 20 * Math.log10(c + 1e-12);
  };

  /* Écrêtage : nombre d'échantillons collés au plafond. Un seul suffit à
     s'entendre sur une transitoire. */
  window.bancEcretage = function (d) {
    let n = 0;
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) >= 0.9995) n++;
    return n;
  };

  /* Discontinuité, rapportée à la crête pour être indépendante du niveau.
   
     Mesure d'INFORMATION, sans seuil : je n'ai pas su en tirer un critère qui
     sépare un clic d'un signal légitimement riche en haut du spectre. Essayé
     et rejeté : le rapport du plus grand saut à leur moyenne quadratique donne
     16,9 sur un signal propre contre 20,6 avec un clic franc — trop proche
     pour décider. La borne physique est donnée à côté comme repère : un signal
     limité à fmax ne peut pas sauter de plus de 2*pi*fmax/fe par échantillon.
     Au-delà, quelque chose n'est plus dans la bande.
     
     Les clics aux raccords, eux, sont attrapés là où ils naissent : verifier.js
     les contrôle sur le montage et sur l'assemblage des morceaux. */
  window.bancSaut = function (d) {
    let saut = 0, crete = 0;
    for (let i = 1; i < d.length; i++) {
      saut = Math.max(saut, Math.abs(d[i] - d[i-1]));
      crete = Math.max(crete, Math.abs(d[i]));
    }
    return crete > 1e-9 ? saut / crete : 0;
  };

  /* Bruit musical : la soustraction spectrale, poussée trop loin, laisse des
     pics isolés qui vont et viennent — un gargouillis métallique. On le
     mesure par la VARIATION de la platitude spectrale d'une trame à l'autre,
     dans les silences. Un souffle régulier varie peu ; un gargouillis varie
     beaucoup. */
  window.bancGargouillis = function (d) {
    const N = 512, saut = N / 2;
    if (d.length < N * 4) return 0;
    const fen = new Float32Array(N);
    for (let i = 0; i < N; i++) fen[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(N-1));
    const platitudes = [];
    for (let deb = 0; deb + N <= d.length; deb += saut) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = d[deb+i] * fen[i];
      fftSurPlace(re, im);
      let somme = 0, logSomme = 0, k = 0;
      for (let j = 1; j < N/2; j++) {
        const p = re[j]*re[j] + im[j]*im[j] + 1e-20;
        somme += p; logSomme += Math.log(p); k++;
      }
      if (!k) continue;
      platitudes.push(Math.exp(logSomme / k) / (somme / k));   // platitude spectrale
    }
    if (platitudes.length < 4) return 0;
    const moy = platitudes.reduce((a,b)=>a+b,0) / platitudes.length;
    let va = 0;
    for (const p of platitudes) va += (p - moy) * (p - moy);
    return Math.sqrt(va / platitudes.length) / Math.max(moy, 1e-9);  // variation relative
  };

  /* Le souffle SOUS la voix, par différence.
   
     Première version fautive : elle mesurait le souffle dans les silences. Une
     porte de bruit les met à zéro absolu, et la séparation annoncée montait à
     226 dB — un chiffre qui ne veut rien dire. Or la porte ne touche pas au
     souffle pendant la parole, et c'est celui-là qu'on entend.
     
     La voix du signal d'essai est déterministe ; seul le souffle est tiré au
     hasard. On peut donc passer DEUX fois la même voix dans la même chaîne,
     avec et sans souffle : la différence des deux sorties est le souffle tel
     que la chaîne l'a rendu, pendant la parole comme ailleurs.
     
     La chaîne n'est pas linéaire — le compresseur suit le signal — donc la
     différence contient aussi un peu d'écart de gain. Avec un souffle 36 dB
     sous la voix, les deux trajectoires de gain sont quasi identiques et
     l'approximation tient. */
  window.bancResidu = function (avec, sans, zone) {
    const n = Math.min(avec.length, sans.length);
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = avec[i] - sans[i];
    return bancRms(zone ? bancZone(d, zone) : d);
  };

  /* Niveau ABSOLU par bande, en dBFS.
   
     profilBandes() cale sur 1-4 kHz : il décrit le timbre, pas le niveau. Pour
     savoir où le souffle devient audible, il faut comparer voix et souffle
     bande à bande, en valeur absolue — donc une autre mesure.
     
     Pourquoi elle est nécessaire : le rapport large bande est trompeur dès
     qu'on touche au timbre. Couper les graves de 9 dB fait chuter la voix, qui
     y a l'essentiel de son énergie, bien plus que le souffle, qui est plat. Le
     rapport large bande s'effondre alors sans que le souffle soit devenu plus
     audible nulle part. Seule la mesure par bande le dit. */
  window.bancBandesAbs = function (d) {
    const N = 2048, saut = N;
    if (d.length < N) return BANDES.map(() => -240);
    const fen = new Float32Array(N);
    for (let i = 0; i < N; i++) fen[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(N-1));
    const puissance = new Float64Array(N/2 + 1);
    let trames = 0;
    for (let deb = 0; deb + N <= d.length; deb += saut) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = d[deb+i] * fen[i];
      fftSurPlace(re, im);
      for (let k = 0; k <= N/2; k++) puissance[k] += re[k]*re[k] + im[k]*im[k];
      trames++;
    }
    if (!trames) return BANDES.map(() => -240);
    /* Normalisation : fenêtre de Hann, gain cohérent 0,5. */
    const norme = trames * (N * 0.5) * (N * 0.5) / 2;
    return BANDES.map(([f1, f2]) => {
      let somme = 0;
      for (let k = 0; k <= N/2; k++) {
        const f = k * FE / N;
        if (f >= f1 && f < f2) somme += puissance[k];
      }
      return 10 * Math.log10(somme / norme + 1e-24);
    });
  };

  /* ─── Souffle AUDIBLE, et non simplement présent ────────────────────
  
     Le décibel ne dit pas l'audibilité. Un souffle quarante décibels sous la
     voix s'entend dans une bande où la voix ne porte rien, et disparaît dans
     une bande où elle porte tout. Compter des décibels sans modèle d'audition
     revient à juger une image au nombre de pixels.
     
     On pose donc un seuil de masquage : dans chaque bande critique, la voix
     masque ce qui se trouve sous elle d'un certain écart, et cet écart
     s'étale sur les bandes voisines. Ce qui dépasse ce seuil s'entend ; le
     reste, non.
     
     Modèle volontairement simple et ses limites, dites franchement :
       - bandes de Bark, largeur critique de l'oreille ;
       - masquage de 14,5 dB + indice de bande sous le masqueur, la règle
         usuelle pour un masqueur tonal ;
       - étalement de 25 dB par Bark vers le grave, 10 dB par Bark vers l'aigu
         — l'oreille masque bien mieux vers le haut ;
       - seuil absolu d'audition approché, pour ne pas compter un souffle que
         personne n'entendrait.
     C'est un ordre de grandeur, pas une mesure normalisée. Il sert à comparer
     deux réglages entre eux, pas à certifier une valeur.
     
     Convention de niveau : la pleine échelle vaut 90 dB SPL. Sans elle, le
     seuil absolu d'audition n'aurait aucun point d'ancrage. */
  const BARK = [20,100,200,300,400,510,630,770,920,1080,1270,1480,1720,2000,
                2320,2700,3150,3700,4400,5300,6400,7700,9500,12000];
  const PLEINE_ECHELLE_SPL = 90;

  /* Seuil absolu d'audition, approximation usuelle en dB SPL. */
  function seuilAudition(f) {
    const k = f / 1000;
    return 3.64*Math.pow(k,-0.8) - 6.5*Math.exp(-0.6*Math.pow(k-3.3,2))
           + 0.001*Math.pow(k,4);
  }

  window.bancBandesBark = function (d) {
    const N = 2048;
    if (d.length < N) return BARK.slice(0,-1).map(() => -240);
    const fen = new Float32Array(N);
    for (let i = 0; i < N; i++) fen[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(N-1));
    const puiss = new Float64Array(N/2 + 1);
    let trames = 0;
    for (let deb = 0; deb + N <= d.length; deb += N) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = d[deb+i] * fen[i];
      fftSurPlace(re, im);
      for (let k = 0; k <= N/2; k++) puiss[k] += re[k]*re[k] + im[k]*im[k];
      trames++;
    }
    const norme = trames * (N*0.5) * (N*0.5) / 2;
    const sortie = [];
    for (let b = 0; b < BARK.length - 1; b++) {
      let somme = 0;
      for (let k = 0; k <= N/2; k++) {
        const f = k * FE / N;
        if (f >= BARK[b] && f < BARK[b+1]) somme += puiss[k];
      }
      sortie.push(10*Math.log10(somme / norme + 1e-24));
    }
    return sortie;
  };

  /* Combien de décibels de souffle dépassent le seuil de masquage, et dans
     quelle bande. Zéro veut dire : présent mais inaudible. */
  window.bancAudible = function (voix, souffle) {
    const bv = bancBandesBark(voix), bs = bancBandesBark(souffle);
    const n = bv.length;
    /* Seuil de masquage : chaque bande masque les autres, avec étalement. */
    const seuil = new Array(n).fill(-240);
    for (let m = 0; m < n; m++) {
      const niveau = bv[m] - (14.5 + m);           // masquage tonal
      for (let c = 0; c < n; c++) {
        const ecart = c - m;
        const pente = ecart < 0 ? -25 * (-ecart) : -10 * ecart;
        seuil[c] = Math.max(seuil[c], niveau + pente);
      }
    }
    /* Seuil absolu : en dessous, rien ne s'entend, masqué ou non. */
    let pire = 0, oupire = -1, total = 0;
    const detail = [];
    for (let c = 0; c < n; c++) {
      const fc = (BARK[c] + BARK[c+1]) / 2;
      const absolu = seuilAudition(fc) - PLEINE_ECHELLE_SPL;
      const plancher = Math.max(seuil[c], absolu);
      const exces = bs[c] - plancher;
      detail.push(exces);
      if (exces > 0) total += Math.pow(10, exces/10);
      if (exces > pire) { pire = exces; oupire = c; }
    }
    return {
      pire: Math.max(0, pire),
      bande: oupire >= 0 ? Math.round((BARK[oupire] + BARK[oupire+1]) / 2) : 0,
      cumul: total > 0 ? 10*Math.log10(total) : -240,
      detail
    };
  };

  /* Profil par bandes, calé sur 1-4 kHz : c'est le timbre, indépendant du
     niveau. Réutilise la mesure calibrée de la page. */
  window.bancProfil = function (d) {
    return profilBandes(d, FE);
  };

  /* Bande réellement occupée : la plus haute bande encore à moins de 35 dB
     sous la référence 1-4 kHz. */
  window.bancBande = function (profil) {
    if (!profil) return 0;
    let haute = 0;
    for (let i = 0; i < BANDES.length; i++) {
      if (profil[i] !== null && profil[i] > -35) haute = BANDES[i][1];
    }
    return haute;
  };
})();
`;

/* ══════════════════════════════════════════════════════
   DÉROULÉ
   ══════════════════════════════════════════════════════ */

(async () => {
  const nav = await chromium.launch({
    executablePath: process.env.CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--no-proxy-server']
  });
  const ctx = await nav.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.goto(BASE + '/app');
  await page.waitForTimeout(1000);
  await page.evaluate(MESURES);

  dire('BANC DE MESURE DU RENDU — Studio Voix');
  dire('Signal : ' + F0 + ' Hz, harmoniques jusqu\'à 11 kHz, pente ' + PENTE +
       ' dB/octave, souffle à ' + (20*Math.log10(SOUFFLE)).toFixed(0) + ' dBFS');

  /* ─── 1. Le signal d'essai lui-même ────────────────────────────────
     Avant de mesurer quoi que ce soit avec, on vérifie qu'il est apte.
     « Quand une mesure déçoit, soupçonne d'abord ton signal. » */
  titre('1. Aptitude du signal d\'essai');

  const sig = await page.evaluate(() => {
    const d = bancSignal(12, true);
    const propre = bancSignal(12, false);
    const profil = bancProfil(bancZone(d, 'parole'));
    return {
      parole: bancRms(bancZone(d, 'parole')),
      silence: bancRms(bancZone(d, 'silence')),
      crete: bancCrete(d),
      ecretage: bancEcretage(d),
      saut: bancSaut(d),
      sautPropre: bancSaut(propre),
      profil: profil,
      bande: bancBande(profil),
      gargouillis: bancGargouillis(bancZone(d, 'silence'))
    };
  });

  const snrSignal = sig.parole - sig.silence;
  constat('Séparation voix / souffle du signal nu', snrSignal, 'dB',
    snrSignal > 28 && snrSignal < 45, 'assez de marge pour voir la chaîne agir');
  constat('Crête du signal nu', sig.crete, 'dBFS', sig.crete < -1,
    'aucune marge perdue avant la chaîne');
  constat('Échantillons écrêtés', sig.ecretage, '', sig.ecretage === 0);
  const borne = 2 * Math.PI * 11000 / FE;
  constat('Plus grand saut, rapporté à la crête', sig.saut, '',
    sig.saut < borne, 'borne physique pour 11 kHz : ' + borne.toFixed(2));
  constat('Bande occupée', sig.bande, 'Hz', sig.bande >= 8000,
    'toutes les bandes mesurées portent du signal');

  const bandesVides = sig.profil
    ? sig.profil.map((v,i) => (v === null || v < -35) ? NOMS_BANDES[i] : null).filter(Boolean)
    : ['mesure impossible'];
  constat('Bandes sans signal exploitable', bandesVides.length, '',
    bandesVides.length === 0, bandesVides.join(' ') || 'aucune');

  if (sig.profil) {
    dire('\n       Profil du signal nu, calé sur 1-4 kHz :');
    dire('       ' + NOMS_BANDES.map((n,i) =>
      n + ' ' + (sig.profil[i] === null ? '—' : dB(sig.profil[i]))).join('   '));
  }

  if (SIGNAL_SEUL) {
    await nav.close();
    dire('\n' + (alertes.length ? 'SIGNAL INAPTE : ' + alertes.length + ' alerte(s)'
                                : 'Signal apte à la mesure.'));
    process.exit(alertes.length ? 1 : 0);
  }

  /* ─── 2. Chaque étage, séparément puis en chaîne ───────────────────
     Un réglage validé seul peut être mauvais en chaîne : on mesure donc
     l'ajout de chaque étage AU-DESSUS des précédents, jamais isolément. */
  titre('2. Coût et apport de chaque étage — préréglage « naturel »');

  const etages = await page.evaluate(async () => {
    const d = bancSignal(12, true);
    const src = encoderWav(d, 24000, 16);
    const srcPropre = encoderWav(bancSignal(12, false), 24000, 16);

    document.getElementById('preset').value = 'naturel';
    appliquerPreset();
    document.getElementById('traitementActif').checked = true;
    const t = reglagesTraitement();

    /* La MÊME voix est passée deux fois dans la MÊME chaîne, avec et sans
       souffle. La différence donne le souffle tel que la chaîne le rend. */
    const mesurer = async (chaine) => {
      const b1 = await decoderAudio(await appliquerTraitement(src, chaine));
      const b2 = await decoderAudio(await appliquerTraitement(srcPropre, chaine));
      const x = b1.getChannelData(0), propre = b2.getChannelData(0);
      const parole = bancZone(propre, 'parole');
      const profil = bancProfil(parole);
      const voix = bancRms(parole);
      const souffleParole = bancResidu(x, propre, 'parole');
      const souffleSilence = bancResidu(x, propre, 'silence');
      /* Rapport bande par bande : voix et souffle, en absolu, dans la même
         fenêtre de parole. C'est la mesure qui dit OÙ le souffle se dégage. */
      const n = Math.min(x.length, propre.length);
      const residu = new Float32Array(n);
      for (let i = 0; i < n; i++) residu[i] = x[i] - propre[i];
      const bVoix = bancBandesAbs(bancZone(propre, 'parole'));
      const bSouffle = bancBandesAbs(bancZone(residu, 'parole'));
      const audible = bancAudible(bancZone(propre, 'parole'), bancZone(residu, 'parole'));
      return {
        parole: voix,
        silence: souffleParole,           // le souffle SOUS la voix
        snr: voix - souffleParole,
        snrBandes: bVoix.map((v, i) => v - bSouffle[i]),
        audible: audible.pire, ouAudible: audible.bande, cumulAudible: audible.cumul,
        dansSilence: souffleSilence,
        crete: bancCrete(x), ecretage: bancEcretage(x),
        saut: bancSaut(x), gargouillis: bancGargouillis(bancZone(x, 'silence')),
        profil, bande: bancBande(profil)
      };
    };

    const nu = {traitement: null, nettoyage: null, resolution: 16, frequence: 0,
                loudness: '0', souffle: 'aucun',
                autoradio: {graves:0, aigus:0, volume:0}};
    const sansCompression = {...t, ratio: 1, normaliser: false};
    const sansNormalisation = {...t, normaliser: false};

    return {
      depart:      await mesurer(nu),
      souffle:     await mesurer({...nu, souffle: 'moyen'}),
      egaliseur:   await mesurer({...nu, souffle: 'moyen', traitement: sansCompression}),
      compression: await mesurer({...nu, souffle: 'moyen', traitement: sansNormalisation}),
      niveau:      await mesurer({...nu, souffle: 'moyen', traitement: t}),
      porte:       await mesurer({...nu, souffle: 'moyen', traitement: t,
                                  nettoyage: {seuil: -42, rogner: false}}),
      lufs:        await mesurer({...nu, souffle: 'moyen', traitement: t,
                                  nettoyage: {seuil: -42, rogner: false}, loudness: '-16'}),
      sansSouffle: await mesurer({...nu, traitement: t,
                                  nettoyage: {seuil: -42, rogner: false}, loudness: '-16'})
    };
  });

  const ordre = [
    ['depart',      'Signal nu, aucun traitement'],
    ['souffle',     'après retrait du souffle'],
    ['egaliseur',   'après égaliseur'],
    ['compression', 'après compression'],
    ['niveau',      'après normalisation de crête'],
    ['porte',       'après porte de bruit'],
    ['lufs',        'après mise au niveau LUFS']
  ];

  dire('       Souffle mesuré par différence : la même voix passe deux fois dans la');
  dire('       même chaîne, avec et sans souffle. Deux colonnes, car les deux ne');
  dire('       disent pas la même chose — sous la voix il est masqué, dans les');
  dire('       silences il est nu, et c\'est là qu\'on l\'entend.');
  dire('');
  dire('       étage                                  voix   sous voix | silences | AUDIBLE');
  for (const [cle, nom] of ordre) {
    const e = etages[cle];
    dire('       ' + nom.padEnd(38) +
         e.parole.toFixed(1).padStart(7) + e.silence.toFixed(1).padStart(12) + ' |' +
         e.dansSilence.toFixed(1).padStart(9) + ' |' +
         e.audible.toFixed(1).padStart(8) + ' dB' +
         (e.audible > 0.5 ? '  vers ' + e.ouAudible + ' Hz' : '  inaudible'));
  }
  dire('');
  dire('       AUDIBLE : décibels de souffle dépassant le seuil de masquage de');
  dire('       l\'oreille. Zéro veut dire présent mais inaudible. C\'est la seule');
  dire('       colonne qui corresponde à ce qu\'on entend.');

  const coutChaine = etages.souffle.snr - etages.lufs.snr;
  constat('Coût total de la chaîne en séparation', -coutChaine, 'dB', null,
    'large bande : baisse dès qu\'on touche au timbre, donc non jugé');
  constat('Séparation finale', etages.lufs.snr, 'dB', etages.lufs.snr > 28,
    'au-dessous de 28 dB, le souffle s\'entend sous la voix');
  constat('Retrait du souffle : apport SOUS la voix',
    etages.lufs.snr - etages.sansSouffle.snr, 'dB',
    etages.lufs.snr - etages.sansSouffle.snr > -1,
    'sous la voix, le souffle est masqué : peu à gagner');
  constat('Retrait du souffle : apport DANS les silences',
    etages.sansSouffle.dansSilence - etages.lufs.dansSilence, 'dB',
    etages.sansSouffle.dansSilence - etages.lufs.dansSilence > 5,
    'c\'est là qu\'on l\'entend');
  constat('Souffle résiduel dans les silences', etages.lufs.dansSilence, 'dBFS',
    etages.lufs.dansSilence < -60, 'niveau nu, sans voix pour le masquer');
  constat('Souffle audible en bout de chaîne', etages.lufs.audible, 'dB',
    etages.lufs.audible <= etages.depart.audible + 1,
    'départ à ' + etages.depart.audible.toFixed(1) + ' dB — la chaîne ne doit pas en ajouter');
  constat('Retrait du souffle : gain en audibilité',
    etages.sansSouffle.audible - etages.lufs.audible, 'dB',
    etages.sansSouffle.audible - etages.lufs.audible > -0.5,
    'mesuré au seuil de masquage, pas en décibels bruts');
  constat('Écrêtage en sortie', etages.lufs.ecretage, '', etages.lufs.ecretage === 0);
  constat('Gargouillis dans les silences', etages.lufs.gargouillis, '',
    etages.lufs.gargouillis < etages.depart.gargouillis * 2.5,
    'variation de platitude spectrale, ' + etages.depart.gargouillis.toFixed(2) + ' au départ');

  /* ─── 3. Ce que la chaîne fait au timbre ───────────────────────────
     Le souffle n'est pas le seul enjeu : un étage peut aussi déformer. */
  titre('3. Effet sur le timbre — écart au signal nu, bande par bande');

  dire('       bande     ' + NOMS_BANDES.map(n => n.padStart(8)).join(''));
  for (const [cle, nom] of ordre) {
    const p = etages[cle].profil, ref = etages.depart.profil;
    if (!p || !ref) continue;
    dire('       ' + nom.replace('après ', '').padEnd(10) +
      p.map((v,i) => (v === null || ref[i] === null ? '—' : dB(v - ref[i])).padStart(8)).join(''));
  }

  const derive = etages.lufs.profil && etages.depart.profil
    ? etages.lufs.profil.map((v,i) => Math.abs(v - etages.depart.profil[i]))
    : null;
  if (derive) {
    const moy = derive.reduce((a,b)=>a+b,0) / derive.length;
    constat('Déformation moyenne du timbre', moy, 'dB', null,
      'voulue : c\'est le rôle du préréglage');
    constat('Bande la plus déplacée', Math.max(...derive), 'dB',
      Math.max(...derive) < 14, NOMS_BANDES[derive.indexOf(Math.max(...derive))]);
  }
  constat('Bande occupée en sortie', etages.lufs.bande, 'Hz',
    etages.lufs.bande >= 6000, 'le préréglage ne doit pas amputer le haut');

  /* ─── 3 bis. Où le souffle se dégage ─────────────────────────────── */
  titre('3 bis. Rapport voix / souffle, bande par bande');

  dire('       étage         ' + NOMS_BANDES.map(n => n.padStart(8)).join(''));
  for (const [cle, nom] of ordre) {
    const b = etages[cle].snrBandes;
    if (!b) continue;
    dire('       ' + nom.replace('après ', '').padEnd(14) +
      b.map(v => v.toFixed(0).padStart(8)).join(''));
  }
  const depB = etages.depart.snrBandes, finB = etages.lufs.snrBandes;
  if (depB && finB) {
    const perte = depB.map((v,i) => v - finB[i]);
    const pire = Math.max(...perte);
    dire('       ' + 'PERTE'.padEnd(14) + perte.map(v => dB(v).padStart(8)).join(''));
    constat('Pire bande : rapport voix / souffle perdu', pire, 'dB', null,
      NOMS_BANDES[perte.indexOf(pire)] + ' — non interprété, voir le fichier');
    const basses = finB.map((v,i) => v).filter((v,i) => i >= 5);
    constat('Rapport le plus faible au-dessus de 2 kHz', Math.min(...basses), 'dB',
      Math.min(...basses) > 20, 'c\'est là que le souffle s\'entend le mieux');
  }

  /* ─── 4. Tous les préréglages, toutes les forces de retrait ────────
     « Chaque probabilité de chaîne utilisée » : on balaie la grille. */
  titre('4. Grille complète — chaque préréglage, chaque force de retrait');

  const grille = await page.evaluate(async () => {
    const d = bancSignal(12, true);
    const propre = bancSignal(12, false);
    const src = encoderWav(d, 24000, 16);
    const srcPropre = encoderWav(propre, 24000, 16);
    const nuSnr = bancRms(bancZone(propre,'parole')) - bancResidu(d, propre, 'parole');
    const sortie = {depart: nuSnr, cases: []};

    for (const preset of ['aucun','radio','podcast','annonce','telephone','clarte','naturel']) {
      for (const force of ['aucun','leger','moyen','fort']) {
        document.getElementById('preset').value = (preset === 'aucun') ? 'perso' : preset;
        if (preset !== 'aucun') appliquerPreset();
        document.getElementById('traitementActif').checked = (preset !== 'aucun');
        const chaine = {
          traitement: preset === 'aucun' ? null : reglagesTraitement(),
          nettoyage: {seuil: -42, rogner: false},
          resolution: 16, frequence: 0, loudness: '-16', souffle: force,
          autoradio: {graves:0, aigus:0, volume:0}
        };
        const b1 = await decoderAudio(await appliquerTraitement(src, chaine));
        const b2 = await decoderAudio(await appliquerTraitement(srcPropre, chaine));
        const x = b1.getChannelData(0), net = b2.getChannelData(0);
        const profil = bancProfil(bancZone(net,'parole'));
        sortie.cases.push({
          preset, force,
          snr: bancRms(bancZone(net,'parole')) - bancResidu(x, net, 'parole'),
          crete: bancCrete(x), ecretage: bancEcretage(x),
          gargouillis: bancGargouillis(bancZone(x,'silence')),
          bande: bancBande(profil)
        });
      }
    }
    return sortie;
  });

  dire('       préréglage    aucun    léger    moyen     fort   |  bande   écrêtage');
  const parPreset = {};
  for (const c of grille.cases) (parPreset[c.preset] ||= {})[c.force] = c;
  for (const preset of Object.keys(parPreset)) {
    const p = parPreset[preset];
    dire('       ' + preset.padEnd(12) +
      ['aucun','leger','moyen','fort'].map(f => p[f].snr.toFixed(1).padStart(8)).join('') +
      '   | ' + String(p.moyen.bande).padStart(6) + 'Hz' +
      String(p.moyen.ecretage).padStart(10));
  }

  const pires = grille.cases.filter(c => c.force === 'aucun' && c.preset !== 'aucun');
  for (const c of pires) {
    constat('« ' + c.preset +' » sans retrait : séparation', c.snr, 'dB', c.snr > 24,
      'départ à ' + grille.depart.toFixed(1) + ' dB');
  }
  const avecRetrait = grille.cases.filter(c => c.force === 'moyen');
  for (const c of avecRetrait) {
    constat('« ' + c.preset + ' » avec retrait « moyen » : séparation', c.snr, 'dB',
      c.snr > 28);
  }
  const ecretes = grille.cases.filter(c => c.ecretage > 0);
  constat('Cases de la grille qui écrêtent', ecretes.length, '', ecretes.length === 0,
    ecretes.map(c => c.preset + '/' + c.force).join(' ') || 'aucune');

  /* ─── 5. Les cibles de niveau ──────────────────────────────────────
     Un étage dont l'apport ne se chiffre pas est suspect : on vérifie donc
     que la mise au niveau atteint sa cible, et ne sature pas. */
  titre('5. Justesse de la mise au niveau');

  const niveaux = await page.evaluate(async () => {
    const d = bancSignal(12, true);
    const src = encoderWav(d, 24000, 16);
    document.getElementById('preset').value = 'naturel';
    appliquerPreset();
    document.getElementById('traitementActif').checked = true;
    const sortie = [];
    for (const cible of ['-23','-16','-14']) {
      const chaine = {traitement: reglagesTraitement(),
                      nettoyage: {seuil:-42, rogner:false},
                      resolution:16, frequence:0, loudness: cible, souffle:'moyen',
                      autoradio:{graves:0,aigus:0,volume:0}};
      const b = await decoderAudio(await appliquerTraitement(src, chaine));
      const x = b.getChannelData(0);
      sortie.push({cible: parseFloat(cible),
                   obtenu: await mesurerLoudness(x, 24000),
                   crete: bancCrete(x), ecretage: bancEcretage(x),
                   signale: etat.niveauManque ? etat.niveauManque.manque : null});
    }
    return sortie;
  });

  for (const n of niveaux) {
    const ecart = n.obtenu === null ? null : n.obtenu - n.cible;
    /* Manquer la cible n'est pas une faute : le plafond de crête doit gagner,
       sinon on sature. La faute serait de la manquer SANS LE DIRE. On vérifie
       donc que l'écart est signalé, pas qu'il est nul. */
    constat('Cible ' + n.cible + ' LUFS : écart mesuré',
      ecart === null ? 'non mesurable' : ecart, 'LU', null,
      'crête à ' + n.crete.toFixed(1) + ' dBFS');
    constat('Cible ' + n.cible + ' LUFS : écart signalé à l\'utilisateur',
      n.signale === null ? 'non' : ('oui, ' + n.signale.toFixed(1) + ' dB'), '',
      (ecart === null) || (Math.abs(ecart) < 0.8) === (n.signale === null),
      Math.abs(ecart) < 0.8 ? 'cible atteinte, rien à signaler'
                            : 'cible manquée, la page doit le dire');
    constat('Cible ' + n.cible + ' LUFS : échantillons écrêtés', n.ecretage, '',
      n.ecretage === 0);
  }

  /* ─── 6. Tonalité ──────────────────────────────────────────────────
     Trois réglages laissés à l'utilisateur : ils doivent agir, et de la
     quantité annoncée. */
  titre('6. Tonalité — les réglages rendent-ils ce qu\'ils annoncent ?');

  const ton = await page.evaluate(async () => {
    const d = bancSignal(8, false);
    const src = encoderWav(d, 24000, 16);
    const nu = {traitement:null, nettoyage:null, resolution:16, frequence:0,
                loudness:'0', souffle:'aucun'};
    /* Niveaux ABSOLUS par bande : un profil calé sur 1-4 kHz ne peut pas dire
       combien de décibels un plateau bas a réellement posés. */
    const passer = async (a) => {
      const b = await decoderAudio(await appliquerTraitement(src, {...nu, autoradio:a}));
      const x = b.getChannelData(0);
      return {rms: bancRms(x), bandes: bancBandesAbs(bancZone(x,'parole'))};
    };
    const plat = await passer({graves:0, aigus:0, volume:0});
    const gr   = await passer({graves:6, aigus:0, volume:0});
    const ai   = await passer({graves:0, aigus:6, volume:0});
    const vol  = await passer({graves:0, aigus:0, volume:6});
    const volB = await passer({graves:0, aigus:0, volume:-6});
    return {
      /* 160-300 Hz : la bande où vit le corps d'une voix à 190 Hz. En dessous,
         le signal d'essai n'a aucune harmonique, et la mesure n'y vaut rien. */
      graves: gr.bandes[1] - plat.bandes[1],
      aigus:  ai.bandes[7] - plat.bandes[7],
      volPlus: vol.rms - plat.rms,
      volMoins: volB.rms - plat.rms
    };
  });

  /* Un plateau bas posé à 180 Hz n'atteint son gain plein que bien en dessous.
     Dans la bande 160-300, où vit le corps d'une voix, il en rend environ la
     moitié — c'est la physique du filtre, pas un défaut. Le seuil le dit. */
  constat('Graves +6 dB : effet mesuré à 160-300 Hz', ton.graves, 'dB',
    ton.graves > 1.5 && ton.graves < 8,
    'plateau à 180 Hz : environ la moitié du gain dans cette bande');
  constat('Aigus +6 dB : effet mesuré à 6-8 kHz', ton.aigus, 'dB',
    ton.aigus > 2 && ton.aigus < 8);
  constat('Volume +6 dB : effet mesuré', ton.volPlus, 'dB',
    Math.abs(ton.volPlus - 6) < 0.5);
  constat('Volume -6 dB : effet mesuré', ton.volMoins, 'dB',
    Math.abs(ton.volMoins + 6) < 0.5);

  /* ─── 7. Sur un vrai fichier ───────────────────────────────────────
     Le souffle d'un vrai moteur n'est pas celui qu'on simule : il a sa
     couleur, ses creux, sa part de bruit musical laissée par le débruitage du
     serveur. Ce que la chaîne lui fait ne se déduit pas du signal d'essai. */
  if (FICHIER_REEL) {
    titre('7. Sur un vrai fichier — ' + require('path').basename(FICHIER_REEL));
    const octets = require('fs').readFileSync(FICHIER_REEL);
    const b64 = octets.toString('base64');

    const reel = await page.evaluate(async ([b64]) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const src = new Blob([u8], {type: 'audio/wav'});
      const buf = await decoderAudio(src);
      const x = buf.getChannelData(0);

      /* Parole et silence sont repérés sur l'énergie, faute d'enveloppe
         connue : les 20 % de fenêtres les plus faibles sont du silence, les
         20 % les plus fortes de la parole. */
      const fe = buf.sampleRate, w = Math.round(fe * 0.05);
      const niveaux = [];
      for (let i = 0; i + w <= x.length; i += w) {
        let s = 0;
        for (let j = 0; j < w; j++) s += x[i+j]*x[i+j];
        niveaux.push({i, r: Math.sqrt(s/w)});
      }
      /* Les silences insérés entre les morceaux sont des ZÉROS EXACTS : le
         serveur les fabrique en recollant. Les prendre pour le plancher de
         bruit donnait -92 dBFS et 82 dB de séparation, c'est-à-dire la mesure
         du vide. On les écarte, et on cherche le plancher parmi les fenêtres
         faibles mais non nulles. */
      const PLANCHER_NUMERIQUE = Math.pow(10, -85/20);
      const utiles = niveaux.filter(n => n.r > PLANCHER_NUMERIQUE);
      const tries = utiles.slice().sort((a,b) => a.r - b.r);
      const partZero = 1 - utiles.length / Math.max(1, niveaux.length);
      const prendre = (liste) => {
        const out = [];
        for (const {i} of liste) for (let j = 0; j < w; j++) out.push(x[i+j]);
        return Float32Array.from(out);
      };
      const nb = Math.max(4, Math.floor(tries.length * 0.2));
      const silence = prendre(tries.slice(0, nb));
      const parole  = prendre(tries.slice(-nb));

      const sortie = {fe, duree: x.length/fe, partZero,
                      crete: bancCrete(x), ecretage: bancEcretage(x),
                      parole: bancRms(parole), silence: bancRms(silence),
                      audibleNu: bancAudible(parole, silence).pire,
                      ouNu: bancAudible(parole, silence).bande,
                      presets: []};

      /* Chaque préréglage : ce qu'il fait au souffle réel. Le souffle est
         approché par les fenêtres les plus faibles du fichier traité — il n'y
         a pas de version « sans souffle » d'un vrai enregistrement. */
      for (const preset of ['aucun','naturel','radio','podcast']) {
        document.getElementById('preset').value = (preset === 'aucun') ? 'perso' : preset;
        if (preset !== 'aucun') appliquerPreset();
        document.getElementById('traitementActif').checked = (preset !== 'aucun');
        const chaine = {traitement: preset === 'aucun' ? null : reglagesTraitement(),
                        nettoyage: null, resolution: 16, frequence: 0,
                        loudness: '0', souffle: 'aucun',
                        autoradio: {graves:0, aigus:0, volume:0}};
        const y = (await decoderAudio(await appliquerTraitement(src, chaine))).getChannelData(0);
        const pr = [], si = [];
        for (const {i} of tries.slice(-nb)) for (let j = 0; j < w && i+j < y.length; j++) pr.push(y[i+j]);
        for (const {i} of tries.slice(0, nb)) for (let j = 0; j < w && i+j < y.length; j++) si.push(y[i+j]);
        const a = bancAudible(Float32Array.from(pr), Float32Array.from(si));
        sortie.presets.push({preset, audible: a.pire, bande: a.bande,
                             snr: bancRms(Float32Array.from(pr)) - bancRms(Float32Array.from(si))});
      }
      return sortie;
    }, [b64]);

    constat('Fréquence du fichier', reel.fe, 'Hz', null, reel.duree.toFixed(1) + ' s');
    constat('Part de silence numérique exact', reel.partZero * 100, '%', null,
      'silences insérés au recollage — écartés de la mesure du plancher');
    constat('Crête', reel.crete, 'dBFS', reel.crete < -0.5,
      'une génération au ras du plafond n\'a aucune marge');
    constat('Échantillons à pleine échelle', reel.ecretage, '', reel.ecretage < 10);
    constat('Parole', reel.parole, 'dBFS', null);
    constat('Plancher', reel.silence, 'dBFS', null);
    constat('Séparation', reel.parole - reel.silence, 'dB',
      reel.parole - reel.silence > 30);
    constat('Souffle audible, fichier nu', reel.audibleNu, 'dB', null,
      'vers ' + reel.ouNu + ' Hz');
    dire('');
    dire('       préréglage      souffle audible        où     séparation');
    for (const p of reel.presets) {
      dire('       ' + p.preset.padEnd(14) + p.audible.toFixed(1).padStart(10) + ' dB' +
           String(p.bande).padStart(10) + ' Hz' + p.snr.toFixed(1).padStart(13) + ' dB');
    }
    const nu = reel.presets.find(p => p.preset === 'aucun');
    for (const p of reel.presets.filter(p => p.preset !== 'aucun')) {
      constat('« ' + p.preset + ' » : souffle rendu audible en plus',
        p.audible - nu.audible, 'dB', p.audible - nu.audible < 2,
        'au-delà de 2 dB, le préréglage découvre le souffle');
    }
  }

  /* ─── Fin ──────────────────────────────────────────────────────── */
  await nav.close();

  titre('Bulletin');
  if (erreurs.length) {
    dire('  Erreurs de page : ' + erreurs.join(' | '));
    alertes.push('erreurs de page');
  }
  if (!alertes.length) {
    dire('  Aucun seuil franchi. ' + lignes.filter(l => l.bon !== null).length +
         ' constats chiffrés.');
  } else {
    dire('  ' + alertes.length + ' alerte(s) :');
    for (const a of alertes) dire('    - ' + a);
  }
  process.exit(alertes.length ? 1 : 0);
})();
