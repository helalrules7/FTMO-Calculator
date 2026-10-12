// Offline-first service worker. Bump VERSION on every release.
const VERSION = 'ftmo-risk-dev'; // stamped by deploy/deploy.sh
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'src/ui/app.css', 'src/ui/app.js', 'src/ui/i18n.js', 'src/ui/storage.js',
  'src/engine/calc.js', 'src/engine/config.js', 'src/engine/decimal.js',
  'src/engine/ftmo.js', 'src/engine/instruments.js', 'src/engine/symbols.data.js', 'src/engine/validate.js',
  'fonts/changa.css', 'fonts/changa-arabic.woff2', 'fonts/changa-latin.woff2', 'fonts/changa-latin-ext.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== location.origin) return;

  // App shell: cache-first, refresh in background.
  e.respondWith(caches.match(request, { ignoreSearch: true }).then(hit => {
    const net = fetch(request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(request, copy)); }
      return res;
    }).catch(() => hit || caches.match('index.html'));
    return hit || net;
  }));
});
