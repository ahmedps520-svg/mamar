// Mamar admin service worker: Web Push, notification taps, and a small offline shell.
// API calls (/api/*, Supabase, GitHub) are never cached: data is always live.
const VERSION = 'mamar-admin-v1';
const SHELL = [
  '/admin/', '/admin/index.html', '/admin/admin.css', '/admin/app.js', '/admin/ui.js', '/admin/device.js', '/admin/i18n.js',
  '/admin/views/login.js', '/admin/views/home.js', '/admin/views/requests.js', '/admin/views/request.js',
  '/admin/views/businesses.js', '/admin/views/business.js', '/admin/views/biz-look.js', '/admin/views/biz-logins.js',
  '/admin/views/prices.js', '/admin/views/more.js', '/admin/views/golive.js',
  '/admin/manifest.webmanifest', '/admin/icons/icon.svg', '/admin/icons/icon-192.png', '/admin/icons/badge-72.png',
  '/platform/ui/tokens.css', '/platform/ui/kit.css', '/platform/ui/kit.js', '/platform/api.js', '/platform/config.js',
  '/platform/contract.js', '/platform/i18n.js', '/platform/i18n/common.js', '/platform/i18n/errors.js', '/platform/fmt.js',
  '/platform/live.js', '/platform/theme.js', '/platform/estimate.js', '/platform/prayer.js', '/platform/linkpage.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One missing file must not block installing the worker (push still matters most).
    await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k.startsWith('mamar-admin-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* Network first (so a deploy shows up at once), cache as the offline fallback. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // fonts, Supabase, GitHub: not ours
  if (url.pathname.startsWith('/api/')) return;                     // never cache data
  const shell = url.pathname.startsWith('/admin/') || url.pathname.startsWith('/platform/');
  if (!shell) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await caches.match('/admin/')) || Response.error();
      return Response.error();
    }
  })());
});

/* ---------- push ---------- */

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  const lang = d.lang === 'en' ? 'en' : 'ar';
  const title = d.title || (lang === 'en' ? 'Mamar' : 'ممر');
  const options = {
    body: d.body || '',
    icon: '/admin/icons/icon-192.png',
    badge: '/admin/icons/badge-72.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    lang,
    dir: lang === 'en' ? 'ltr' : 'rtl',
    timestamp: Date.now(),
    vibrate: [60, 40, 60],
    data: { url: d.url || '/admin/' },
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Tell open windows to refresh their counts straight away.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) c.postMessage({ type: 'push' });
    try {
      const n = (await self.registration.getNotifications()).length;
      if (n && self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
    } catch { /* no badging API */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/admin/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((c) => new URL(c.url).pathname.startsWith('/admin'));
    if (win) {
      await win.focus().catch(() => {});
      try {
        if ('navigate' in win && win.url !== target) await win.navigate(target);
      } catch {
        win.postMessage({ type: 'navigate', url: target });   // uncontrolled window: let the app route itself
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});
