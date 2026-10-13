/* ==========================================================
   Mamar Booking — owner dashboard service worker (/manage/).
   An offline shell only: the dashboard's own static files
   (and the platform modules they import). Never API calls,
   never other origins. Network first, cache as the fallback,
   so a deploy is picked up on the next load.
   ========================================================== */

const CACHE = 'mamar-manage-v1';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './core.js',
  './prefs.js',
  './i18n.js',
  './manage.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
  './views/today.js',
  './views/booking.js',
  './views/bookings.js',
  './views/prices.js',
  './views/more.js',
  './views/hours.js',
  './views/team.js',
  './views/settings.js',
  './views/billing.js',
  './views/login.js',
  '../platform/api.js',
  '../platform/config.js',
  '../platform/contract.js',
  '../platform/fmt.js',
  '../platform/i18n.js',
  '../platform/live.js',
  '../platform/prayer.js',
  '../platform/theme.js',
  '../platform/i18n/common.js',
  '../platform/i18n/errors.js',
  '../platform/ui/kit.js',
  '../platform/ui/kit.css',
  '../platform/ui/tokens.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not break the install.
    await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mamar-manage-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const scope = new URL(self.registration.scope);
const ours = (url) => url.origin === scope.origin
  && (url.pathname.startsWith(scope.pathname) || url.pathname.startsWith('/platform/'))
  && !url.pathname.startsWith('/api/')
  && !url.pathname.includes('/supabase/');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!ours(url)) return;                     // APIs, fonts, other surfaces: straight to the network

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      return (await caches.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
