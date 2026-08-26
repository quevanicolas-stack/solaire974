'use strict';
// Service worker : rend l'interface installable sur le telephone et la tablette et
// la garde consultable si le Mac n'est pas joignable. Les appels d'API ne sont
// jamais mis en cache : ils dependent de l'etat reel de la machine.

const CACHE = 'jarvis-v1';
const RESSOURCES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './client.js',
  './voix.js',
  './reacteur.js',
  './qr.js',
  './manifest.webmanifest',
  './icones/reacteur-192.png',
  './icones/reacteur-512.png'
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(RESSOURCES))
      .then(() => self.skipWaiting())
      .catch(() => { /* une ressource manquante ne doit pas bloquer l'installation */ })
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  // Les routes d'API et les WebSockets passent toujours par le reseau.
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  // Reseau d'abord, cache en secours : l'interface reste a jour tant que le Mac
  // repond, et reste consultable quand il ne repond plus.
  evenement.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse && reponse.ok && url.origin === self.location.origin) {
          const copie = reponse.clone();
          caches.open(CACHE).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(requete).then((c) => c || caches.match('./index.html')))
  );
});
