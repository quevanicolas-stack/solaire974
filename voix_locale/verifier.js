/*
 * Vérifications automatiques — Studio Voix
 *
 * Ces contrôles ont longtemps vécu hors du dépôt, et un redémarrage de machine
 * les a effacés d'un coup. Ils sont désormais versionnés : une suite qui ne
 * survit pas à un redémarrage ne protège rien.
 *
 * Ils couvrent d'abord les règles verrouillées — celles dont la violation ne
 * doit jamais passer inaperçue — puis la chaîne complète.
 *
 * Lancement, serveur de test démarré à côté :
 *     python serveur.py --moteur test --chat test
 *     node verifier.js
 *
 * Option --https pour contrôler l'accès au micro depuis un téléphone :
 *     python serveur.py --moteur test --chat test --port 8771 --https
 *     node verifier.js --https
 */

const CHEMIN_PLAYWRIGHT = process.env.PLAYWRIGHT ||
  '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(CHEMIN_PLAYWRIGHT);

const HTTPS = process.argv.includes('--https');
function mixte_origine_attendue(){ return BASE; }
const BASE = HTTPS ? 'https://127.0.0.1:8771' : 'http://127.0.0.1:8770';

const verifs = [];
function verifier(nom, ok, detail) {
  verifs.push({ nom, ok });
  console.log((ok ? '  OK   ' : '  ECHEC') + ' | ' + nom + (detail ? ' — ' + detail : ''));
}

async function consentir(page, usage) {
  await page.click('#zoneOrigine .radio:nth-child(1)');
  await page.fill('#consNom', 'Nicolas Queva');
  await page.fill('#consUsage', usage);
  for (let i = 1; i <= 4; i++) await page.check('#cons' + i);
}

async function creerVoix(page, nom) {
  await page.evaluate(() => go(1));
  await page.waitForTimeout(500);
  await page.click('#btnRec');
  await page.waitForTimeout(4000);
  await page.click('#btnRec');
  await page.waitForTimeout(2000);
  await page.fill('#voixNom', nom);
  await page.click('#btnCreer');
  await page.waitForTimeout(10000);
}

(async () => {
  const nav = await chromium.launch({
    executablePath: process.env.CHROMIUM ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--no-sandbox', '--no-proxy-server']
  });
  const ctx = await nav.newContext({
    permissions: ['microphone'], acceptDownloads: true, ignoreHTTPSErrors: true
  });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());

  const erreurs = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/status of (422|429)/.test(t)) return;   // provoqués volontairement
    erreurs.push('CONSOLE: ' + t);
  });
  page.on('pageerror', e => erreurs.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/app');
  await page.waitForTimeout(1200);

  // ════════ RÈGLES VERROUILLÉES ════════
  console.log('\n--- Règles verrouillées ---');

  verifier('Quatre pages, consentement en tête',
    await page.evaluate(() => PAGES.length === 4 && PAGES[0].t === 'Consentement'));
  verifier('Le consentement barre toutes les autres pages',
    await page.evaluate(() => !!verrou(1) && !!verrou(2) && !!verrou(3)),
    await page.evaluate(() => verrou(1)));
  verifier('Bandeau « contenu synthétique » présent',
    (await page.textContent('.bandeau')).toLowerCase().includes('synthétique'));
  verifier('Bandeau sur fond opaque, lisible au défilement',
    await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.bandeau'));
      return s.backgroundImage !== 'none' ||
             !/rgba\([^)]+,\s*0?\.\d+\)/.test(s.backgroundColor);
    }));
  verifier('Deux origines proposées, ni plus ni moins',
    (await page.locator('#zoneOrigine .radio').count()) === 2);
  verifier('Quatre engagements, tous obligatoires',
    (await page.locator('#cons1, #cons2, #cons3, #cons4').count()) === 4);
  verifier('Aucune clé écrite en dur dans le fichier',
    !(await page.content()).match(/sk-ant|xi-api-key["']\s*:\s*["'][A-Za-z0-9]{16}/));

  // Navigation refusée tant que le consentement n'est pas complet
  await page.evaluate(() => go(1));
  await page.waitForTimeout(400);
  verifier('Navigation refusée sans consentement',
    await page.evaluate(() =>
      [...document.querySelectorAll('.page')].findIndex(p => p.classList.contains('on')) === 0));

  await consentir(page, 'Vérifications automatiques');
  await page.evaluate(() => go(1));
  await page.waitForTimeout(500);
  verifier('Navigation ouverte une fois le consentement validé',
    await page.evaluate(() =>
      [...document.querySelectorAll('.page')].findIndex(p => p.classList.contains('on')) === 1));

  // ════════ CHAÎNE COMPLÈTE ════════
  console.log('\n--- Chaîne complète ---');

  if (HTTPS) {
    verifier('Contexte jugé sûr par le navigateur',
      await page.evaluate(() => window.isSecureContext === true));
    verifier('Interface du micro disponible',
      await page.evaluate(() => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)));
  }

  await page.click('#btnRec');
  await page.waitForTimeout(4000);
  await page.click('#btnRec');
  await page.waitForTimeout(2000);
  const ech = await page.evaluate(() => etat.echantillons[0] ? {
    n: etat.echantillons.length, taille: etat.echantillons[0].blob.size,
    type: etat.echantillons[0].blob.type, freq: etat.echantillons[0].frequence } : null);
  verifier('Prise captée', ech && ech.n === 1, ech ? ech.n + ' échantillon(s)' : 'aucun');
  verifier('Capture non compressée, au-dessus de la bande du moteur',
    ech && ech.type === 'audio/wav' && ech.freq >= 44100,
    ech ? ech.type + ', ' + ech.freq + ' Hz' : '');

  await page.fill('#voixNom', 'Voix de contrôle');
  await page.click('#btnCreer');
  await page.waitForTimeout(10000);
  verifier('Voix créée par le serveur',
    (await page.textContent('#resCreation')).includes('Voix créée'));

  await page.evaluate(() => go(2));
  await page.waitForTimeout(500);
  await page.fill('#texte', 'Première phrase de contrôle.\n\nDeuxième phrase de contrôle.');
  await page.click('#btnSynth');
  await page.waitForTimeout(13000);

  const gen = await page.evaluate(() => {
    const g = etat.generations[0];
    return g ? { nom: g.nom, nomBrut: g.nomBrut, nomPropose: g.nomPropose,
                 raisons: (g.raisons || []).length, taille: g.blob.size } : null;
  });
  verifier('Audio généré', !!gen, gen ? gen.taille + ' octets' : 'aucun');
  verifier('Préfixe voix-synthetique sur les trois versions',
    gen && [gen.nom, gen.nomBrut, gen.nomPropose].every(n => n && n.startsWith('voix-synthetique_')),
    gen ? gen.nom : '');
  verifier('Trois lecteurs proposés',
    (await page.locator('#resSynth audio').count()) === 3);
  verifier('Proposition motivée par des mesures',
    gen && gen.raisons >= 4, gen ? gen.raisons + ' motifs' : '');
  // Le telechargement a quitte l'ecran de generation : on y compare et on y
  // choisit, la bibliotheque delivre les fichiers.
  const boutons = await page.evaluate(() => {
    const zone = document.getElementById('resSynth');
    const noms = [...zone.querySelectorAll('button')].map(b => b.textContent.trim());
    return { noms, charger: noms.filter(n => n === 'Charger').length,
             telecharger: noms.filter(n => n.indexOf('Téléchar') >= 0).length };
  });
  verifier('Trois boutons « Charger » sur l\'écran de génération',
    boutons.charger === 3, boutons.noms.join(' | '));
  verifier('Plus aucun téléchargement direct depuis la génération',
    boutons.telecharger === 0, boutons.noms.join(' | '));

  const choix = await page.evaluate(async () => {
    const g = etat.generations[0];
    const avant = g.retenue;
    await chargerVersion(g.id, 'propose');
    const apres = etat.generations.find(x => x.id === g.id).retenue;
    const enBase = (await bdLire('generations', g.id));
    const libelle = document.getElementById('charger_propose').textContent.trim();
    afficherGenerations();
    const texte = document.getElementById('listeGen').textContent;
    const btns = [...document.querySelectorAll('#listeGen button')].map(b => b.textContent.trim());
    return { avant, apres, persiste: enBase ? enBase.retenue : null, libelle, texte, btns };
  });
  verifier('Aucune version n\'est retenue d\'office', choix.avant === null, String(choix.avant));
  verifier('Charger retient la version écoutée', choix.apres === 'propose', String(choix.apres));
  verifier('Le choix est conservé en base', choix.persiste === 'propose', String(choix.persiste));
  verifier('Le bouton dit que la version est chargée', choix.libelle === 'Chargée', choix.libelle);
  verifier('La bibliothèque annonce la version retenue',
    choix.texte.indexOf('version retenue : proposition') >= 0);
  verifier('La bibliothèque délivre les trois versions',
    ['Non traitée', 'Vos réglages', 'Proposition'].every(n => choix.btns.indexOf(n) >= 0),
    choix.btns.join(' | '));

  verifier('Bouton rendu après génération', await page.evaluate(() => {
    const b = document.getElementById('btnSynth');
    return b.textContent.trim() === "Générer l'audio" && !b.disabled && !b.querySelector('.spin');
  }));

  // ════════ RÉGLAGES ════════
  console.log('\n--- Réglages ---');

  verifier('Suppression du bruit de fond réglable',
    (await page.locator('#debruitage').count()) === 1 &&
    (await page.inputValue('#debruitage')) === 'moyen');
  verifier('Niveau sonore normalisé proposé',
    (await page.locator('#loudness').count()) === 1);
  verifier('Commande directe du moteur présente',
    (await page.locator('#temperature, #topP, #topK, #graine').count()) === 4);

  for (const [maj, cle] of [['Graves','graves'],['BasMed','basMed'],['Mediums','mediums'],
                            ['Aigus','aigus'],['Deess','deess']]) {
    verifier('Bande « ' + cle + ' » réglable en gain, fréquence et largeur',
      (await page.locator('#' + cle + ', #f' + maj + ', #q' + maj).count()) === 3);
  }

  await page.selectOption('#preset', 'radio');
  await page.waitForTimeout(300);
  const radio = await page.evaluate(() => reglagesTraitement());
  verifier('Préréglages d\'origine inchangés',
    radio.fGraves === 120 && radio.fMediums === 1800 && radio.fAigus === 6000 &&
    radio.graves === 2.5 && radio.typeGraves === 'lowshelf');

  await page.selectOption('#preset', 'clarte');
  await page.waitForTimeout(300);
  const clarte = await page.evaluate(() => reglagesTraitement());
  // Le prereglage « naturel » vient d'une mesure : trois prises de la meme voix
  // comparees a une generation faite depuis elles. Il retire du bas-medium et
  // rend des aigus. Un signe inverse trahirait une saisie fautive.
  const naturel = await page.evaluate(() => PRESETS.naturel);
  verifier('Le préréglage « naturel » retire du bas-médium',
    naturel.graves < 0 && naturel.basMed < 0,
    'graves ' + naturel.graves + ' dB, bas-médium ' + naturel.basMed + ' dB');
  verifier('Le préréglage « naturel » rend des aigus',
    naturel.aigus > 4 && naturel.typeAigus === 'highshelf',
    naturel.typeAigus + ' ' + naturel.aigus + ' dB à ' + naturel.fAigus + ' Hz');
  verifier('Le préréglage « naturel » ne touche pas la bande 1-4 kHz',
    naturel.mediums === 0, 'médiums ' + naturel.mediums + ' dB');
  verifier('Le préréglage « naturel » décrit toutes ses bandes',
    ['fGraves','fBasMed','fMediums','fAigus','fDeess','qGraves','qBasMed','qMediums','qAigus','qDeess']
      .every(c => typeof naturel[c] === 'number' && isFinite(naturel[c])));

  verifier('Préréglage « voix claire » conforme à la correction mesurée',
    clarte.typeGraves === 'peaking' && clarte.fGraves === 180 && clarte.graves === -9);

  // Lexique de prononciation
  const lex = await page.evaluate(() => {
    etat.lexique = [{ecrit:'Queva', dit:'Kéva'}, {ecrit:'Aurélie', dit:'Oh-ré-lie'}];
    return {
      simple: appliquerLexique('Bonjour Queva.'),
      entier: appliquerLexique('Quevastan reste Quevastan.'),
      accent: appliquerLexique('Aurélie et Aurélien')
    };
  });
  verifier('Lexique : remplacement effectué', lex.simple === 'Bonjour Kéva.', lex.simple);
  verifier('Lexique : mots entiers seulement',
    lex.entier === 'Quevastan reste Quevastan.', lex.entier);
  verifier('Lexique : les accents bornent le mot',
    lex.accent === 'Oh-ré-lie et Aurélien', lex.accent);
  await page.evaluate(() => { etat.lexique = []; });

  // Lexique de base. XTTS n'accepte aucune transcription phonetique : la seule
  // facon d'imposer une prononciation est de reecrire le mot. Ces controles
  // verifient que la base agit, qu'elle ne prend jamais le pas sur les mots de
  // l'utilisateur, et qu'elle n'abime pas les mots en -er dont le R s'entend.
  const base = await page.evaluate(() => {
    const avant = etat.lexique.slice();
    etat.lexique = [];
    etat.baseEcartees = [];
    etat.baseVerbes = etat.baseSigles = etat.baseAnglicismes = true;
    const r = {
      verbe: appliquerLexique('Il faut gommer son accent et diriger.'),
      sigle: appliquerLexique('Le PDG a signé.'),
      anglais: appliquerLexique('On planifie un meeting.'),
      // Pieges : ces mots finissent aussi par -er, leur R se prononce.
      pieges: appliquerLexique('hiver cher mer fer super amer papier premier métier'),
      // Ambigus, volontairement absents de la liste.
      ambigus: appliquerLexique('un reporter et un supporter'),
      nb: lexiqueDeBase().length
    };
    // Vos mots passent avant ceux de la base.
    etat.lexique = [{ecrit:'gommer', dit:'go-mère'}];
    r.priorite = appliquerLexique('Il faut gommer.');
    // Une entrée écartée cesse d'agir.
    etat.lexique = [];
    etat.baseEcartees = ['diriger'];
    r.ecartee = appliquerLexique('Il faut diriger.');
    etat.baseEcartees = [];
    etat.baseVerbes = false;
    r.eteinte = appliquerLexique('Il faut gommer.');
    etat.baseVerbes = true;
    etat.lexique = avant;
    return r;
  });
  verifier('Le lexique de base retire le R final des infinitifs',
    base.verbe === 'Il faut gommé son accent et dirigé.', base.verbe);
  verifier('Les sigles sont lus lettre par lettre',
    base.sigle.indexOf('pé dé gé') >= 0, base.sigle);
  verifier('Les mots anglais sont réécrits à la française',
    base.anglais.indexOf('miting') >= 0, base.anglais);
  verifier('Les mots en -er dont le R se prononce sont épargnés',
    base.pieges === 'hiver cher mer fer super amer papier premier métier', base.pieges);
  verifier('Les mots ambigus sont laissés tels quels',
    base.ambigus === 'un reporter et un supporter', base.ambigus);
  verifier('Vos mots passent avant le lexique de base',
    base.priorite === 'Il faut go-mère.', base.priorite);
  verifier('Une entrée de base écartée cesse d\'agir',
    base.ecartee === 'Il faut diriger.', base.ecartee);
  verifier('Une liste désactivée n\'agit plus du tout',
    base.eteinte === 'Il faut gommer.', base.eteinte);
  verifier('Le lexique de base compte des entrées',
    base.nb > 300, base.nb + ' réécriture(s)');

  // Mesure de niveau, confrontée au comportement attendu
  const lufs = await page.evaluate(async () => {
    const fe = 48000, n = fe * 4, d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fe;
      d[i] = 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.5 * t)) * Math.sin(2 * Math.PI * 150 * t);
    }
    const a = await mesurerLoudness(d, fe);
    const fort = new Float32Array(n);
    for (let i = 0; i < n; i++) fort[i] = d[i] * 2;       // +6 dB exactement
    const b = await mesurerLoudness(fort, fe);
    return { a, b, ecart: b - a };
  });
  // La regle du grondement a longtemps vise le fondamental de la voix.
  // Sur une voix feminine a 198 Hz, elle posait un creux de 7 dB a 180 Hz :
  // elle amincissait la voix en croyant nettoyer la piece. Ces controles
  // interdisent le retour de ce defaut.
  const grave = await page.evaluate(async () => {
    const fe = 24000, n = fe * 4;
    // Voix synthetique : fondamentale a 198 Hz et ses harmoniques, comme une
    // voix feminine reelle. Le souffle evite un signal trop pur.
    const voix = f0 => {
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / fe;
        const enveloppe = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t);
        let v = 0;
        for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / (h * h);
        d[i] = 0.35 * enveloppe * v + 0.002 * (Math.random() - 0.5);
      }
      return d;
    };
    const avecGrondement = d => {
      const s = new Float32Array(d.length);
      for (let i = 0; i < d.length; i++) {
        s[i] = d[i] + 0.25 * Math.sin(2 * Math.PI * 55 * i / fe);
      }
      return s;
    };
    const mesurer = async d => await mesurerAudio(encoderWav(d, fe, 16));
    const propre = voix(198);
    const mPropre = await mesurer(propre);
    const mSale = await mesurer(avecGrondement(propre));
    const mHomme = await mesurer(voix(105));
    return {
      f0Propre: mPropre && mPropre.fondamentale,
      f0Homme: mHomme && mHomme.fondamentale,
      sousPropre: mPropre && mPropre.sousLaVoix,
      sousSale: mSale && mSale.sousLaVoix,
      chainePropre: chaineProposee(mPropre).chaine.traitement,
      chaineSale: chaineProposee(mSale).chaine.traitement,
      chaineHomme: chaineProposee(mHomme).chaine.traitement,
      raisonsPropre: chaineProposee(mPropre).raisons.map(r => r.replace(/<[^>]*>/g, ''))
    };
  });
  verifier('Hauteur de la voix mesurée, voix aiguë',
    grave.f0Propre > 185 && grave.f0Propre < 212,
    Math.round(grave.f0Propre) + ' Hz pour 198 Hz attendus');
  verifier('Hauteur de la voix mesurée, voix grave',
    grave.f0Homme > 98 && grave.f0Homme < 113,
    Math.round(grave.f0Homme) + ' Hz pour 105 Hz attendus');
  verifier('Un grondement réel est bien détecté',
    grave.sousSale > grave.sousPropre + 10,
    'sous la voix : ' + grave.sousPropre.toFixed(1) + ' dB propre, ' +
    grave.sousSale.toFixed(1) + ' dB avec grondement');
  verifier('Voix saine : aucun creux posé dans le bas',
    grave.chainePropre.graves >= 0,
    'gain grave ' + grave.chainePropre.graves + ' dB');
  verifier('Voix saine : le coupe-bas reste sous la fondamentale',
    grave.chainePropre.passeHaut < grave.f0Propre * 0.8,
    grave.chainePropre.passeHaut + ' Hz pour une voix à ' + Math.round(grave.f0Propre) + ' Hz');
  verifier('Grondement traité sans toucher à la fondamentale',
    grave.chaineSale.graves < 0 && grave.chaineSale.fGraves < grave.f0Propre * 0.8,
    'creux de ' + grave.chaineSale.graves + ' dB à ' + grave.chaineSale.fGraves +
    ' Hz, fondamentale à ' + Math.round(grave.f0Propre) + ' Hz');
  verifier('Le coupe-bas ne monte jamais sur la fondamentale',
    grave.chaineSale.passeHaut < grave.f0Propre * 0.8,
    grave.chaineSale.passeHaut + ' Hz');
  verifier('Voix grave : le coupe-bas s\'abaisse aussi',
    grave.chaineHomme.passeHaut < grave.f0Homme * 0.8,
    grave.chaineHomme.passeHaut + ' Hz pour une voix à ' + Math.round(grave.f0Homme) + ' Hz');

  verifier('Mesure de niveau : six décibels donnent six décibels',
    Math.abs(lufs.ecart - 6) < 0.15, 'écart mesuré ' + lufs.ecart.toFixed(2) + ' LU');

  // ════════ RETOUR DEPUIS LE CATALOGUE ════════
  console.log('\n--- Matière d\'entrée ---');

  // Recuperer la prise telle qu'elle a ete captee : sans l'original, on ne
  // peut pas dire si un defaut vient du micro ou du moteur.
  const prise = await page.evaluate(() => {
    const e = etat.echantillons[0];
    return e ? { nom: nomEchantillon(e), taille: e.blob.size } : null;
  });
  verifier('Une prise enregistrée peut être récupérée',
    !!prise && prise.taille > 1000, prise ? prise.nom + ', ' + prise.taille + ' octets' : 'aucune');
  verifier('Le nom d\'une prise ne porte pas le préfixe des fichiers synthétiques',
    !!prise && prise.nom.indexOf('voix-synthetique') < 0, prise ? prise.nom : '');
  verifier('Le bouton de récupération est présent pour chaque prise',
    (await page.locator('#listeEch button:has-text("Télécharger")').count())
      === (await page.evaluate(() => etat.echantillons.length)));
  verifier('Le bouton « Télécharger les prises » existe',
    await page.locator('#btnToutesPrises').count() > 0);

  // Les plafonds : une prise bornee, un cumul borne, et une jauge qui dit ce
  // qu'elle fait au lieu de rester pleine en silence.
  const plafonds = await page.evaluate(() => ({
    prise: typeof DUREE_PRISE_MAX === 'number' ? DUREE_PRISE_MAX : null,
    cumul: typeof DUREE_MAXI === 'number' ? DUREE_MAXI : null,
    cible: typeof DUREE_CIBLE === 'number' ? DUREE_CIBLE : null
  }));
  verifier('Plafond par prise défini', plafonds.prise > 0, plafonds.prise + ' s');
  verifier('Plafond cumulé à trente minutes', plafonds.cumul === 1800, plafonds.cumul + ' s');
  verifier('La cible de la jauge est au-dessus de l\'ancienne valeur de 180 s',
    plafonds.cible > 180, plafonds.cible + ' s');

  const jauge = await page.evaluate(() => {
    const vrais = etat.echantillons;
    const faux = d => ({ id: 'faux' + d, nom: 'x', duree: d, blob: new Blob(['x']), type: 'audio/wav' });
    etat.echantillons = [faux(DUREE_CIBLE + 120)];
    majJauge();
    const depasse = document.getElementById('jaugeSuite').textContent;
    const largeurDepasse = document.getElementById('jaugePlein').style.width;
    etat.echantillons = [faux(DUREE_MAXI)];
    majJauge();
    const plein = document.getElementById('jaugeSuite').textContent;
    etat.echantillons = [faux(120)];
    majJauge();
    const normal = document.getElementById('jaugeSuite').textContent;
    // Le plafond doit refuser, pas tronquer en silence.
    etat.echantillons = [faux(DUREE_MAXI - 10)];
    const refus = placeDisponible(60);
    etat.echantillons = vrais;
    majJauge();
    return { depasse, plein, normal, refus, largeurDepasse };
  });
  // Le recapitulatif d'envoi ne se rafraichissait qu'a l'arrivee sur l'etape :
  // il affichait zero echantillon pendant que la jauge, juste au-dessus,
  // comptait quinze minutes. Ce controle passe par le vrai parcours — ajout
  // puis suppression d'une prise — et non par un appel direct aux fonctions
  // d'affichage, qui est precisement ce qui avait laisse passer le defaut.
  const recap = await page.evaluate(async () => {
    const lire = () => {
      const t = document.getElementById('recapEnvoi').textContent;
      return {
        nb: (t.match(/Échantillons\s*([0-9]+)/) || [])[1],
        duree: (t.match(/Durée cumulée\s*([0-9:]+)/) || [])[1],
        insuffisant: t.indexOf('Matière insuffisante') >= 0
      };
    };
    const depart = lire();
    await ajouterEchantillon({ id: 'temoin', nom: 'Témoin.wav', duree: 420,
      blob: new Blob([new Uint8Array(500000)]), type: 'audio/wav', source: 'micro' });
    const apresAjout = lire();
    await supprimerEchantillon('temoin');
    const apresRetrait = lire();
    return { depart, apresAjout, apresRetrait,
             reel: etat.echantillons.length, jauge: dureeCumulee() };
  });
  verifier('Le récapitulatif compte les prises réellement présentes',
    Number(recap.apresAjout.nb) === recap.reel + 1,
    recap.apresAjout.nb + ' annoncé(s) pour ' + (recap.reel + 1) + ' présent(s)');
  verifier('Le récapitulatif ne reste pas à zéro pendant que la jauge compte',
    recap.apresAjout.duree !== '00:00' && recap.apresAjout.insuffisant === false,
    'durée annoncée ' + recap.apresAjout.duree);
  verifier('Le récapitulatif suit aussi une suppression',
    Number(recap.apresRetrait.nb) === recap.reel,
    recap.apresRetrait.nb + ' annoncé(s) pour ' + recap.reel + ' présent(s)');

  verifier('Sous la cible, la jauge n\'ajoute aucun commentaire',
    jauge.normal === '', JSON.stringify(jauge.normal));
  verifier('Au-delà de la cible, la jauge dit où va le surplus',
    jauge.depasse.length > 0 && jauge.depasse.indexOf('affinage') >= 0, jauge.depasse);
  verifier('Au plafond, la jauge annonce le refus des prises suivantes',
    jauge.plein.indexOf('refus') >= 0, jauge.plein);
  verifier('Une prise qui dépasserait le plafond est refusée',
    jauge.refus === false);

  // Un refus ne doit pas etre suivi d'un « prise ajoutee » : deux messages
  // contradictoires laissent croire que la prise est entree.
  const refusPrise = await page.evaluate(async () => {
    const vrais = etat.echantillons.slice();
    const dits = [];
    const vrai = window.toast;
    window.toast = (t, k) => { dits.push(t); };
    // Le plafond doit etre franchi par la prise de trois secondes : a cinq
    // secondes pres il restait de la place, et la prise entrait a bon droit.
    etat.echantillons = [{id:'gros', nom:'gros.wav', duree: DUREE_MAXI - 1,
      blob: new Blob([new Uint8Array(500)]), type:'audio/wav', source:'micro'}];
    const donnees = new Float32Array(48000 * 3);
    for (let i = 0; i < donnees.length; i++) donnees[i] = 0.1 * Math.sin(i / 20);
    await finaliserEnregistrement(donnees, 48000);
    const etatRec = document.getElementById('recEtat').textContent;
    window.toast = vrai;
    etat.echantillons = vrais;
    afficherEchantillons();
    return { dits, etatRec, ajoutee: dits.some(t => t.indexOf('ajoutée') >= 0) };
  });
  verifier('Une prise refusée n\'est pas annoncée comme ajoutée',
    refusPrise.ajoutee === false, refusPrise.dits.join(' | '));
  verifier('Le refus se lit aussi à côté du chronomètre',
    refusPrise.etatRec.indexOf('refus') >= 0, refusPrise.etatRec);

  // Deux prises ne doivent jamais porter le meme nom : elles se
  // telechargeraient dans le meme fichier.
  const nommage = await page.evaluate(async () => {
    const vrais = etat.echantillons.slice();
    etat.echantillons = [];
    const faux = n => ({id:'n'+n, nom:'Prise '+n+'.wav', duree:5,
      blob:new Blob([new Uint8Array(100)]), type:'audio/wav', source:'micro'});
    await ajouterEchantillon(faux(1));
    await ajouterEchantillon(faux(2));
    await supprimerEchantillon('n1');
    const propose = nomDePrise();
    await ajouterEchantillon({id:'n3', nom: propose, duree:5,
      blob:new Blob([new Uint8Array(100)]), type:'audio/wav', source:'micro'});
    const noms = etat.echantillons.map(e => e.nom);
    etat.echantillons = vrais;
    afficherEchantillons();
    return { propose, noms, uniques: new Set(noms).size === noms.length };
  });
  verifier('Aucune prise ne reprend le nom d\'une autre',
    nommage.uniques, nommage.noms.join(' | '));

  // Le serveur doit exploiter la matiere, pas seulement la stocker.
  const fiche = await page.evaluate(async () => {
    const r = await fetch(baseApi() + '/voices', { headers: entetes() });
    const d = await r.json();
    const v = (d.voices || []).find(v => v.name === 'controle') || (d.voices || [])[0];
    return v || null;
  });
  // Exiger un compte non nul : une fiche annoncant zero tranche signifie que
  // le decoupage n'a rien donne, donc que la matiere n'est pas exploitee.
  verifier('La fiche de voix indique la matière réellement exploitée',
    !!fiche && fiche.nb_tranches > 0 && fiche.duree_utilisee > 0,
    fiche ? fiche.nb_tranches + ' tranche(s), ' + fiche.duree_utilisee + ' s utilisées' : 'aucune fiche');

  console.log('\n--- Correction mesurée ---');

  // Test decisif : on abime un signal avec un egaliseur CONNU, puis on demande
  // la correction. Elle doit en etre l'inverse. Si le calcul d'enveloppe, la
  // reponse des filtres ou l'ajustement sont faux, ce test tombe.
  const corr = await page.evaluate(async () => {
    const fe = 24000, n = fe * 6;
    // Voix synthetique : harmoniques et souffle, plus realiste qu'un bruit pur.
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fe;
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * t);
      let v = 0;
      for (let h = 1; h <= 40; h++) v += Math.sin(2 * Math.PI * 170 * h * t + h) / h;
      d[i] = 0.3 * env * (v + 0.35 * (Math.random() - 0.5));
    }
    const reference = profilBandes(d, fe);

    // On applique un defaut connu : trop de bas, pas assez de haut — celui du
    // moteur, en plus marque.
    const ctx = new OfflineAudioContext(1, n, fe);
    const tampon = ctx.createBuffer(1, n, fe);
    tampon.copyToChannel(d, 0);
    const src = ctx.createBufferSource(); src.buffer = tampon;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'lowshelf'; f1.frequency.value = 300; f1.Q.value = 0.9; f1.gain.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'highshelf'; f2.frequency.value = 4500; f2.Q.value = 0.7; f2.gain.value = -7;
    src.connect(f1); f1.connect(f2); f2.connect(ctx.destination); src.start();
    const rendu = await ctx.startRendering();
    const abime = profilBandes(rendu.getChannelData(0), fe);

    const r = ajusterCorrection(reference, abime, fe);
    return { reference, abime, r,
             ecartInitial: reference.map((v,i) => abime[i]-v) };
  });

  // Le defaut qui a rendu la premiere version inutilisable : le lissage de
  // l'enveloppe dependait de la frequence d'echantillonnage du fichier. Prises
  // en 48 kHz contre generation en 24 kHz donnaient 13 dB d'artefact a
  // 80-160 Hz — du meme ordre que l'ecart cherche. La mesure doit donner le
  // meme profil pour le meme son, quelle que soit sa frequence.
  const calibre = await page.evaluate(() => {
    // Le signal est fabrique UNE fois a 48 kHz, puis reduit a 24 kHz en ne
    // gardant qu'un echantillon sur deux. Toutes ses harmoniques tiennent sous
    // 5 kHz, donc cette reduction n'introduit aucun repli : c'est exactement
    // le meme son, decrit a deux frequences. Le fabriquer separement a chaque
    // frequence donnerait deux sons differents, et le controle ne dirait rien.
    const fe = 48000, n = fe * 8;
    const haut = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fe;
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * t);
      let v = 0;
      // Harmoniques jusqu'a 10,9 kHz : toutes les bandes mesurees doivent
      // porter du signal. Avec un contenu qui s'arrete a 5 kHz, les bandes
      // hautes ne comparent que du bruit de calcul et le controle ment.
      for (let h = 1; h <= 68; h++) v += Math.sin(2 * Math.PI * 160 * h * t + h) / h;
      haut[i] = 0.3 * env * v;
    }
    const bas = new Float32Array(n >> 1);
    for (let i = 0; i < bas.length; i++) bas[i] = haut[i * 2];
    const a = profilBandes(haut, 48000);
    const b = profilBandes(bas, 24000);
    if (!a || !b) return null;
    const ecarts = a.map((v, i) => Math.abs(v - b[i]));
    return { moyen: ecarts.reduce((t, v) => t + v, 0) / ecarts.length,
             max: Math.max(...ecarts) };
  });
  verifier('La mesure ne dépend pas de la fréquence d\'échantillonnage',
    calibre && calibre.moyen < 1,
    calibre ? 'écart moyen ' + calibre.moyen.toFixed(2) + ' dB entre 48 et 24 kHz' : 'mesure impossible');
  verifier('Aucune bande ne dérive avec la fréquence',
    calibre && calibre.max < 0.5,
    calibre ? 'écart maximal ' + calibre.max.toFixed(2) + ' dB' : '');

  const maxAvant = Math.max(...corr.ecartInitial.map(Math.abs));
  verifier('Le défaut injecté est bien mesuré',
    maxAvant > 4, 'écart maximal mesuré ' + maxAvant.toFixed(1) + ' dB');
  verifier('La correction inverse le plateau bas injecté',
    corr.r.gains[0] < -3, 'plateau bas ' + corr.r.gains[0].toFixed(1) + ' dB pour +6 dB injectés');
  verifier('La correction inverse le plateau haut injecté',
    corr.r.gains[2] > 3, 'plateau haut ' + corr.r.gains[2].toFixed(1) + ' dB pour -7 dB injectés');
  verifier('La correction réduit nettement l\'écart',
    corr.r.ecartApres < corr.r.ecartAvant / 2,
    corr.r.ecartAvant.toFixed(1) + ' dB ramené à ' + corr.r.ecartApres.toFixed(1) + ' dB');

  // Un signal sain ne doit pas etre corrige : une correction qui invente un
  // defaut est pire que pas de correction du tout.
  const sain = await page.evaluate(() => {
    const fe = 24000, n = fe * 6;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fe;
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * t);
      let v = 0;
      for (let h = 1; h <= 40; h++) v += Math.sin(2 * Math.PI * 170 * h * t + h) / h;
      d[i] = 0.3 * env * (v + 0.35 * (Math.random() - 0.5));
    }
    const p = profilBandes(d, fe);
    const q = profilBandes(d.slice(0, n - 137), fe);   // même signal, cadrage différent
    return ajusterCorrection(p, q, fe);
  });
  // Ce qui est annonce doit etre ce qui est applique : les curseurs de gain
  // avancent par demi-decibel, et un gain calcule a -6,3 dB devenait -6,5 une
  // fois pose, sans que l'ecran le dise.
  const pose = await page.evaluate(() => {
    const g = ajusterCorrection([0,0,0,0,0,0,0,0,0],
                                [6.3,4.1,2.2,1.1,0,0,-2.3,-3.7,-4.9], 24000).gains;
    document.getElementById('graves').value = g[0];
    document.getElementById('basMed').value = g[1];
    document.getElementById('aigus').value = g[2];
    majTraitement();
    const c = chaineCourante().traitement;
    return { calcules: g, appliques: [c.graves, c.basMed, c.aigus] };
  });
  verifier('Les gains calculés sont exactement ceux appliqués',
    pose.calcules.every((v, i) => Math.abs(v - pose.appliques[i]) < 1e-9),
    'calculés ' + pose.calcules.join(' / ') + '  appliqués ' + pose.appliques.join(' / '));

  verifier('Aucune bande déjà juste n\'est sensiblement abîmée',
    corr.r.degradation <= 1.5 + 1e-9,
    'pire dégradation ' + corr.r.degradation.toFixed(2) + ' dB');

  verifier('Un signal déjà conforme n\'est presque pas corrigé',
    sain.gains.every(g => Math.abs(g) < 1.5),
    'gains ' + sain.gains.map(g => g.toFixed(1)).join(' / ') + ' dB');

  // Garde-fou : jamais de gain delirant, meme sur des profils absurdes.
  const borne = await page.evaluate(() => {
    const ref = [0,0,0,0,0,0,0,0,0];
    const fou = [40,40,40,0,0,0,-40,-40,-40];
    return ajusterCorrection(ref, fou, 24000).gains;
  });
  verifier('Les gains restent bornés sur des mesures absurdes',
    borne.every(g => Math.abs(g) <= 9 + 1e-9),
    'gains ' + borne.map(g => g.toFixed(1)).join(' / ') + ' dB');

  // Une comparaison entre deux voix sans rapport doit etre refusee, pas
  // appliquee : trois filtres butes a fond abimeraient le son.
  const refusComparaison = await page.evaluate(async () => {
    const avant = {
      graves: document.getElementById('graves').value,
      aigus: document.getElementById('aigus').value
    };
    await calculerCorrection();
    const texte = document.getElementById('resCorrection').textContent;
    return { texte, apres: {
      graves: document.getElementById('graves').value,
      aigus: document.getElementById('aigus').value
    }, avant };
  });
  verifier('Une comparaison inexploitable est refusée',
    refusComparaison.texte.indexOf('inexploitable') >= 0, refusComparaison.texte.slice(0, 80));
  verifier('Un refus ne touche à aucun réglage',
    refusComparaison.avant.graves === refusComparaison.apres.graves &&
    refusComparaison.avant.aigus === refusComparaison.apres.aigus,
    'graves ' + refusComparaison.avant.graves + ' -> ' + refusComparaison.apres.graves);

  console.log('\n--- Montage ---');

  const mont = await page.evaluate(async () => {
    const g = etat.generations[0];
    etat.montage = [];
    // Le meme audio deux fois : suffisant pour verifier l'ordre, le rognage,
    // les silences et la longueur du rendu.
    await ajouterAuMontage(g.id);
    await ajouterAuMontage(g.id);
    const cles = etat.montage.map(m => m.cle);
    // Rogner le premier, silence d'une seconde apres lui ; rien apres le second.
    await majChampMontage(cles[0], 'debut', '0.2');
    await majChampMontage(cles[0], 'fin', '0.3');
    await majChampMontage(cles[0], 'pause', '1');
    await majChampMontage(cles[1], 'pause', '0');
    const rendu = await construireMontage();
    const source = await decoderAudio(versionRetenue(g).blob);
    const attendu = (source.duration - 0.5) + 1 + source.duration;
    // Le deplacement doit marcher sans glisser-deposer aussi.
    await montageDeplacer(cles[1], -1);
    const ordre = etat.montage.map(m => m.cle);
    // Les silences inseres doivent etre du vrai silence.
    const d = rendu.donnees, fe = rendu.frequence;
    const debutSilence = Math.round((source.duration - 0.5) * fe) + Math.round(0.1 * fe);
    let creux = 0;
    for (let i = debutSilence; i < debutSilence + Math.round(0.5 * fe); i++) creux = Math.max(creux, Math.abs(d[i]));
    // Aucun saut brutal : un raccord mal fondu s'entend comme un clic.
    let saut = 0;
    for (let i = 1; i < d.length; i++) saut = Math.max(saut, Math.abs(d[i] - d[i-1]));
    const persiste = await bdLire('config', 'montage');
    return {
      duree: d.length / fe, attendu, ordre0: ordre[0], cle1: cles[1],
      creux, saut, nb: etat.montage.length,
      persiste: persiste && persiste.valeur ? persiste.valeur.length : 0,
      frequence: fe
    };
  });
  verifier('Le montage assemble les extraits bout à bout',
    Math.abs(mont.duree - mont.attendu) < 0.05,
    mont.duree.toFixed(2) + ' s pour ' + mont.attendu.toFixed(2) + ' s attendues');
  verifier('Le silence demandé est réellement silencieux',
    mont.creux < 1e-6, 'crête dans le silence : ' + mont.creux.toExponential(1));
  verifier('Aucune marche brutale aux raccords',
    mont.saut < 0.5, 'saut maximal ' + mont.saut.toFixed(3));
  verifier('L\'ordre se change sans glisser-déposer',
    mont.ordre0 === mont.cle1);
  // Les valeurs doivent etre LISIBLES dans les champs : un input « number »
  // rejette « 0,6 » et s'affiche vide, ce qu'une verification passant par les
  // fonctions internes ne voit pas.
  const champs = await page.evaluate(async () => {
    const g = etat.generations[0];
    etat.montage = [];
    await ajouterAuMontage(g.id);
    await majChampMontage(etat.montage[0].cle, 'debut', '0.25');
    afficherMontage();
    const vals = [...document.querySelectorAll('#listeMontage input[type=number]')]
      .map(i => i.value);
    return { vals, pause: etat.montage[0].pause, debut: etat.montage[0].debut };
  });
  verifier('Les champs du montage affichent leur valeur',
    champs.vals.length === 3 && champs.vals.every(v => v !== ''),
    'valeurs affichées : ' + JSON.stringify(champs.vals));
  verifier('Le silence par défaut est visible et non nul',
    Number(champs.vals[2]) === champs.pause && champs.pause > 0,
    champs.vals[2] + ' s');
  verifier('Le rognage saisi est relu correctement',
    Number(champs.vals[0]) === 0.25, champs.vals[0]);

  verifier('Le montage est conservé d\'une session à l\'autre',
    mont.persiste === mont.nb, mont.persiste + ' extrait(s) en base');

  const vide = await page.evaluate(async () => {
    await viderMontage();
    let erreur = null;
    try { await construireMontage(); } catch (e) { erreur = e.message; }
    return { nb: etat.montage.length, erreur };
  });
  verifier('Vider le montage le vide vraiment', vide.nb === 0);
  verifier('Un montage vide est refusé proprement',
    !!vide.erreur && vide.erreur.indexOf('vide') >= 0, vide.erreur);

  console.log('\n--- Adresse du serveur ---');

  // Le serveur sert lui-meme la page. Une adresse par defaut ecrite en dur
  // produisait, des que le serveur passait en https, des appels en http
  // bloques par le navigateur — et signales comme un serveur eteint.
  const adresse = await page.evaluate(() => ({
    defaut: urlParDefaut(),
    courante: urlLocale(),
    origine: location.origin,
    melange: melangeInterdit()
  }));
  verifier('L\'adresse par défaut suit l\'origine de la page',
    adresse.defaut === adresse.origine, adresse.defaut);
  verifier('L\'adresse employée est appelable depuis la page',
    adresse.melange === false, adresse.courante);

  const mixte = await page.evaluate(() => {
    const champ = document.getElementById('urlLocale');
    const avant = champ.value;
    champ.value = 'http://127.0.0.1:8770';
    const bloque = melangeInterdit();
    const propose = bloque ? urlCorrigee() : null;
    const message = bloque ? messageReseau(new TypeError('Load failed')) : '';
    champ.value = avant;
    return { bloque, propose, message, https: location.protocol === 'https:' };
  });
  if (mixte.https) {
    verifier('Une adresse en http est reconnue comme inappelable', mixte.bloque);
    verifier('Le message ne met pas la panne sur le dos du serveur',
      mixte.message.indexOf('serveur n\'est pas en cause') >= 0, mixte.message.slice(0, 90));
    verifier('Une adresse corrigée est proposée',
      mixte.propose === mixte_origine_attendue(), mixte.propose);
  } else {
    verifier('En http, aucune adresse n\'est déclarée inappelable', mixte.bloque === false);
  }

  console.log('\n--- Pièges connus ---');

  await page.evaluate(() => go(1));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    if (document.getElementById('reglagesConnexion').style.display === 'none') basculerReglages();
  });
  await page.waitForTimeout(300);
  await page.click('#radioCatalogue');
  await page.waitForTimeout(500);
  verifier('Le catalogue masque bien l\'enregistreur',
    !(await page.locator('#btnRec').isVisible()));
  verifier('Le fournisseur d\'avant est retenu',
    (await page.evaluate(() => etat.fournisseurAvant)) === 'local');
  await page.click('#zoneCatalogue button:has-text("Enregistrer ma voix")');
  await page.waitForTimeout(600);
  verifier('Le retour au clonage rend l\'enregistreur',
    await page.locator('#btnRec').isVisible());
  verifier('Le retour rétablit le serveur local',
    (await page.evaluate(() => etat.fournisseur)) === 'local');

  // Un réglage incomplet ne doit pas faire échouer la chaîne
  const resiste = await page.evaluate(async () => {
    try {
      await appliquerTraitement(new Blob([new Uint8Array(2000)], {type:'audio/wav'}),
        {traitement:{graves:-3}, nettoyage:null, resolution:16, frequence:0, loudness:'0'});
      return 'ok';
    } catch (e) { return e.message; }
  });
  verifier('Un réglage incomplet ne casse pas la génération', resiste === 'ok', resiste);

  verifier('Une erreur locale n\'est pas imputée au serveur',
    await page.evaluate(() =>
      messageReseau(new RangeError('valeur non finie')).includes('dans la page')));

  // ════════ ASSISTANT ════════
  console.log('\n--- Assistant ---');

  const chat = await ctx.newPage();
  chat.on('pageerror', e => erreurs.push('PAGEERROR: ' + e.message));
  await chat.goto(BASE + '/chat');
  await chat.waitForTimeout(1500);
  verifier('Assistant servi par le serveur',
    (await chat.textContent('.bandeau')).includes('Assistant automatique'));
  verifier('Nature du service annoncée dès l\'accueil',
    (await chat.textContent('#fil')).includes('voix de synthèse'));
  await chat.fill('#message', 'Bonjour, qui êtes-vous ?');
  await chat.click('#btnEnvoyer');
  await chat.waitForTimeout(9000);
  verifier('Échange abouti, réponse lue à voix haute',
    (await chat.locator('.tour').count()) === 3 &&
    (await chat.locator('.tour.lui:last-child audio').count()) === 1);
  verifier('Le moteur de contrôle signale ses réponses fabriquées',
    (await chat.textContent('.tour.lui:last-child')).includes('fabriquée'));
  const refus = await chat.evaluate(async () => (await fetch('/v1/chat', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({messages: [{role: 'assistant', content: 'à moi'}]})
  })).status);
  verifier('Le serveur refuse un échange mal formé', refus === 422, 'code ' + refus);
  await chat.close();

  // ════════ MOBILE ════════
  await page.setViewportSize({ width: 400, height: 900 });
  await page.waitForTimeout(400);
  verifier('Pas de débordement horizontal en mobile', !(await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)));

  console.log('\n--- Erreurs console/page ---');
  console.log(erreurs.length ? erreurs.join('\n') : 'aucune');
  const ko = verifs.filter(v => !v.ok).length;
  console.log('\nRESULTAT : ' + (verifs.length - ko) + '/' + verifs.length + ' vérifications réussies');
  await nav.close();
  process.exit(ko || erreurs.length ? 1 : 0);
})();
