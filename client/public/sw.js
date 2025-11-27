const VERSION = 'v3';
const CORE = ['/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Always network-first for HTML navigations
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept')||'').includes('text/html');
  if (isHTML && url.origin === self.location.origin) {
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  // Cache-first for static assets
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      });
    })
  );
});
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'notify' && data.title) {
    self.registration.showNotification(data.title, { body: data.body || '', icon: '/dong-son.png' });
  }
});
