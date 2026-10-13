/* ==========================================================
   Mamar Booking — i18n
   Arabic first (RTL), English one tap away.
   Importable in Node: every DOM / storage access is guarded.

   The language choice lives in localStorage 'mamar-lang' — the
   same key the studio portfolio uses — so it carries across
   mamar.site. A page may force a language for one visit with
   ?lang=en|ar (not persisted).
   ========================================================== */

import { digits } from './fmt.js';

export const LANGS = Object.freeze(['ar', 'en']);
export const STORAGE_KEY = 'mamar-lang';

const hasDOM = typeof document !== 'undefined' && !!document.documentElement;
const store = { ar: Object.create(null), en: Object.create(null) };
const listeners = new Set();
const warned = new Set();
let allowed = [...LANGS];
let current = null;
const wired = new WeakSet();

/* ---------- storage ---------- */

function readSaved() {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null; } catch { return null; }
}
function writeSaved(l) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, l); } catch { /* private mode */ }
}
function fromUrl() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('lang');
    return LANGS.includes(q) ? q : null;
  } catch { return null; }
}

const valid = (l) => LANGS.includes(l);
const clamp = (l) => (allowed.includes(l) ? l : allowed[0]);

/* ---------- language state ---------- */

/** The active language: 'ar' (default) or 'en'. */
export function lang() {
  if (!current) {
    const saved = readSaved();
    current = clamp(fromUrl() || (valid(saved) ? saved : 'ar'));
  }
  return current;
}

/** 'rtl' for Arabic, 'ltr' for English. */
export function dir(l = lang()) {
  return l === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Switch language: updates <html lang dir>, persists the choice, fires
 * 'langchange' (on <html>, bubbling to document and window) and onLang callbacks.
 * @param {'ar'|'en'} l
 * @param {{persist?: boolean, silent?: boolean}} [opts]
 */
export function setLang(l, { persist = true, silent = false } = {}) {
  if (!valid(l)) return lang();
  const next = clamp(l);
  const changed = next !== current;
  current = next;
  if (persist && next === l) writeSaved(next);
  if (hasDOM) {
    const root = document.documentElement;
    root.lang = next;
    root.dir = dir(next);
    syncToggles();
  }
  if (!silent && changed) emit();
  return next;
}

function emit() {
  const detail = { lang: current, dir: dir(current) };
  if (hasDOM && typeof CustomEvent === 'function') {
    document.documentElement.dispatchEvent(new CustomEvent('langchange', { bubbles: true, detail }));
  }
  for (const cb of [...listeners]) {
    try { cb(detail.lang, detail.dir); } catch (e) { console.error(e); }
  }
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLang(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Restrict the languages a page offers (e.g. a business that is Arabic-only).
 * Hides every [data-lang-toggle] when one language is left. Does not overwrite
 * the visitor's saved preference for the rest of mamar.site.
 */
export function allowLangs(list = LANGS) {
  const next = (Array.isArray(list) ? list : [list]).filter(valid);
  allowed = next.length ? next : [...LANGS];
  if (hasDOM) {
    document.documentElement.toggleAttribute('data-lang-locked', allowed.length < 2);
  }
  const want = clamp(lang());
  if (want !== current) setLang(want, { persist: false });
  else syncToggles();
  return [...allowed];
}

/** The languages this page currently offers. */
export function allowedLangs() { return [...allowed]; }

/* ---------- dictionaries ---------- */

/** Merge a {ar:{key:str}, en:{key:str}} dictionary into the shared store. */
export function register(dict) {
  if (!dict) return;
  for (const l of LANGS) if (dict[l]) Object.assign(store[l], dict[l]);
}

/** True if a key exists in the given (or current) language. */
export function has(key, l = lang()) {
  return Object.prototype.hasOwnProperty.call(store[l] || {}, key);
}

function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  if (typeof console !== 'undefined') console.warn(`[i18n] ${msg}`);
}

function interpolate(str, vars, l) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => {
    if (!(name in vars) || vars[name] == null) return m;
    const v = vars[name];
    return typeof v === 'number' ? digits(String(v), l) : String(v);
  });
}

/**
 * Translate a key. `{name}` placeholders are filled from vars (numbers get
 * localised digits). Falls back to the other language, then to the key itself,
 * warning once per key.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @param {'ar'|'en'} [l] force a language
 */
export function t(key, vars, l = lang()) {
  if (has(key, l)) return interpolate(store[l][key], vars, l);
  const other = l === 'ar' ? 'en' : 'ar';
  if (has(key, other)) {
    warnOnce(`"${key}" missing in ${l}, using ${other}`);
    return interpolate(store[other][key], vars, l);
  }
  warnOnce(`"${key}" missing`);
  return key;
}

/**
 * Plural-aware translate with Intl.PluralRules (Arabic: zero/one/two/few/many/other).
 * Looks up `${key}.${category}`, then `${key}.other`. A `${key}.zero` entry is
 * also honoured for n = 0 in English ("No bookings yet").
 * `{n}` is always available as a placeholder.
 */
export function tn(key, n, vars = {}, l = lang()) {
  const v = { n, count: n, ...vars };
  if (n === 0 && has(`${key}.zero`, l)) return t(`${key}.zero`, v, l);
  let cat = 'other';
  try { cat = new Intl.PluralRules(l).select(n); } catch { /* old engine */ }
  if (has(`${key}.${cat}`, l)) return t(`${key}.${cat}`, v, l);
  return t(`${key}.other`, v, l);
}

/* ---------- DOM ---------- */

function* matches(root, sel) {
  if (root.matches?.(sel)) yield root;
  if (root.querySelectorAll) yield* root.querySelectorAll(sel);
}

/**
 * Fill translatable markup under root:
 *  - [data-i18n="key"]                         → textContent
 *  - [data-i18n-attr="placeholder:key;aria-label:key2"] → attributes
 *  - [data-ar][data-en]                        → textContent (studio legacy pattern)
 * Text is always set with textContent, never as HTML.
 */
export function applyDom(root) {
  if (!hasDOM) return;
  root = root || document;
  const l = lang();
  for (const el of matches(root, '[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of matches(root, '[data-i18n-attr]')) {
    for (const pair of el.getAttribute('data-i18n-attr').split(';')) {
      const i = pair.indexOf(':');
      if (i < 1) continue;
      el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
    }
  }
  for (const el of matches(root, '[data-ar][data-en]')) {
    el.textContent = el.getAttribute(l === 'ar' ? 'data-ar' : 'data-en');
  }
}

function paintToggle(btn) {
  const l = lang();
  const label = btn.querySelector('[data-lang-label]') || btn;
  label.textContent = l === 'ar' ? 'EN' : 'ع';
  label.setAttribute('lang', l === 'ar' ? 'en' : 'ar');
  btn.setAttribute('aria-label', l === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
  btn.hidden = allowed.length < 2;
}

function syncToggles() {
  if (!hasDOM) return;
  for (const b of document.querySelectorAll('[data-lang-toggle]')) paintToggle(b);
}

/**
 * Wire a language toggle: shows 'EN' while in Arabic and 'ع' while in English.
 * Put [data-lang-label] on a child to label only that part of the button.
 * @returns {() => void} cleanup
 */
export function langToggle(button) {
  if (!hasDOM || !button) return () => {};
  if (wired.has(button)) { paintToggle(button); return () => {}; }
  wired.add(button);
  button.setAttribute('data-lang-toggle', '');
  if (button.tagName === 'BUTTON' && !button.getAttribute('type')) button.type = 'button';
  const onClick = () => setLang(lang() === 'ar' ? 'en' : 'ar');
  button.addEventListener('click', onClick);
  paintToggle(button);
  return () => { wired.delete(button); button.removeEventListener('click', onClick); };
}

/**
 * One-call page setup: applies the language to <html>, fills the DOM, wires every
 * [data-lang-toggle], and re-fills on each change.
 */
export function boot(root) {
  if (!hasDOM) return lang();
  setLang(lang(), { persist: false, silent: true });
  applyDom(root || document);
  for (const b of document.querySelectorAll('[data-lang-toggle]')) langToggle(b);
  onLang(() => applyDom(root || document));
  return lang();
}

/** Test helper: forget the cached language and allowed list. */
export function _reset() {
  current = null;
  allowed = [...LANGS];
  warned.clear();
  listeners.clear();
}
