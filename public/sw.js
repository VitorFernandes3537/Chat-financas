const CACHE = 'financa-v2';
const STATIC = ['/', '/index.html', '/app.js', '/style.css', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Chamadas ao Worker e APIs externas: sempre rede
  if (e.request.url.includes('workers.dev') || e.request.url.includes('openai.com')) {
    return;
  }
  // Estáticos: cache first, fallback para rede
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
