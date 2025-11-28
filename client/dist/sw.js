const VERSION = 'v3';
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Navigation requests: network-first to avoid stale index.html causing blank screen
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => {
      const c = await caches.open(VERSION); return c.match('/index.html') || Response.error()
    }))
    return;
  }
  // Cache static assets under /assets/ with stale-while-revalidate
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const cached = await c.match(req); const net = fetch(req).then((res) => { c.put(req, res.clone()); return res });
      return cached || net;
    }))
    return;
  }
});
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'notify' && data.title) {
    self.registration.showNotification(data.title, { body: data.body || '', icon: '/icons/leaf-192.png' });
  }
});
