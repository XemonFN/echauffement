// Service worker : le site marche hors connexion (application installée sur iPhone)
const VERSION = "echauffement-ab0b51a94a";
const FILES = ['./', 'anglais.html', 'civique.html', 'css/style.css', 'data/countries.json', 'data/france-dep.json', 'data/france-reg.json', 'data/world-50m.json', 'defi.html', 'focus.html', 'fonts/archivo-latin-400-normal.woff2', 'fonts/archivo-latin-600-normal.woff2', 'fonts/archivo-latin-700-normal.woff2', 'fonts/archivo-latin-800-normal.woff2', 'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-600-normal.woff2', 'france.html', 'geo.html', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'index.html', 'js/common.js', 'js/pays.js', 'js/questions-en.js', 'js/questions-geo.js', 'js/questions-tech.js', 'js/questions.js', 'js/quiz.js', 'manifest.webmanifest', 'pays.html', 'tech.html', 'vendor/d3.min.js', 'vendor/topojson-client.min.js'];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// réseau d'abord pour les pages (mises à jour rapides), cache d'abord pour le reste
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const isPage = e.request.mode === "navigate";
  e.respondWith(isPage
    ? fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
    : caches.match(e.request).then(r => r || fetch(e.request)));
});
