// Mamar admin — shared view helpers on top of platform/ui/kit.js.
// Every piece of data goes in through h() text nodes / textContent; nothing here writes HTML.
import { h, icon as kitIcon, toast, reduced } from '../platform/ui/kit.js';
import { t, lang } from '../platform/i18n.js';
import { errorKey } from '../platform/api.js';
import * as fmt from '../platform/fmt.js';

/* ---------- icons (24 grid, stroke = currentColor, same look as the kit's) ---------- */

const dot = (cx, cy, r = 1.35) => ['circle', { cx, cy, r, fill: 'currentColor', stroke: 'none' }];
const P = {
  home: [['path', { d: 'M4 10.6 12 4l8 6.6v8.9a.5.5 0 0 1-.5.5H15v-5.5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1V20H4.5a.5.5 0 0 1-.5-.5z' }]],
  store: [['path', { d: 'M4.5 10v9a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-9M3.5 9.5 5.3 4.7A1.1 1.1 0 0 1 6.3 4h11.4a1.1 1.1 0 0 1 1 .7l1.8 4.8M3.5 9.5h17M9.5 20v-5h5v5' }]],
  more: [dot(5.5, 12, 1.6), dot(12, 12, 1.6), dot(18.5, 12, 1.6)],
  bell: [['path', { d: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0' }]],
  tag: [['path', { d: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-6.9 6.9a1 1 0 0 1-1.4 0z' }], ['circle', { cx: 8, cy: 8, r: 1.5 }]],
  sliders: [['path', { d: 'M4 7h10M18 7h2M4 17h4M12 17h8' }], ['circle', { cx: 16, cy: 7, r: 2 }], ['circle', { cx: 10, cy: 17, r: 2 }]],
  whatsapp: [['path', { d: 'M4.3 19.7l1.2-3.7a8 8 0 1 1 2.8 2.7z' }], ['path', { d: 'M9.4 8.7c.2-.3.4-.3.6-.3h.5c.2 0 .4.1.5.4l.6 1.4c.1.2 0 .4-.1.6l-.5.6c.6 1.1 1.4 1.9 2.5 2.5l.6-.5c.2-.1.4-.2.6-.1l1.4.6c.3.1.4.3.4.5v.5c0 .2-.1.4-.3.6-.5.4-1.3.6-2.4.2a9 9 0 0 1-4.6-4.6c-.4-1-.2-1.9.2-2.4z' }]],
  mail: [['rect', { x: 3.5, y: 5.5, width: 17, height: 13, rx: 2 }], ['path', { d: 'm4.5 7 7.5 6 7.5-6' }]],
  chat: [['path', { d: 'M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10.5l-4 3.5v-3.5h0a2 2 0 0 1-2-2z' }], dot(8.6, 10.5, 1.1), dot(12, 10.5, 1.1), dot(15.4, 10.5, 1.1)],
  copy: [['rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 }], ['path', { d: 'M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5' }]],
  external: [['path', { d: 'M13.5 4.5h6v6M19.5 4.5l-8 8M17.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.5' }]],
  upload: [['path', { d: 'M12 15.5v-11M7.5 9 12 4.5 16.5 9M4.5 15.5v3A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-3' }]],
  trash: [['path', { d: 'M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7' }]],
  key: [['circle', { cx: 8, cy: 15.5, r: 3.5 }], ['path', { d: 'M10.5 13 19 4.5M16 7.5l2.5 2.5M13.8 9.7l2 2' }]],
  link: [['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }]],
  palette: [['path', { d: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.6 0-.9.7-1.5 1.6-1.5h2.1a4 4 0 0 0 4-4c0-4.3-3.8-7.2-8.5-7.2z' }], dot(7.6, 11.6, 1.1), dot(9.8, 7.6, 1.1), dot(14.4, 7.4, 1.1)],
  users: [['circle', { cx: 9, cy: 8.5, r: 3 }], ['path', { d: 'M3.5 19c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5M15.5 5.6a3 3 0 0 1 0 5.8M17 14.7c1.6.5 2.8 1.9 3.5 4.3' }]],
  card: [['rect', { x: 3.5, y: 5.5, width: 17, height: 13, rx: 2 }], ['path', { d: 'M3.5 9.5h17M7 15h3' }]],
  sound: [['path', { d: 'M4.5 9.5h3l4.5-4v13l-4.5-4h-3zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11' }]],
  refresh: [['path', { d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4' }]],
  shield: [['path', { d: 'M12 3.5 5 6v5.5c0 4.3 3 7.5 7 9 4-1.5 7-4.7 7-9V6zM9 12l2 2 4-4' }]],
  code: [['path', { d: 'M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5l-3 14' }]],
  eye: [['path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  lock: [['rect', { x: 5, y: 10.5, width: 14, height: 9.5, rx: 2 }], ['path', { d: 'M8 10.5V8a4 4 0 0 1 8 0v2.5' }]],
  moon: [['path', { d: 'M19.5 14.5a8 8 0 0 1-10-10 8 8 0 1 0 10 10z' }]],
  doc: [['rect', { x: 5, y: 3.5, width: 14, height: 17, rx: 2 }], ['path', { d: 'M9 8.5h6M9 12h6M9 15.5h3' }]],
  flag: [['path', { d: 'M5.5 20.5v-16M5.5 4.5h11l-2 4 2 4h-11' }]],
  send: [['path', { d: 'M20 4 4 11l6.5 2.5L13 20zM20 4l-9.5 9.5' }]],
  plan: [['path', { d: 'M12 3.5 14.4 9l5.8.5-4.4 3.8 1.4 5.7L12 16l-5.2 3 1.4-5.7-4.4-3.8L9.6 9z' }]],
  device: [['rect', { x: 7, y: 3, width: 10, height: 18, rx: 2.5 }], ['path', { d: 'M11 18h2' }]],
  logout: [['path', { d: 'M14.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3.5M10 8l-4 4 4 4M6 12h9.5' }]],
  wand: [['path', { d: 'M5 19 15.5 8.5M14 4.5v2M19.5 10h-2M17.6 6.4l-1.4 1.4' }]],
};
const DIRECTIONAL = new Set(['logout', 'send']);

/** Icon by name: admin set first, then the kit's. */
export function ic(name, opts = {}) {
  const parts = P[name];
  if (!parts) return kitIcon(name, opts);
  const svg = h('svg', {
    viewBox: '0 0 24 24',
    class: ['b-icon', DIRECTIONAL.has(name) && 'b-icon--dir', opts.class],
    'aria-hidden': opts.label ? null : 'true', role: opts.label ? 'img' : null, 'aria-label': opts.label || null,
    focusable: 'false',
  });
  for (const [tag, attrs] of parts) svg.appendChild(h(tag, attrs));
  return svg;
}

/** The Mamar arch, drawn at any size. */
export function arch(cls = 'adm-arch') {
  return h('svg', { viewBox: '0 0 34 34', class: cls, 'aria-hidden': 'true', focusable: 'false' },
    h('path', { d: 'M6 28V14a11 11 0 0 1 22 0v14' }),
    h('path', { d: 'M12.5 28V14.5a4.5 4.5 0 0 1 9 0V28' }));
}

/* ---------- formatting in the current language ---------- */

export const money = (hal, opts) => fmt.money(hal, lang(), opts);
export const num = (n) => fmt.num(n, lang());
export const pickName = (row, field = 'name') => {
  const l = lang();
  const o = l === 'en' ? 'ar' : 'en';
  return (row && (row[`${field}_${l}`] || row[`${field}_${o}`])) || '';
};

/** "now" · "5 min ago" · "9:30 PM" · "Yesterday · 9:30 PM" · "13 Oct" */
export function when(iso, now = new Date()) {
  if (!iso) return '';
  const d = fmt.toDate(iso);
  const diff = (now - d) / 60000;
  const l = lang();
  if (diff < 1 && diff > -1) return t('rel.now');
  if (diff > 0 && diff < 60) return t('rel.min', { n: Math.round(diff) });
  const day = fmt.riyadhDateISO(d);
  const today = fmt.riyadhDateISO(now);
  if (day === today) return fmt.time(d, l);
  if (day === fmt.addDaysISO(today, -1)) return `${t('yesterday')} · ${fmt.time(d, l)}`;
  return fmt.dateShort(d, l, { year: day.slice(0, 4) !== today.slice(0, 4) });
}

/** '١٣ أكتوبر ٢٠٢٦ · ٩:٣٠ م' */
export const stamp = (iso) => `${fmt.dateShort(iso, lang(), { year: true })} · ${fmt.time(iso, lang())}`;

/* ---------- money input (halala-exact, no float maths) ---------- */

/** '1,250.5' / '١٬٢٥٠٫٥' → 125050. '' → null. Invalid → NaN. */
export function parseSar(str) {
  const s = fmt.toLatin(String(str ?? '')).replace(/[\s,]/g, '').trim();
  if (s === '') return null;
  const m = /^(\d{1,7})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}
/** 125050 → '1250.50' · 399900 → '3999' (what goes back into an input). */
export function sarInput(hal) {
  if (hal == null) return '';
  const r = Math.floor(hal / 100);
  const c = hal % 100;
  return c ? `${r}.${String(c).padStart(2, '0')}` : String(r);
}

/* ---------- building blocks ---------- */

/** Large page title with an eyebrow, optional lede and actions. The title takes focus on navigation. */
export function pageHead({ eyebrow, title, sub, actions, back } = {}) {
  const h1 = h('h1', { class: 'adm-title', tabindex: '-1', 'data-page-title': '' }, title);
  return h('header', { class: 'adm-head' },
    back && h('a', { class: 'adm-back', href: back.href }, kitIcon('back'), h('span', null, back.label)),
    eyebrow && h('p', { class: 'b-eyebrow adm-head__eyebrow' }, eyebrow),
    h('div', { class: 'adm-head__row' }, h1, actions && h('div', { class: 'adm-head__actions' }, actions)),
    sub && h('p', { class: 'adm-head__sub' }, sub));
}

/** A titled section. */
export function section(title, body, { action, id, sub, cls } = {}) {
  return h('section', { class: ['adm-sec', cls], id, 'aria-labelledby': id && title ? `${id}-t` : null },
    (title || action) && h('div', { class: 'adm-sec__head' },
      title && h('h2', { class: 'adm-sec__title', id: id ? `${id}-t` : null }, title),
      action || null),
    sub && h('p', { class: 'adm-sec__sub' }, sub),
    body);
}

let fid = 0;
/** Static-label text field. Returns {el, input, msg, setError}. */
export function field({ label, value = '', type = 'text', name, placeholder, hint, attrs = {}, multiline = false, mono = false, dir } = {}) {
  const id = `adm-f-${++fid}`;
  const msgId = `${id}-m`;
  const props = {
    class: ['b-field__input', mono && 'b-mono'], id, name, placeholder: placeholder || ' ', dir: dir || null,
    'aria-describedby': hint ? msgId : null, ...attrs,
  };
  const input = multiline ? h('textarea', props) : h('input', { ...props, type });
  input.value = value ?? '';
  const msg = h('p', { class: 'b-field__msg', id: msgId, hidden: !hint }, hint || '');
  const el = h('div', { class: 'b-field b-field--static' },
    h('label', { class: 'b-field__label', for: id }, label),
    h('div', { class: 'b-field__box' }, input),
    msg);
  const setError = (text) => {
    el.classList.toggle('is-invalid', !!text);
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (text) { msg.hidden = false; msg.textContent = text; input.setAttribute('aria-describedby', msgId); }
    else { msg.textContent = hint || ''; msg.hidden = !hint; }
  };
  return { el, input, msg, setError };
}

let sid = 0;
/** A switch row: label + sub text + kit switch. */
export function switchRow({ label, sub, checked, onChange, end, disabled }) {
  const id = `adm-s-${++sid}`;
  const input = h('input', { class: 'b-switch__input', type: 'checkbox', id, role: 'switch', checked: !!checked, disabled: !!disabled });
  input.addEventListener('change', () => onChange?.(input.checked, input));
  const row = h('label', { class: 'adm-switchrow', for: id },
    h('span', { class: 'adm-switchrow__text' },
      h('span', { class: 'adm-switchrow__label' }, label),
      sub && h('span', { class: 'adm-switchrow__sub' }, sub)),
    end || null,
    h('span', { class: 'b-switch' }, input, h('span', { class: 'b-switch__track', 'aria-hidden': 'true' })));
  row.input = input;
  return row;
}

/** Segmented control: options [{value, label}] → .b-seg with aria-pressed buttons. */
export function seg(options, value, onChange, { block = false, label } = {}) {
  const wrap = h('div', { class: ['b-seg', block && 'b-seg--block'], role: 'group', 'aria-label': label || null });
  const btns = options.map((o) => h('button', {
    type: 'button', class: 'b-seg__opt', 'aria-pressed': String(o.value) === String(value),
    onClick: () => { set(o.value); onChange?.(o.value); },
  }, o.label));
  wrap.append(...btns);
  function set(v) { btns.forEach((b, i) => b.setAttribute('aria-pressed', String(String(options[i].value) === String(v)))); }
  wrap.set = set;
  return wrap;
}

/** Status pill: kind = 'req' | 'biz' | 'plan'. */
export function pill(kind, status) {
  const s = status || 'none';
  return h('span', { class: ['b-pill', `adm-pill--${s.replace(/_/g, '-')}`] }, t(`${kind}.${s}`));
}

export function badge(text, cls = 'b-badge--soft') { return h('span', { class: ['b-badge', cls] }, text); }

/** Empty state. */
export function empty({ icon = 'inbox', title, text, action } = {}) {
  return h('div', { class: 'b-empty adm-empty' },
    h('div', { class: 'b-empty__mark' }, ic(icon)),
    h('p', { class: 'b-empty__title' }, title || t('empty.title')),
    text && h('p', { class: 'b-empty__text' }, text),
    action || null);
}

/** Key / value list. rows: [[k, v, opts?]] (v may be a node). */
export function kv(rows, cls) {
  return h('div', { class: ['b-kv', cls] }, rows.filter(Boolean).map(([k, v, o = {}]) =>
    h('div', { class: ['b-kv__row', o.total && 'b-kv__row--total', o.cls] },
      h('span', { class: 'b-kv__k' }, k), h('span', { class: ['b-kv__v', o.mono && 'b-mono'], dir: o.dir || null }, v))));
}

/* ---------- actions ---------- */

export function errToast(e) {
  if (!e?.code) console.warn(e);
  toast(t(errorKey(e)), { kind: 'err', timeout: 5200 });
}

/** Run fn with the button in its loading state. Errors toast. */
export async function busy(btn, fn) {
  if (btn?.getAttribute('aria-busy') === 'true') return undefined;
  btn?.setAttribute('aria-busy', 'true');
  try { return await fn(); }
  catch (e) { errToast(e); return undefined; }
  finally { btn?.removeAttribute('aria-busy'); }
}

export async function copyText(text) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back below */ }
  if (!ok) {
    const ta = h('textarea', { style: 'position:fixed;opacity:0;inset-block-start:0', readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* nothing else to try */ }
    ta.remove();
  }
  toast(t('copied'), { kind: 'ok', timeout: 1800 });
}

/** A small "Copy" button for a value. */
export function copyBtn(get, label = t('copy'), cls = 'b-btn b-btn--ghost b-btn--sm') {
  return h('button', { type: 'button', class: cls, onClick: () => copyText(typeof get === 'function' ? get() : get) },
    ic('copy'), h('span', null, label));
}

/** A read-only value with a copy button (links, snippets, credentials). */
export function copyRow(label, value, { mono = true, multiline = false } = {}) {
  return h('div', { class: ['adm-copyrow', multiline && 'adm-copyrow--multi'] },
    h('span', { class: 'adm-copyrow__k' }, label),
    h(multiline ? 'pre' : 'span', { class: ['adm-copyrow__v', mono && 'b-mono'], dir: 'ltr' }, value),
    h('button', { type: 'button', class: 'b-iconbtn adm-copyrow__btn', 'aria-label': `${t('copy')} · ${label}`, onClick: () => copyText(value) }, ic('copy')));
}

/** Button-styled link. */
export function linkBtn(href, label, { icon, cls = 'b-btn b-btn--ghost', external = false } = {}) {
  return h('a', { class: cls, href, target: external ? '_blank' : null, rel: external ? 'noopener' : null },
    icon && ic(icon), h('span', null, label));
}

/** Debounce with flush(). */
export function debounce(fn, ms = 600) {
  let tm = null;
  let last = [];
  const d = (...a) => { last = a; clearTimeout(tm); tm = setTimeout(() => { tm = null; fn(...a); }, ms); };
  d.flush = () => { if (tm) { clearTimeout(tm); tm = null; return fn(...last); } return undefined; };
  d.cancel = () => { clearTimeout(tm); tm = null; };
  d.pending = () => tm != null;
  return d;
}

/** Fade/slide a freshly rendered block in (respects reduced motion). */
export function enter(el, delay = 0) {
  if (reduced || typeof el?.animate !== 'function') return el;
  el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 380, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
  return el;
}

/** Loading block for a view. */
export function loadingBlock(n = 3) {
  return h('div', { class: 'adm-loading' }, h('span', { class: 'b-skel b-skel--title', style: '--w:46%' }), skeletonRows(n));
}
function skeletonRows(n) {
  const list = h('div', { class: 'b-skel-list', 'aria-busy': 'true', role: 'status', 'aria-label': t('loading') });
  for (let i = 0; i < n; i++) list.appendChild(h('span', { class: 'b-skel b-skel--card' }));
  return list;
}

/** Error block with retry. */
export function failBlock(e, retry) {
  return h('div', { class: 'b-empty adm-empty', role: 'alert' },
    h('div', { class: 'b-empty__mark' }, ic('alert')),
    h('p', { class: 'b-empty__title' }, t('error.generic')),
    h('p', { class: 'b-empty__text' }, t(errorKey(e))),
    retry && h('button', { type: 'button', class: 'b-btn b-btn--ghost', onClick: retry }, ic('refresh'), h('span', null, t('retry'))));
}

/** Isolate a left-to-right value (path, phone, email, ref) inside a sentence of either direction. */
export const ltr = (s) => `⁦${s}⁩`;

/**
 * Toggle chips that update in place (keyboard focus stays put).
 * options [{value, label, cls?}] · returns the group with set(value) and counts(fn(value) → n | null).
 */
export function chipGroup(options, value, onChange, { label, cls } = {}) {
  const wrap = h('div', { class: ['b-chips', cls], role: 'group', 'aria-label': label || null });
  const btns = options.map((o) => {
    const cnt = h('span', { class: 'adm-chipcount', hidden: true });
    const b = h('button', {
      type: 'button', class: ['b-chip', o.cls], 'aria-pressed': String(String(o.value) === String(value)), dataset: { v: o.value },
      onClick: () => { wrap.set(o.value); onChange?.(o.value, b); },
    }, o.label, cnt);
    b.cnt = cnt;
    return b;
  });
  wrap.append(...btns);
  wrap.set = (v) => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  wrap.counts = (fn) => btns.forEach((b) => {
    const n = fn(b.dataset.v);
    b.cnt.hidden = n == null;
    if (n != null) b.cnt.textContent = num(n);
  });
  return wrap;
}

/** replaceChildren that skips false / null / undefined (the DOM method would print "false"). */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false && k !== true));
  return el;
}
