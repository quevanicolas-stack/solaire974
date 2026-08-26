'use strict';
// Pont de la pastille : elle ne fait qu'afficher un etat et remonter des gestes.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisPastille', {
  surEtat: (rappel) => ipcRenderer.on('pastille:etat', (evenement, etat) => rappel(etat)),
  surNiveau: (rappel) => ipcRenderer.on('pastille:niveau', (evenement, valeur) => rappel(valeur)),
  surOpacite: (rappel) => ipcRenderer.on('pastille:opacite', (evenement, valeur) => rappel(valeur)),
  basculerEcoute: () => ipcRenderer.send('pastille:basculerEcoute'),
  ouvrirFenetre: () => ipcRenderer.send('pastille:ouvrir'),
  menu: () => ipcRenderer.send('pastille:menu')
});
