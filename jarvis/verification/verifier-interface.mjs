// Verification de bout en bout de l'interface, pilotee dans un vrai navigateur.
//
// Prerequis : npx playwright install chromium  (ou un Chromium deja present)
// Usage     : node jarvis/verification/verifier-interface.mjs
//
// Le script demarre un serveur JARVIS isole sur le port 4801, cree un compte,
// appaire un second appareil et verifie la synchronisation en direct entre les deux.

// Playwright peut etre installe dans le projet ou globalement : on essaie les deux.
const { chromium } = await (async () => {
  try {
    return await import('playwright');
  } catch (e) {
    if (!process.env.PLAYWRIGHT_MODULE) {
      console.error('Playwright est introuvable. Installez-le (npm i -D playwright) ou '
        + 'indiquez son chemin dans PLAYWRIGHT_MODULE.');
      process.exit(2);
    }
    return await import(process.env.PLAYWRIGHT_MODULE);
  }
})();
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dossier = path.join(os.tmpdir(), 'jarvis-ui-' + Date.now());
const env = { ...process.env, JARVIS_DOSSIER: dossier };
fs.mkdirSync(dossier, { recursive: true });
fs.writeFileSync(path.join(dossier, 'config.json'), JSON.stringify({ port: 4801 }));

const racine = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const serveur = spawn('node', [path.join(racine, 'server', 'index.js')], { env, stdio: 'pipe' });
serveur.stdout.on('data', d => process.stdout.write('[serveur] ' + d));
await new Promise(r => setTimeout(r, 1200));

const ok = (t, c) => console.log((c ? '  OK  ' : ' ECHEC ') + t);
// PLAYWRIGHT_CHROMIUM permet de designer un Chromium deja installe.
const navigateur = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const contexte = await navigateur.newContext({ viewport: { width: 480, height: 900 } });
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', e => erreurs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:4801/index.html', { waitUntil: 'networkidle' });

ok('ecran de connexion visible', await page.isVisible('#ecran-connexion'));
ok('titre JARVIS affiche', (await page.textContent('.titre-marque')).trim() === 'JARVIS');

// Le reacteur de connexion doit reellement dessiner quelque chose
const pixelsDessines = await page.evaluate(() => {
  const c = document.querySelector('#reacteur-connexion');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return { n, largeur: c.width };
});
ok('reacteur dessine (' + pixelsDessines.n + ' pixels sur canvas ' + pixelsDessines.largeur + 'px)', pixelsDessines.n > 2000);

// Animation : le rendu au centre du reacteur doit evoluer dans le temps
const echantillon = () => page.evaluate(() => {
  const c = document.querySelector('#reacteur-connexion');
  const x = Math.round(c.width / 2) - 12;
  const y = Math.round(c.height / 2) - 12;
  return Array.from(c.getContext('2d').getImageData(x, y, 24, 24).data).join(',');
});
const emp1 = await echantillon();
await page.waitForTimeout(700);
const emp2 = await echantillon();
await page.waitForTimeout(700);
const emp3 = await echantillon();
ok('reacteur anime (le rendu evolue dans le temps)', emp1 !== emp2 || emp2 !== emp3);

// Onglets
await page.click('.onglet[data-onglet="creation"]');
ok('onglet creation actif', await page.isVisible('#formulaire-creation'));

await page.fill('#formulaire-creation input[name="courriel"]', 'nicolas@exemple.re');
await page.fill('#formulaire-creation input[name="motDePasse"]', 'motdepasse974');
await page.click('#formulaire-creation button[type="submit"]');
await page.waitForSelector('#ecran-principal:not(.masque)', { timeout: 5000 });
ok('compte cree, ecran principal affiche', true);

await page.waitForFunction(() => document.querySelector('#etat-liaison').textContent === 'En ligne', null, { timeout: 5000 });
ok('WebSocket connecte (etat "En ligne")', true);

// Salutation automatique
await page.waitForFunction(() => document.querySelectorAll('#liste-echanges .bulle.jarvis').length > 0, null, { timeout: 6000 });
const salutation = await page.textContent('#liste-echanges .bulle.jarvis');
ok('salutation prononcee : "' + salutation.slice(0, 60) + '..."', /travaill|fait|programme|commence|mission|besoin|prepare|ecoute|attelle|occupe|allez/i.test(salutation));

// Commande ecrite
await page.fill('#champ-commande', 'quelle heure est-il');
await page.click('#formulaire-commande button[type="submit"]');
await page.waitForFunction(() => Array.from(document.querySelectorAll('.bulle.jarvis')).some(b => /Il est/.test(b.textContent)), null, { timeout: 5000 });
ok('commande ecrite traitee (heure renvoyee)', true);

// Action sensible : confirmation
await page.fill('#champ-commande', "verrouille l'ecran");
await page.click('#formulaire-commande button[type="submit"]');
await page.waitForFunction(() => document.querySelector('.bulle.jarvis.attente') !== null, null, { timeout: 5000 });
ok('action sensible : bulle de confirmation affichee', true);
await page.fill('#champ-commande', 'non');
await page.click('#formulaire-commande button[type="submit"]');
await page.waitForTimeout(600);

// Reglages
await page.click('#bouton-reglages');
ok('panneau de reglages ouvert', await page.isVisible('#panneau-reglages'));
ok('courriel du compte affiche', (await page.textContent('#courriel-compte')) === 'nicolas@exemple.re');
ok('liste des appareils remplie', (await page.locator('#liste-appareils .ligne-liste').count()) >= 1);
ok('raccourcis par defaut affiches', (await page.locator('#liste-raccourcis .ligne-liste').count()) === 2);

// Changement de nom
await page.fill('#reglage-nom', 'Nicolas');
await page.waitForTimeout(900);
const reglagesEnregistres = await page.evaluate(async () => {
  const r = await fetch('/api/reglages', { headers: { Authorization: 'Bearer ' + localStorage.getItem('jarvis.jeton') } });
  return (await r.json()).nomUtilisateur;
});
ok('reglage enregistre cote serveur (nom = ' + reglagesEnregistres + ')', reglagesEnregistres === 'Nicolas');

// Appairage + QR
await page.click('#bouton-appairer');
await page.waitForSelector('#bloc-appairage:not(.masque)', { timeout: 4000 });
const code = (await page.textContent('#code-appairage')).trim();
ok('code d\'appairage affiche : ' + code, /^\d{6}$/.test(code));
const qr = await page.evaluate(() => {
  const c = document.querySelector('#qr-appairage');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sombres = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) sombres++;
  return { sombres, largeur: c.width };
});
ok('code QR dessine (' + qr.sombres + ' modules sombres, ' + qr.largeur + 'px)', qr.sombres > 1000);

// Ajout d'un raccourci
await page.fill('#raccourci-nom', 'Devis');
await page.fill('#raccourci-phrases', 'ouvre le devis, mes devis');
await page.selectOption('#raccourci-type', 'dossier');
await page.fill('#raccourci-cible', 'Documents/Devis');
await page.click('#ajouter-raccourci');
await page.waitForTimeout(700);
ok('raccourci ajoute', (await page.locator('#liste-raccourcis .ligne-liste').count()) === 3);

await page.click('#fermer-reglages');
ok('panneau referme', await page.isHidden('#panneau-reglages'));

// Deuxieme appareil : appairage par code et synchronisation
const pageTelephone = await contexte.browser().newContext({ viewport: { width: 390, height: 844 } });
const tel = await pageTelephone.newPage();
await tel.goto('http://127.0.0.1:4801/index.html#code=' + code, { waitUntil: 'networkidle' });
ok('telephone : onglet appairage preselectionne', await tel.isVisible('#formulaire-appairage'));
ok('telephone : code prerempli', (await tel.inputValue('#formulaire-appairage input[name="code"]')) === code);
await tel.click('#formulaire-appairage button[type="submit"]');
await tel.waitForSelector('#ecran-principal:not(.masque)', { timeout: 5000 });
ok('telephone : rejoint le compte', true);
await tel.waitForFunction(() => document.querySelectorAll('#liste-echanges .echange').length > 2, null, { timeout: 5000 });
ok('telephone : historique du compte recupere', true);

// Synchronisation en direct : commande depuis le telephone, visible sur le Mac
const avant = await page.locator('#liste-echanges .echange').count();
await tel.fill('#champ-commande', 'de quoi on parlait');
await tel.click('#formulaire-commande button[type="submit"]');
await page.waitForFunction((n) => document.querySelectorAll('#liste-echanges .echange').length > n, avant, { timeout: 5000 });
ok('synchronisation en direct : la commande du telephone apparait sur le Mac', true);

// Responsive
await page.setViewportSize({ width: 1200, height: 900 });
await page.waitForTimeout(200);
const largeBureau = await page.evaluate(() => document.querySelector('#reacteur-principal').getBoundingClientRect().width);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const largeMobile = await page.evaluate(() => document.querySelector('#reacteur-principal').getBoundingClientRect().width);
ok('bascule mobile a 860 px (reacteur ' + largeBureau + ' -> ' + largeMobile + ' px)', largeBureau === 210 && largeMobile === 142);

const debordement = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok('aucun debordement horizontal sur mobile', !debordement);

const captures = process.env.JARVIS_CAPTURES || dossier;
await page.screenshot({ path: path.join(captures, 'jarvis-mobile.png') });
await page.setViewportSize({ width: 520, height: 820 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(captures, 'jarvis-principal.png') });
await page.click('#bouton-reglages');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(captures, 'jarvis-reglages.png') });
console.log('\nCaptures ecrites dans ' + captures);

console.log('\nErreurs JavaScript : ' + (erreurs.length ? erreurs.join('\n  ') : 'aucune'));
await navigateur.close();
serveur.kill();
process.exit(erreurs.length ? 1 : 0);
