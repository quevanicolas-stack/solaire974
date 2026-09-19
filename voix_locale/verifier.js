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
  verifier('Sous la cible, la jauge n\'ajoute aucun commentaire',
    jauge.normal === '', JSON.stringify(jauge.normal));
  verifier('Au-delà de la cible, la jauge dit où va le surplus',
    jauge.depasse.length > 0 && jauge.depasse.indexOf('affinage') >= 0, jauge.depasse);
  verifier('Au plafond, la jauge annonce le refus des prises suivantes',
    jauge.plein.indexOf('refus') >= 0, jauge.plein);
  verifier('Une prise qui dépasserait le plafond est refusée',
    jauge.refus === false);

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
