/* ==========================================================
   Mamar Booking — owner dashboard (/manage/)
   Shell: auth, business choice (?b= · last used · first),
   bottom tab bar (sidebar on desktop), hash router, live
   updates with arrival toasts and the optional chime.
   ========================================================== */

import {
  S, t, h, icon, toast, haptic, on, emit, nm, pref, customer, when, loadOverview, loadWindow, L, fmt, stripZero,
} from './core.js';
import { rpc, currentUser, onAuthChange, signOut, errorKey } from '../platform/api.js';
import { live } from '../platform/live.js';
import { lang, setLang, onLang, langToggle } from '../platform/i18n.js';
import { sheet, skeleton, watchStuck } from '../platform/ui/kit.js';
import { applyMode, chime } from './prefs.js';
import { mountLogin, archMark } from './views/login.js';
import { openBooking, openNewBooking } from './views/booking.js';
import * as today from './views/today.js';
import * as bookings from './views/bookings.js';
import * as prices from './views/prices.js';
import * as more from './views/more.js';
import { openServiceEditor } from './views/prices.js';

const BIZ_KEY = 'mamar-manage-business';
const TABS = { today, bookings, prices, more };
const app = document.getElementById('app');

let stopLive = null;
let unmount = () => {};
let shell = null;

/* ---------- boot ---------- */

setLang(lang(), { persist: false, silent: true });
applyMode();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}));
}

onAuthChange((user) => { if (!user) toLogin(); });
onLang(() => { if (shell) { renderShell(); route(); } else if (!currentUser()) toLogin(); document.title = pageTitle(); });

if (currentUser()) start(); else toLogin();

/* ---------- login ---------- */

function toLogin() {
  teardown();
  shell = null;
  S.me = null;
  document.title = t('mg.title');
  mountLogin(app, { onDone: () => start() });
}

function teardown() {
  unmount();
  unmount = () => {};
  stopLive?.();
  stopLive = null;
}

/* ---------- start ---------- */

async function start() {
  app.replaceChildren(splash());
  let me;
  try {
    me = await rpc('own_me', {});
  } catch (e) {
    if (e.code === 'NOT_ALLOWED') { signOut(); return; }
    app.replaceChildren(fatal(t(errorKey(e)), start));
    return;
  }
  S.me = me;
  if (!me.businesses?.length) {
    app.replaceChildren(h('div', { class: 'mg-login' },
      h('main', { class: 'mg-login__card', id: 'main' },
        h('div', { class: 'mg-login__mark', 'aria-hidden': 'true' }, archMark()),
        h('h1', { class: 'mg-login__title' }, t('mg.nobiz.title')),
        h('p', { class: 'mg-login__lede' }, t('mg.nobiz.text')),
        h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--block', onClick: () => signOut() }, h('span', null, t('sign_out'))))));
    return;
  }
  const params = new URLSearchParams(location.search);
  const want = params.get('b');
  const find = (v) => v && me.businesses.find((b) => b.id === v || b.slug === v);
  if (want && !find(want)) setTimeout(() => toast(t('mg.not_member'), { kind: 'err' }), 300);
  const pick = find(want) || find(pref.get(BIZ_KEY)) || me.businesses[0];
  await selectBusiness(pick.id);
}

async function selectBusiness(bid) {
  teardown();
  Object.assign(S, { bid, ov: null, win: null, known: null });
  S.fresh.clear();
  S.mine.clear();
  pref.set(BIZ_KEY, bid);
  const u = new URL(location.href);
  u.searchParams.set('b', bid);
  history.replaceState(null, '', u);

  renderShell();
  shell.main.replaceChildren(h('div', { class: 'mg-loading' }, skeleton(4)));
  try {
    await Promise.all([loadOverview(), loadWindow().catch(() => {})]);
  } catch (e) {
    if (e.code === 'NOT_ALLOWED') {
      toast(t('mg.not_member'), { kind: 'err' });
      const other = S.me.businesses.find((b) => b.id !== bid);
      pref.set(BIZ_KEY, null);
      if (other) { selectBusiness(other.id); return; }
    }
    shell.main.replaceChildren(fatal(t(errorKey(e)), () => selectBusiness(bid)));
    return;
  }
  renderShell();
  route();
  stopLive = live(bid, (k) => {
    if (k.slots) { loadWindow().catch(() => {}); loadOverview().catch(() => {}); } else if (k.catalog) loadOverview().catch(() => {});
  });
}

/* ---------- shell ---------- */

const TAB_ICONS = {
  today: [['rect', { x: 4, y: 5.5, width: 16, height: 14.5, rx: 2.5 }], ['path', { d: 'M4 10h16M8.5 3.5v4M15.5 3.5v4' }], ['circle', { cx: 12, cy: 15, r: 1.7, class: 'mg-fill' }]],
  bookings: [['path', { d: 'M9.5 7h10M9.5 12h10M9.5 17h10' }], ['circle', { cx: 5, cy: 7, r: 1.1, class: 'mg-fill' }], ['circle', { cx: 5, cy: 12, r: 1.1, class: 'mg-fill' }], ['circle', { cx: 5, cy: 17, r: 1.1, class: 'mg-fill' }]],
  prices: [['path', { d: 'M3.8 12.4V5.8a2 2 0 0 1 2-2h6.6l8 8a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0z' }], ['circle', { cx: 8.3, cy: 8.3, r: 1.6 }]],
  more: [['circle', { cx: 6, cy: 12, r: 1.5, class: 'mg-fill' }], ['circle', { cx: 12, cy: 12, r: 1.5, class: 'mg-fill' }], ['circle', { cx: 18, cy: 12, r: 1.5, class: 'mg-fill' }]],
};
function tabIcon(name) {
  const svg = h('svg', { viewBox: '0 0 24 24', class: 'b-icon mg-tab__icon', 'aria-hidden': 'true', focusable: 'false' });
  for (const [tag, attrs] of TAB_ICONS[name]) svg.appendChild(h(tag, attrs));
  return svg;
}

const monogram = (b) => {
  const n = (nm(b) || b?.slug || '?').trim();
  return h('span', { class: 'mg-mono', 'aria-hidden': 'true' }, n.slice(0, 1));
};

function bizButton() {
  const b = S.ov?.business || S.me.businesses.find((x) => x.id === S.bid);
  const many = S.me.businesses.length > 1;
  const inner = [monogram(b),
    h('span', { class: 'mg-biz__text' },
      h('span', { class: 'mg-biz__name' }, nm(b)),
      h('span', { class: 'mg-biz__sub' },
        h('span', { class: ['mg-livedot', !navigator.onLine && 'is-off'], 'aria-hidden': 'true' }),
        b?.is_demo ? t('mg.demo') : t(`mg.biz.${b?.status || 'active'}`))),
    many && icon('chevronDown', { class: 'mg-biz__chev' })];
  return many
    ? h('button', { type: 'button', class: 'mg-biz', 'aria-haspopup': 'dialog', 'aria-label': `${nm(b)} · ${t('mg.switch_business')}`, onClick: openSwitcher }, ...inner)
    : h('div', { class: 'mg-biz' }, ...inner);
}

function renderShell() {
  const r = parse();
  const nav = h('nav', { class: 'mg-nav', 'aria-label': t('mg.nav') },
    h('div', { class: 'mg-nav__brand' }, h('span', { class: 'mg-nav__mark', 'aria-hidden': 'true' }, archMark()), h('span', null, t('mg.app'))),
    h('div', { class: 'mg-nav__biz' }, bizButton()),
    h('div', { class: 'mg-nav__tabs' }, Object.keys(TABS).map((k) => h('a', {
      class: 'mg-tab', href: `#/${k}`, 'data-tab': k, 'aria-current': r.tab === k ? 'page' : null,
    }, tabIcon(k), h('span', { class: 'mg-tab__label' }, t(`mg.tab.${k}`)), h('span', { class: 'mg-tab__dot', hidden: true, 'aria-hidden': 'true' })))),
    h('div', { class: 'mg-nav__foot' }, h('button', { type: 'button', class: 'b-lang', 'data-lang-toggle': '' })));
  const top = h('header', { class: 'b-topbar mg-top' });
  const main = h('main', { class: 'mg-main', id: 'main', tabindex: '-1' });
  const offline = h('div', { class: 'mg-offline', role: 'status', hidden: navigator.onLine }, icon('alert'), t('mg.offline_banner'));
  const root = h('div', { class: 'mg-shell' },
    h('a', { class: 'mg-skip', href: '#main', onClick: (e) => { e.preventDefault(); main.focus(); } }, t('mg.skip')),
    nav, top, offline, main);
  const prevMain = shell?.main;
  shell = { root, nav, top, main, offline };
  if (prevMain && prevMain.isConnected) main.append(...prevMain.childNodes);
  app.replaceChildren(root);
  for (const b of root.querySelectorAll('[data-lang-toggle]')) langToggle(b);
  watchStuck(top);
  document.title = pageTitle();
}

function paintTop(r) {
  const top = shell.top;
  const subPage = r.tab === 'more' && r.sub && !window.matchMedia('(min-width: 1024px)').matches;
  const start = subPage
    ? h('a', { class: 'b-iconbtn mg-back', href: '#/more', 'aria-label': t('back') }, icon('back'))
    : bizButton();
  const action = {
    today: () => h('button', { type: 'button', class: 'b-iconbtn mg-plus', 'aria-label': t('mg.qa.new'), onClick: () => openNewBooking() }, icon('plus')),
    bookings: () => h('button', { type: 'button', class: 'b-iconbtn mg-plus', 'aria-label': t('mg.qa.new'), onClick: () => openNewBooking() }, icon('plus')),
    prices: () => h('button', { type: 'button', class: 'b-iconbtn mg-plus', 'aria-label': t('mg.pr.add'), onClick: () => openServiceEditor(null) }, icon('plus')),
  }[r.tab];
  const langBtn = h('button', { type: 'button', class: 'b-lang' });
  top.replaceChildren(
    h('div', { class: 'b-topbar__start' }, start),
    h('div', { class: 'b-topbar__title' }, subPage ? (more.PAGES[r.sub]?.title() || '') : h('span', { class: 'mg-desktitle' },
      t(`mg.tab.${r.tab}`), r.tab === 'more' && r.sub && more.PAGES[r.sub] ? h('small', null, ` · ${more.PAGES[r.sub].title()}`) : null)),
    h('div', { class: 'b-topbar__end' }, langBtn, action && action()));
  langToggle(langBtn);
}

/* ---------- router ---------- */

function parse() {
  const [tab, sub] = location.hash.replace(/^#\/?/, '').split('/');
  return { tab: TABS[tab] ? tab : 'today', sub: sub || null };
}

function route() {
  if (!shell || !S.ov) return;
  const r = parse();
  unmount();
  for (const a of shell.nav.querySelectorAll('.mg-tab')) {
    const on0 = a.dataset.tab === r.tab;
    if (on0) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (on0 && r.tab === 'today') a.querySelector('.mg-tab__dot').hidden = true;
  }
  paintTop(r);
  shell.main.classList.toggle('is-sub', !!r.sub);
  shell.main.dataset.tab = r.tab;
  try {
    unmount = TABS[r.tab].mount(shell.main, { sub: r.sub }) || (() => {});
  } catch (e) {
    console.error(e);
    shell.main.replaceChildren(fatal(t('error.generic'), route));
    unmount = () => {};
  }
  document.title = pageTitle();
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  const prev = lastHash;
  lastHash = location.hash;
  route();
  // Moving between tabs starts at the top; focus goes to the page for screen readers.
  const [a] = prev.replace(/^#\/?/, '').split('/');
  const [b] = location.hash.replace(/^#\/?/, '').split('/');
  if (a !== b || location.hash.split('/').length > 2) window.scrollTo({ top: 0 });
  const heading = shell?.main.querySelector('h1');
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
});

function pageTitle() {
  const b = S.ov?.business;
  return b ? `${nm(b)} · ${t('mg.title')}` : t('mg.title');
}

/* ---------- business switcher ---------- */

function openSwitcher() {
  const list = S.me.businesses.slice().sort((a, b) => nm(a).localeCompare(nm(b), L()));
  setTimeout(stripZero, 0);
  sheet({
    title: S.me.is_admin ? t('mg.businesses_admin') : t('mg.businesses'),
    className: 'mg-sheet',
    content: (close) => h('div', { class: 'b-list mg-switch' }, list.map((b) => h('button', {
      type: 'button', class: ['b-row', b.id === S.bid && 'is-current'], 'aria-current': b.id === S.bid ? 'true' : null,
      onClick: () => { close(); if (b.id !== S.bid) { haptic(); selectBusiness(b.id); } },
    },
      monogram(b),
      h('span', { class: 'b-row__main' },
        h('span', { class: 'b-row__title' }, nm(b)),
        h('span', { class: 'b-row__sub', dir: 'ltr' }, `${b.slug} · ${b.is_demo ? t('mg.demo') : t(`mg.biz.${b.status}`)}`)),
      b.id === S.bid && icon('check', { class: 'mg-switch__tick' })))),
  });
}

/* ---------- live arrivals ---------- */

on('arrival', (b) => {
  chime();
  haptic([10, 40, 10]);
  toast(t('mg.new_booking', { name: customer(b), when: when(b.starts_at) }), {
    kind: 'ok', timeout: 7000, action: { label: t('mg.view'), onClick: () => openBooking(b) },
  });
  const r = parse();
  const dot = shell?.nav.querySelector('[data-tab="today"] .mg-tab__dot');
  if (dot && r.tab !== 'today' && fmt.riyadhDateISO(b.starts_at) === fmt.riyadhDateISO(new Date())) dot.hidden = false;
});
on('cust-cancel', (b) => {
  toast(t('mg.cust_cancelled', { name: customer(b), when: when(b.starts_at) }), { kind: 'info', timeout: 6000 });
});

/* ---------- connection ---------- */

function setOnline() {
  if (!shell) return;
  shell.offline.hidden = navigator.onLine;
  for (const d of shell.root.querySelectorAll('.mg-livedot')) d.classList.toggle('is-off', !navigator.onLine);
  if (navigator.onLine && S.bid) { loadWindow().catch(() => {}); loadOverview().catch(() => {}); }
}
window.addEventListener('online', setOnline);
window.addEventListener('offline', setOnline);
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  // Refresh after a real absence only (phones put the app in the background; panes flicker).
  if (S.bid && shell && Date.now() - hiddenAt > 3000) loadWindow().catch(() => {});
});
on('overview', () => {
  // Business name / status may change from the admin.
  if (!shell) return;
  const r = parse();
  const fresh = bizButton();
  shell.nav.querySelector('.mg-nav__biz')?.replaceChildren(fresh);
  if (!(r.tab === 'more' && r.sub && !window.matchMedia('(min-width: 1024px)').matches)) {
    shell.top.querySelector('.b-topbar__start')?.replaceChildren(bizButton());
  }
  document.title = pageTitle();
});

/* ---------- small screens ---------- */

function splash() {
  return h('div', { class: 'mg-splash', role: 'status', 'aria-label': t('loading') },
    h('span', { class: 'mg-splash__mark', 'aria-hidden': 'true' }, archMark()));
}

function fatal(message, retry) {
  return h('div', { class: 'b-empty mg-empty' },
    h('div', { class: 'b-empty__mark' }, icon('alert')),
    h('h2', { class: 'b-empty__title' }, t('mg.load_failed')),
    h('p', { class: 'b-empty__text' }, message),
    h('button', { type: 'button', class: 'b-btn b-btn--ghost', onClick: retry }, h('span', null, t('retry'))));
}

export { emit };
