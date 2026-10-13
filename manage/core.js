/* ==========================================================
   Mamar Booking — owner dashboard core
   Shared state, data loading, formatting and small form
   builders for the views. Business and customer text always
   goes through h()/textContent, never innerHTML.
   ========================================================== */

import { rpc, errorKey } from '../platform/api.js';
import { t, tn, lang, register } from '../platform/i18n.js';
import { pick } from '../platform/contract.js';
import * as fmt from '../platform/fmt.js';
import { h, icon, toast, selectable, haptic, sheet as kitSheet, stepTransition } from '../platform/ui/kit.js';
import { STUDIO, SITE } from '../platform/config.js';
import common from '../platform/i18n/common.js';
import errors from '../platform/i18n/errors.js';
import dict from './i18n.js';

register(common);
register(errors);
register(dict);

export { t, tn, fmt, h, icon, toast, haptic, STUDIO, SITE };

/* ---------- state ---------- */

export const S = {
  me: null,          // own_me
  bid: null,         // current business id
  ov: null,          // own_overview of the current business
  win: null,         // {from, to, bookings, blocks}: today + the next two weeks (live watch window)
  known: null,       // Map booking id → status, for spotting live arrivals
  mine: new Set(),   // ids this device created or changed (no "new booking" toast for them)
  fresh: new Set(),  // ids that just arrived live (highlighted once)
};

/* ---------- tiny event bus ---------- */

const subs = new Map();
export function on(ev, fn) {
  if (!subs.has(ev)) subs.set(ev, new Set());
  subs.get(ev).add(fn);
  return () => subs.get(ev)?.delete(fn);
}
export function emit(ev, data) {
  for (const fn of [...(subs.get(ev) || [])]) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

/* ---------- server calls ---------- */

/** rpc with the current business_id; shows the error as a toast unless quiet. */
export async function call(name, args = {}, { quiet = false } = {}) {
  try {
    return await rpc(name, { business_id: S.bid, ...args });
  } catch (e) {
    if (!quiet) toast(t(errorKey(e)), { kind: 'err' });
    throw e;
  }
}
export const errText = (e) => t(errorKey(e));

/** Run fn at most once at a time; calls during a run queue exactly one more run. */
function coalesced(fn) {
  let running = null;
  let again = false;
  return () => {
    if (running) { again = true; return running; }
    running = (async () => {
      try { do { again = false; await fn(); } while (again); } finally { running = null; }
    })();
    return running;
  };
}

export const loadOverview = coalesced(async () => {
  const bid = S.bid;
  const ov = await rpc('own_overview', { business_id: bid });
  if (bid !== S.bid) return;
  S.ov = ov;
  emit('overview', ov);
});

export const WINDOW_DAYS = 14;
export const loadWindow = coalesced(async () => {
  const bid = S.bid;
  const from = todayISO();
  const to = fmt.addDaysISO(from, WINDOW_DAYS);
  const r = await rpc('own_bookings', { business_id: bid, from, to });
  if (bid !== S.bid) return;
  spot(r.bookings || []);
  S.win = { from, to, bookings: r.bookings || [], blocks: r.blocks || [] };
  emit('window', S.win);
});

/* Compare against what we saw last time: new live bookings and customer cancellations. */
function spot(list) {
  const first = !S.known;
  const prev = S.known || new Map();
  const next = new Map();
  for (const b of list) {
    next.set(b.id, b.status);
    if (first || S.mine.has(b.id)) continue;
    const was = prev.get(b.id);
    if (!was && (b.status === 'confirmed' || b.status === 'pending_payment')) {
      S.fresh.add(b.id);
      emit('arrival', b);
    } else if (was && was !== 'cancelled' && b.status === 'cancelled') {
      emit('cust-cancel', b);
    }
  }
  // Keep remembering ids that left the window (moved out of range) so they don't re-announce.
  for (const [id, st] of prev) if (!next.has(id)) next.set(id, st);
  S.known = next;
}

/** Remember a booking this device touched, then refresh. */
export function touched(id) {
  if (id) S.mine.add(id);
  loadWindow().catch(() => {});
  loadOverview().catch(() => {});
}

/* ---------- lookups ---------- */

export const L = () => lang();
export const biz = () => S.ov?.business || S.me?.businesses?.find((b) => b.id === S.bid) || null;
export const cfg = () => S.ov?.cfg || {};
export const ent = () => S.ov?.business?.entitlements || {};
export const nm = (row, f = 'name') => pick(row, f, L());
export const service = (id) => S.ov?.services?.find((s) => s.id === id) || null;
export const staffById = (id) => S.ov?.staff?.find((s) => s.id === id) || null;
export const resourceById = (id) => S.ov?.resources?.find((s) => s.id === id) || null;
export const activeStaff = () => (S.ov?.staff || []).filter((s) => s.active);
export const activeResources = () => (S.ov?.resources || []).filter((r) => r.active);
export const usesStaff = () => (S.ov?.services || []).some((s) => s.mode === 'staff');
export const bizName = () => nm(biz()) || '';

/* ---------- formatting ---------- */

export const fm = (halalas, opts) => fmt.money(halalas, L(), opts);
export const tm = (d) => fmt.time(d, L());
export const dg = (s) => fmt.digits(String(s), L());
export const num = (n) => fmt.num(n, L());
export const todayISO = () => fmt.riyadhDateISO(new Date());
export const dayOf = (iso) => fmt.riyadhDateISO(iso);
export const dayStart = (dayISO) => fmt.riyadhInstant(dayISO, '00:00');
/** Minutes from the start of dayISO (Riyadh) to an instant; may be negative or > 1440. */
export const minOf = (iso, dayISO) => Math.round((new Date(iso).getTime() - dayStart(dayISO).getTime()) / 60000);
/** The instant at `min` minutes after dayISO's midnight (min may exceed 1440). */
export const atMin = (dayISO, min) => new Date(dayStart(dayISO).getTime() + min * 60000);
export const hhmm = (min) => {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
export const tmMin = (min) => fmt.time(hhmm(min), L());
export const nowMin = (dayISO = todayISO()) => minOf(new Date().toISOString(), dayISO);
export const range = (a, b) => t('mg.range', { from: a, to: b });
export const dur = (min) => fmt.durationMin(min, L());

/** 'اليوم' / 'غداً' / weekday for the next 6 days, else '١٤ أكتوبر'. */
export function dayWord(dayISO) {
  const d = fmt.daysFromToday(dayISO);
  if (d >= -1 && d <= 6) return d === -1 ? t('yesterday') : fmt.dayLabel(dayISO, L());
  return fmt.dateShort(dayISO, L(), { weekday: true });
}
/** 'غداً · ٤:٣٠ م'. */
export const when = (iso) => t('mg.when', { day: dayWord(dayOf(iso)), time: tm(iso) });

/** 'الثلاثاء، ١٣ أكتوبر ٢٠٢٦ · ٢٢ ربيع الآخر ١٤٤٨' (Hijri when the business shows it). */
export function dateWithHijri(dayISO, { year = true } = {}) {
  const g = fmt.dateLong(dayISO, L(), { year });
  if (cfg().hijri === false) return g;
  const hj = fmt.hijri(dayISO, L());
  return hj ? `${g} · ${hj}` : g;
}

export const customer = (b) => (b?.name && b.name.trim()) || (b?.source === 'walkin' ? t('mg.walkin') : t('mg.guest'));
export const statusKey = (st) => ({
  confirmed: 'status.confirmed', completed: 'status.completed', no_show: 'status.no_show', cancelled: 'status.cancelled',
  pending_payment: 'mg.st.pending_payment', expired: 'mg.st.expired',
})[st] || 'status.confirmed';
export const pillClass = (st) => `b-pill b-pill--${({ pending_payment: 'pending', no_show: 'no-show', expired: 'cancelled' })[st] || st}`;
export const pill = (st) => h('span', { class: pillClass(st) }, t(statusKey(st)));
export const isLive = (b) => b.status === 'confirmed' || b.status === 'pending_payment';

/* ---------- SAR (halalas, never floats) ---------- */

/** '80' | '79.5' | '٧٩٫٥٠' | '1,200' → halalas. '' → null. Anything else → NaN. */
export function parseSar(input) {
  const s = fmt.toLatin(String(input ?? ''))
    .replace(/(SAR|ر\.?\s?س\.?|﷼)/gi, '')
    .replace(/[\s,،]/g, '');
  if (s === '') return null;
  const m = /^(\d{1,7})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}
/** halalas → '79.50' / '80' for an input's value. */
export const sarValue = (hal) => {
  const v = Math.max(0, Math.round(Number(hal) || 0));
  const r = Math.floor(v / 100);
  const c = v % 100;
  return c ? `${r}.${String(c).padStart(2, '0')}` : String(r);
};

/* ---------- extra icons (same stroke language as the kit) ---------- */

const XICONS = {
  copy: [['rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2.2 }], ['path', { d: 'M15.5 8.5V6.2a1.7 1.7 0 0 0-1.7-1.7H6.2a1.7 1.7 0 0 0-1.7 1.7v7.6a1.7 1.7 0 0 0 1.7 1.7h2.3' }]],
  share: [['path', { d: 'M12 14.5V4M8 7.8 12 4l4 3.8' }], ['path', { d: 'M8.5 10.5H7a2 2 0 0 0-2 2v5.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1.5' }]],
  external: [['path', { d: 'M13.5 5.5h5v5M18.5 5.5 11 13' }], ['path', { d: 'M17 13.5v3.8a1.7 1.7 0 0 1-1.7 1.7H6.7A1.7 1.7 0 0 1 5 17.3V8.7A1.7 1.7 0 0 1 6.7 7h3.8' }]],
};
export function xicon(name, cls) {
  const svg = h('svg', { viewBox: '0 0 24 24', class: ['b-icon', cls], 'aria-hidden': 'true', focusable: 'false' });
  for (const [tag, attrs] of XICONS[name]) svg.appendChild(h(tag, attrs));
  return svg;
}

/* ---------- links ---------- */

export const studioWa = (text) => fmt.whatsappUrl(`+${STUDIO.whatsapp}`, text);
export const bookingLink = (slug) => `${SITE}/b/${slug}`;

/* ---------- DOM builders (kit classes) ---------- */

let fid = 0;
export const uid = (p = 'mg') => `${p}-${++fid}`;

/**
 * A kit text field with a static label above the box.
 * @returns {HTMLElement & {input: HTMLInputElement, setError(msg?:string):void}}
 */
export function field({ label, value = '', type = 'text', hint, placeholder, inputmode, autocomplete, multiline,
  maxlength, dir, suffix, prefix, required, onInput, onChange, name, compact } = {}) {
  const id = uid('f');
  const msgId = `${id}-m`;
  const input = h(multiline ? 'textarea' : 'input', {
    id, name, class: 'b-field__input', type: multiline ? null : type, placeholder: placeholder || ' ',
    inputmode, autocomplete, maxlength, dir, required, rows: multiline ? 3 : null,
    'aria-describedby': msgId,
  });
  input.value = value ?? '';
  const msg = h('p', { class: 'b-field__msg', id: msgId, hidden: !hint }, hint || '');
  const box = h('div', { class: 'b-field__box' },
    prefix && h('span', { class: 'mg-affix mg-affix--pre' }, prefix),
    input,
    suffix && h('span', { class: 'mg-affix' }, suffix));
  const wrap = h('div', { class: ['b-field', 'b-field--static', compact && 'mg-field--compact'] },
    h('label', { class: 'b-field__label', for: id }, label), box, msg);
  wrap.input = input;
  wrap.setError = (err) => {
    wrap.classList.toggle('is-invalid', !!err);
    input.setAttribute('aria-invalid', err ? 'true' : 'false');
    msg.textContent = err || hint || '';
    msg.hidden = !(err || hint);
  };
  if (onInput) input.addEventListener('input', () => onInput(input.value, wrap));
  if (onChange) input.addEventListener('change', () => onChange(input.value, wrap));
  return wrap;
}

/** A SAR amount field. wrap.value() → halalas | null | NaN. */
export function sarField({ label, halalas, hint, onChange } = {}) {
  const f = field({ label, value: halalas == null ? '' : sarValue(halalas), inputmode: 'decimal', hint,
    suffix: t('sar'), autocomplete: 'off', dir: 'ltr' });
  f.value = () => parseSar(f.input.value);
  f.input.addEventListener('blur', () => {
    const v = parseSar(f.input.value);
    if (Number.isNaN(v)) f.setError(t('mg.pr.bad_price'));
    else { f.setError(''); if (v != null) f.input.value = sarValue(v); onChange?.(v); }
  });
  return f;
}

/** Native select in the kit field look. */
export function selectField({ label, options, value, onChange, hint }) {
  const id = uid('s');
  const sel = h('select', { id, class: 'b-field__input mg-select' },
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value ?? '') }, o.label)));
  sel.value = String(value ?? '');
  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  const wrap = h('div', { class: 'b-field b-field--static' },
    h('label', { class: 'b-field__label', for: id }, label),
    h('div', { class: 'b-field__box mg-selectbox' }, sel, icon('chevronDown', { class: 'mg-selectbox__chev' })),
    hint && h('p', { class: 'b-field__msg' }, hint));
  wrap.input = sel;
  return wrap;
}

/** Kit switch row: label (and optional hint) with the switch at the end. */
export function switchRow({ label, hint, checked, onChange, disabled }) {
  const input = h('input', { type: 'checkbox', class: 'b-switch__input', role: 'switch', checked: !!checked, disabled });
  if (onChange) input.addEventListener('change', () => { haptic(); onChange(input.checked, input); });
  const row = h('label', { class: 'mg-switchrow' },
    h('span', { class: 'mg-switchrow__text' },
      h('span', { class: 'mg-switchrow__label' }, label),
      hint && h('span', { class: 'mg-switchrow__hint' }, hint)),
    h('span', { class: 'b-switch' }, input, h('span', { class: 'b-switch__track', 'aria-hidden': 'true' })));
  row.input = input;
  return row;
}

/** Bare kit switch (for list rows). */
export function switchEl({ checked, label, onChange, disabled }) {
  const input = h('input', { type: 'checkbox', class: 'b-switch__input', role: 'switch', checked: !!checked, 'aria-label': label, disabled });
  if (onChange) input.addEventListener('change', () => { haptic(); onChange(input.checked, input); });
  const el = h('span', { class: 'b-switch' }, input, h('span', { class: 'b-switch__track', 'aria-hidden': 'true' }));
  el.input = input;
  return el;
}

/** Segmented control (radio group). */
export function seg(options, value, onChange, { label, block = true, small } = {}) {
  const el = h('div', { class: ['b-seg', block && 'b-seg--block', small && 'mg-seg--sm'], role: 'radiogroup', 'aria-label': label },
    options.map((o) => h('button', { type: 'button', class: 'b-seg__opt', 'data-value': o.value, 'aria-checked': String(o.value) === String(value) }, o.label)));
  const api = selectable(el, { onChange: (v) => onChange?.(v) });
  el.get = api.get;
  el.set = api.set;
  return el;
}

/** Chips (single or multi). */
export function chips(options, value, onChange, { multi = false, label, scroll = false } = {}) {
  const set = new Set([].concat(value ?? []).map(String));
  const el = h('div', { class: ['b-chips', scroll && 'b-chips--scroll'], 'aria-label': label, role: multi ? 'group' : null },
    options.map((o) => h('button', {
      type: 'button', class: 'b-chip', 'data-value': o.value,
      [multi ? 'aria-pressed' : 'aria-checked']: set.has(String(o.value)),
    }, o.label)));
  const api = selectable(el, { multi, onChange: (v) => onChange?.(v) });
  el.get = api.get;
  el.set = api.set;
  return el;
}

/** − value + stepper. */
export function stepper({ value, min = 0, max = 999, step = 1, format = (v) => dg(v), label, onChange }) {
  let v = value;
  const out = h('output', { class: 'b-stepper__val mg-stepper__val', 'aria-live': 'polite' });
  const minus = h('button', { type: 'button', class: 'b-stepper__btn', 'aria-label': `${label} −` }, icon('minus'));
  const plus = h('button', { type: 'button', class: 'b-stepper__btn', 'aria-label': `${label} +` }, icon('plus'));
  const sync = () => { out.textContent = format(v); minus.disabled = v <= min; plus.disabled = v >= max; };
  const set = (n) => { const nv = Math.max(min, Math.min(max, n)); if (nv === v) return; v = nv; haptic(); sync(); onChange?.(v); };
  minus.addEventListener('click', () => set(v - step));
  plus.addEventListener('click', () => set(v + step));
  sync();
  const el = h('div', { class: 'b-stepper', role: 'group', 'aria-label': label }, minus, out, plus);
  el.get = () => v;
  el.set = (n) => { v = n; sync(); };
  return el;
}

/** Labelled row with a control at the end (settings style). */
export const ctlRow = (label, control, hint) => h('div', { class: 'mg-ctlrow' },
  h('span', { class: 'mg-ctlrow__text' }, h('span', { class: 'mg-ctlrow__label' }, label), hint && h('span', { class: 'mg-ctlrow__hint' }, hint)),
  control);

/** A titled group of settings/form rows. */
export const group = (title, ...kids) => h('section', { class: 'mg-group' },
  title && h('h3', { class: 'mg-group__title' }, title),
  h('div', { class: 'mg-group__body' }, ...kids));

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'b-empty mg-empty' },
    h('div', { class: 'b-empty__mark' }, icon(iconName)),
    h('h3', { class: 'b-empty__title' }, title),
    text && h('p', { class: 'b-empty__text' }, text),
    action);
}

export const btn = (label, { kind = 'ghost', size = 'sm', icon: ic, onClick, block, danger, type = 'button', ...rest } = {}) =>
  h('button', {
    type, class: ['b-btn', `b-btn--${kind}`, size && `b-btn--${size}`, block && 'b-btn--block', danger && 'b-btn--danger'],
    onClick, ...rest,
  }, ic && (XICONS[ic] ? xicon(ic) : icon(ic)), h('span', null, label));

/** Run an async action with the button showing its loading state. */
export async function busy(button, fn) {
  if (button?.getAttribute('aria-busy') === 'true') return undefined;
  button?.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally { button?.removeAttribute('aria-busy'); }
}

/* ---------- sheets ---------- */

/**
 * Kit sheet with a content builder that can swap steps and retitle the sheet.
 * build(ctx) → Node; ctx = {close, setTitle, swap(node, dir), body}.
 */
export function openSheet({ title, build, className, wide }) {
  const p = kitSheet({
    title,
    className: ['mg-sheet', wide && 'mg-sheet--wide', className].filter(Boolean).join(' '),
    content: (close) => {
      const body = h('div', { class: 'mg-sheetbody' });
      const ctx = {
        close,
        body,
        setTitle(text) {
          const el = body.closest('.b-sheet')?.querySelector('.b-sheet__title');
          if (el) el.textContent = text;
        },
        swap(node, direction = 'forward') {
          return stepTransition(body, node, direction);
        },
      };
      const first = build(ctx);
      if (first) body.appendChild(first);
      return body;
    },
  });
  stripZero();
  const panels = document.querySelectorAll('.b-overlay > .b-sheet');
  panels[panels.length - 1]?.querySelector('.b-sheet__title')?.setAttribute('dir', 'auto');
  p.then(() => emit('sheet-closed'));
  return p;
}

/* kit.sheet() without actions passes a falsy footer (0 or null) to the native panel.append(),
   which renders it as the text "0" / "null"; remove that stray text node. */
export function stripZero() {
  const panels = document.querySelectorAll('.b-overlay > .b-sheet');
  const panel = panels[panels.length - 1];
  if (!panel) return;
  for (const n of [...panel.childNodes]) if (n.nodeType === 3 && (n.textContent === '0' || n.textContent === 'null')) n.remove();
}

/* ---------- misc ---------- */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0;inset-block-start:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* nothing else to try */ }
    ta.remove();
  }
  toast(t('copied'), { kind: 'ok', timeout: 1800 });
}

/** A phone number for display. Arabic-Indic digit groups are bidi "AN", so the spaces between them
 *  would resolve right-to-left even inside dir=ltr; LRM on both sides keeps 055 123 4567 in order. */
const LRM = String.fromCharCode(0x200e);
export const phoneText = (p) => fmt.formatPhone(p, L()).split(' ').join(LRM + ' ' + LRM);

export function telUrl(phone) {
  const n = fmt.normalizePhone(phone);
  return n ? `tel:${n}` : null;
}

/** Opening ranges [[open, close]] (minutes, close may exceed 1440) of a day for one section (special hours win). */
export function dayRanges(dayISO, sectionId = null) {
  const ov = S.ov;
  if (!ov) return [];
  const sec = sectionId || ov.sections?.[0]?.id || null;
  const sp = (ov.special_hours || [])
    .filter((x) => dayISO >= x.from_date && dayISO <= x.to_date && (!x.section_id || x.section_id === sec))
    .sort((a, b) => (a.section_id ? 0 : 1) - (b.section_id ? 0 : 1))[0];
  if (sp) return (sp.ranges || []).map((r) => [Number(r[0]), Number(r[1])]).filter((r) => r[1] > r[0]);
  const wd = fmt.riyadhParts(dayISO).weekday;
  return (ov.hours || []).filter((x) => x.weekday === wd && (!sec || x.section_id === sec))
    .map((x) => [x.open_min, x.close_min]).sort((a, b) => a[0] - b[0]);
}
/** Ranges for every section merged (for whole-business views). */
export function dayRangesAll(dayISO) {
  const secs = S.ov?.sections?.length ? S.ov.sections : [{ id: null }];
  return secs.flatMap((s) => dayRanges(dayISO, s.id)).sort((a, b) => a[0] - b[0]);
}

/** Debounce. */
export function debounce(fn, ms = 400) {
  let tm0 = null;
  const d = (...a) => { clearTimeout(tm0); tm0 = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(tm0); fn(...a); };
  return d;
}

/** Local preference helpers (localStorage, guarded). */
export const pref = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
