// Mamar admin — the shell: sign-in gate, chrome (sidebar on desktop, tab bar on phones),
// hash routing, the live doorbell (new requests chime in), and the service worker.
import { h, toast, haptic } from '../platform/ui/kit.js';
import { register, t, lang, setLang, onLang, langToggle } from '../platform/i18n.js';
import errors from '../platform/i18n/errors.js';
import { rpc, currentUser, signOut, mode } from '../platform/api.js';
import { live } from '../platform/live.js';
import { URLS } from '../platform/contract.js';
import dict from './i18n.js';
import { ic, arch, num, pickName, loadingBlock, failBlock } from './ui.js';
import * as device from './device.js';

register(errors);
register(dict);

/* ---------- routes ---------- */

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const ROUTES = [
  { re: /^\/?$/, view: 'home', tab: 'home' },
  { re: /^\/requests\/?$/, view: 'requests', tab: 'requests' },
  { re: new RegExp(`^/requests/${UUID}/?$`), view: 'request', tab: 'requests' },
  { re: /^\/businesses\/?$/, view: 'businesses', tab: 'businesses' },
  { re: new RegExp(`^/businesses/${UUID}(?:/([a-z]+))?/?$`), view: 'business', tab: 'businesses' },
  { re: /^\/prices\/?$/, view: 'prices', tab: 'prices' },
  { re: /^\/more\/?$/, view: 'more', tab: 'more' },
  { re: /^\/more\/golive\/?$/, view: 'golive', tab: 'more' },
  { re: /^\/chat\/?$/, view: 'chat', tab: 'more' },
];
const VIEWS = {
  home: () => import('./views/home.js'),
  requests: () => import('./views/requests.js'),
  request: () => import('./views/request.js'),
  businesses: () => import('./views/businesses.js'),
  business: () => import('./views/business.js'),
  prices: () => import('./views/prices.js'),
  more: () => import('./views/more.js'),
  golive: () => import('./views/golive.js'),
  chat: () => import('./views/chat.js'),
};

/* ---------- shared app state (views read it through ctx.app) ---------- */

const listeners = new Map();
export const app = {
  me: null,
  overview: null,
  seen: new Set(),
  go(path) { location.hash = `#${path}`; },
  /** Notification URLs look like '/admin/#/requests/<id>'. */
  open(url) {
    if (!url) return;
    const u = new URL(url, location.origin);
    if (u.origin === location.origin && u.pathname.startsWith('/admin')) {
      const next = u.hash || '#/';
      if (location.hash === next) render({ focus: true }); else location.hash = next;
    } else {
      location.href = u.href;
    }
  },
  announce(text) {
    const r = document.getElementById('adm-announce');
    if (!r) return;
    r.textContent = '';
    setTimeout(() => { r.textContent = text; }, 60);
  },
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  },
  emit(evt, data) { for (const fn of listeners.get(evt) || []) { try { fn(data); } catch (e) { console.error(e); } } },
  pulse: () => pulse(),
  rerender: () => render({ focus: false, keepScroll: true, force: true }),
  setTitle(title) { setTitle(title); },
};
globalThis.mamarAdmin = app;   // handy in the console

/* ---------- boot ---------- */

const body = document.body;
let started = false;

async function boot() {
  if (!currentUser()) return gate('login');
  try {
    app.me = await rpc('own_me');
  } catch (e) {
    if (e.code === 'NOT_ALLOWED') { signOut(); return gate('login'); }
    return gate('offline', e);
  }
  if (!app.me.is_admin) return gate('not_admin');
  start();
}

async function gate(kind, err) {
  stopApp();
  const { default: login } = await import('./views/login.js');
  body.replaceChildren();
  body.className = 'b-app adm adm--gate';
  body.append(login({ kind, err, app, onDone: boot }), h('div', { class: 'b-grain', 'aria-hidden': 'true' }));
}

/* ---------- chrome ---------- */

let main;
let side;
let top;
let tabs;
let stopLive = () => {};
let offLang = () => {};

function navItems() {
  return [
    { tab: 'home', href: '#/', icon: 'home', label: t('nav.home') },
    { tab: 'requests', href: '#/requests', icon: 'inbox', label: t('nav.requests'), badge: 'requests' },
    { tab: 'businesses', href: '#/businesses', icon: 'store', label: t('nav.businesses') },
    { tab: 'prices', href: '#/prices', icon: 'tag', label: t('nav.prices'), desktopOnly: true },
    { tab: 'more', href: '#/more', icon: 'more', label: t('nav.more'), desktopLabel: t('nav.settings'), desktopIcon: 'sliders' },
  ];
}

function brand() {
  return h('a', { class: 'adm-brand', href: '#/', 'aria-label': t('app.name') },
    arch('adm-arch'),
    h('span', { class: 'adm-brand__word' }, t('app.short')),
    h('span', { class: 'adm-brand__tag' }, t('app.tag')));
}

function buildSide() {
  const items = navItems();
  const toggle = h('button', { type: 'button', class: 'b-lang' }, h('span', { 'data-lang-label': '' }));
  langToggle(toggle);
  return h('aside', { class: 'adm-side', 'aria-label': t('nav.label') },
    brand(),
    h('a', { class: 'b-btn b-btn--primary b-btn--block adm-side__cta', href: URLS.assisted() }, ic('plus'), h('span', null, t('home.new_system'))),
    h('nav', { class: 'adm-side__nav', 'aria-label': t('nav.label') },
      items.map((it) => h('a', { class: 'adm-side__item', href: it.href, dataset: { tab: it.tab } },
        ic(it.desktopIcon || it.icon),
        h('span', { class: 'adm-side__label' }, it.desktopLabel || it.label),
        it.badge && h('span', { class: 'adm-count', dataset: { badge: it.badge }, hidden: true })))),
    h('div', { class: 'adm-side__foot' },
      h('a', { class: 'adm-modechip', href: '#/more/golive' },
        h('span', { class: ['adm-modechip__dot', mode() === 'cloud' && 'is-cloud'] }),
        h('span', null, mode() === 'cloud' ? t('mode.cloud') : t('mode.local'))),
      h('div', { class: 'adm-side__row' },
        h('span', { class: 'adm-side__who', dir: 'ltr' }, app.me?.email || ''),
        toggle),
      h('button', { type: 'button', class: 'adm-side__item adm-side__out', onClick: doSignOut }, ic('logout'), h('span', null, t('sign_out')))));
}

function buildTop() {
  const toggle = h('button', { type: 'button', class: 'b-lang' }, h('span', { 'data-lang-label': '' }));
  langToggle(toggle);
  return h('header', { class: 'b-topbar adm-top' },
    h('div', { class: 'b-topbar__start adm-top__start' },
      h('a', { class: 'adm-top__back b-iconbtn', href: '#/', hidden: true, 'aria-label': t('back') }, ic('back')),
      h('a', { class: 'adm-top__brand', href: '#/', 'aria-label': t('app.name') }, arch('adm-arch'))),
    h('p', { class: 'b-topbar__title adm-top__title', 'aria-hidden': 'true' }),
    h('div', { class: 'b-topbar__end' }, toggle));
}

function buildTabs() {
  return h('nav', { class: 'adm-tabs', 'aria-label': t('nav.label') },
    navItems().filter((it) => !it.desktopOnly).map((it) => h('a', { class: 'adm-tab', href: it.href, dataset: { tab: it.tab } },
      h('span', { class: 'adm-tab__ic' }, ic(it.icon)),
      h('span', { class: 'adm-tab__label' }, it.label),
      it.badge && h('span', { class: 'adm-tab__badge', dataset: { badge: it.badge }, hidden: true }))));
}

function buildChrome() {
  side = buildSide();
  top = buildTop();
  tabs = buildTabs();
  main = main || h('main', { id: 'main', class: 'adm-main', tabindex: '-1' });
  body.replaceChildren(
    h('a', { class: 'adm-skip', href: '#main', onClick: (e) => { e.preventDefault(); main.focus(); } }, t('skip')),
    h('div', { class: 'adm-shell' }, side, h('div', { class: 'adm-col' }, top, main), tabs),
    h('div', { id: 'adm-announce', class: 'b-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }),
    h('div', { class: 'b-grain', 'aria-hidden': 'true' }));
  body.className = 'b-app adm';
  if (app.overview) paintBadges(app.overview);
}

function rebuildChrome() {
  const s = buildSide(); side.replaceWith(s); side = s;
  const tp = buildTop(); top.replaceWith(tp); top = tp;
  const tb = buildTabs(); tabs.replaceWith(tb); tabs = tb;
  if (app.overview) paintBadges(app.overview);
  markTab(currentTab);
}

let currentTab = 'home';
function markTab(tab) {
  currentTab = tab;
  for (const a of document.querySelectorAll('[data-tab]')) {
    const on = a.dataset.tab === tab || (tab === 'prices' && a.dataset.tab === 'more' && a.classList.contains('adm-tab'));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function paintBadges(ov) {
  const n = ov?.requests?.new || 0;
  for (const el of document.querySelectorAll('[data-badge="requests"]')) {
    el.hidden = n === 0;
    el.textContent = num(n > 99 ? 99 : n);
  }
  const home = document.querySelector('.adm-tab[data-tab="home"]');
  home?.classList.toggle('has-dot', (ov?.unread || 0) > 0);
  device.setAppBadge(ov?.unread || 0);
}

function setTitle(title) {
  const el = top?.querySelector('.adm-top__title');
  if (el) el.textContent = title || '';
  document.title = title ? `${title} · ${t('app.name')}` : t('app.name');
}

/* compact title in the phone top bar once the big title scrolls away */
let titleObserver = null;
function watchTitle() {
  titleObserver?.disconnect();
  const big = main.querySelector('[data-page-title]');
  if (!big || !('IntersectionObserver' in window)) return;
  titleObserver = new IntersectionObserver(([e]) => {
    top?.classList.toggle('is-titled', !e.isIntersecting && e.boundingClientRect.top < 80);
    top?.classList.toggle('is-stuck', !e.isIntersecting);
  }, { rootMargin: '-64px 0px 0px 0px' });
  titleObserver.observe(big);
}

/* ---------- router ---------- */

let current = null;
let seq = 0;

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || '') };
}

async function render({ focus = true, keepScroll = false, force = false } = {}) {
  if (!started) return;
  const my = ++seq;
  const { path, query } = parseHash();
  const route = ROUTES.find((r) => r.re.test(path));
  if (!route) { location.replace('#/'); return; }
  const params = path.match(route.re).slice(1);
  const y = window.scrollY;
  // Same view (e.g. another tab of the same business): let it update in place.
  if (!force && current && current.view === route.view && typeof current.update === 'function') {
    let handled = false;
    try { handled = current.update({ params, query }) !== false; } catch (e) { console.error(e); }
    if (handled) { markTab(route.tab); return; }
  }
  try { current?.destroy?.(); } catch (e) { console.error(e); }
  current = null;
  markTab(route.tab);
  const back = top?.querySelector('.adm-top__back');
  const brandEl = top?.querySelector('.adm-top__brand');
  if (back) back.hidden = true;
  if (brandEl) brandEl.hidden = false;

  if (!keepScroll) main.replaceChildren(loadingBlock());
  let ctl;
  const root = h('div', { class: 'adm-view' });
  try {
    const mod = await VIEWS[route.view]();
    if (my !== seq) return;
    ctl = (await mod.default({ app, params, query, root, path })) || {};
  } catch (e) {
    if (my !== seq) return;
    if (e?.code === 'NOT_ALLOWED') return expire();
    console.warn(e);
    main.replaceChildren(failBlock(e, () => render()));
    return;
  }
  if (my !== seq) { ctl.destroy?.(); return; }
  current = ctl;
  current.view = route.view;
  main.replaceChildren(root);
  setTitle(ctl.title);
  if (ctl.back && back) {
    back.href = ctl.back;
    back.hidden = false;
    if (brandEl) brandEl.hidden = true;
  }
  if (keepScroll) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
  watchTitle();
  if (focus) (main.querySelector('[data-page-title]') || main).focus({ preventScroll: true });
}

/* ---------- live: the doorbell ---------- */

let pulsing = null;
let again = false;
/** Re-read the overview; anything new chimes, toasts and is announced. Calls during a read queue one more. */
async function pulse({ announce = true } = {}) {
  if (pulsing) { again = true; return pulsing; }
  pulsing = (async () => {
    let first = true;
    do {
      again = false;
      await pulseOnce(first ? announce : true);
      first = false;
    } while (again && started);
  })();
  try { return await pulsing; } finally { pulsing = null; }
}

async function pulseOnce(announce) {
  {
    let ov;
    try { ov = await rpc('adm_overview'); } catch (e) { if (e.code === 'NOT_ALLOWED') expire(); return; }
    const fresh = (ov.notifications || []).filter((n) => !app.seen.has(n.id));
    for (const n of ov.notifications || []) app.seen.add(n.id);
    app.overview = ov;
    paintBadges(ov);
    if (announce && fresh.length) {
      if (fresh.some((n) => n.kind === 'setup_request' || n.kind === 'chat_contact')) device.chime();
      haptic([10, 50, 10]);
      for (const n of fresh.slice(0, 2).reverse()) {
        toast(pickName(n, 'title'), {
          kind: n.kind === 'payment_flag' ? 'warn' : 'info', timeout: 7000,
          action: n.url ? { label: t('act.open'), onClick: () => app.open(n.url) } : undefined,
        });
      }
      app.announce(fresh.map((n) => pickName(n, 'title')).join('. '));
    }
    app.emit('pulse', { ov, fresh });
    try { await current?.onLive?.({ ov, fresh }); } catch (e) { console.warn(e); }
  }
}

function expire() {
  signOut();
  toast(t('session.expired'), { kind: 'warn' });
  gate('login');
}

async function doSignOut() {
  await device.unsubscribePush().catch(() => {});
  signOut();
  gate('login');
}
app.signOut = doSignOut;

function stopApp() {
  if (!started) return;
  started = false;
  stopLive();
  offLang();
  try { current?.destroy?.(); } catch { /* ignore */ }
  current = null;
  titleObserver?.disconnect();
  window.removeEventListener('hashchange', onHash);
}

const onHash = () => render();

function start() {
  if (started) return;
  started = true;
  buildChrome();
  window.addEventListener('hashchange', onHash);
  stopLive = live('admin', (k) => { if (k.admin) pulse(); });
  offLang = onLang((l) => {
    rebuildChrome();
    render({ focus: false, keepScroll: true, force: true });
    device.refreshPushLang(l);
  });
  pulse({ announce: false });
  render({ focus: false });
  device.refreshPushLang(lang());   // pushes arrive in the language this device last used
}

/* ---------- once per page ---------- */

device.registerSW();
device.primeAudio();
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.url) app.open(e.data.url);
    if (e.data?.type === 'push') pulse();
  });
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (started && Date.now() - hiddenAt > 3000) pulse();   // only after a real absence
});
setLang(lang(), { persist: false, silent: true });
boot();
