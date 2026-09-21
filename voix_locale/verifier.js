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

// Le consentement n'est plus une page mais le passage oblige de toute
// creation de profil : sans profil, aucune autre etape n'est accessible.
async function consentir(page, usage, nom) {
  await page.click('button:has-text("Créer un profil")');
  await page.waitForTimeout(300);
  await page.click('#zoneOrigine .radio:nth-child(1)');
  await page.fill('#consNom', nom || 'Nicolas Queva');
  await page.fill('#consUsage', usage);
  for (let i = 1; i <= 4; i++) await page.check('#cons' + i);
  await page.click('button:has-text("Créer le profil")');
  await page.waitForTimeout(600);
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

  verifier('Quatre pages, profils en tête',
    await page.evaluate(() => PAGES.length === 4 && PAGES[0].t === 'Profils'));
  verifier('Sans profil, toutes les autres pages sont barrées',
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

  // Le formulaire d'accord conditionne la creation : un engagement manquant,
  // un champ vide, et aucun profil n'est cree.
  const refusCons = await page.evaluate(async () => {
    const avant = etat.profils.length;
    ouvrirConsentement();
    document.querySelector('#zoneOrigine .radio').click();
    document.getElementById('consNom').value = 'Personne';
    document.getElementById('consUsage').value = 'essai';
    for (let i = 1; i <= 3; i++) document.getElementById('cons' + i).checked = true;
    await creerProfil();                       // le quatrieme engagement manque
    const troisCoches = etat.profils.length;
    document.getElementById('consUsage').value = '';
    document.getElementById('cons4').checked = true;
    await creerProfil();                       // l'usage manque
    const sansUsage = etat.profils.length;
    const ouverte = document.getElementById('modaleConsentement').style.display !== 'none';
    fermerConsentement();
    return { avant, troisCoches, sansUsage, ouverte };
  });
  verifier('Trois engagements sur quatre ne créent aucun profil',
    refusCons.troisCoches === refusCons.avant,
    refusCons.troisCoches + ' profil(s) pour ' + refusCons.avant + ' avant');
  verifier('Un usage non renseigné ne crée aucun profil',
    refusCons.sansUsage === refusCons.avant, String(refusCons.sansUsage));
  verifier('Le formulaire reste ouvert tant qu\'il est incomplet', refusCons.ouverte);
  verifier('Aucun profil ne peut exister sans consentement',
    await page.evaluate(() => etat.profils.every(p => !!p.consentement && !!p.consentement.nom)));
  verifier('Aucune clé écrite en dur dans le fichier',
    !(await page.content()).match(/sk-ant|xi-api-key["']\s*:\s*["'][A-Za-z0-9]{16}/));

  // Navigation refusée tant que le consentement n'est pas complet
  await page.evaluate(() => go(1));
  await page.waitForTimeout(400);
  verifier('Navigation refusée sans consentement',
    await page.evaluate(() =>
      [...document.querySelectorAll('.page')].findIndex(p => p.classList.contains('on')) === 0));

  await consentir(page, 'Vérifications automatiques');
  verifier('Créer un profil exige et enregistre le consentement',
    await page.evaluate(() => {
      const p = profilActif();
      return !!p && !!p.consentement && p.consentement.usage === 'Vérifications automatiques';
    }));
  await page.evaluate(() => go(1));
  await page.waitForTimeout(500);
  verifier('Navigation ouverte une fois le profil créé',
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

  // La generation n'entre plus en bibliotheque : elle attend un choix.
  const gen = await page.evaluate(() => {
    const g = etat.generationEnCours;
    if (!g) return null;
    const v = g.versions;
    return { noms: Object.keys(v).map(k => v[k].nom),
             raisons: (g.raisons || []).length, taille: v.votre.blob.size };
  });
  verifier('Audio généré', !!gen, gen ? gen.taille + ' octets' : 'aucun');
  verifier('Préfixe voix-synthetique sur les trois versions',
    gen && gen.noms.length === 3 && gen.noms.every(n => n && n.startsWith('voix-synthetique_')),
    gen ? gen.noms.join(' | ') : '');
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

  // Retouche : rejouer les reglages sans refaire parler le moteur.
  //
  // Le piege a eviter est l'empilement : si la retouche repartait de la
  // version affichee, l'egaliseur s'ajouterait a lui-meme a chaque essai et
  // deux retouches identiques ne donneraient pas le meme son.
  // L'empreinte porte sur les echantillons decodes, pas sur une bande : le
  // moteur de test n'emet rien entre 1 et 4 kHz, et un profil cale sur cette
  // bande-la ne compare que du bruit de calcul.
  const retouche = await page.evaluate(async () => {
    const empreinte = async (blob) => {
      const a = await decoderAudio(blob);
      const d = a.getChannelData(0);
      let carres = 0, somme = 0;
      for (let i = 0; i < d.length; i++) { carres += d[i] * d[i]; somme += Math.abs(d[i]); }
      return { n: d.length, rms: Math.sqrt(carres / d.length), somme: somme };
    };
    const ecart = (a, b) =>
      Math.abs(a.rms - b.rms) / Math.max(a.rms, b.rms, 1e-12) +
      Math.abs(a.somme - b.somme) / Math.max(a.somme, b.somme, 1e-12);

    const g = etat.generationEnCours;
    const departBrut = g.versions.brut.blob;
    const sourceAvant = g.source;
    const poser = (grave) => {
      document.getElementById('traitementActif').checked = true;
      document.getElementById('preset').value = 'perso';
      document.getElementById('graves').value = grave;
      majTraitement();
    };

    poser(6);  await retoucher();  const a1 = await empreinte(g.versions.votre.blob);
    // Meme reglage une seconde fois : le resultat doit etre identique.
    await retoucher();             const a2 = await empreinte(g.versions.votre.blob);
    // Un autre reglage doit changer quelque chose.
    poser(-6); await retoucher();  const b1 = await empreinte(g.versions.votre.blob);
    // Revenir au premier reglage doit redonner exactement le premier son.
    // Si la retouche repartait de la version affichee, l'egaliseur se serait
    // empile trois fois et ce retour serait impossible.
    poser(6);  await retoucher();  const a3 = await empreinte(g.versions.votre.blob);

    return {
      repete: ecart(a1, a2), retour: ecart(a1, a3), change: ecart(a1, b1),
      sourceIntacte: g.source === sourceAvant,
      brutIntact: g.versions.brut.blob === departBrut,
      bouton: !!document.getElementById('btnRetoucher'),
      nom: g.versions.votre.nom
    };
  });
  verifier('La retouche est proposée sur l\'écran de génération', retouche.bouton);
  verifier('La retouche modifie bien le son',
    retouche.change > 0.01, 'écart relatif ' + retouche.change.toExponential(1));
  verifier('Deux retouches identiques donnent le même son',
    retouche.repete < 1e-9, 'écart ' + retouche.repete.toExponential(1));
  verifier('Revenir à un réglage précédent le reproduit, sans cumul',
    retouche.retour < 1e-9, 'écart ' + retouche.retour.toExponential(1));
  verifier('La retouche ne touche ni la source ni la version non traitée',
    retouche.sourceIntacte && retouche.brutIntact);
  verifier('La version retouchée garde le préfixe voix-synthetique',
    retouche.nom.startsWith('voix-synthetique_'), retouche.nom);

  const choix = await page.evaluate(async () => {
    const g = etat.generationEnCours;
    const avantBiblio = etat.generations.length;
    await chargerVersion(g.id, 'propose');
    const entree = etat.generations.find(x => x.id === g.id);
    const enBase = await bdLire('generations', g.id);
    const libelle = document.getElementById('charger_propose').textContent.trim();
    // Charger une seconde fois doit remplacer, pas ajouter.
    await chargerVersion(g.id, 'brut');
    const apresDeux = etat.generations.filter(x => x.id === g.id).length;
    const finale = etat.generations.find(x => x.id === g.id);
    afficherGenerations();
    const btns = [...document.querySelectorAll('#listeGen button')].map(b => b.textContent.trim());
    return { avantBiblio, apres: etat.generations.length, entree, libelle,
             persiste: enBase ? enBase.version : null, apresDeux,
             versionFinale: finale ? finale.version : null,
             clesEntree: entree ? Object.keys(entree) : [],
             btns, texte: document.getElementById('listeGen').textContent };
  });
  verifier('Rien n\'entre en bibliothèque sans choix explicite',
    choix.avantBiblio === 0, choix.avantBiblio + ' entrée(s) avant « Charger »');
  verifier('Charger dépose la version écoutée',
    choix.apres === 1 && choix.entree.version === 'propose',
    choix.apres + ' entrée(s), version ' + (choix.entree || {}).version);
  verifier('Le choix est conservé en base', choix.persiste === 'propose', String(choix.persiste));
  verifier('L\'entrée ne porte qu\'un seul audio',
    !choix.clesEntree.includes('versions') && !choix.clesEntree.includes('propose'),
    choix.clesEntree.join(' '));
  verifier('Charger une seconde fois remplace au lieu d\'ajouter',
    choix.apresDeux === 1 && choix.versionFinale === 'brut',
    choix.apresDeux + ' entrée(s), version ' + choix.versionFinale);
  verifier('Le bouton dit que la version est chargée', choix.libelle === 'Chargée', choix.libelle);
  verifier('La bibliothèque annonce la version conservée',
    choix.texte.indexOf('non traitée') >= 0);
  verifier('La bibliothèque propose un seul téléchargement',
    choix.btns.filter(n => n === 'Télécharger').length === 1, choix.btns.join(' | '));

  verifier('Bouton rendu après génération', await page.evaluate(() => {
    const b = document.getElementById('btnSynth');
    return b.textContent.trim() === "Générer l'audio" && !b.disabled && !b.querySelector('.spin');
  }));

  // ════════ RÉGLAGES ════════
  console.log('\n--- Réglages ---');

  // Les reglages ont rejoint l'etape 02 : on s'y place pour les manipuler.
  await page.evaluate(() => go(1));
  await page.waitForTimeout(400);

  verifier('Suppression du bruit de fond réglable',
    (await page.locator('#debruitage').count()) === 1 &&
    (await page.inputValue('#debruitage')) === 'moyen');
  verifier('Niveau sonore normalisé proposé',
    (await page.locator('#loudness').count()) === 1);
  verifier('Commande directe du moteur présente',
    (await page.locator('#temperature, #topP, #topK, #graine').count()) === 4);

  // Les reglages qu'aucun moteur local ne lit ont ete retires. Un reglage
  // sans effet finit par etre regle, et le bouger basculait le style en
  // « Personnalise », ce qui changeait le rythme sans rien ameliorer.
  const retires = await page.evaluate(() => {
    const ids = ['similarite', 'style', 'boost'].filter(i => document.getElementById(i));
    const envoye = Object.keys(reglagesMoteur());
    return { ids, envoye };
  });
  verifier('Similarité, expressivité et renforcement du locuteur retirés de la page',
    retires.ids.length === 0, retires.ids.join(' ') || 'aucun reliquat');
  verifier('Aucun de ces réglages n\'est encore transmis au moteur',
    !['similarity_boost', 'style', 'use_speaker_boost'].some(k => retires.envoye.includes(k)),
    retires.envoye.join(' '));

  // La graine etait envoyee a chaque generation et valait 1234 par defaut :
  // meme texte, meme audio a l'octet pres. Une phrase mal dite le restait, et
  // relancer n'y changeait rien. Elle ne part plus que si on la fixe.
  const graine = await page.evaluate(() => {
    document.getElementById('graineFixe').checked = false;
    const libre = reglagesMoteur().seed;
    document.getElementById('graineFixe').checked = true;
    document.getElementById('graine').value = '4321';
    const fixee = reglagesMoteur().seed;
    document.getElementById('graineFixe').checked = false;
    return { libre, fixee };
  });
  verifier('Aucune graine n\'est transmise par défaut',
    graine.libre === undefined, 'graine envoyée : ' + String(graine.libre));
  verifier('La graine n\'est transmise que si on la fixe',
    graine.fixee === 4321, String(graine.fixee));

  // L'ecran annonce ce que le serveur deduirait : deux formules divergentes le
  // feraient mentir. La pente s'arrete a 0,45 pour ne pas pousser le decodeur
  // dans la zone ou il boucle.
  // La stabilite n'est plus un curseur : elle ne servait qu'a deduire trois
  // valeurs, et cessait d'etre lue des qu'on pilotait le moteur a la main.
  // La formule survit pour les styles d'elocution, qui restent decrits par
  // une stabilite — et elle doit rester celle du serveur.
  const deduites = await page.evaluate(() => ({
    bas: valeursDeduites(0).temperature,
    milieu: valeursDeduites(0.5).temperature,
    haut: valeursDeduites(1).temperature
  }));
  verifier('La température déduite suit la pente attendue',
    Math.abs(deduites.bas - 0.85) < 1e-9 && Math.abs(deduites.milieu - 0.65) < 1e-9 &&
    Math.abs(deduites.haut - 0.45) < 1e-9,
    [deduites.bas, deduites.milieu, deduites.haut].map(v => v.toFixed(2)).join(' / '));
  verifier('La stabilité maximale ne descend pas dans la zone de bouclage',
    deduites.haut >= 0.45 - 1e-9, 'température à stabilité 1 : ' + deduites.haut.toFixed(2));
  // Un reglage qui n'agit plus ne doit pas rester affiche : c'est le defaut
  // deja corrige pour les reglages du profil et pour similarity_boost.
  verifier('Le curseur de stabilité a disparu de la page',
    await page.evaluate(() => !document.getElementById('stabilite')));
  verifier('La commande directe n\'est plus optionnelle',
    await page.evaluate(() => !document.getElementById('avanceActif')));
  verifier('Tout ce qui pilote le moteur part réellement au moteur',
    await page.evaluate(() => {
      const v = reglagesMoteur();
      return ['temperature','top_p','top_k','repetition_penalty','length_penalty']
        .every(c => typeof v[c] === 'number' && isFinite(v[c]));
    }), JSON.stringify(await page.evaluate(() => reglagesMoteur())).slice(0, 110));

  // Le debit est un etirement applique par le moteur : loin de 1,00 il abime
  // l'elocution. La course s'arrete donc avant.
  const debit = await page.evaluate(() => {
    const d = document.getElementById('debit');
    return { min: parseFloat(d.min), max: parseFloat(d.max) };
  });
  verifier('La course du débit reste dans la zone saine du moteur',
    debit.min >= 0.8 - 1e-9 && debit.max <= 1.2 + 1e-9,
    debit.min + ' à ' + debit.max);

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

  console.log('\n--- Mise en forme du texte ---');

  // L'auteur ecrit des paragraphes pour placer ses pauses. Un style ne doit
  // jamais en fabriquer d'autres : les siens noieraient ceux de l'auteur.
  const pitch = "Une croyance bloque beaucoup de monde. Elle est tenace.\n\n" +
                "Regardez les dirigeants respectés. Aucun n'a gommé son accent.\n\n" +
                "Alors pourquoi ce blocage ?";
  const formes = await page.evaluate((pitch) => {
    const out = {};
    for (const cle of ['perso', 'narrateur', 'journal', 'enseignant', 'livre']) {
      document.getElementById('elocution').value = cle;
      appliquerElocution();
      const t = preparerTexte(pitch, cle);
      out[cle] = { blancs: (t.match(/\n\n/g) || []).length,
                   pausePhrase: reglagesMoteur().pause_phrase };
    }
    return out;
  }, pitch);
  const voulus = 2;
  for (const cle of Object.keys(formes)) {
    verifier('Le style « ' + cle + ' » respecte les paragraphes de l\'auteur',
      formes[cle].blancs === voulus,
      formes[cle].blancs + ' paragraphe(s) pour ' + voulus + ' voulu(s)');
  }
  verifier('Un style à pauses marquées allonge la pause de phrase',
    formes.narrateur.pausePhrase > formes.journal.pausePhrase,
    'narrateur ' + formes.narrateur.pausePhrase + ' s, journal ' + formes.journal.pausePhrase + ' s');

  // Bouger un curseur bascule en personnalise : le texte transmis ne doit pas
  // changer pour autant, sinon le rythme change sans que rien ne l'annonce.
  const bascule = await page.evaluate((pitch) => {
    document.getElementById('elocution').value = 'narrateur';
    appliquerElocution();
    const avant = { texte: preparerTexte(pitch, 'narrateur'),
                    phrase: reglagesMoteur().pause_phrase };
    const c = document.getElementById('temperature');
    c.value = '0.9'; c.dispatchEvent(new Event('input', {bubbles:true}));
    const apres = { style: document.getElementById('elocution').value,
                    texte: preparerTexte(pitch, document.getElementById('elocution').value),
                    phrase: reglagesMoteur().pause_phrase };
    return { avant, apres };
  }, pitch);
  verifier('Bouger un curseur bascule bien en personnalisé',
    bascule.apres.style === 'perso', bascule.apres.style);
  verifier('Bouger un curseur ne change pas le texte transmis',
    bascule.avant.texte === bascule.apres.texte);
  verifier('Bouger un curseur ne change pas la durée des pauses',
    bascule.avant.phrase === bascule.apres.phrase,
    bascule.avant.phrase + ' s puis ' + bascule.apres.phrase + ' s');

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

  // Une generation est un tirage du moteur, pas le moteur. La correction doit
  // se deduire de TOUTES les versions non traitees disponibles, moyennees, et
  // annoncer combien elle en a vu.
  const moyenne = await page.evaluate(async () => {
    const fe = 24000, n = fe * 6;
    // Deux sons de la meme voix, avec deux equilibres differents : la moyenne
    // des deux profils doit tomber entre les deux, exactement au milieu.
    const faire = (pente) => {
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / fe;
        const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * t);
        let v = 0;
        for (let h = 1; h <= 60; h++) v += Math.sin(2 * Math.PI * 180 * h * t + h) / Math.pow(h, pente);
        // Amplitude basse a dessein : encoderWav ecrete a plus ou moins un,
        // et un ecretage change le spectre mesure.
        d[i] = 0.12 * env * v;
      }
      return encoderWav(d, fe, 16);
    };
    const a = faire(1), b = faire(1.4);
    const pa = await profilDeBlob(a), pb = await profilDeBlob(b);
    const m = await profilDesGenerations([a, b]);
    const seul = await profilDesGenerations([a]);
    const ecart = m.profil.map((v, i) => Math.abs(v - (pa[i] + pb[i]) / 2));
    const etendues = pa.map((v, i) => Math.abs(v - pb[i]));
    return {
      nb: m.nb, ecartMax: Math.max(...ecart),
      dispersion: m.dispersion,
      etendueVraie: etendues.reduce((t, v) => t + v, 0) / etendues.length,
      nbSeul: seul.nb, dispersionSeul: seul.dispersion,
      identique: pa.every((v, i) => Math.abs(v - seul.profil[i]) < 1e-9)
    };
  });
  verifier('La correction moyenne toutes les générations non traitées',
    moyenne.nb === 2 && moyenne.ecartMax < 1e-9,
    moyenne.nb + ' générations, écart à la moyenne ' + moyenne.ecartMax.toExponential(1) + ' dB');
  verifier('La dispersion entre générations est mesurée',
    Math.abs(moyenne.dispersion - moyenne.etendueVraie) < 1e-9,
    'annoncée ' + moyenne.dispersion.toFixed(2) + ' dB, réelle ' + moyenne.etendueVraie.toFixed(2) + ' dB');
  verifier('Une génération seule reste son propre profil',
    moyenne.nbSeul === 1 && moyenne.identique && moyenne.dispersionSeul === 0,
    moyenne.nbSeul + ' génération, dispersion ' + moyenne.dispersionSeul);

  // La version non traitee chargee en bibliotheque porte le meme identifiant
  // que la generation en cours : comptee deux fois, l'ecran annoncerait deux
  // tirages la ou il n'y en a qu'un.
  const sources = await page.evaluate(async () => {
    const avant = versionsNonTraitees().length;
    const memeId = etat.generationEnCours &&
      etat.generations.some(g => g.id === etat.generationEnCours.id && g.version === 'brut');
    // Une entree traitee ne doit jamais entrer dans la mesure.
    const g0 = etat.generations[0];
    const traitee = Object.assign({}, g0, { id: 'entree-traitee', version: 'propose' });
    etat.generations.push(traitee);
    const avecTraitee = versionsNonTraitees().length;
    // Une seconde generation non traitee, elle, doit compter.
    const autre = Object.assign({}, g0, { id: 'autre-brut', version: 'brut' });
    etat.generations.push(autre);
    const avecAutre = versionsNonTraitees().length;
    etat.generations = etat.generations.filter(
      g => g.id !== 'entree-traitee' && g.id !== 'autre-brut');
    return { avant, memeId, avecTraitee, avecAutre };
  });
  verifier('La même génération n\'est jamais comptée deux fois',
    sources.memeId && sources.avant === 1,
    sources.avant + ' source(s) pour une génération chargée en bibliothèque');
  verifier('Une version traitée n\'entre pas dans la mesure',
    sources.avecTraitee === 1, sources.avecTraitee + ' source(s) après ajout d\'une version traitée');
  verifier('Une autre génération non traitée entre dans la mesure',
    sources.avecAutre === 2, sources.avecAutre + ' source(s) après ajout d\'une seconde non traitée');

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

  // Le chemin qui reussit, de bout en bout, jusqu'a l'ecran : le seul controle
  // qui lise ce que l'utilisateur voit apres un calcul abouti.
  //
  // La generation et la prise sont fabriquees ici, et non reprises du moteur
  // de test : celui-ci n'emet que trois harmoniques, donc rien au-dessus de
  // 500 Hz. La bande 1-4 kHz sur laquelle tout se cale n'y porte que du bruit
  // de calcul, et la correction deduite serait sans rapport avec le defaut
  // introduit. Un signal de controle doit porter du signal dans TOUTES les
  // bandes mesurees — le piege est deja connu, ne pas y retomber.
  //
  // La prise est la generation deformee par un plateau bas de +5 dB : les deux
  // profils decrivent alors la meme voix, et la correction doit remonter le
  // grave de la generation d'a peu pres autant.
  const succes = await page.evaluate(async () => {
    const memoireEch = etat.echantillons;
    const memoireBrut = etat.generationEnCours.versions.brut.blob;
    const fe = 24000, n = fe * 6;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fe;
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * t);
      let v = 0;
      for (let h = 1; h <= 68; h++) v += Math.sin(2 * Math.PI * 160 * h * t + h) / h;
      d[i] = 0.12 * env * v;
    }
    const ctx = new OfflineAudioContext(1, n, fe);
    const t = ctx.createBuffer(1, n, fe);
    t.copyToChannel(d, 0);
    const s = ctx.createBufferSource(); s.buffer = t;
    const f = ctx.createBiquadFilter();
    f.type = 'lowshelf'; f.frequency.value = 250; f.Q.value = 1.1; f.gain.value = 5;
    s.connect(f); f.connect(ctx.destination); s.start();
    const rendu = await ctx.startRendering();

    etat.generationEnCours.versions.brut.blob = encoderWav(d, fe, 16);
    etat.echantillons = [{ id: 'controle', nom: 'controle.wav',
      blob: encoderWav(rendu.getChannelData(0), fe, 16) }];
    await calculerCorrection();
    const texte = document.getElementById('resCorrection').textContent;
    const gains = ['graves', 'basMed', 'aigus']
      .map(k => parseFloat(document.getElementById(k).value));
    etat.echantillons = memoireEch;
    etat.generationEnCours.versions.brut.blob = memoireBrut;
    return { texte, gains, preset: document.getElementById('preset').value,
             actif: document.getElementById('traitementActif').checked };
  });
  verifier('Une comparaison exploitable aboutit à une correction',
    succes.texte.indexOf('Correction calculée') >= 0, succes.texte.slice(0, 70));
  verifier('L\'écran dit sur combien de prises et de générations il a mesuré',
    /sur\s+\d+\s+prise\(s\)\s+et\s+\d+\s+génération\(s\)/.test(succes.texte),
    succes.texte.slice(0, 70));
  verifier('L\'écran dit si une seule génération a servi',
    succes.texte.indexOf('un seul tirage') >= 0 ||
    /générations non traitées moyennées/.test(succes.texte),
    succes.texte.indexOf('un seul tirage') >= 0 ? 'une seule génération, annoncée' : 'plusieurs, moyennées');
  verifier('La correction retrouve le défaut introduit dans la prise',
    succes.gains[0] >= 3 && succes.gains[0] <= 6,
    'plateau bas ' + succes.gains[0] + ' dB pour +5 dB de graves dans la prise');
  verifier('La correction laisse l\'égaliseur actif et en personnalisé',
    succes.actif && succes.preset === 'perso', succes.preset);

  console.log('\n--- Profils et verrouillage ---');

  await page.evaluate(() => go(1));
  await page.waitForTimeout(400);

  // Le texte d'essai doit etre la, assez long pour que le decoupage joue et
  // pour porter plusieurs longueurs de phrase : c'est sur lui qu'on regle.
  const essai = await page.evaluate(() => ({
    present: !!document.getElementById('texteEssai'),
    rempli: (document.getElementById('texteEssai').value || '').length,
    paragraphes: (document.getElementById('texteEssai').value || '').split(/\n\s*\n/).length,
    bouton: !!document.getElementById('btnEssai')
  }));
  verifier('Un texte d\'essai est proposé à l\'étape 02',
    essai.present && essai.bouton && essai.rempli > 400,
    essai.rempli + ' caractères');
  verifier('Le texte d\'essai est assez long pour que le découpage joue',
    essai.rempli > 230, essai.rempli + ' caractères pour une limite de 230 par morceau');
  verifier('Le texte d\'essai porte plusieurs paragraphes',
    essai.paragraphes >= 3, essai.paragraphes + ' paragraphe(s)');

  // Le verrou : les reglages du profil doivent primer sur les curseurs
  // affiches, sinon il ne sert a rien.
  const verrouillage = await page.evaluate(async () => {
    const p = profilActif();
    document.getElementById('temperature').value = 0.75;
    document.getElementById('debit').value = 0.95;
    majReglages();
    await verrouillerReglages();
    const fige = { verrouille: p.verrouille, temp: p.reglages.nombres.temperature,
                   cache: document.getElementById('blocReglagesProfil').style.display,
                   remplace: document.getElementById('blocVerrouille').style.display };

    // On deregle les curseurs : une generation verrouillee doit les ignorer.
    document.getElementById('temperature').value = 0.20;
    document.getElementById('debit').value = 1.20;
    majReglages();
    const repose = reglagesDeGeneration();
    const pendant = parseFloat(document.getElementById('temperature').value);
    if (repose) appliquerReglagesProfil(repose);
    const apres = parseFloat(document.getElementById('temperature').value);

    await deverrouillerReglages();
    const rouvert = p.verrouille;
    return { fige, pendant, apres, rouvert };
  });
  verifier('Verrouiller fige les réglages sur le profil',
    verrouillage.fige.verrouille && Math.abs(verrouillage.fige.temp - 0.75) < 1e-9,
    'température figée à ' + verrouillage.fige.temp);
  verifier('Une génération verrouillée reprend les réglages du profil',
    Math.abs(verrouillage.pendant - 0.75) < 1e-9,
    'température employée : ' + verrouillage.pendant + ' malgré 0,20 affiché');
  verifier('Les curseurs affichés sont rendus intacts après la génération',
    Math.abs(verrouillage.apres - 0.20) < 1e-9, String(verrouillage.apres));
  // Masquer la chaine sans rien dire ferait croire a une page cassee.
  verifier('Verrouillé, un encadré prend la place de la chaîne',
    verrouillage.fige.cache === 'none' && verrouillage.fige.remplace === 'block',
    'chaîne ' + verrouillage.fige.cache + ', encadré ' + verrouillage.fige.remplace);
  verifier('Les réglages peuvent être rouverts', verrouillage.rouvert === false);

  // Deux profils ne partagent ni leurs prises, ni leur voix, ni leurs reglages.
  const deux = await page.evaluate(async () => {
    const premier = profilActif();
    // Compte pris en base, et non en memoire : la suite a manipule
    // etat.echantillons directement plus haut pour eprouver les plafonds, et
    // c'est bien la base qui fait foi au changement de profil.
    const nbPrises = (await bdTout('echantillons'))
      .filter(e => e.profilId === premier.id).length;
    premier.reglages = reglagesDuProfil();
    premier.verrouille = true;
    await enregistrerProfilActif();

    ouvrirConsentement();
    document.querySelector('#zoneOrigine .radio:nth-child(2)').click();
    document.getElementById('consNom').value = 'Deuxième personne';
    document.getElementById('consUsage').value = 'second profil';
    for (let i = 1; i <= 4; i++) document.getElementById('cons' + i).checked = true;
    await creerProfil();

    const second = profilActif();
    const isole = {
      autre: second.id !== premier.id,
      prises: etat.echantillons.length,
      voix: etat.voixId,
      verrouille: second.verrouille,
      consentementPropre: second.consentement.nom
    };
    await activerProfil(premier.id);
    return { nbPrises, isole, retour: etat.echantillons.length,
             voixRevenue: etat.voixId, nb: etat.profils.length };
  });
  verifier('Un second profil part de zéro : aucune prise héritée',
    deux.isole.autre && deux.isole.prises === 0,
    deux.isole.prises + ' prise(s) pour le nouveau profil');
  verifier('Un second profil n\'hérite ni de la voix ni du verrou',
    deux.isole.voix === null && deux.isole.verrouille === false,
    'voix ' + deux.isole.voix);
  verifier('Chaque profil porte son propre consentement',
    deux.isole.consentementPropre === 'Deuxième personne', deux.isole.consentementPropre);
  verifier('Revenir au premier profil rend ses prises et sa voix',
    deux.retour === deux.nbPrises && deux.nbPrises > 0 && !!deux.voixRevenue,
    deux.retour + ' prise(s) retrouvée(s) sur ' + deux.nbPrises + ' en base');

  // Les prises portent leur profil : sans cela, changer de profil afficherait
  // les prises de l'autre.
  verifier('Chaque prise est rattachée à un profil',
    await page.evaluate(async () =>
      (await bdTout('echantillons')).every(e => !!e.profilId)));

  console.log('\n--- Chaîne de production, étage par étage ---');

  // Six etages pour UNE prononciation, et chacun avec son bouton. Le piege
  // serait qu'un etage ne change rien : on aurait alors un lecteur qui ment,
  // comme les curseurs inertes. L'etage doit alors se declarer inactif.
  const cascade = await page.evaluate(async () => {
    const empreinte = async (blob) => {
      if (!blob) return null;
      const a = await decoderAudio(blob);
      const d = a.getChannelData(0);
      let carres = 0, somme = 0;
      for (let i = 0; i < d.length; i++) { carres += d[i]*d[i]; somme += Math.abs(d[i]); }
      return {n: d.length, duree: d.length / a.sampleRate,
              rms: Math.sqrt(carres / d.length), somme};
    };
    // Des reglages qui agissent vraiment, sinon les etages se ressemblent.
    document.getElementById('preset').value = 'radio';
    appliquerPreset();
    document.getElementById('traitementActif').checked = true;
    document.getElementById('nettoyageActif').checked = true;
    document.getElementById('souffle').value = 'moyen';
    document.getElementById('loudness').value = '-16';

    // La suite a touche des reglages du moteur plus haut : la chaine est donc
    // perimee des l'etage 01, et c'est bien ce qu'on veut — un reglage du
    // moteur ne se rattrape par aucun recalcul. On refait donc parler le
    // moteur, puis on presse chaque bouton dans l'ordre, comme l'utilisateur.
    await genererEssai();
    for (const n of [2, 3, 4, 5, 6]) await genererEtage(n);

    const c = etat.cascade;
    const rendus = {};
    for (const cle of ['moteur','pauses','souffle','egaliseur','porte','niveau']) {
      rendus[cle] = await empreinte(c.audios[cle]);
    }
    const lecteurs = [1,2,3,4,5,6]
      .map(n => document.querySelectorAll('#etage' + n + ' audio').length);

    // L'etage 06 doit etre EXACTEMENT la version « vos reglages » : sinon la
    // bibliotheque recevrait un autre son que celui qu'on vient d'ecouter.
    const memeQueVotre = (etat.generationEnCours.versions.votre.blob === c.audios.niveau);

    // Les pauses : rejouees deux fois avec des durees differentes.
    const g = etat.generationEnCours;
    let pausesCourtes = null, pausesLongues = null, memeVoix = null;
    if (g.decoupe && g.decoupe.length > 1) {
      const court = await rejouerPauses(g.source, g.decoupe,
        {proposition:0.05, phrase:0.05, ligne:0.05, paragraphe:0.05, fin:0});
      const long = await rejouerPauses(g.source, g.decoupe,
        {proposition:0.6, phrase:0.6, ligne:0.6, paragraphe:0.6, fin:0});
      pausesCourtes = await empreinte(court);
      pausesLongues = await empreinte(long);
      // La PAROLE doit rester la meme : seuls les silences changent. On le
      // verifie par la somme des valeurs absolues, insensible aux zeros.
      memeVoix = Math.abs(pausesCourtes.somme - pausesLongues.somme) /
                 Math.max(pausesCourtes.somme, 1e-9);
    }
    return {lecteurs, rendus, pausesCourtes, pausesLongues, memeVoix, memeQueVotre,
            atteint: c.atteint, nbMorceaux: g.decoupe ? g.decoupe.length : 0};
  });

  verifier('Le serveur rend la carte des morceaux',
    cascade.nbMorceaux >= 2, cascade.nbMorceaux + ' morceau(x)');
  verifier('Les six étages se génèrent l\'un après l\'autre',
    cascade.atteint === 6, 'étage atteint : ' + cascade.atteint);
  verifier('Chaque étage rend son propre lecteur',
    cascade.lecteurs.every(n => n === 1), cascade.lecteurs.join(' / '));
  verifier('L\'étage 06 est exactement la version « vos réglages »',
    cascade.memeQueVotre === true);

  const suite = ['moteur', 'pauses', 'souffle', 'egaliseur', 'porte', 'niveau'];
  for (let i = 1; i < suite.length; i++) {
    const a = cascade.rendus[suite[i-1]], b = cascade.rendus[suite[i]];
    const ecart = Math.abs(a.rms - b.rms) / Math.max(a.rms, b.rms, 1e-12) +
                  Math.abs(a.somme - b.somme) / Math.max(a.somme, b.somme, 1e-12);
    verifier('L\'étage « ' + suite[i] + ' » change réellement le son',
      ecart > 1e-6, 'écart relatif ' + ecart.toExponential(1));
  }

  if (cascade.pausesCourtes) {
    verifier('Des pauses plus longues allongent l\'audio',
      cascade.pausesLongues.duree > cascade.pausesCourtes.duree + 0.2,
      cascade.pausesCourtes.duree.toFixed(2) + ' s -> ' + cascade.pausesLongues.duree.toFixed(2) + ' s');
    verifier('Rejouer les pauses ne touche pas à la parole',
      cascade.memeVoix < 0.01, 'écart relatif sur la parole : ' + (cascade.memeVoix * 100).toFixed(2) + ' %');
  }

  // Un reglage qui bouge PERIME les etages qui en dependent. Laisser un
  // lecteur jouer un son qui ne correspond plus serait la meme faute qu'un
  // curseur inerte, en plus discret.
  const perime = await page.evaluate(async () => {
    const lire = () => document.getElementById('etatCascade').textContent.trim();
    const neuf = etat.cascade.perimeA;
    document.getElementById('porte').value = -50;
    majNettoyage();
    const apresPorte = { n: etat.cascade.perimeA, texte: lire() };
    document.getElementById('temperature').value = 0.9;
    majMoteur(true);
    const apresMoteur = { n: etat.cascade.perimeA, texte: lire() };
    // Un etage ne se recalcule pas tant que le moteur n'a pas reparle.
    await genererEtage(4);
    const bloque = etat.cascade.perimeA;
    return { neuf, apresPorte, apresMoteur, bloque };
  });
  verifier('Une cascade fraîche n\'est pas périmée', perime.neuf === 0, String(perime.neuf));
  verifier('Changer la porte périme à partir de son étage',
    perime.apresPorte.n === 5, 'étage ' + perime.apresPorte.n);
  verifier('L\'écran dit à partir d\'où les étages sont périmés',
    /périmés à partir du 05/.test(perime.apresPorte.texte), perime.apresPorte.texte.slice(0, 60));
  verifier('Changer un réglage du moteur oblige à regénérer',
    perime.apresMoteur.n === 1 && /doit reparler/.test(perime.apresMoteur.texte),
    perime.apresMoteur.texte.slice(0, 60));
  verifier('Un étage refuse de se recalculer sur un moteur périmé',
    perime.bloque === 1, 'périmé à ' + perime.bloque);

  // Un style n'est pas le reglage d'un etage : il ecrit le moteur (01), la
  // duree des pauses (02), l'egaliseur (04) et la mise au niveau (06). Le
  // placer dans un etage laissait croire qu'il n'agissait que la, et il ne
  // perimait alors qu'a partir du 02 — l'etage 01 jouait une prononciation
  // obtenue avec d'autres valeurs que celles affichees.
  const style = await page.evaluate(async () => {
    await genererEssai();
    const lire = () => ['debit','temperature','topP','topK','preset','graves','cible']
      .map(k => document.getElementById(k).value).join('|');
    const avant = lire();
    const neuf = etat.cascade.perimeA;
    const sel = document.getElementById('elocution');
    sel.value = 'publicite';
    sel.dispatchEvent(new Event('change', {bubbles:true}));
    return { avant, apres: lire(), neuf, perime: etat.cascade.perimeA,
             texte: document.getElementById('etatCascade').textContent.trim(),
             dansEtage2: !!document.querySelector('#etage2') &&
                         !!document.getElementById('elocution').closest('.card')
                           .querySelector('#pauseCourte') };
  });
  verifier('Choisir un style réécrit bien les réglages du moteur',
    style.avant !== style.apres, style.apres);
  verifier('Choisir un style oblige à refaire parler le moteur',
    style.neuf === 0 && style.perime === 1 && /doit reparler/.test(style.texte),
    'après génération ' + style.neuf + ', après style ' + style.perime);
  // Reposer des reglages n'est pas les changer : une generation verrouillee se
  // terminait en rendant les curseurs intacts, donc en perimant ce qu'elle
  // venait de calculer.
  verifier('Une génération fraîche n\'est jamais annoncée périmée',
    style.neuf === 0, 'périmé à ' + style.neuf + ' juste après génération');
  verifier('Le style est hors des étages, puisqu\'il les traverse',
    style.dansEtage2 === false);

  // Un etage dont le reglage est eteint doit le DIRE, au lieu d'afficher un
  // lecteur identique au precedent.
  const inactif = await page.evaluate(async () => {
    document.getElementById('temperature').value = 0.65;
    majMoteur();
    etat.cascade.perimeA = 0;
    document.getElementById('souffle').value = 'aucun';
    document.getElementById('traitementActif').checked = false;
    document.getElementById('preset').value = 'aucun';
    majTraitement();
    etat.cascade.perimeA = 0;
    await genererEtage(4);
    return {
      drapeaux: etat.cascade.inactif,
      texte3: document.getElementById('etage3').textContent,
      texte4: document.getElementById('etage4').textContent
    };
  });
  verifier('Un étage éteint se déclare inactif',
    inactif.drapeaux.souffle === true && inactif.drapeaux.egaliseur === true,
    JSON.stringify(inactif.drapeaux));
  verifier('L\'étage inactif le dit à l\'écran, au lieu de faire croire à un effet',
    /inactif/.test(inactif.texte3) && /inactif/.test(inactif.texte4),
    inactif.texte4.slice(0, 70));

  // La proposition automatique : la ressemblance aux prises, et rien des
  // reglages affiches. Signal riche, pour la meme raison que la correction
  // manuelle — le moteur de test n'emet rien au-dessus de 500 Hz.
  const propose = await page.evaluate(async () => {
    const memoireEch = etat.echantillons;
    const g = etat.generationEnCours;
    const memoireBrut = g.versions.brut.blob;
    const memoireSource = g.source;
    // versionsNonTraitees() moyenne aussi les entrees de bibliotheque : elles
    // portent encore le signal a trois harmoniques du moteur de test, et
    // pollueraient le profil moyen. On mesure sur le seul signal de controle.
    const memoireGen = etat.generations;
    etat.generations = [];

    const fe = 24000, n = fe * 6;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fe;
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * t);
      let v = 0;
      for (let h = 1; h <= 68; h++) v += Math.sin(2 * Math.PI * 160 * h * t + h) / h;
      d[i] = 0.12 * env * v;
    }
    const ctx = new OfflineAudioContext(1, n, fe);
    const t = ctx.createBuffer(1, n, fe);
    t.copyToChannel(d, 0);
    const s = ctx.createBufferSource(); s.buffer = t;
    const f = ctx.createBiquadFilter();
    f.type = 'lowshelf'; f.frequency.value = 250; f.Q.value = 1.1; f.gain.value = 5;
    s.connect(f); f.connect(ctx.destination); s.start();
    const rendu = await ctx.startRendering();

    g.versions.brut.blob = encoderWav(d, fe, 16);
    g.source = g.versions.brut.blob;
    etat.echantillons = [{ id: 'controle', nom: 'controle.wav',
      blob: encoderWav(rendu.getChannelData(0), fe, 16) }];

    // On note les reglages affiches AVANT : la proposition ne doit en toucher
    // aucun. C'est ce qui la distingue de « Calculer d'apres mes prises ».
    const avant = ['graves','basMed','aigus','seuil','ratio']
      .map(k => document.getElementById(k).value).join('|');
    const presetAvant = document.getElementById('preset').value;
    const actifAvant = document.getElementById('traitementActif').checked;

    await proposerRessemblance();

    const apres = ['graves','basMed','aigus','seuil','ratio']
      .map(k => document.getElementById(k).value).join('|');
    const zone = document.getElementById('resProposition');
    const sortie = {
      texte: zone.textContent,
      lecteurs: zone.querySelectorAll('audio').length,
      curseursIntacts: (avant === apres),
      presetIntact: presetAvant === document.getElementById('preset').value,
      actifIntact: actifAvant === document.getElementById('traitementActif').checked,
      versionPropose: !!(g.versions.propose && g.versions.propose.blob)
    };
    etat.echantillons = memoireEch;
    etat.generations = memoireGen;
    g.versions.brut.blob = memoireBrut;
    g.source = memoireSource;
    return sortie;
  });
  verifier('La proposition automatique aboutit et rend un audio',
    propose.lecteurs >= 1 && propose.versionPropose,
    propose.lecteurs + ' lecteur(s) — ' + propose.texte.slice(0, 60));
  verifier('La proposition retrouve le défaut introduit dans la prise',
    /Graves [3-6],\d dB/.test(propose.texte),
    (propose.texte.match(/Graves [-\d,]+ dB/) || ['?'])[0]);
  verifier('La proposition ne touche aucun de vos réglages',
    propose.curseursIntacts && propose.presetIntact && propose.actifIntact,
    'curseurs ' + (propose.curseursIntacts ? 'intacts' : 'MODIFIÉS'));
  verifier('La proposition n\'ajoute ni compression ni porte',
    /Aucune compression, aucune porte/.test(propose.texte));

  // ════════ RESPIRATIONS ════════
  console.log('\n--- Respirations ---');

  // Quatre natures de silence, quatre durees. Deux curseurs seulement etaient
  // exposes, et ils mentaient : « pause entre propositions » pilotait en
  // realite le retour a la ligne, « pause entre phrases » le paragraphe. Les
  // deux autres durees se deduisaient au serveur, proportionnellement, et
  // n'etaient donc pas atteignables.
  verifier('Quatre durées de respiration, une par nature',
    await page.evaluate(() =>
      ['pauseProposition','pausePhrase','pauseLigne','pauseParagraphe']
        .every(id => !!document.getElementById(id))));
  verifier('Les deux curseurs aux noms faux ont disparu',
    await page.evaluate(() =>
      !document.getElementById('pauseCourte') && !document.getElementById('pauseLongue')));
  verifier('Les quatre durées partent explicitement au moteur',
    await page.evaluate(() => {
      const v = reglagesMoteur();
      return ['pause_proposition','pause_phrase','pause_ligne','pause_paragraphe']
        .every(c => typeof v[c] === 'number' && isFinite(v[c]));
    }));

  // Un texte qui porte les QUATRE natures : une phrase trop longue, deux
  // phrases dans une ligne, un retour a la ligne, une ligne vide.
  const resp = await page.evaluate(async () => {
    const memoire = document.getElementById('texteEssai').value;
    document.getElementById('texteEssai').value =
      'Première phrase. Deuxième phrase dans la même ligne.\n' +
      'Une ligne qui suit, après un retour à la ligne voulu.\n\n' +
      'Un paragraphe neuf, qui contient une phrase délibérément très longue afin de dépasser ' +
      'la limite que le moteur accepte d’un seul tenant, et pour cela il faut vraiment ' +
      'beaucoup de mots, encore et encore, jusqu’à ce que la coupure devienne inévitable ' +
      'et tombe au milieu, sans que personne ne l’ait choisie.';
    await genererEssai();
    const g = etat.generationEnCours;
    const decoupe = g.decoupe || [];

    const duree = async (blob) => {
      const a = await decoderAudio(blob);
      return a.length / a.sampleRate;
    };
    const base = {pauseProposition:160, pausePhrase:250, pauseLigne:280, pauseParagraphe:550};
    const poser = (o) => Object.keys(o).forEach(k => document.getElementById(k).value = o[k]);
    const compte = {};
    decoupe.forEach(m => compte[m.nature] = (compte[m.nature] || 0) + 1);

    poser(base);
    const ref = await duree(await rejouerPauses(g.source, g.decoupe, dureesDePause()));
    const effet = {};
    for (const [id, nature] of [['pauseProposition','proposition'], ['pausePhrase','phrase'],
                                ['pauseLigne','ligne'], ['pauseParagraphe','paragraphe']]) {
      poser(base);
      // Une seconde de plus par silence de cette nature : le gain de duree doit
      // valoir exactement le nombre de silences de cette nature.
      document.getElementById(id).value = base[id] + 1000;
      const d = await duree(await rejouerPauses(g.source, g.decoupe, dureesDePause()));
      effet[nature] = {gain: d - ref, attendu: compte[nature] || 0};
    }
    poser(base);
    majPauses();
    const carte = document.getElementById('carteRespirations').textContent;
    document.getElementById('texteEssai').value = memoire;
    return {natures: decoupe.map(m => m.nature), textes: decoupe.map(m => m.texte || ''),
            effet, carte};
  });

  verifier('Les quatre natures de silence apparaissent sur un texte qui les porte',
    ['proposition','phrase','ligne','paragraphe'].every(n => resp.natures.includes(n)),
    resp.natures.join(', '));
  for (const nature of ['proposition','phrase','ligne','paragraphe']) {
    const e = resp.effet[nature];
    verifier('La durée « ' + nature +' » agit sur sa nature, et sur elle seule',
      e.attendu > 0 && Math.abs(e.gain - e.attendu) < 0.05,
      e.gain.toFixed(3) + ' s de plus pour ' + e.attendu + ' silence(s) de cette nature');
  }
  // Sans le texte de chaque morceau, la carte ne dit que des secondes : on ne
  // sait pas OU la coupure imposee est tombee, donc on ne peut pas la deplacer.
  verifier('Chaque morceau de la carte porte son texte',
    resp.textes.length > 1 && resp.textes.every(t => t.trim().length > 0),
    resp.textes.length + ' morceau(x), le premier : « ' + resp.textes[0].slice(0, 30) + ' »');
  verifier('La carte nomme la coupure imposée et dit comment la déplacer',
    /coupure de longueur/.test(resp.carte) && /coupez la phrase vous-même/.test(resp.carte),
    resp.carte.replace(/\s+/g, ' ').slice(0, 80));

  // Les profils d'avant portaient les deux noms faux : leurs durees doivent
  // revenir la ou elles agissaient reellement, sinon le travail est perdu.
  verifier('Un profil d\'avant retrouve ses durées de respiration',
    await page.evaluate(() => {
      const avant = ['pauseLigne','pauseParagraphe'].map(id => document.getElementById(id).value);
      appliquerReglagesProfil({nombres: {pauseCourte: 700, pauseLongue: 1400}});
      const apres = ['pauseLigne','pauseParagraphe'].map(id => document.getElementById(id).value);
      appliquerReglagesProfil({nombres: {pauseLigne: +avant[0], pauseParagraphe: +avant[1]}});
      return apres[0] === '700' && apres[1] === '1400';
    }));

  console.log('\n--- Retrait du souffle ---');

  // Le souffle est ce que l'utilisateur entend en premier : un grésillement
  // sous la voix. Il ne vient pas du moteur mais de la chaine, qui l'amplifie.
  //
  // Le signal de controle a des attaques DOUCES. Coupee net, la voix fabrique
  // des clics que les filtres font sonner dans les silences : on mesure alors
  // la trainee des filtres en croyant mesurer le souffle. La premiere version
  // de cette mesure etait faussee exactement ainsi.
  const souffle = await page.evaluate(async () => {
    const fe = 24000, n = fe * 6;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fe;
      const phase = (t * 0.5) % 1;
      let env = 0;
      if (phase < 0.45) env = Math.min(1, Math.min(phase, 0.45 - phase) / 0.08);
      let v = 0;
      for (let h = 1; h <= 40; h++) v += Math.sin(2*Math.PI*190*h*t + h) / h;
      d[i] = 0.12 * env * v + 0.004 * (Math.random()*2 - 1);
    }
    const zone = (arr, deb, fin) => {
      let s = 0, k = 0;
      for (let i = 0; i < arr.length; i++) {
        const ph = ((i/24000) * 0.5) % 1;
        if (ph > deb && ph < fin) { s += arr[i]*arr[i]; k++; }
      }
      return 20 * Math.log10(Math.sqrt(s/k) + 1e-12);
    };
    const ecart = (a) => zone(a, 0.12, 0.33) - zone(a, 0.60, 0.95);

    const src = encoderWav(d, fe, 16);
    document.getElementById('preset').value = 'naturel';
    appliquerPreset();
    document.getElementById('traitementActif').checked = true;
    const base = {traitement: reglagesTraitement(), nettoyage: null,
                  resolution:16, frequence:0, loudness:'0',
                  autoradio:{graves:0,aigus:0,volume:0}};
    const passer = async (f) => {
      const b = await decoderAudio(await appliquerTraitement(src, {...base, souffle: f}));
      const x = b.getChannelData(0);
      return { ecart: ecart(x), voix: zone(x, 0.12, 0.33) };
    };
    const seul = retirerSouffle(d, fe, 'moyen');
    return {
      depart: ecart(d),
      horsChaine: ecart(seul),
      voixHorsChaine: { avant: zone(d,0.12,0.33), apres: zone(seul,0.12,0.33) },
      aucun: await passer('aucun'),
      leger: await passer('leger'),
      moyen: await passer('moyen'),
      fort:  await passer('fort')
    };
  });
  verifier('Hors chaîne, le retrait dégage nettement le souffle',
    souffle.horsChaine - souffle.depart > 6,
    souffle.depart.toFixed(1) + ' -> ' + souffle.horsChaine.toFixed(1) + ' dB de séparation');
  verifier('Hors chaîne, la voix n\'est pas entamée',
    Math.abs(souffle.voixHorsChaine.apres - souffle.voixHorsChaine.avant) < 0.5,
    souffle.voixHorsChaine.avant.toFixed(2) + ' -> ' + souffle.voixHorsChaine.apres.toFixed(2) + ' dB');
  verifier('La chaîne dégrade bien la séparation quand rien ne la protège',
    souffle.depart - souffle.aucun.ecart > 5,
    souffle.depart.toFixed(1) + ' -> ' + souffle.aucun.ecart.toFixed(1) + ' dB');
  verifier('Le retrait rend à la chaîne ce qu\'elle avait pris',
    souffle.moyen.ecart - souffle.aucun.ecart > 8,
    souffle.aucun.ecart.toFixed(1) + ' -> ' + souffle.moyen.ecart.toFixed(1) + ' dB de séparation');
  verifier('En bout de chaîne, on fait mieux que le signal de départ',
    souffle.moyen.ecart > souffle.depart,
    souffle.moyen.ecart.toFixed(1) + ' dB pour ' + souffle.depart.toFixed(1) + ' dB au départ');
  verifier('Les trois forces vont croissant',
    souffle.leger.ecart < souffle.moyen.ecart && souffle.moyen.ecart < souffle.fort.ecart,
    [souffle.leger, souffle.moyen, souffle.fort].map(x => x.ecart.toFixed(1)).join(' / '));
  verifier('Aucune force ne prend à la voix',
    ['leger','moyen','fort'].every(f => souffle[f].voix >= souffle.aucun.voix - 0.5),
    ['aucun','leger','moyen','fort'].map(f => souffle[f].voix.toFixed(1)).join(' / ') + ' dB');

  console.log('\n--- Tonalité et réglages masqués ---');

  // Un reglage affiche doit agir. Une fois verrouilles, les curseurs du studio
  // n'agissent plus : les laisser visibles afficherait une fausse info.
  const masque = await page.evaluate(async () => {
    const p = profilActif();
    await verrouillerReglages();
    const verrouille = document.getElementById('blocReglagesProfil').style.display;
    await deverrouillerReglages();
    const ouvert = document.getElementById('blocReglagesProfil').style.display;
    return { verrouille, ouvert, etait: p.verrouille };
  });
  verifier('Verrouillés, les réglages du studio sont masqués',
    masque.verrouille === 'none', 'display: ' + masque.verrouille);
  verifier('Rouverts, ils réapparaissent',
    masque.ouvert !== 'none', 'display: ' + masque.ouvert);

  // La tonalite est le seul reglage laisse a la generation : elle doit donc
  // agir reellement, sur la chaine active comme sur la chaine inactive.
  const ton = await page.evaluate(async () => {
    const empreinte = async (blob) => {
      const a = await decoderAudio(blob);
      const d = a.getChannelData(0);
      let carres = 0;
      for (let i = 0; i < d.length; i++) carres += d[i] * d[i];
      return Math.sqrt(carres / d.length);
    };
    // Un signal grave franc : un plateau bas doit s'y entendre.
    const fe = 24000, n = fe * 3;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = 0.2 * Math.sin(2 * Math.PI * 100 * i / fe);
    const src = encoderWav(d, fe, 16);

    const poser = (g, a, v) => {
      document.getElementById('radioGraves').value = g;
      document.getElementById('radioAigus').value = a;
      document.getElementById('radioVolume').value = v;
      majAutoradio();
    };
    const sansChaine = {traitement:null, nettoyage:null, resolution:16, frequence:0, loudness:'0'};

    poser(0, 0, 0);
    const plat = await empreinte(await appliquerTraitement(src, {...sansChaine, autoradio: autoradio()}));
    poser(6, 0, 0);
    const graves = await empreinte(await appliquerTraitement(src, {...sansChaine, autoradio: autoradio()}));
    poser(0, 0, 6);
    const fort = await empreinte(await appliquerTraitement(src, {...sansChaine, autoradio: autoradio()}));
    poser(0, 0, -6);
    const faible = await empreinte(await appliquerTraitement(src, {...sansChaine, autoradio: autoradio()}));
    poser(0, 0, 0);

    // La chaine courante doit porter la tonalite, sinon la generation l'ignore.
    poser(3, -2, 1);
    const dansChaine = chaineCourante().autoradio;
    // Elle ne doit PAS entrer dans les reglages verrouilles du profil.
    const dansProfil = Object.keys(reglagesDuProfil().nombres).filter(k => k.startsWith('radio'));
    poser(0, 0, 0);
    remettreAutoradio();
    const remis = autoradio();

    return { plat, graves, fort, faible, dansChaine, dansProfil, remis };
  });
  verifier('Le plateau des graves agit sur un signal grave',
    ton.graves > ton.plat * 1.4,
    'niveau ' + ton.plat.toFixed(4) + ' -> ' + ton.graves.toFixed(4));
  verifier('Le volume monte et descend réellement',
    ton.fort > ton.plat * 1.8 && ton.faible < ton.plat * 0.6,
    '+6 dB : ' + ton.fort.toFixed(4) + '  -6 dB : ' + ton.faible.toFixed(4) +
    '  à plat : ' + ton.plat.toFixed(4));
  verifier('La tonalité est bien transmise à la chaîne',
    ton.dansChaine && ton.dansChaine.graves === 3 && ton.dansChaine.aigus === -2 &&
    ton.dansChaine.volume === 1, JSON.stringify(ton.dansChaine));
  verifier('La tonalité n\'est pas absorbée par le verrouillage du profil',
    ton.dansProfil.length === 0, ton.dansProfil.join(' ') || 'aucune');
  verifier('La tonalité se remet à plat',
    ton.remis.graves === 0 && ton.remis.aigus === 0 && ton.remis.volume === 0);

  // Aucun autre reglage ne doit subsister a l'etape de generation.
  const etape3 = await page.evaluate(() =>
    [...document.querySelectorAll('#p2 input[type=range], #p2 select')].map(e => e.id));
  verifier('À la génération, seule la tonalité reste réglable',
    etape3.length === 3 && etape3.every(i => i.startsWith('radio')),
    etape3.join(' ') || 'aucun');

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

  // Le bouton « Tester la connexion » a longtemps echappe a cette suite : elle
  // lisait les fonctions d'adresse sans jamais presser le bouton. Une variable
  // orpheline laissee par le retrait du service distant y survivait donc, et
  // ne se voyait qu'a l'ecran, sous la forme d'un ReferenceError. Un bouton
  // que l'utilisateur presse doit etre presse ici aussi.
  await page.evaluate(() => go(1));
  await page.waitForTimeout(300);
  const test = await page.evaluate(async () => {
    etat.connexion = null;
    let plante = '';
    try { await testerConnexion(); }
    catch (e) { plante = String(e && e.message || e); }
    const zone = document.getElementById('resTest');
    return {
      plante,
      connecte: !!(etat.connexion && etat.connexion.ok),
      texte: (zone ? zone.textContent : ''),
      bouton: (document.getElementById('btnTest') || {}).disabled === true
    };
  });
  verifier('Le test de connexion s\'exécute sans lever d\'erreur',
    test.plante === '', test.plante);
  verifier('Le test de connexion aboutit sur le serveur local',
    test.connecte === true, test.texte.slice(0, 90));
  verifier('Le moteur de contrôle est annoncé comme ne clonant pas',
    /moteur de test|ne clone pas/i.test(test.texte), test.texte.slice(0, 120));
  verifier('Le bouton de test est rendu à l\'utilisateur après l\'appel',
    test.bouton === false);

  console.log('\n--- Pièges connus ---');

  await page.evaluate(() => go(1));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    if (document.getElementById('reglagesConnexion').style.display === 'none') basculerReglages();
  });
  await page.waitForTimeout(300);
  // Le service distant a ete retire : plus de catalogue, plus de cle, plus de
  // choix de fournisseur. L'application ne doit plus sortir de la machine.
  const seulLocal = await page.evaluate(() => ({
    restes: ['radioCatalogue', 'radioDistant', 'cleApi', 'memoCle', 'blocCle', 'blocModele',
             'zoneCatalogue', 'listeCatalogue', 'modele']
             .filter(i => document.getElementById(i)),
    base: baseApi(),
    fonctions: ['cleCourante', 'choisirFournisseur', 'choisirTypeVoix', 'listerCatalogue']
             .filter(f => typeof window[f] === 'function')
  }));
  verifier('Plus aucun vestige du service distant dans la page',
    seulLocal.restes.length === 0, seulLocal.restes.join(' ') || 'aucun');
  verifier('Plus aucune fonction du service distant',
    seulLocal.fonctions.length === 0, seulLocal.fonctions.join(' ') || 'aucune');
  verifier('Le service appelé est le serveur local',
    seulLocal.base.indexOf(BASE) === 0, seulLocal.base);
  verifier('Aucune adresse distante n\'est écrite dans le fichier',
    !(await page.content()).includes('elevenlabs.io'));

  // Le mode demonstration masque encore l'enregistreur, et le chemin du retour
  // doit rester : sans lui on ne retrouve plus comment enregistrer sa voix.
  await page.evaluate(() => choisirMode('demo'));
  await page.waitForTimeout(400);
  verifier('Le mode démonstration masque bien l\'enregistreur',
    !(await page.locator('#btnRec').isVisible()));
  await page.click('#zoneCreationDemo button:has-text("Revenir au clonage")');
  await page.waitForTimeout(600);
  verifier('Le retour au clonage rend l\'enregistreur',
    await page.locator('#btnRec').isVisible());

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

  // Le meme message sert au test de connexion et a la generation : il ne doit
  // donc pas nommer l'audio, sinon un simple echec de connexion envoie
  // chercher une panne de traitement la ou aucun audio n'existe.
  verifier('Le message d\'erreur locale ne nomme pas une opération qu\'il ignore',
    await page.evaluate(() =>
      !/audio/i.test(messageReseau(new RangeError('valeur non finie')))),
    await page.evaluate(() => messageReseau(new RangeError('valeur non finie'))));

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

  // ════════ REPRISE D'UNE VERSION ANTÉRIEURE ════════
  console.log('\n--- Reprise des données d\'avant les profils ---');

  // Une version anterieure ne connaissait ni profil ni rattachement : un
  // consentement unique en configuration, des prises sans proprietaire, une
  // voix active a part. Tout cela decrit un premier profil — le perdre serait
  // perdre le travail de l'utilisateur.
  //
  // Le contexte est neuf : l'application de la page principale tient sa base
  // ouverte, et toute montee de version y resterait bloquee.
  // Contexte neuf, donc stockage isole ; le certificat auto-signe du mode
  // https doit y etre accepte comme dans le contexte principal.
  const ctxAvant = await nav.newContext({ ignoreHTTPSErrors: true });
  const vieille = await ctxAvant.newPage();
  const errAvant = [];
  vieille.on('pageerror', e => errAvant.push(e.message));
  // Meme origine, mais sans charger l'application : elle ouvrirait la base.
  await vieille.goto(BASE + '/chat');
  await vieille.waitForTimeout(400);
  await vieille.evaluate(async () => {
    const b = await new Promise((res, rej) => {
      const q = indexedDB.open('studio_voix', 1);
      q.onupgradeneeded = e => {
        const d = e.target.result;
        d.createObjectStore('echantillons', {keyPath:'id'});
        d.createObjectStore('generations', {keyPath:'id'});
        d.createObjectStore('config', {keyPath:'cle'});
      };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    const put = (m, o) => new Promise(r => {
      const t = b.transaction(m, 'readwrite').objectStore(m).put(o);
      t.onsuccess = r; t.onerror = r;
    });
    await put('config', {cle:'consentement', valeur:{
      origine:'autre', nom:'Personne reprise', date:'2026-09-01',
      usage:'narration', valideLe:new Date().toISOString()}});
    await put('config', {cle:'voix', valeur:{id:'voix-ancienne', nom:'Voix d\'avant'}});
    await put('echantillons', {id:'e1', nom:'Prise 1.wav', duree:30, type:'audio/wav',
      blob:new Blob([new Uint8Array(100)], {type:'audio/wav'})});
    await put('echantillons', {id:'e2', nom:'Prise 2.wav', duree:25, type:'audio/wav',
      blob:new Blob([new Uint8Array(100)], {type:'audio/wav'})});
    await put('generations', {id:'g1', date:new Date().toISOString(), texte:'ancien',
      voix:'Voix d\'avant', version:'votre', nom:'voix-synthetique_x.wav',
      blob:new Blob([new Uint8Array(100)], {type:'audio/wav'})});
    b.close();
  });
  await vieille.goto(BASE + '/app');
  await vieille.waitForTimeout(2500);
  const repris = await vieille.evaluate(async () => ({
    nb: etat.profils.length,
    nom: etat.profils[0] ? etat.profils[0].nom : null,
    voix: etat.profils[0] ? etat.profils[0].voixNom : null,
    consentement: !!(etat.profils[0] && etat.profils[0].consentement),
    actif: profilActif() ? profilActif().nom : null,
    prises: etat.echantillons.length,
    prisesRattachees: (await bdTout('echantillons')).every(e => !!e.profilId),
    genRattachees: (await bdTout('generations')).every(g => !!g.profilId),
    navOuverte: !verrou(1)
  }));
  verifier('Un profil est repris des données d\'avant',
    repris.nb === 1 && repris.nom === 'Personne reprise', repris.nom);
  verifier('Le consentement déjà donné est repris, pas redemandé',
    repris.consentement && repris.actif === 'Personne reprise' && repris.navOuverte);
  verifier('La voix active d\'avant est rattachée au profil',
    repris.voix === "Voix d'avant", String(repris.voix));
  verifier('Les prises d\'avant sont retrouvées et rattachées',
    repris.prises === 2 && repris.prisesRattachees, repris.prises + ' prise(s)');
  verifier('Les audios d\'avant sont rattachés au profil', repris.genRattachees);
  verifier('La reprise ne produit aucune erreur',
    errAvant.length === 0, errAvant.join(' | ') || 'aucune');
  await ctxAvant.close();

  console.log('\n--- Erreurs console/page ---');
  console.log(erreurs.length ? erreurs.join('\n') : 'aucune');
  const ko = verifs.filter(v => !v.ok).length;
  console.log('\nRESULTAT : ' + (verifs.length - ko) + '/' + verifs.length + ' vérifications réussies');
  await nav.close();
  process.exit(ko || erreurs.length ? 1 : 0);
})();
