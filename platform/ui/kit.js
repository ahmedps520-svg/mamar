/* ==========================================================
   MAMAR BOOKING — kit.js
   Small DOM helpers that pair with kit.css.
   ES module with no DOM access at import time (safe to import
   in Node for tests); every function guards its own DOM use.
   Text always goes in through text nodes / textContent —
   nothing here ever writes user data as HTML.
   ========================================================== */

import { t, register, dir as langDir } from '../i18n.js';
import common from '../i18n/common.js';

register(common);

const hasDOM = () => typeof document !== 'undefined' && !!document.documentElement;

/* ---------- reduced motion (live binding) ---------- */

const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

/** true when the visitor prefers reduced motion. Live: re-read it, don't cache it. */
export let reduced = !!(mq && mq.matches);
mq?.addEventListener?.('change', (e) => { reduced = e.matches; });

/* ---------- query helpers ---------- */

/** First match under root (default document). */
export const $ = (sel, root) => (root || document).querySelector(sel);
/** All matches under root, as an array. */
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ---------- h() ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'use', 'title']);
const PROPS = new Set(['value', 'checked', 'selected', 'indeterminate', 'htmlFor', 'tabIndex', 'inert']);

function classList(v) {
  if (!v) return [];
  if (typeof v === 'string') return v.split(/\s+/).filter(Boolean);
  if (Array.isArray(v)) return v.flatMap(classList);
  if (typeof v === 'object') return Object.keys(v).filter((k) => v[k]);
  return [];
}

function appendChildren(el, kids) {
  for (const c of kids) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (typeof Node !== 'undefined' && c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));   // text is never parsed as HTML
  }
}

/**
 * Create an element.
 *   h('button', {class:'b-btn b-btn--primary', type:'button', onClick: fn, 'aria-pressed': false}, 'Continue')
 * props: class (string | array | {name:bool}), style (string | object, '--vars' ok), dataset,
 * on<Event> listeners, aria-* (false is kept as "false"), text, ref(el).
 * Boolean true → empty attribute; false / null → omitted. There is deliberately no `html` prop.
 */
export function h(tag, props, ...children) {
  if (props == null || typeof props !== 'object' || Array.isArray(props) ||
      (typeof Node !== 'undefined' && props instanceof Node)) {
    if (props != null) children.unshift(props);
    props = {};
  }
  const svg = SVG_TAGS.has(tag) || props.ns === 'svg';
  const el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  let ref = null;
  for (const [k, v] of Object.entries(props)) {
    if (k === 'ns') continue;
    if (k === 'ref') { ref = v; continue; }
    if (k.startsWith('aria-') && (v === false || v === true)) { el.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') {
      const list = classList(v);
      if (list.length) el.setAttribute('class', list.join(' '));
    } else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText = v;
      else for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv;
      }
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) if (dv != null) el.dataset[dk] = String(dv);
    } else if (k === 'text') {
      el.textContent = String(v);
    } else if (/^on[A-Z]/.test(k) && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (!svg && PROPS.has(k)) {
      el[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendChildren(el, children);
  if (typeof ref === 'function') ref(el);
  return el;
}

/* ---------- icons ---------- */

const ICONS = {
  back: [['path', { d: 'M14.5 5.5 8 12l6.5 6.5' }]],
  forward: [['path', { d: 'M9.5 5.5 16 12l-6.5 6.5' }]],
  close: [['path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }]],
  check: [['path', { d: 'M5 12.5 9.5 17 19 7.5' }]],
  plus: [['path', { d: 'M12 5.5v13M5.5 12h13' }]],
  minus: [['path', { d: 'M5.5 12h13' }]],
  chevronDown: [['path', { d: 'm6.5 9.5 5.5 5.5 5.5-5.5' }]],
  calendar: [['rect', { x: 4, y: 5.5, width: 16, height: 14.5, rx: 2.5 }], ['path', { d: 'M4 10h16M8.5 3.5v4M15.5 3.5v4' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7.5V12l3 2' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z' }]],
  alert: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7.8v5M12 16.2v.01' }]],
  info: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 11v5M12 7.8v.01' }]],
  pin: [['path', { d: 'M12 20.5s-6.5-5.6-6.5-10.8a6.5 6.5 0 0 1 13 0c0 5.2-6.5 10.8-6.5 10.8z' }], ['circle', { cx: 12, cy: 9.7, r: 2.3 }]],
  user: [['circle', { cx: 12, cy: 8.5, r: 3.5 }], ['path', { d: 'M5 19.5c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5' }]],
  phone: [['path', { d: 'M7.2 4.5h2.4l1.3 3.6-1.8 1.2a10 10 0 0 0 5.6 5.6l1.2-1.8 3.6 1.3v2.4a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 5.2 6.7a2 2 0 0 1 2-2.2z' }]],
  car: [['path', { d: 'M4.5 16.5V13l1.8-4.6A2 2 0 0 1 8.2 7h7.6a2 2 0 0 1 1.9 1.4L19.5 13v3.5M4.5 13h15M3.5 16.5h17' }], ['circle', { cx: 8, cy: 16.5, r: 1.8 }], ['circle', { cx: 16, cy: 16.5, r: 1.8 }]],
  sparkle: [['path', { d: 'M12 4c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6zM18.5 15.5c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2z' }]],
  inbox: [['path', { d: 'M4 13.5 6.3 6.6A1.5 1.5 0 0 1 7.7 5.5h8.6a1.5 1.5 0 0 1 1.4 1.1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18zM4 13.5h4.5l1.2 2h4.6l1.2-2H20' }]],
  arrowUp: [['path', { d: 'M12 18.5v-13M6.5 11 12 5.5 17.5 11' }]],
  arrowDown: [['path', { d: 'M12 5.5v13M6.5 13 12 18.5 17.5 13' }]],
};
const DIRECTIONAL = new Set(['back', 'forward']);

/**
 * Inline SVG icon (stroke = currentColor). Directional icons mirror in RTL.
 * @param {string} name  one of ICON_NAMES
 * @param {{label?:string, class?:string}} [opts] label → role="img" + aria-label, else aria-hidden
 */
export function icon(name, { label, class: cls } = {}) {
  const parts = ICONS[name] || ICONS.info;
  const svg = h('svg', {
    viewBox: '0 0 24 24',
    class: ['b-icon', DIRECTIONAL.has(name) && 'b-icon--dir', cls],
    'aria-hidden': label ? null : 'true',
    role: label ? 'img' : null,
    'aria-label': label || null,
    focusable: 'false',
  });
  for (const [tag, attrs] of parts) svg.appendChild(h(tag, attrs));
  return svg;
}
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** The Mamar arch mark. */
export function mark() {
  return h('svg', { viewBox: '0 0 34 34', 'aria-hidden': 'true', focusable: 'false' },
    h('path', { d: 'M6 28V14a11 11 0 0 1 22 0v14' }),
    h('path', { d: 'M12.5 28V14.5a4.5 4.5 0 0 1 9 0V28' }));
}

/** "Made by Mamar" footer credit linking to mamar.site. */
export function madeBy() {
  return h('a', { class: 'b-madeby', href: 'https://mamar.site', target: '_blank', rel: 'noopener' }, mark(), t('made_by'));
}

/* ---------- haptics ---------- */

/** A tiny tap on supporting phones (navigator.vibrate). */
export function haptic(pattern = 8) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // Browsers refuse (and log) vibration before the first real tap.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate(pattern);
  } catch { /* not allowed (iframe / no gesture) */ }
}

/* ---------- toasts ---------- */

let toastRegion = null;
function region() {
  if (!toastRegion || !toastRegion.isConnected) {
    toastRegion = h('div', { class: 'b-toasts', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.appendChild(toastRegion);
  }
  return toastRegion;
}

/**
 * Show a toast. Returns a function that dismisses it.
 * @param {string} msg
 * @param {{kind?:'info'|'ok'|'warn'|'err', timeout?:number, action?:{label:string, onClick:Function}}} [opts]
 */
export function toast(msg, { kind = 'info', timeout = 3200, action } = {}) {
  if (!hasDOM()) return () => {};
  const r = region();
  let timer = null;
  const el = h('div', { class: ['b-toast', `b-toast--${kind}`], role: kind === 'err' ? 'alert' : null },
    h('span', { class: 'b-toast__dot', 'aria-hidden': 'true' }),
    h('span', { class: 'b-toast__msg' }, msg),
    action && h('button', {
      class: 'b-toast__action', type: 'button',
      onClick: () => { try { action.onClick?.(); } finally { close(); } },
    }, action.label));

  function close() {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), reduced ? 0 : 260);
  }
  const arm = () => { clearTimeout(timer); if (timeout > 0) timer = setTimeout(close, timeout); };

  while (r.children.length >= 3) r.firstElementChild.remove();
  r.appendChild(el);
  void el.offsetWidth;            // commit the start state so the entrance transitions
  el.classList.add('is-in');
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', arm);
  arm();
  if (kind === 'err') haptic([12, 60, 12]);
  return close;
}

/* ---------- focus trap ---------- */

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

/**
 * Keep Tab / Shift+Tab inside container. Focuses `initial` (or the first focusable).
 * @returns {(opts?:{restore?:boolean}) => void} release — restores focus to where it was
 */
export function trapFocus(container, { initial } = {}) {
  if (!hasDOM() || !container) return () => {};
  const prev = document.activeElement;
  const items = () => $$(FOCUSABLE, container).filter((el) => el.getClientRects().length > 0);
  function onKey(e) {
    if (e.key !== 'Tab') return;
    const list = items();
    if (!list.length) { e.preventDefault(); container.focus(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !container.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !container.contains(active))) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  const target = initial || items()[0] || container;
  target.focus?.({ preventScroll: true });
  return ({ restore = true } = {}) => {
    document.removeEventListener('keydown', onKey, true);
    if (restore && prev && typeof prev.focus === 'function' && prev.isConnected) prev.focus({ preventScroll: true });
  };
}

/* ---------- scroll lock ---------- */

let locks = 0;
function lockScroll() { if (locks++ === 0) document.documentElement.classList.add('b-locked'); }
function unlockScroll() { if (--locks <= 0) { locks = 0; document.documentElement.classList.remove('b-locked'); } }

let uidN = 0;
const uid = (p) => `${p}-${++uidN}`;

/* ---------- sheet / modal ---------- */

/**
 * Bottom sheet on phones, centred modal from 640px.
 * Resolves with the chosen action's `value` (or null when dismissed).
 * @param {{title?:string, content?:Node|string|((close:Function)=>Node), dismissible?:boolean, className?:string,
 *          actions?:Array<{label:string, value?:any, kind?:'primary'|'ghost'|'quiet', danger?:boolean,
 *                          onClick?:(close:Function)=>any}>}} opts
 *   An action's onClick may return a promise (the button shows its loading state) and
 *   may return false to keep the sheet open.
 * @returns {Promise<any>}
 */
export function sheet({ title, content, actions = [], dismissible = true, className } = {}) {
  if (!hasDOM()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const titleId = uid('b-sheet-t');
    let done = false;
    let release = () => {};

    const panel = h('div', {
      class: ['b-sheet', className],
      role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
      'aria-labelledby': title ? titleId : null,
      'aria-label': title ? null : t('close'),
    });
    const overlay = h('div', { class: 'b-overlay' }, panel);

    function close(value = null) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      release();
      overlay.classList.remove('is-open');
      const finish = () => { overlay.remove(); unlockScroll(); resolve(value); };
      if (reduced) finish(); else setTimeout(finish, 320);
    }
    function onKey(e) { if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(null); } }

    const body = typeof content === 'function' ? content(close) : content;
    const buttons = actions.map((a) => {
      const btn = h('button', {
        type: 'button',
        class: ['b-btn', a.kind === 'primary' ? 'b-btn--primary' : a.kind === 'quiet' ? 'b-btn--quiet' : 'b-btn--ghost', a.danger && 'b-btn--danger'],
        onClick: async () => {
          if (btn.getAttribute('aria-busy') === 'true') return;
          if (a.onClick) {
            btn.setAttribute('aria-busy', 'true');
            let r;
            try { r = await a.onClick(close); } finally { btn.removeAttribute('aria-busy'); }
            if (r === false || done) return;
          }
          close(a.value !== undefined ? a.value : a.label);
        },
      }, h('span', null, a.label));
      return btn;
    });

    // Native append() prints null/false as text, so filter the optional parts first.
    panel.append(...[
      h('div', { class: 'b-sheet__grip', 'aria-hidden': 'true' }),
      h('header', { class: 'b-sheet__head' },
        title ? h('h2', { class: 'b-sheet__title', id: titleId }, title) : h('span'),
        dismissible && h('button', {
          type: 'button', class: 'b-iconbtn b-sheet__close', 'aria-label': t('close'), onClick: () => close(null),
        }, icon('close'))),
      body != null && h('div', { class: 'b-sheet__body' }, body),
      buttons.length ? h('footer', { class: 'b-sheet__actions' }, buttons) : null,
    ].filter(Boolean));

    overlay.addEventListener('click', (e) => { if (e.target === overlay && dismissible) close(null); });
    document.addEventListener('keydown', onKey);
    if (dismissible) dragToDismiss(panel, () => close(null));

    lockScroll();
    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
    const primary = buttons.find((b, i) => actions[i].autofocus);
    release = trapFocus(panel, { initial: primary || panel });
    haptic();
  });
}

/* Pull the sheet down by its grip/header to dismiss (phones only). */
function dragToDismiss(panel, onDismiss) {
  let y0 = null;
  let dy = 0;
  const handle = (e) => e.target.closest('.b-sheet__grip, .b-sheet__head') && !e.target.closest('button');
  panel.addEventListener('pointerdown', (e) => {
    if (!handle(e) || (typeof window !== 'undefined' && window.innerWidth >= 640)) return;
    y0 = e.clientY; dy = 0;
    panel.setPointerCapture?.(e.pointerId);
    panel.style.transition = 'none';
  });
  panel.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 90) onDismiss();
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
}

/**
 * Yes / no question as a sheet. Resolves true or false.
 * @param {{title?:string, message?:string, confirm?:string, cancel?:string, danger?:boolean}} opts
 */
export async function confirmDialog({ title, message, confirm, cancel, danger = false } = {}) {
  const v = await sheet({
    title: title || t('confirm.title'),
    content: message ? h('p', null, message) : null,
    actions: [
      { label: cancel || t('cancel'), value: false, kind: 'ghost' },
      { label: confirm || t('confirm'), value: true, kind: 'primary', danger, autofocus: true },
    ],
  });
  return v === true;
}

/* ---------- numbers ---------- */

const easeOutCubic = (p) => 1 - (1 - p) ** 3;
const runningNum = new WeakMap();
const lastNum = new WeakMap();

/**
 * Count el's text from `from` to `to` (running totals).
 * Pass from = null to continue from the last value shown in el.
 * @param {Element} el
 * @param {number|null} from
 * @param {number} to
 * @param {{duration?:number, format?:(n:number)=>string, step?:number}} [opts]
 *   step rounds intermediate frames (e.g. 100 halalas → whole riyals while counting)
 * @returns {Promise<void>}
 */
export function animateNumber(el, from, to, { duration = 520, format = (n) => String(n), step = 1 } = {}) {
  if (!el) return Promise.resolve();
  runningNum.get(el)?.();
  const start = from ?? lastNum.get(el) ?? to;
  lastNum.set(el, to);
  const show = (v) => { el.textContent = format(Math.round(v / step) * step); };
  if (reduced || start === to || typeof requestAnimationFrame !== 'function') {
    el.textContent = format(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      if (p < 1) { show(start + (to - start) * easeOutCubic(p)); raf = requestAnimationFrame(tick); }
      else { el.textContent = format(to); runningNum.delete(el); resolve(); }
    };
    raf = requestAnimationFrame(tick);
    runningNum.set(el, () => { cancelAnimationFrame(raf); runningNum.delete(el); resolve(); });
  });
}

/* ---------- concierge step transition ---------- */

function isRTL(el) {
  try { return getComputedStyle(el).direction === 'rtl'; } catch { return langDir() === 'rtl'; }
}

/**
 * Replace the current step in `container` with `nextEl`: the old step slides out
 * and fades, the new one slides in from the reading direction ('forward') or
 * from behind ('back'). Mirrors in RTL; a plain cross-fade under reduced motion.
 * Focus moves to the new step's [data-step-focus] or .b-step__q heading.
 * @param {Element} container   e.g. .b-stage
 * @param {Element} nextEl      e.g. a new .b-step
 * @param {'forward'|'back'} [direction]
 * @returns {Promise<void>}
 */
export function stepTransition(container, nextEl, direction = 'forward') {
  if (!hasDOM() || !container || !nextEl) return Promise.resolve();
  const prev = Array.from(container.children).find((c) => c !== nextEl && !c.hasAttribute('data-leaving'));
  const focusNext = () => {
    const f = nextEl.querySelector('[data-step-focus], .b-step__q, h1, h2');
    if (!f) return;
    if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1');
    f.focus({ preventScroll: true });
  };
  const canAnimate = typeof nextEl.animate === 'function';

  if (!prev) {
    container.appendChild(nextEl);
    focusNext();
    return Promise.resolve();
  }
  if (reduced || !canAnimate) {
    prev.remove();
    container.appendChild(nextEl);
    if (canAnimate) nextEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'linear' });
    focusNext();
    return Promise.resolve();
  }

  const sign = (direction === 'back' ? -1 : 1) * (isRTL(container) ? -1 : 1);
  const h0 = container.offsetHeight;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  // Lift the outgoing step out of flow so the incoming one lays out normally.
  prev.setAttribute('data-leaving', '');
  prev.setAttribute('aria-hidden', 'true');
  prev.inert = true;
  Object.assign(prev.style, { position: 'absolute', top: '0', left: '0', right: '0', pointerEvents: 'none' });
  container.appendChild(nextEl);
  const h1 = container.offsetHeight;

  const anims = [
    prev.animate(
      [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-sign * 24}px)`, opacity: 0 }],
      { duration: 200, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }),
    nextEl.animate(
      [{ transform: `translateX(${sign * 40}px)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration: 320, delay: 80, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' }),
  ];
  if (Math.abs(h1 - h0) > 2) {
    anims.push(container.animate([{ height: `${h0}px` }, { height: `${h1}px` }],
      { duration: 320, easing: 'cubic-bezier(.2, .7, 0, 1)' }));
  }
  return Promise.all(anims.map((a) => a.finished)).catch(() => {}).then(() => {
    prev.remove();
    focusNext();
  });
}

/* ---------- skeletons ---------- */

/**
 * n skeleton placeholders in a .b-skel-list (aria-busy, labelled "Loading…").
 * @param {number} [n]
 * @param {{variant?:'card'|'line'|'title'}} [opts]
 */
export function skeleton(n = 3, { variant = 'card' } = {}) {
  const cls = variant === 'line' ? 'b-skel' : `b-skel b-skel--${variant}`;
  const list = h('div', { class: 'b-skel-list', 'aria-busy': 'true', role: 'status', 'aria-label': t('loading') });
  for (let i = 0; i < n; i++) {
    list.appendChild(h('span', { class: cls, style: variant === 'line' ? { '--w': `${[100, 82, 64][i % 3]}%` } : null }));
  }
  return list;
}

/* ---------- selection groups ---------- */

/**
 * Make a group of option elements (choice cards, dates, slots, chips, segmented options)
 * behave as a radio group (or a set of toggles with multi:true): click, Space/Enter,
 * arrow keys (mirrored in RTL), roving tabindex, aria-checked / aria-pressed.
 * @param {Element} container
 * @param {{selector?:string, multi?:boolean, onChange?:(value:string|string[], el:Element)=>void}} [opts]
 *   options are identified by data-value
 * @returns {{get:()=>string|string[]|null, set:(v:string|string[])=>void, destroy:()=>void}}
 */
export function selectable(container, { selector = '[data-value]', multi = false, onChange } = {}) {
  if (!hasDOM() || !container) return { get: () => null, set: () => {}, destroy: () => {} };
  const attr = multi ? 'aria-pressed' : 'aria-checked';
  const opts = () => $$(selector, container).filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  if (!multi && !container.hasAttribute('role')) container.setAttribute('role', 'radiogroup');

  const paint = () => {
    const all = $$(selector, container);
    let tabbed = false;
    for (const el of all) {
      if (!multi) el.setAttribute('role', 'radio');
      const on = el.getAttribute(attr) === 'true';
      if (!el.hasAttribute(attr)) el.setAttribute(attr, 'false');
      if (!multi) {
        el.tabIndex = on ? 0 : -1;
        if (on) tabbed = true;
      }
    }
    if (!multi && !tabbed) { const first = opts()[0]; if (first) first.tabIndex = 0; }
  };
  const get = () => {
    const on = $$(selector, container).filter((el) => el.getAttribute(attr) === 'true').map((el) => el.dataset.value);
    return multi ? on : on[0] ?? null;
  };
  const choose = (el, emit = true) => {
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (multi) el.setAttribute(attr, String(el.getAttribute(attr) !== 'true'));
    else for (const o of $$(selector, container)) o.setAttribute(attr, String(o === el));
    paint();
    haptic();
    if (emit) onChange?.(get(), el);
  };
  const set = (v) => {
    const want = new Set([].concat(v ?? []).map(String));
    for (const o of $$(selector, container)) o.setAttribute(attr, String(want.has(o.dataset.value)));
    paint();
  };

  const onClick = (e) => {
    const el = e.target.closest(selector);
    if (el && container.contains(el)) choose(el);
  };
  const onKey = (e) => {
    const el = e.target.closest(selector);
    if (!el || !container.contains(el)) return;
    const list = opts();
    const i = list.indexOf(el);
    const rtl = isRTL(container);
    let next = null;
    if (e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = list[(i + 1) % list.length];
    else if (e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = list[(i - 1 + list.length) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else if ((e.key === ' ' || e.key === 'Enter') && el.tagName !== 'BUTTON') { e.preventDefault(); choose(el); return; }
    if (next) {
      e.preventDefault();
      next.focus();
      if (!multi) choose(next);
    }
  };
  container.addEventListener('click', onClick);
  container.addEventListener('keydown', onKey);
  paint();
  return {
    get, set,
    destroy() { container.removeEventListener('click', onClick); container.removeEventListener('keydown', onKey); },
  };
}

/* ---------- misc ---------- */

/** Toggle .is-stuck on a sticky bar once the page scrolls under it. Returns a cleanup. */
export function watchStuck(bar, threshold = 4) {
  if (!hasDOM() || !bar || typeof window === 'undefined') return () => {};
  const on = () => bar.classList.toggle('is-stuck', window.scrollY > threshold);
  window.addEventListener('scroll', on, { passive: true });
  on();
  return () => window.removeEventListener('scroll', on);
}
