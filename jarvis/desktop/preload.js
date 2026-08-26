'use strict';
// Pont de la fenetre principale : expose au code de l'interface le strict necessaire
// pour piloter la pastille, sans ouvrir l'acces a Node.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisBureau', {
  // Transmet l'etat de la voix a la pastille en surimpression.
  signalerEtat: (etat) => ipcRenderer.send('jarvis:etat', etat),
  signalerNiveau: (valeur) => ipcRenderer.send('jarvis:niveau', valeur),
  // Applique la position, la taille et l'opacite choisies dans les reglages.
  appliquerReacteur: (reglages) => ipcRenderer.send('jarvis:reacteur', reglages),
  // Le raccourci global et la pastille demandent l'ouverture du micro.
  surBasculerEcoute: (rappel) => ipcRenderer.on('jarvis:basculerEcoute', () => rappel()),
  estApplication: true
});
