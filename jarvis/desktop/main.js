'use strict';
// Application macOS JARVIS : demarre le serveur local, ouvre la fenetre principale
// et la pastille du reacteur toujours visible en haut de l'ecran.

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage, globalShortcut } = require('electron');
const path = require('path');

// Le serveur tourne dans le meme processus : une seule application a lancer.
const config = require('../server/config');
const serveur = require('../server/index');

let fenetrePrincipale = null;
let fenetrePastille = null;
let zoneNotification = null;
let fermetureDemandee = false;

const RACINE_UI = path.join(__dirname, '..', 'ui');
const ICONE = path.join(RACINE_UI, 'icones', 'reacteur-64.png');

function adresseLocale() {
  return 'http://127.0.0.1:' + config.lire().port;
}

// --- Fenetre principale ---------------------------------------------------
function creerFenetrePrincipale() {
  if (fenetrePrincipale) {
    fenetrePrincipale.show();
    fenetrePrincipale.focus();
    return fenetrePrincipale;
  }

  fenetrePrincipale = new BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: 'JARVIS',
    backgroundColor: '#020a14',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  fenetrePrincipale.loadURL(adresseLocale() + '/index.html');

  fenetrePrincipale.once('ready-to-show', () => fenetrePrincipale.show());

  // Fermer la fenetre ne quitte pas l'application : JARVIS reste en arriere-plan.
  fenetrePrincipale.on('close', (evenement) => {
    if (fermetureDemandee) return;
    evenement.preventDefault();
    fenetrePrincipale.hide();
  });

  fenetrePrincipale.on('closed', () => { fenetrePrincipale = null; });

  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'application.
  fenetrePrincipale.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return fenetrePrincipale;
}

// --- Pastille du reacteur -------------------------------------------------
function positionPastille(reglages) {
  const ecran = screen.getPrimaryDisplay();
  const zone = ecran.workArea;
  const taille = reglages.taille;
  const marge = reglages.margeHaut;
  let x;
  if (reglages.position === 'gauche') x = zone.x + 18;
  else if (reglages.position === 'droite') x = zone.x + zone.width - taille - 18;
  else x = zone.x + Math.round((zone.width - taille) / 2);
  return { x, y: zone.y + marge, width: taille, height: taille };
}

function creerPastille() {
  const reglages = config.lire().reacteur;
  if (!reglages.active) return null;
  if (fenetrePastille) return fenetrePastille;

  const cadre = positionPastille(reglages);

  fenetrePastille = new BrowserWindow({
    ...cadre,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    // Reste visible au-dessus des autres applications, y compris en plein ecran.
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-pastille.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  fenetrePastille.setAlwaysOnTop(true, 'screen-saver');
  fenetrePastille.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  fenetrePastille.loadFile(path.join(RACINE_UI, 'pastille.html'));

  fenetrePastille.on('closed', () => { fenetrePastille = null; });

  return fenetrePastille;
}

function appliquerReglagesPastille(reglages) {
  if (!reglages) return;
  if (!reglages.active) {
    if (fenetrePastille) { fenetrePastille.destroy(); fenetrePastille = null; }
    return;
  }
  if (!fenetrePastille) { creerPastille(); return; }
  fenetrePastille.setBounds(positionPastille(reglages));
  fenetrePastille.webContents.send('pastille:opacite', reglages.opaciteRepos);
}

// --- Zone de notification -------------------------------------------------
function creerZoneNotification() {
  let icone = nativeImage.createFromPath(ICONE);
  if (!icone.isEmpty()) icone = icone.resize({ width: 18, height: 18 });
  icone.setTemplateImage(false);

  zoneNotification = new Tray(icone);
  zoneNotification.setToolTip('JARVIS');
  majMenuZoneNotification();
  zoneNotification.on('click', () => creerFenetrePrincipale());
}

function majMenuZoneNotification() {
  if (!zoneNotification) return;
  const reglages = config.lire();
  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir JARVIS', click: () => creerFenetrePrincipale() },
    { label: 'Parler maintenant', accelerator: 'Alt+Space', click: () => demanderEcoute() },
    { type: 'separator' },
    {
      label: 'Afficher la pastille',
      type: 'checkbox',
      checked: reglages.reacteur.active,
      click: (element) => {
        config.ecrire({ reacteur: { active: element.checked } });
        appliquerReglagesPastille(config.lire().reacteur);
        majMenuZoneNotification();
      }
    },
    {
      label: 'Lancer au demarrage de la session',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (element) => {
        app.setLoginItemSettings({ openAtLogin: element.checked, openAsHidden: true });
        majMenuZoneNotification();
      }
    },
    { type: 'separator' },
    { label: 'Adresse du serveur : ' + adresseLocale(), enabled: false },
    { type: 'separator' },
    {
      label: 'Quitter JARVIS',
      accelerator: 'Command+Q',
      click: () => { fermetureDemandee = true; app.quit(); }
    }
  ]);
  zoneNotification.setContextMenu(menu);
}

// --- Communication entre les fenetres -------------------------------------
function demanderEcoute() {
  const fenetre = creerFenetrePrincipale();
  fenetre.webContents.send('jarvis:basculerEcoute');
}

function brancherIpc() {
  // La fenetre principale relaie l'etat de la voix a la pastille.
  ipcMain.on('jarvis:etat', (evenement, etat) => {
    if (fenetrePastille) fenetrePastille.webContents.send('pastille:etat', etat);
  });

  ipcMain.on('jarvis:niveau', (evenement, valeur) => {
    if (fenetrePastille) fenetrePastille.webContents.send('pastille:niveau', valeur);
  });

  ipcMain.on('jarvis:reacteur', (evenement, reglages) => {
    appliquerReglagesPastille(reglages);
    majMenuZoneNotification();
  });

  // Gestes sur la pastille.
  ipcMain.on('pastille:basculerEcoute', () => demanderEcoute());
  ipcMain.on('pastille:ouvrir', () => creerFenetrePrincipale());
  ipcMain.on('pastille:menu', () => {
    if (zoneNotification) zoneNotification.popUpContextMenu();
  });
}

// --- Cycle de vie ---------------------------------------------------------
// Une seule instance : une seconde ouverture ramene la fenetre existante.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => creerFenetrePrincipale());

  app.whenReady().then(() => {
    serveur.demarrer();
    brancherIpc();
    creerFenetrePrincipale();
    creerPastille();
    creerZoneNotification();

    // Raccourci global : parler sans quitter l'application en cours.
    globalShortcut.register('Alt+Space', () => demanderEcoute());

    app.on('activate', () => creerFenetrePrincipale());
  });

  // L'application vit dans la zone de notification : fermer la fenetre ne quitte pas.
  app.on('window-all-closed', (evenement) => {
    if (evenement && evenement.preventDefault) evenement.preventDefault();
  });

  app.on('before-quit', () => { fermetureDemandee = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
