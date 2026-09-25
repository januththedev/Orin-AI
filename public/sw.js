const RAW_VERSION = '%SW_VERSION%';
// In dev, Vite serves public/sw.js directly and the placeholder is not replaced.
// Fallback to a stable "dev" cache name there to avoid churning caches.
const CACHE_NAME = `orin-ai-${RAW_VERSION === '%SW_VERSION%' ? 'dev' : RAW_VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => (name !== CACHE_NAME ? caches.delete(name) : Promise.resolve()))
      );
    }).then(() => self.clients.claim())
  );
});

// ── Upgrade notification reconciliation ─────────────────────────────────────
// When the app is offline or closed and a plan upgrade happens, the push
// notification may be missed. On SW activate, we send a message to all open
// clients so the app can re-check the plan and show the upgrade popup.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_PLAN_UPDATE') {
    // Re-broadcast to all clients so they can check localStorage plan vs DB
    self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
      clients.forEach(client => client.postMessage({ type: 'RECHECK_PLAN' }));
    });
  }
});

// On activate, tell all open clients to re-check their plan (catches missed upgrades)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
      clients.forEach(client => client.postMessage({ type: 'RECHECK_PLAN' }));
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' ||
      url.pathname.startsWith('/api') ||
      url.origin.includes('firebase') ||
      url.origin.includes('google') ||
      url.origin.includes('firestore')) {
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }
  if (['script', 'style', 'image', 'font'].includes(event.request.destination)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetched = fetch(event.request).then((res) => {
          if (res?.status === 200 && res?.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        }).catch(() => null);
        return cached || fetched;
      })
    );
  }
});
