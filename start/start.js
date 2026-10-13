/* ==========================================================
   Mamar Booking · /start/ — the setup configurator
   One calm question per screen; a live estimate always in view.
   Public mode:   /start/
   Assisted mode: /start/?assist=1[&draft=<id>] (Ahmed fills it in)
   Every user-typed value reaches the DOM through text nodes only.
   ========================================================== */

import { boot, register, t, tn, lang, onLang } from '../platform/i18n.js';
import common from '../platform/i18n/common.js';
import errors from '../platform/i18n/errors.js';
import dict from './i18n.js';
import { rpc, errorKey, signIn, signOut, currentUser } from '../platform/api.js';
import { estimate, deltaFor } from '../platform/estimate.js';
import { money, plusMoney, included, digits, toLatin, normalizePhone, formatPhone, durationMin } from '../platform/fmt.js';
import { pick } from '../platform/contract.js';
import { STUDIO } from '../platform/config.js';
import { h, $, icon, mark, madeBy, toast, sheet, haptic, animateNumber, stepTransition, selectable, reduced } from '../platform/ui/kit.js';
import { hoursEditor, PRESETS, cloneHours, sanitizeHours, hoursSummary } from './hours.js';
import { phoneMock } from './preview.js';

register(common);
register(errors);
register(dict);

/* ───────────── constants ───────────── */

const DRAFT_KEY = 'mamar-start-draft';
const params = new URLSearchParams(location.search);
const ASSIST = params.get('assist') === '1';
const KINDS = ['salon', 'carwash', 'activity', 'other'];
const DURATIONS = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const SWATCHES = [['red', '#FF4A2B'], ['gold', '#C9A227'], ['green', '#0E6B5C'], ['blue', '#2F5FB3'],
  ['plum', '#7A3E9D'], ['rose', '#D9467A'], ['sand', '#B08968'], ['ink', '#2A2A2E']];
const MOCK_PRICES = { salon: [8000, 4000], carwash: [6000, 35000], activity: [9000, 15000], other: [20000, 35000] };
const MAX_STAFF = 30;
const MAX_CAP = 500;
const MAX_BRANCHES = 20;
const COUNT_MAX = 60;

const ORDER = ASSIST
  ? ['contact', 'business', 'services', 'hours', 'slots', 'staff', 'sections', 'home', 'prayer', 'hijri', 'look',
    'langs', 'customer', 'payment', 'extras', 'branches', 'plan', 'review', 'done']
  : ['welcome', 'business', 'services', 'hours', 'slots', 'staff', 'sections', 'home', 'prayer', 'hijri', 'look',
    'langs', 'customer', 'payment', 'extras', 'branches', 'plan', 'contact', 'review', 'done'];

/* ───────────── state ───────────── */

let uidN = 0;
const uid = () => `r${Date.now().toString(36)}${++uidN}`;
const newRow = () => ({ id: uid(), name: '', dur: 30, price: '' });

function freshAnswers() {
  return {
    business: { name_ar: '', name_en: '', kind: '', site_url: '', instagram: '' },
    services: [],
    services_later: false,
    service_count: 8,
    hours: cloneHours(PRESETS[0].hours),
    slots: { mode: 'staff', staff_count: 1, capacity: 2 },
    staff_choice: false,
    sections: false,
    home_service: false,
    prayer: false,
    hijri: true,
    look: 'standard',
    brand: { mode: 'light', accent: '#0E6B5C', logo_note: '', fonts_note: '' },
    langs: 'ar',
    customer: 'name_phone',
    payment: 'shop',
    extras: { self_manage: false, waitlist: false },
    branches: 1,
    plan: { code: 'none', interval: 'monthly' },
  };
}

const S = {
  sheet: null,
  step: ORDER[0],
  a: freshAnswers(),
  rows: [newRow()],
  contact: { name: '', phone: '', email: '' },
  site: '',
  slug: '',
  honey: '',
  ui: { slotsTouched: false, memo: {} },
  started: ASSIST,
  returnToReview: false,
  draft: null,
  draftId: ASSIST ? params.get('draft') : null,
  ref: null,
  result: null,
  busy: null,
  authed: !ASSIST,
};

const L = () => lang();
/**
 * Bidi controls for phoneShow(): a phone number that reads correctly inside right-to-left text. Arabic-Indic digit groups separated by
 * spaces get reordered by the bidi algorithm even in an LTR span (numbers act as R for the spaces), so the
 * spaces are pinned with LRMs and the whole number is isolated.
 */
const LRI = '\u2066';
const PDI = '\u2069';
const LRM = '\u200E';
const phoneShow = (p, l = L()) => `${LRI}${formatPhone(p, l).split(' ').join(`${LRM} ${LRM}`)}${PDI}`;
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(toLatin(String(v ?? '')), 10) || lo));

/** Merge saved answers over fresh defaults (drafts may predate a field). */
function hydrate(src = {}) {
  const f = freshAnswers();
  return {
    ...f, ...src,
    business: { ...f.business, ...(src.business || {}) },
    slots: { ...f.slots, ...(src.slots || {}) },
    brand: { ...f.brand, ...(src.brand || {}) },
    extras: { ...f.extras, ...(src.extras || {}) },
    plan: { ...f.plan, ...(src.plan || {}) },
    hours: src.hours && typeof src.hours === 'object' ? sanitizeHours(src.hours) : f.hours,
  };
}
const rowsFrom = (list) => {
  const rows = (Array.isArray(list) ? list : []).map((s) => ({
    id: uid(), name: String(s.name || s.name_ar || s.name_en || ''),
    dur: DURATIONS.includes(+s.duration_min) ? +s.duration_min : 30,
    price: s.price_sar ? String(s.price_sar) : '',
  }));
  return rows.length ? rows : [newRow()];
};

function parseSite(raw) {
  const s = String(raw || '').trim();
  if (!s) return { site_url: '', instagram: '' };
  const ig = /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(s);
  if (ig) return { site_url: '', instagram: ig[1] };
  if (/^@[A-Za-z0-9._]{1,30}$/.test(s)) return { site_url: '', instagram: s.slice(1) };
  if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(s.replace(/^https?:\/\//i, ''))) {
    return { site_url: /^https?:\/\//i.test(s) ? s : `https://${s}`, instagram: '' };
  }
  if (/^[A-Za-z0-9._]{2,30}$/.test(s)) return { site_url: '', instagram: s };
  return { site_url: s.slice(0, 300), instagram: '' };
}

function serviceOut(r) {
  const name = r.name.trim().slice(0, 80);
  const ar = /[\u0600-\u06FF]/.test(name);
  const price = parseFloat(toLatin(r.price).replace(/[^\d.]/g, '')) || 0;
  return { name, name_ar: ar ? name : '', name_en: ar ? '' : name, duration_min: r.dur, price_sar: Math.round(price * 100) / 100, max_qty: 1 };
}

/** The answers exactly as the server receives them (SETUP_ANSWERS). The estimate is computed from this too. */
function answersOut() {
  const a = JSON.parse(JSON.stringify(S.a));
  const named = S.rows.filter((r) => r.name.trim());
  a.services = a.services_later ? [] : named.map(serviceOut);
  a.service_count = a.services_later ? clampInt(a.service_count, 1, COUNT_MAX) : a.services.length;
  a.hours = sanitizeHours(a.hours);
  a.slots.staff_count = clampInt(a.slots.staff_count, 1, MAX_STAFF);
  a.slots.capacity = clampInt(a.slots.capacity, 1, MAX_CAP);
  if (a.slots.mode !== 'staff') a.staff_choice = false;
  if (a.business.kind === 'carwash') a.sections = false;
  a.branches = clampInt(a.branches, 1, MAX_BRANCHES);
  a.business.name_ar = a.business.name_ar.trim().slice(0, 80);
  a.business.name_en = a.business.name_en.trim().slice(0, 80);
  Object.assign(a.business, parseSite(S.site));
  if (a.plan.code === 'none') a.plan.interval = 'monthly';
  return a;
}

const contactOut = () => ({
  name: S.contact.name.trim().slice(0, 80),
  phone: normalizePhone(S.contact.phone) || S.contact.phone.trim(),
  ...(S.contact.email.trim() ? { email: S.contact.email.trim() } : {}),
});

const bizName = () => {
  const b = S.a.business;
  return (L() === 'en' ? (b.name_en || b.name_ar) : (b.name_ar || b.name_en)).trim();
};
const kind = () => S.a.business.kind || 'other';

/* ───────────── steps ───────────── */

function visible() {
  return ORDER.filter((id) => {
    if (id === 'staff') return S.a.slots.mode === 'staff';
    if (id === 'sections') return S.a.business.kind !== 'carwash';
    return true;
  });
}
const questions = () => visible().filter((id) => id !== 'welcome' && id !== 'done');

const STEPS = {
  welcome: { render: renderWelcome },
  contact: { render: renderContact, validate: validateContact },
  business: { render: renderBusiness, validate: validateBusiness },
  services: { render: renderServices, validate: validateServices },
  hours: { render: renderHours, validate: validateHours },
  slots: { render: renderSlots },
  staff: { render: () => yesNo('staff_choice', { q: 'st.staff.q', hint: 'st.staff.hint', no: 'st.staff.no', noMeta: 'st.staff.no_meta', yes: 'st.staff.yes', yesMeta: 'st.staff.yes_meta' }) },
  sections: { render: () => yesNo('sections', { q: 'st.sec.q', hint: 'st.sec.hint', no: 'st.sec.no', yes: 'st.sec.yes', yesMeta: 'st.sec.yes_meta' }) },
  home: { render: () => yesNo('home_service', { q: `st.home.q.${kind() === 'salon' || kind() === 'carwash' ? kind() : 'other'}`, hint: 'st.home.hint', no: 'st.home.no', yes: 'st.home.yes', yesMeta: 'st.home.yes_meta' }) },
  prayer: { render: () => yesNo('prayer', { q: 'st.prayer.q', hint: 'st.prayer.hint', no: 'st.prayer.no', yes: 'st.prayer.yes', yesMeta: 'st.prayer.yes_meta' }) },
  hijri: { render: () => yesNo('hijri', { q: 'st.hijri.q', hint: 'st.hijri.hint', no: 'st.hijri.no', yes: 'st.hijri.yes', yesFirst: true }) },
  look: { render: renderLook },
  langs: { render: renderLangs },
  customer: { render: renderCustomer },
  payment: { render: renderPayment },
  extras: { render: renderExtras },
  branches: { render: renderBranches },
  plan: { render: renderPlan },
  review: { render: renderReview },
  done: { render: renderDone },
};

/* ───────────── small builders ───────────── */

function svg(parts, cls) {
  const s = h('svg', { viewBox: '0 0 24 24', class: ['b-icon', cls], 'aria-hidden': 'true', focusable: 'false' });
  for (const [tag, a] of parts) s.appendChild(h(tag, a));
  return s;
}
const ICON = {
  salon: () => svg([['circle', { cx: 6.5, cy: 17.5, r: 2.6 }], ['circle', { cx: 17.5, cy: 17.5, r: 2.6 }], ['path', { d: 'M8.4 15.6 18.6 4.4M15.6 15.6 5.4 4.4' }]]),
  carwash: () => icon('car'),
  activity: () => svg([['path', { d: 'M6 21V3.8' }], ['path', { d: 'M6 4.5h12l-2.8 4 2.8 4H6' }]]),
  other: () => icon('sparkle'),
  chat: () => svg([['path', { d: 'M4.5 19.5l1.3-3.9A7.9 7.9 0 1 1 8.6 18.4z' }], ['path', { d: 'M9 11.5h.01M12 11.5h.01M15 11.5h.01' }]]),
  mail: () => svg([['rect', { x: 3.5, y: 5.5, width: 17, height: 13, rx: 2.5 }], ['path', { d: 'm4.5 7.5 7.5 5.5 7.5-5.5' }]]),
  card: () => svg([['rect', { x: 3.5, y: 5.5, width: 17, height: 13, rx: 2.5 }], ['path', { d: 'M3.5 10h17M7 14.5h3' }]]),
  edit: () => svg([['path', { d: 'M5 19h3.5L18.3 9.2a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0L5 15.5z' }]]),
  trash: () => svg([['path', { d: 'M5.5 7.5h13M10 7.5V5.5h4v2M7.5 7.5l.8 11a1.5 1.5 0 0 0 1.5 1.5h4.4a1.5 1.5 0 0 0 1.5-1.5l.8-11' }]]),
};

function shell(qKey, hintKey, ...body) {
  const list = questions();
  const i = list.indexOf(S.step);
  const q = typeof qKey === 'string' ? t(qKey) : qKey;
  return h('section', { class: 'b-step st-step', 'data-step': S.step, 'aria-labelledby': `q-${S.step}` },
    h('header', { class: 'b-step__head' },
      i >= 0 && h('span', { class: 'b-eyebrow' }, t('step_of', { n: i + 1, total: list.length })),
      h('h1', { class: 'b-step__q', id: `q-${S.step}` }, q),
      hintKey && h('p', { class: 'b-step__hint' }, t(hintKey))),
    ...body);
}

const group = (labelText, el, extra, before) => {
  const id = `g-${uid()}`;
  if (el && el.setAttribute) el.setAttribute('aria-labelledby', id);
  return h('div', { class: ['st-group', extra] }, h('p', { class: 'st-label', id }, labelText), before, el);
};

let fid = 0;
function field({ label, value = '', type = 'text', autocomplete, inputmode, hint, textarea, staticLabel, placeholder,
  maxlength = 80, name, affix, onInput, onBlur, cls }) {
  const id = `f${++fid}`;
  const msgId = `${id}-m`;
  const input = h(textarea ? 'textarea' : 'input', {
    id, name, class: 'b-field__input', type: textarea ? null : type, placeholder: placeholder || ' ',
    autocomplete, inputmode, maxlength, 'aria-describedby': msgId, rows: textarea ? 3 : null,
  });
  input.value = value;
  const lab = h('label', { class: 'b-field__label', for: id }, label);
  const msg = h('p', { class: 'b-field__msg', id: msgId }, hint || '');
  msg.hidden = !hint;
  const wrap = h('div', { class: ['b-field', staticLabel && 'b-field--static', cls] },
    staticLabel && lab,
    h('div', { class: 'b-field__box' }, input, !staticLabel && lab, affix && h('span', { class: 'b-field__affix st-affix', 'aria-hidden': 'true' }, affix)),
    msg);
  let curHint = hint || '';
  function setError(m) {
    wrap.classList.toggle('is-invalid', !!m);
    if (m) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    msg.textContent = m || curHint;
    msg.hidden = !(m || curHint);
  }
  input.addEventListener('input', () => { if (wrap.classList.contains('is-invalid')) setError(null); onInput?.(input.value); });
  if (onBlur) input.addEventListener('blur', () => onBlur(input.value));
  return { el: wrap, input, setError, setHint(v) { curHint = v || ''; if (!wrap.classList.contains('is-invalid')) setError(null); } };
}

/** An inline error line for a group of cards. */
function groupError() {
  const el = h('p', { class: 'st-err', role: 'alert', hidden: true });
  return { el, set(m) { el.textContent = m || ''; el.hidden = !m; } };
}

const quoteItem = (key) => (S.sheet?.items || []).find((i) => i.key === key);
const isQuote = (key) => { const it = quoteItem(key); return !!it && it.amount_halalas == null; };

/** What an option adds on top of the baseline choice, from the live price sheet. */
function addOn(base, patch) {
  const a = answersOut();
  const from = { ...a, ...base, extras: { ...a.extras, ...(base.extras || {}) } };
  return deltaFor(S.sheet, from, patch);
}

function priceNode(amount) {
  if (amount == null) return null;
  if (amount === 'quote') {
    return [h('span', { class: 'b-choice__price st-quote' }, t('st.quote')), h('span', { class: 'st-quote__talk' }, t('st.quote_talk'))];
  }
  return amount > 0
    ? h('span', { class: 'b-choice__price' }, plusMoney(amount, L()))
    : h('span', { class: 'b-choice__price st-incl' }, included(L()));
}

function choice({ value, title, meta, price, badge, media, compact, cls }) {
  const end = priceNode(price);
  return h('button', { type: 'button', class: ['b-choice', compact && 'b-choice--compact', cls], 'data-value': value },
    badge && h('span', { class: 'b-choice__badge b-badge' }, badge),
    media
      ? h('span', { class: 'b-choice__media st-media' }, media)
      : h('span', { class: 'b-choice__lead' }, h('span', { class: 'b-choice__tick' })),
    h('span', { class: 'b-choice__main' },
      h('span', { class: 'b-choice__title' }, title),
      meta && h('span', { class: 'b-choice__meta' }, meta)),
    end && h('span', { class: 'b-choice__end' }, end));
}

function radioCards(options, current, onPick, { label, cls } = {}) {
  const box = h('div', { class: ['b-choices', cls], 'aria-label': label || null }, options.map(choice));
  const sel = selectable(box, { onChange: (v) => onPick(v) });
  if (current != null) sel.set(String(current));
  return box;
}

function seg(options, current, onPick, { label, block = true } = {}) {
  const box = h('div', { class: ['b-seg', block && 'b-seg--block'], role: 'radiogroup', 'aria-label': label || null },
    options.map(([v, text]) => h('button', { type: 'button', class: 'b-seg__opt', 'data-value': v }, text)));
  const sel = selectable(box, { onChange: (v) => onPick(v) });
  sel.set(String(current));
  return box;
}

/** A big − value + stepper; the value is also typeable. */
function bigStepper({ value, min, max, label, onChange }) {
  let v = value;
  const input = h('input', { class: 'st-stepper__val', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': label, maxlength: 3 });
  const minus = h('button', { type: 'button', class: 'st-stepper__btn', 'aria-label': t('st.dec') }, icon('minus'));
  const plus = h('button', { type: 'button', class: 'st-stepper__btn', 'aria-label': t('st.inc') }, icon('plus'));
  const paint = () => { input.value = digits(String(v), L()); minus.disabled = v <= min; plus.disabled = v >= max; };
  const set = (n, { repaint = true } = {}) => {
    const next = Math.min(max, Math.max(min, n));
    const changedV = next !== v;
    v = next;
    if (repaint) paint(); else { minus.disabled = v <= min; plus.disabled = v >= max; }
    if (changedV) onChange(v);
  };
  const hold = (btn, d) => {
    let timer = null;
    let rep = null;
    let held = false;                     // a long press already stepped; swallow the click that follows
    const stop = () => { clearTimeout(timer); clearInterval(rep); timer = rep = null; };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      held = false;
      timer = setTimeout(() => { held = true; rep = setInterval(() => { set(v + d); if (v <= min || v >= max) stop(); }, 70); }, 420);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) btn.addEventListener(ev, stop);
    btn.addEventListener('click', () => { if (held) { held = false; return; } haptic(); set(v + d); });
  };
  hold(minus, -1);
  hold(plus, 1);
  input.addEventListener('input', () => {
    const n = parseInt(toLatin(input.value).replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) set(n, { repaint: false });
  });
  input.addEventListener('blur', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); set(v + 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); set(v - 1); }
  });
  paint();
  return h('div', { class: 'st-stepper', role: 'group', 'aria-label': label }, minus, input, plus);
}

/** Reveal / hide a panel with a calm height + fade. */
function reveal(el, show) {
  if (show === !el.hidden) return;
  if (reduced || typeof el.animate !== 'function') { el.hidden = !show; return; }
  if (show) {
    el.hidden = false;
    const hgt = el.scrollHeight;
    el.animate([{ opacity: 0, height: '0px', overflow: 'hidden' }, { opacity: 1, height: `${hgt}px`, overflow: 'hidden' }],
      { duration: 320, easing: 'cubic-bezier(.2,.7,0,1)' });
  } else {
    const hgt = el.offsetHeight;
    const a = el.animate([{ opacity: 1, height: `${hgt}px`, overflow: 'hidden' }, { opacity: 0, height: '0px', overflow: 'hidden' }],
      { duration: 220, easing: 'cubic-bezier(.4,0,1,1)' });
    a.onfinish = () => { el.hidden = true; };
  }
}

/* ───────────── step: welcome ───────────── */

function ago(ts) {
  const s = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(L() === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

function renderWelcome() {
  const d = S.draft;
  const draftName = d ? ((L() === 'en' ? (d.a?.business?.name_en || d.a?.business?.name_ar) : (d.a?.business?.name_ar || d.a?.business?.name_en)) || '').trim() : '';
  return h('section', { class: 'b-step st-step st-welcome', 'data-step': 'welcome', 'aria-labelledby': 'q-welcome' },
    h('div', { class: 'st-hero' },
      h('span', { class: 'b-eyebrow' }, t('st.w.eyebrow')),
      h('h1', { class: 'b-display st-hero__title', id: 'q-welcome', 'data-step-focus': '' },
        t('st.w.title'), ' ', h('em', null, t('st.w.title_em'))),
      h('p', { class: 'b-lede' }, t('st.w.lede'))),
    h('ul', { class: 'st-facts' },
      h('li', null, icon('clock'), h('span', null, t('st.w.f1'))),
      h('li', null, icon('sparkle'), h('span', null, t('st.w.f2'))),
      h('li', null, icon('check'), h('span', null, t('st.w.f3')))),
    h('p', { class: 'st-hero__for' }, t('st.w.for')),
    d && h('div', { class: 'st-resume' },
      h('span', { class: 'st-resume__dot', 'aria-hidden': 'true' }),
      h('div', null,
        h('p', { class: 'st-resume__title' }, t('st.w.draft_title')),
        h('p', { class: 'st-resume__meta' }, t('st.w.draft_meta', { name: draftName || t('st.w.draft_unnamed'), when: ago(d.saved_at) })))));
}

async function start() {
  if (!(await withSheet('start'))) return;
  S.started = true;
  go('business');
}
async function resume() {
  if (!(await withSheet('resume'))) return;
  const d = S.draft;
  S.a = hydrate(d.a);
  S.rows = rowsFrom(d.rows?.length ? d.rows.map((r) => ({ name: r.name, duration_min: r.dur, price_sar: r.price })) : []);
  S.contact = { name: '', phone: '', email: '', ...(d.contact || {}) };
  S.site = d.site || '';
  S.ui = { slotsTouched: !!d.ui?.slotsTouched, memo: d.ui?.memo || {} };
  S.started = true;
  S.draft = null;
  const target = visible().includes(d.step) && d.step !== 'done' ? d.step : 'business';
  renderSummary();
  go(target);
}
async function restart() {
  if (!(await withSheet('restart'))) return;
  clearDraft();
  S.a = freshAnswers();
  S.rows = [newRow()];
  S.contact = { name: '', phone: '', email: '' };
  S.site = '';
  S.ui = { slotsTouched: false, memo: {} };
  S.draft = null;
  S.started = true;
  renderSummary();
  go('business');
}

/* ───────────── step: contact ───────────── */

let contactFields = null;
function renderContact() {
  const c = S.contact;
  const name = field({ label: ASSIST ? t('name') : t('st.contact.name'), value: c.name, autocomplete: ASSIST ? 'off' : 'name', onInput: (v) => { c.name = v; changed(); } });
  const phone = field({
    label: t('phone'), value: c.phone, type: 'tel', inputmode: 'tel', autocomplete: ASSIST ? 'off' : 'tel', maxlength: 20,
    hint: ASSIST ? null : t('st.contact.wa_hint'),
    onInput: (v) => { c.phone = v; changed(); },
    onBlur: (v) => {
      if (!v.trim()) return;
      const n = normalizePhone(v);
      if (n) { phone.input.value = formatPhone(n, 'en'); c.phone = phone.input.value; persist(); } else phone.setError(t('field.phone_invalid'));
    },
  });
  const email = field({ label: t('st.contact.email'), value: c.email, type: 'email', inputmode: 'email', autocomplete: ASSIST ? 'off' : 'email', maxlength: 120,
    onInput: (v) => { c.email = v; changed(); },
    onBlur: (v) => { if (v.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) email.setError(t('field.email_invalid')); } });
  const site = field({ label: t('st.contact.site'), value: S.site, autocomplete: ASSIST ? 'off' : 'url', inputmode: 'url', maxlength: 200, onInput: (v) => { S.site = v; changed(); } });
  site.input.setAttribute('dir', 'ltr');
  contactFields = { name, phone, email };

  const hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', value: S.honey });
  hp.addEventListener('input', () => { S.honey = hp.value; });
  const honeypot = !ASSIST && h('div', { class: 'st-hp', 'aria-hidden': 'true' }, h('label', null, 'Website', hp));

  return shell(ASSIST ? 'st.contact.q_assist' : 'st.contact.q', ASSIST ? 'st.contact.hint_assist' : 'st.contact.hint',
    h('div', { class: 'st-form' }, name.el, phone.el, email.el, site.el, honeypot));
}

function validateContact() {
  const f = contactFields;
  let first = null;
  if (S.contact.name.trim().length < 2) { f?.name.setError(t('st.err.contact_name')); first ??= f?.name.input; }
  if (!normalizePhone(S.contact.phone)) { f?.phone.setError(t('field.phone_invalid')); first ??= f?.phone.input; }
  const em = S.contact.email.trim();
  if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { f?.email.setError(t('field.email_invalid')); first ??= f?.email.input; }
  if (first) { first.focus(); haptic([12, 60, 12]); return false; }
  return true;
}

/* ───────────── step: business ───────────── */

let bizFields = null;
function renderBusiness() {
  const b = S.a.business;
  const en = L() === 'en';
  const primaryKey = en ? 'name_en' : 'name_ar';
  const secondaryKey = en ? 'name_ar' : 'name_en';
  const onName = (k) => (v) => { b[k] = v; changed(); };
  const primary = field({ label: t('st.biz.name_primary'), value: b[primaryKey], autocomplete: 'organization', onInput: onName(primaryKey) });
  const secondary = field({ label: t('st.biz.name_secondary'), value: b[secondaryKey], autocomplete: 'off', onInput: onName(secondaryKey) });
  primary.input.setAttribute('lang', en ? 'en' : 'ar');
  secondary.input.setAttribute('lang', en ? 'ar' : 'en');
  secondary.input.setAttribute('dir', en ? 'rtl' : 'ltr');
  const err = groupError();
  const cards = radioCards(KINDS.map((k) => ({ value: k, title: t(`st.kind.${k}`), meta: t(`st.kind.${k}_meta`), media: ICON[k]() })),
    b.kind || null,
    (v) => {
      b.kind = v;
      err.set(null);
      if (!S.ui.slotsTouched) {
        S.a.slots.mode = v === 'carwash' || v === 'activity' ? 'capacity' : 'staff';
        S.a.slots.capacity = v === 'activity' ? 8 : 2;
      }
      changed();
    }, { cls: 'st-kinds' });
  bizFields = { primary, secondary, err, cards };
  return shell('st.biz.q', 'st.biz.hint',
    h('div', { class: 'st-form' }, primary.el, secondary.el),
    group(t('st.biz.kind'), cards, null, err.el));
}

function validateBusiness() {
  const b = S.a.business;
  const f = bizFields;
  if ((b.name_ar.trim() || b.name_en.trim()).length < 2) {
    f.primary.setError(t('st.err.name'));
    f.primary.input.focus();
    return false;
  }
  if (!KINDS.includes(b.kind)) {
    f.err.set(t('st.err.kind'));
    f.cards.querySelector('[tabindex="0"]')?.focus();
    return false;
  }
  return true;
}

/* ───────────── step: services ───────────── */

let svcCtx = null;
function renderServices() {
  const a = S.a;
  const err = groupError();
  const listBox = h('div', { class: 'st-svcs' });
  const tierNote = h('div', { class: 'st-tiernote', 'aria-live': 'polite' });
  const now = h('div', { class: 'st-svc-now' });
  const later = h('div', { class: 'st-svc-later' });

  const named = () => S.rows.filter((r) => r.name.trim()).length;
  const paintTier = () => {
    const n = named();
    const key = n > 40 ? 'services_40_plus' : n >= 16 ? 'services_16_40' : null;
    tierNote.replaceChildren();
    if (key) {
      tierNote.append(icon('info'), h('span', null, `${tn('st.services', n)} · ${plusMoney(quoteItem(key)?.amount_halalas || 0, L())}`),
        h('span', { class: 'st-mut' }, t('st.svc.tier_note')));
    }
  };

  function rowEl(r, i) {
    const name = field({ label: t('st.svc.name'), value: r.name, placeholder: t(`st.svc.ex.${kind()}`),
      onInput: (v) => { r.name = v; err.set(null); paintTier(); changed(); } });
    const durSel = h('select', { class: 'b-field__input st-select__input', id: `d-${r.id}` },
      DURATIONS.map((m) => h('option', { value: String(m) }, durationMin(m, L()))));
    durSel.value = String(r.dur);
    durSel.addEventListener('change', () => { r.dur = +durSel.value; changed(); });
    const dur = h('div', { class: 'b-field st-select' },
      h('div', { class: 'b-field__box' }, durSel, h('label', { class: 'b-field__label', for: `d-${r.id}` }, t('st.svc.dur')),
        h('span', { class: 'st-select__chev', 'aria-hidden': 'true' }, icon('chevronDown'))));
    const price = field({ label: t('st.svc.price'), value: r.price ? digits(r.price, 'en') : '', inputmode: 'decimal', maxlength: 8, affix: t('sar'),
      onInput: (v) => { r.price = toLatin(v).replace(/[^\d.]/g, ''); changed(); } });
    price.input.setAttribute('dir', 'ltr');
    const remove = h('button', { type: 'button', class: 'b-iconbtn st-svc__remove', 'aria-label': t('st.svc.remove', { n: i + 1 }), hidden: S.rows.length < 2 },
      ICON.trash());
    remove.addEventListener('click', () => removeRow(r.id));
    return h('fieldset', { class: 'st-svc', 'data-id': r.id },
      h('legend', { class: 'st-svc__legend' }, t('st.svc.row', { n: i + 1 })),
      remove,
      name.el,
      h('div', { class: 'st-svc__grid' }, dur, price.el));
  }

  function paintRows() {
    listBox.replaceChildren(...S.rows.map(rowEl));
    paintTier();
  }

  function addRow() {
    const r = newRow();
    const last = S.rows[S.rows.length - 1];
    if (last) r.dur = last.dur;
    S.rows.push(r);
    paintRows();
    const el = listBox.lastElementChild;
    if (!reduced && el?.animate) el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
    el?.querySelector('input')?.focus();
    el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    haptic();
    changed();
  }

  function removeRow(id) {
    const i = S.rows.findIndex((r) => r.id === id);
    if (i < 0 || S.rows.length < 2) return;
    const el = listBox.querySelector(`[data-id="${id}"]`);
    const finish = () => {
      S.rows.splice(i, 1);
      paintRows();
      const target = listBox.children[Math.min(i, S.rows.length - 1)];
      target?.querySelector('input')?.focus();
      changed();
    };
    haptic();
    if (reduced || !el?.animate) finish();
    else el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }], { duration: 160, easing: 'ease-in' }).onfinish = finish;
  }

  const addBtn = h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--block st-add' }, icon('plus'), h('span', null, t('st.svc.add')));
  addBtn.addEventListener('click', addRow);
  now.append(err.el, listBox, addBtn, tierNote);

  /* later: an approximate count */
  const countOut = h('output', { class: 'st-count__val', 'aria-live': 'polite' });
  const range = h('input', { type: 'range', class: 'st-range-input', min: 1, max: COUNT_MAX, step: 1, 'aria-label': t('st.svc.count_q') });
  range.value = String(clampInt(a.service_count, 1, COUNT_MAX));
  const tiers = h('div', { class: 'st-tiers', role: 'list', 'aria-label': t('st.tiers') });
  const tierDefs = [['st.tier.1', null, (n) => n <= 15], ['st.tier.2', 'services_16_40', (n) => n >= 16 && n <= 40], ['st.tier.3', 'services_40_plus', (n) => n > 40]];
  const paintCount = () => {
    const n = +range.value;
    countOut.textContent = n >= COUNT_MAX ? t('st.svc.count_plus') : tn('st.services', n);
    range.style.setProperty('--pct', `${((n - 1) / (COUNT_MAX - 1)) * 100}%`);
    range.setAttribute('aria-valuetext', countOut.textContent);
    tiers.replaceChildren(...tierDefs.map(([k, key, on]) => h('div', { class: ['st-tier', on(n) && 'is-on'], role: 'listitem' },
      h('span', { class: 'st-tier__k' }, t(k)),
      h('span', { class: 'st-tier__v' }, key ? plusMoney(quoteItem(key)?.amount_halalas || 0, L()) : included(L())))));
  };
  range.addEventListener('input', () => { a.service_count = +range.value; paintCount(); changed(); });
  later.append(
    h('div', { class: 'st-count' },
      h('p', { class: 'st-label' }, t('st.svc.count_q')),
      countOut,
      range,
      tiers),
    h('p', { class: 'st-note' }, ICON.chat(), h('span', null, t('st.svc.later_note'))));

  const modeSeg = seg([['now', t('st.svc.now')], ['later', t('st.svc.later')]], a.services_later ? 'later' : 'now', (v) => {
    a.services_later = v === 'later';
    err.set(null);
    reveal(now, !a.services_later);
    reveal(later, a.services_later);
    changed();
  }, { label: t('st.svc.mode') });

  now.hidden = a.services_later;
  later.hidden = !a.services_later;
  paintRows();
  paintCount();
  svcCtx = { err, listBox };
  return shell('st.svc.q', 'st.svc.hint', modeSeg, now, later);
}

function validateServices() {
  if (S.a.services_later) return true;
  if (S.rows.some((r) => r.name.trim())) {
    S.rows = S.rows.filter((r) => r.name.trim());
    return true;
  }
  svcCtx?.err.set(t('st.err.services'));
  svcCtx?.listBox.querySelector('input')?.focus();
  return false;
}

/* ───────────── step: hours ───────────── */

let hoursErr = null;
function renderHours() {
  hoursErr = groupError();
  const ed = hoursEditor({
    hours: S.a.hours,
    memo: S.ui.memo,
    onChange: (hrs) => { S.a.hours = hrs; hoursErr.set(null); changed(); },
  });
  ed.insertBefore(hoursErr.el, ed.querySelector('.st-week'));
  return shell('st.hours.q', 'st.hours.hint', ed);
}
function validateHours() {
  if (Object.keys(sanitizeHours(S.a.hours)).length) return true;
  hoursErr?.set(t('st.err.hours'));
  document.querySelector('.st-day .b-switch__input')?.focus();
  return false;
}

/* ───────────── step: who or what limits a slot ───────────── */

function renderSlots() {
  const sl = S.a.slots;
  const k = kind();
  const staff = sl.mode === 'staff';
  const qKey = staff
    ? (k === 'salon' ? 'st.slots.q.staff.salon' : 'st.slots.q.staff.other')
    : (k === 'carwash' ? 'st.slots.q.cap.carwash' : k === 'activity' ? 'st.slots.q.cap.activity' : 'st.slots.q.cap.other');
  const stepper = bigStepper({
    value: staff ? sl.staff_count : sl.capacity, min: 1, max: staff ? MAX_STAFF : MAX_CAP, label: t(qKey),
    onChange: (v) => { if (staff) sl.staff_count = v; else sl.capacity = v; S.ui.slotsTouched = true; changed(); },
  });
  const flip = h('button', { type: 'button', class: 'st-link st-flip' }, t(staff ? 'st.slots.to_cap' : 'st.slots.to_staff'));
  flip.addEventListener('click', () => {
    sl.mode = staff ? 'capacity' : 'staff';
    S.ui.slotsTouched = true;
    haptic();
    changed();
    renderStage('swap');
  });
  return shell(qKey, staff ? 'st.slots.hint.staff' : 'st.slots.hint.cap',
    h('div', { class: 'st-big' },
      stepper,
      h('p', { class: 'st-big__unit' }, t(!staff && k === 'activity' ? 'st.slots.per_session' : 'st.slots.at_once'))),
    flip);
}

/* ───────────── yes / no steps ───────────── */

function yesNo(key, { q, hint, no, noMeta, yes, yesMeta, yesFirst }) {
  const opts = [
    { value: 'no', title: t(no), meta: noMeta ? t(noMeta) : null, price: null },
    { value: 'yes', title: t(yes), meta: yesMeta ? t(yesMeta) : null, price: addOn({ [key]: false }, { [key]: true }) },
  ];
  if (yesFirst) opts.reverse();
  const cards = radioCards(opts, S.a[key] ? 'yes' : 'no', (v) => { S.a[key] = v === 'yes'; changed(); }, { label: t(q) });
  return shell(q, hint, cards);
}

/* ───────────── step: look ───────────── */

function mockItems() {
  const named = S.rows.filter((r) => r.name.trim()).slice(0, 2).map((r) => ({ title: r.name.trim(), price: Math.round((parseFloat(r.price) || 0) * 100) }));
  if (named.length >= 2 || (named.length && S.a.services_later === false)) {
    const k = kind();
    while (named.length < 2) named.push({ title: t(`st.mock.${k}2`), price: MOCK_PRICES[k][1] });
    return named;
  }
  const k = kind();
  return [{ title: t(`st.mock.${k}1`), price: MOCK_PRICES[k][0] }, { title: t(`st.mock.${k}2`), price: MOCK_PRICES[k][1] }];
}

function renderLook() {
  const a = S.a;
  const br = a.brand;
  const items = mockItems();
  const stdMock = phoneMock({ look: 'standard', name: bizName(), items });
  const cusMock = phoneMock({ look: 'custom', brand: br, name: bizName(), items });
  const customAdd = addOn({ look: 'standard' }, { look: 'custom' });

  const card = (value, mock, title, meta, price) => h('button', { type: 'button', class: 'b-choice st-look', 'data-value': value },
    h('span', { class: 'st-look__media' }, mock.el),
    h('span', { class: 'st-look__text' },
      h('span', { class: 'b-choice__title' }, title),
      h('span', { class: 'b-choice__meta' }, meta)),
    h('span', { class: 'st-look__foot' }, h('span', { class: 'b-choice__tick' }), priceNode(price)));

  const cards = h('div', { class: 'st-looks', 'aria-label': t('st.look.q') },
    card('standard', stdMock, t('st.look.std'), t('st.look.std_meta'), 0),
    card('custom', cusMock, t('st.look.custom'), t('st.look.custom_meta'), customAdd));

  const note = h('p', { class: 'st-note st-note--accent' }, icon('info'), h('span', null, t('st.look.custom_note', { amount: money(customAdd, L()) })));

  /* custom brand options */
  const paintMock = () => cusMock.update({ brand: { ...br } });
  const swBox = h('div', { class: 'st-swatches' },
    SWATCHES.map(([n, hex]) => h('button', { type: 'button', class: 'st-swatch', 'data-value': hex, 'aria-label': t(`st.color.${n}`), title: t(`st.color.${n}`), style: { '--c': hex } })));
  const picker = h('input', { type: 'color', class: 'st-swatch__input', 'aria-label': t('st.look.pick') });
  picker.value = br.accent.toLowerCase();
  const pickWrap = h('label', { class: 'st-swatch st-swatch--pick', title: t('st.look.pick') }, picker, h('span', { class: 'st-swatch__plus', 'aria-hidden': 'true' }, icon('plus')));
  swBox.appendChild(pickWrap);
  const swSel = selectable(swBox, { selector: '.st-swatch[data-value]', onChange: (v) => { br.accent = v; picker.value = v.toLowerCase(); paintPick(); paintMock(); changed(); } });
  const paintPick = () => {
    const known = SWATCHES.some(([, hex]) => hex === br.accent);
    swSel.set(known ? br.accent : []);
    pickWrap.classList.toggle('is-on', !known);
    pickWrap.style.setProperty('--c', known ? 'transparent' : br.accent);
  };
  picker.addEventListener('input', () => { br.accent = picker.value.toUpperCase(); paintPick(); paintMock(); changed(); });
  paintPick();

  const modeSeg = seg([['light', t('st.look.light')], ['dark', t('st.look.dark')]], br.mode === 'dark' ? 'dark' : 'light',
    (v) => { br.mode = v; paintMock(); changed(); }, { label: t('st.look.mode') });
  const logo = field({ label: t('st.look.logo'), value: br.logo_note, textarea: true, staticLabel: true, placeholder: t('st.look.logo_ph'), maxlength: 500,
    onInput: (v) => { br.logo_note = v; changed(); } });
  const fonts = field({ label: t('st.look.fonts'), value: br.fonts_note, staticLabel: true, placeholder: t('st.look.fonts_ph'), maxlength: 120,
    onInput: (v) => { br.fonts_note = v; changed(); } });

  const custom = h('div', { class: 'st-custom' },
    group(t('st.look.accent'), swBox),
    group(t('st.look.mode'), modeSeg),
    logo.el,
    fonts.el);
  custom.hidden = a.look !== 'custom';

  const sel = selectable(cards, { selector: '.st-look', onChange: (v) => { a.look = v; reveal(custom, v === 'custom'); changed(); } });
  sel.set(a.look);
  return shell('st.look.q', 'st.look.hint', cards, note, custom);
}

/* ───────────── step: languages, customer, payment ───────────── */

function renderLangs() {
  const base = { langs: 'ar' };
  const opts = [
    { value: 'ar', title: t('st.langs.ar'), price: addOn(base, { langs: 'ar' }) },
    { value: 'en', title: t('st.langs.en'), price: addOn(base, { langs: 'en' }) },
    { value: 'both', title: t('st.langs.both'), meta: t('st.langs.both_meta'), price: addOn(base, { langs: 'both' }) },
  ];
  return shell('st.langs.q', 'st.langs.hint', radioCards(opts, S.a.langs, (v) => { S.a.langs = v; changed(); }, { label: t('st.langs.q') }));
}

function renderCustomer() {
  const base = { customer: 'name_phone' };
  const p = (v, key) => (isQuote(key) ? 'quote' : addOn(base, { customer: v }));
  const opts = [
    { value: 'name_phone', title: t('st.cust.np'), meta: t('st.cust.np_meta'), badge: t('st.recommended'), price: 0 },
    { value: 'name_phone_email', title: t('st.cust.npe'), meta: t('st.cust.npe_meta'), price: p('name_phone_email', 'customer_email') },
    { value: 'sms', title: t('st.cust.sms'), meta: t('st.cust.sms_meta'), price: p('sms', 'customer_sms') },
    { value: 'accounts', title: t('st.cust.acc'), meta: t('st.cust.acc_meta'), price: p('accounts', 'customer_accounts') },
  ];
  return shell('st.cust.q', 'st.cust.hint', radioCards(opts, S.a.customer, (v) => { S.a.customer = v; changed(); }, { label: t('st.cust.q'), cls: 'st-badged' }));
}

function renderPayment() {
  const base = { payment: 'shop' };
  const opts = [
    { value: 'shop', title: t('st.pay.shop'), meta: t('st.pay.shop_meta'), badge: t('st.pay.recommended'), price: 0 },
    { value: 'deposit', title: t('st.pay.deposit'), meta: t('st.pay.deposit_meta'), price: addOn(base, { payment: 'deposit' }) },
    { value: 'full', title: t('st.pay.full'), meta: t('st.pay.full_meta'), price: addOn(base, { payment: 'full' }) },
  ];
  const note = h('p', { class: ['st-note', S.a.payment !== 'shop' && 'st-note--accent'] }, ICON.card(), h('span', null, t('st.pay.moyasar')));
  const cards = radioCards(opts, S.a.payment, (v) => {
    S.a.payment = v;
    note.classList.toggle('st-note--accent', v !== 'shop');
    changed();
  }, { label: t('st.pay.q'), cls: 'st-badged' });
  return shell('st.pay.q', 'st.pay.hint', cards, note);
}

/* ───────────── step: extras, branches ───────────── */

function renderExtras() {
  const ex = S.a.extras;
  const opts = [
    { value: 'self_manage', title: t('st.ext.self'), meta: t('st.ext.self_meta'), price: addOn({ extras: { self_manage: false } }, { extras: { self_manage: true } }) },
    { value: 'waitlist', title: t('st.ext.wait'), meta: t('st.ext.wait_meta'), price: addOn({ extras: { waitlist: false } }, { extras: { waitlist: true } }) },
  ];
  const box = h('div', { class: 'b-choices', role: 'group', 'aria-label': t('st.ext.q') }, opts.map(choice));
  const sel = selectable(box, { multi: true, onChange: (v) => { ex.self_manage = v.includes('self_manage'); ex.waitlist = v.includes('waitlist'); changed(); } });
  sel.set(Object.keys(ex).filter((k) => ex[k]));
  return shell('st.ext.q', 'st.ext.hint', box);
}

function renderBranches() {
  const unit = quoteItem('branch_extra')?.amount_halalas || 0;
  const label = h('p', { class: 'st-big__unit' });
  const extraVal = h('strong', { class: 'st-kv__v' });
  const extraRow = h('div', { class: 'st-kv__row' }, h('span', { class: 'st-kv__k' }), extraVal);
  const paint = (n) => {
    label.textContent = tn('st.branches', n);
    extraRow.hidden = n < 2;
    extraRow.firstChild.textContent = t('st.br.extra', { n: n - 1 });
    animateNumber(extraVal, null, unit * Math.max(0, n - 1), { format: (v) => plusMoney(v, L()), step: 100 });
  };
  const stepper = bigStepper({ value: clampInt(S.a.branches, 1, MAX_BRANCHES), min: 1, max: MAX_BRANCHES, label: t('st.br.q'),
    onChange: (v) => { S.a.branches = v; paint(v); changed(); } });
  paint(clampInt(S.a.branches, 1, MAX_BRANCHES));
  return shell('st.br.q', 'st.br.hint',
    h('div', { class: 'st-big' }, stepper, label),
    h('div', { class: 'st-kv' },
      h('div', { class: 'st-kv__row' }, h('span', { class: 'st-kv__k' }, t('st.br.first')), h('span', { class: 'st-kv__v st-incl' }, included(L()))),
      h('div', { class: 'st-kv__row' }, h('span', { class: 'st-kv__k' }, t('st.br.unit')), h('span', { class: 'st-kv__v' }, plusMoney(unit, L()))),
      extraRow));
}

/* ───────────── step: care plan ───────────── */

function planName(p) { return pick(p, 'name', L()); }

function renderPlan() {
  const plan = S.a.plan;
  const plans = S.sheet?.plans || [];
  const host = h('div');
  const maxSave = Math.max(0, ...plans.map((p) => p.yearly_saving_halalas ?? (p.monthly_halalas * 12 - p.yearly_halalas)));

  const paintCards = () => {
    const yearly = plan.interval === 'yearly';
    const opts = [{ value: 'none', title: t('st.plan.none'), meta: t('st.plan.none_meta') }].concat(plans.map((p) => {
      const save = p.yearly_saving_halalas ?? (p.monthly_halalas * 12 - p.yearly_halalas);
      return { value: p.code, title: planName(p), meta: pick(p, 'desc', L()), yearly, p, save };
    }));
    const box = h('div', { class: 'b-choices st-plans st-badged', 'aria-label': t('st.plan.q') }, opts.map((o) => {
      const end = o.p ? h('span', { class: 'b-choice__end' },
        o.yearly && o.save > 0 && h('span', { class: 'b-choice__was' }, money(o.p.monthly_halalas * 12, L())),
        h('span', { class: 'b-choice__price' }, money(o.yearly ? o.p.yearly_halalas : o.p.monthly_halalas, L())),
        h('span', { class: 'st-per' }, t(o.yearly ? 'st.per.yr' : 'st.per.mo'))) : null;
      return h('button', { type: 'button', class: 'b-choice', 'data-value': o.value },
        o.yearly && o.save > 0 && h('span', { class: 'b-choice__badge b-badge' }, t('save_amount', { amount: money(o.save, L()) })),
        h('span', { class: 'b-choice__lead' }, h('span', { class: 'b-choice__tick' })),
        h('span', { class: 'b-choice__main' },
          h('span', { class: 'b-choice__title' }, o.title),
          o.meta && h('span', { class: 'b-choice__meta' }, o.meta)),
        end);
    }));
    const sel = selectable(box, { onChange: (v) => { plan.code = v; changed(); } });
    sel.set(plan.code);
    const had = host.contains(document.activeElement);
    host.replaceChildren(box);
    if (had) box.querySelector('[tabindex="0"]')?.focus();
  };

  const billing = seg([['monthly', t('st.plan.monthly')], ['yearly', t('st.plan.yearly')]], plan.interval, (v) => {
    plan.interval = v;
    paintCards();
    changed();
  }, { label: t('st.plan.billing') });
  paintCards();
  return shell('st.plan.q', 'st.plan.hint',
    h('div', { class: 'st-billing' }, billing, maxSave > 0 && h('p', { class: 'st-billing__save' }, t('st.plan.save_up', { amount: money(maxSave, L()) }))),
    host);
}

/* ───────────── step: review ───────────── */

let slugField = null;
function renderReview() {
  const a = answersOut();
  const est = estimate(S.sheet, a);
  const l = L();

  const lines = h('ul', { class: 'st-lines st-lines--review' }, est.lines.map((line) => {
    const label = line.qty > 1 ? t('st.qty', { label: pick(line, 'label', l), n: line.qty }) : pick(line, 'label', l);
    const v = line.quote ? t('st.quote') : line.amount_halalas ? money(line.amount_halalas, l) : included(l);
    return h('li', { class: ['st-line', line.quote && 'is-quote', !line.quote && !line.amount_halalas && 'is-free'] },
      h('span', { class: 'st-line__k' }, label), h('span', { class: 'st-line__v' }, v));
  }));
  const planLine = est.plan.code !== 'none'
    ? h('div', { class: 'st-rev__plan' },
      h('span', null, `${t('st.rev.plan')} · ${pick(est.plan, 'name', l)}`),
      h('span', { class: 'st-rev__planv' },
        t(est.plan.interval === 'yearly' ? 'st.price.yr' : 'st.price.mo', { amount: money(est.plan.amount_halalas, l) }),
        est.plan.saving_halalas > 0 && h('small', null, t('save_amount', { amount: money(est.plan.saving_halalas, l) }))))
    : null;

  const estCard = h('div', { class: 'st-rev__card' },
    h('p', { class: 'st-label' }, t('st.rev.estimate')),
    lines,
    h('div', { class: 'st-rev__total' },
      h('span', null, t('st.rev.setup_total')),
      h('strong', { class: 'b-num' }, money(est.setup_halalas, l))),
    planLine,
    h('p', { class: 'st-rev__note' }, icon('info'), h('span', null, t('st.sum.note'))),
    est.has_quote && h('p', { class: 'st-rev__note' }, icon('alert'), h('span', null, t('st.rev.quote_note'))));

  const b = a.business;
  const svcText = a.services_later
    ? t('st.rev.later', { count: a.service_count >= COUNT_MAX ? t('st.svc.count_plus') : tn('st.services', a.service_count) })
    : `${tn('st.services', a.services.length)} · ${a.services.slice(0, 3).map((s) => s.name).join(t('st.sep'))}${a.services.length > 3 ? '…' : ''}`;
  const slotsText = a.slots.mode === 'staff'
    ? t('st.rev.at_once', { n: a.slots.staff_count })
    : `${digits(String(a.slots.capacity), l)} ${t(b.kind === 'activity' ? 'st.slots.per_session' : 'st.slots.at_once')}`;
  const rows = [
    ['business', 'business', [b.name_ar, b.name_en].filter(Boolean).join(' · ') + (b.kind ? ` — ${t(`st.kind.${b.kind}`)}` : '')],
    ['services', 'services', svcText],
    ['hours', 'hours', hoursSummary(a.hours, tn)],
    ['slots', 'slots', slotsText],
    ['look', 'look', a.look === 'custom' ? `${t('st.look.custom')} · ${t(a.brand.mode === 'dark' ? 'st.look.dark' : 'st.look.light')}` : t('st.look.std'), a.look === 'custom' ? a.brand.accent : null],
    ['langs', 'langs', t(`st.langs.${a.langs}`)],
    ['customer', 'customer', t({ name_phone: 'st.cust.np', name_phone_email: 'st.cust.npe', sms: 'st.cust.sms', accounts: 'st.cust.acc' }[a.customer])],
    ['payment', 'payment', t(`st.pay.${a.payment}`)],
    ['contact', 'contact', [S.contact.name.trim(), normalizePhone(S.contact.phone) ? phoneShow(S.contact.phone, l) : ''].filter(Boolean).join(' · ')],
  ];
  const answers = h('div', { class: 'st-ans' }, rows.map(([k, step, value, swatch]) => {
    const what = t(`st.rev.k.${k}`);
    return h('div', { class: 'st-ans__row' },
      h('div', { class: 'st-ans__main' },
        h('span', { class: 'st-ans__k' }, what),
        h('span', { class: 'st-ans__v' }, swatch && h('i', { class: 'st-ans__sw', style: { '--c': swatch }, 'aria-hidden': 'true' }), value || '—')),
      h('button', { type: 'button', class: 'st-link st-ans__edit', 'aria-label': t('st.rev.edit', { what }), onClick: () => { S.returnToReview = true; go(step, 'back'); } },
        t('edit')));
  }));

  let slug = null;
  if (ASSIST) {
    slugField = field({ label: t('st.as.slug'), value: S.slug, staticLabel: true, placeholder: slugify(b.name_en) || 'ward-barber', maxlength: 40, hint: t('st.as.slug_hint'),
      affix: 'mamar.site/b/', onInput: (v) => { S.slug = v.toLowerCase().replace(/[^a-z0-9-]/g, ''); } });
    slugField.input.setAttribute('dir', 'ltr');
    slug = slugField.el;
  }

  return shell('st.rev.q', 'st.rev.hint',
    estCard,
    group(t('st.rev.answers'), answers),
    slug);
}

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);

/* ───────────── step: done ───────────── */

function renderDone() {
  const r = S.result || {};
  const phone = normalizePhone(S.contact.phone);
  const later = S.a.services_later;
  return h('section', { class: 'b-step st-step st-done', 'data-step': 'done', 'aria-labelledby': 'q-done' },
    h('div', { class: 'st-done__mark', 'aria-hidden': 'true' },
      h('svg', { viewBox: '0 0 52 52' }, h('circle', { cx: 26, cy: 26, r: 24 }), h('path', { d: 'M15 27l7.5 7.5L37.5 19' }))),
    h('header', { class: 'b-step__head' },
      h('h1', { class: 'b-step__q', id: 'q-done' }, t('st.done.q')),
      h('p', { class: 'b-step__hint' }, t('st.done.lede'))),
    h('div', { class: 'st-ref' },
      h('span', { class: 'st-ref__k' }, t('st.done.ref')),
      h('strong', { class: 'st-ref__v', dir: 'ltr' }, r.ref || '—'),
      r.estimate && h('span', { class: 'st-ref__est' }, `${t('st.rev.setup_total')} · ${money(r.estimate.setup_halalas, L())}`)),
    h('div', { class: 'st-group' },
      h('p', { class: 'st-label' }, t('st.done.next')),
      h('ol', { class: 'st-next' },
        ['st.done.s1', 'st.done.s2', 'st.done.s3'].map((k, i) => h('li', null,
          h('span', { class: 'st-next__n', 'aria-hidden': 'true' }, digits(String(i + 1), L())),
          h('span', null, t(k)))))),
    h('p', { class: 'st-note st-note--accent' }, ICON.chat(),
      h('span', null, phone ? t('st.done.wa_at', { phone: phoneShow(phone) }) : t('st.done.wa'))),
    later && h('p', { class: 'st-note' }, icon('info'), h('span', null, t('st.done.list'))),
    h('a', { class: 'b-btn b-btn--ghost st-done__home', href: '/' }, h('span', null, t('st.done.home'))));
}

/* ───────────── navigation ───────────── */

function navActions() {
  switch (S.step) {
    case 'welcome':
      return S.draft
        ? [{ id: 'restart', label: t('st.w.restart'), kind: 'ghost', run: restart }, { id: 'resume', label: t('st.w.resume'), kind: 'primary', run: resume }]
        : [{ id: 'start', label: t('st.start'), kind: 'primary', run: start, arrow: true }];
    case 'review':
      return ASSIST
        ? [{ id: 'save', label: t('st.as.save_req'), kind: 'ghost', run: () => submitAssisted(false) },
          { id: 'create', label: t('st.as.create'), kind: 'primary', run: () => submitAssisted(true) }]
        : [{ id: 'submit', label: t('st.rev.submit'), kind: 'primary', run: submit }];
    case 'done':
      return [];
    default:
      return [{ id: 'next', label: S.returnToReview ? t('st.back_to_review') : t('continue'), kind: 'primary', run: next, arrow: true }];
  }
}

function actionButtons(list) {
  return list.map((a) => h('button', {
    type: 'button',
    class: ['b-btn', a.kind === 'primary' ? 'b-btn--primary' : 'b-btn--ghost', 'st-act'],
    'data-act': a.id,
    'aria-busy': S.busy === a.id ? 'true' : null,
    onClick: () => { if (!S.busy && !moving) a.run(); },
  }, h('span', null, a.label), a.arrow && icon('forward')));
}

function renderNav() {
  const list = navActions();
  const bar = $('#barActions');
  bar.replaceChildren(...actionButtons(list));
  $('#bar').classList.toggle('st-bar--two', list.length > 1);
  const canBack = visible().indexOf(S.step) > 0 && S.step !== 'done';
  const foot = $('#foot');
  foot.hidden = !list.length;
  foot.replaceChildren(...[
    h('div', { class: 'st-foot__acts' }, ...actionButtons(list).reverse()),
    list.length === 1 && S.step !== 'review' && h('span', { class: 'st-foot__hint', 'aria-hidden': 'true' }, t('st.enter_hint'), ' ', h('kbd', null, '↵')),
    canBack && h('button', { type: 'button', class: 'b-btn b-btn--quiet st-foot__back', onClick: back }, icon('back'), h('span', null, t('back'))),
  ].filter(Boolean));
}

function setBusy(id) {
  S.busy = id;
  for (const b of document.querySelectorAll('.st-act')) {
    if (id && b.dataset.act === id) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
    b.disabled = !!id && b.dataset.act !== id;
  }
}

async function withSheet(id) {
  if (S.sheet) return true;
  setBusy(id);
  try { await needSheet(); return true; } catch { return false; } finally { setBusy(null); }
}

let moving = false;
function go(id, dir = 'forward') {
  S.step = id;
  renderStage(dir);
  persist();
  if (ASSIST && S.dirty) saveSoon();
}

function next() {
  const st = STEPS[S.step];
  if (st.validate && !st.validate()) return;
  haptic();
  if (S.returnToReview) { S.returnToReview = false; go('review'); return; }
  const list = visible();
  const i = list.indexOf(S.step);
  if (i < list.length - 1) go(list[i + 1]);
}

function back() {
  if (moving) return;
  const list = visible();
  const i = list.indexOf(S.step);
  if (i > 0) { S.returnToReview = false; go(list[i - 1], 'back'); }
}

/** mode: 'forward' | 'back' slide; 'swap' cross-fades in place; 'none' replaces silently (language change). */
async function renderStage(mode = 'none') {
  const stage = $('#stage');
  const el = STEPS[S.step].render();
  document.body.dataset.step = S.step;
  renderChrome();
  renderNav();
  if (mode === 'none') {
    stage.replaceChildren(el);
    return;
  }
  if (mode !== 'swap' && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
  moving = true;
  try {
    await stepTransition(stage, el, mode === 'back' ? 'back' : 'forward');
  } finally { moving = false; }
}

/* ───────────── chrome: top bar, progress, banner ───────────── */

function renderChrome() {
  const list = questions();
  const i = list.indexOf(S.step);
  const p = S.step === 'done' ? 1 : i < 0 ? 0 : i / list.length;
  const prog = $('#progress');
  prog.style.setProperty('--p', String(p));
  prog.setAttribute('aria-valuenow', String(Math.max(0, i + 1)));
  prog.setAttribute('aria-valuemax', String(list.length));
  prog.setAttribute('aria-label', t('st.progress'));
  prog.setAttribute('aria-valuetext', i >= 0 ? t('step_of', { n: i + 1, total: list.length }) : '');
  const canBack = S.authed && visible().indexOf(S.step) > 0 && S.step !== 'done';
  const backBtn = $('#back');
  backBtn.hidden = !canBack;
  backBtn.setAttribute('aria-label', t('back'));
  $('#contactMe').hidden = ASSIST;
  $('#contactMeLabel').textContent = t('st.contact_me');
  $('#brandLink').setAttribute('aria-label', t('st.home_link'));
  document.body.classList.toggle('st-done-mode', S.step === 'done');
  document.body.classList.toggle('st-login-mode', !S.authed);
}

function updateMeta() {
  document.title = t('st.meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('st.meta.desc'));
}

/* ───────────── live summary ───────────── */

const lineEls = new Map();
let liveTimer = null;

function summaryLine(line, l) {
  const label = line.qty > 1 ? t('st.qty', { label: pick(line, 'label', l), n: line.qty }) : pick(line, 'label', l);
  const v = line.quote ? t('st.quote') : line.amount_halalas ? money(line.amount_halalas, l) : included(l);
  return { label, v };
}

function planSub(est) {
  if (est.plan.code === 'none') return est.has_quote ? t('st.sum.quote') : t('st.sum.setup');
  return t(est.plan.interval === 'yearly' ? 'st.sum.plan_yr' : 'st.sum.plan_mo', { plan: pick(est.plan, 'name', L()), amount: money(est.plan.amount_halalas, L()) });
}

function renderSummary() {
  const l = L();
  const ready = !!S.sheet;
  const est = estimate(S.sheet, answersOut());
  S.est = est;
  const fmt = (v) => money(v, l);
  for (const el of [$('#barTotal'), $('#panelTotal')]) {
    if (!ready) { el.textContent = '—'; continue; }
    animateNumber(el, null, est.setup_halalas, { format: fmt, step: 100 });
  }
  $('#barLabel').textContent = t('st.sum.label');
  $('#barSub').textContent = ready ? planSub(est) : t('loading');
  $('#barSum').setAttribute('aria-label', `${t('st.sum.open')} — ${t('st.sum.label')}`);
  $('#panelEyebrow').textContent = t('st.sum.label');
  $('#panelName').textContent = bizName() || t('st.sum.label');
  $('#panelName').hidden = !bizName();
  $('#panelTotalLabel').textContent = t('st.sum.total');
  $('#panelSetup').textContent = t('st.sum.setup');
  $('#panelNote').textContent = t('st.sum.note');
  const planEl = $('#panelPlan');
  planEl.hidden = est.plan.code === 'none';
  if (est.plan.code !== 'none') {
    planEl.replaceChildren(
      h('span', null, pick(est.plan, 'name', l)),
      h('span', { class: 'b-num' }, t(est.plan.interval === 'yearly' ? 'st.price.yr' : 'st.price.mo', { amount: money(est.plan.amount_halalas, l) })));
  }

  const list = $('#panelLines');
  const keep = new Set();
  for (const line of est.lines) {
    keep.add(line.key);
    const { label, v } = summaryLine(line, l);
    let li = lineEls.get(line.key);
    const fresh = !li;
    if (fresh) {
      li = h('li', { class: 'st-line' }, h('span', { class: 'st-line__k' }), h('span', { class: 'st-line__v' }));
      lineEls.set(line.key, li);
    }
    li.firstChild.textContent = label;
    li.lastChild.textContent = v;
    li.classList.toggle('is-free', !line.quote && !line.amount_halalas);
    li.classList.toggle('is-quote', !!line.quote);
    list.appendChild(li);
    if (fresh && S.summaryPainted && !reduced && li.animate) {
      li.animate([{ opacity: 0, transform: 'translateY(-6px)', background: 'var(--b-accent-soft)' }, { opacity: 1, transform: 'none', background: 'transparent' }],
        { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }
  for (const [k, li] of lineEls) if (!keep.has(k)) { lineEls.delete(k); li.remove(); }
  if (ready) S.summaryPainted = true;

  clearTimeout(liveTimer);
  if (ready) liveTimer = setTimeout(() => { $('#live').textContent = t('st.sum.live', { total: money(est.setup_halalas, L()) }); }, 900);
}

function breakdown() {
  const est = S.est || estimate(S.sheet, answersOut());
  const l = L();
  const rows = est.lines.map((line) => {
    const { label, v } = summaryLine(line, l);
    return h('li', { class: ['st-line', line.quote && 'is-quote', !line.quote && !line.amount_halalas && 'is-free'] }, h('span', { class: 'st-line__k' }, label), h('span', { class: 'st-line__v' }, v));
  });
  return h('div', { class: 'st-breakdown' },
    h('ul', { class: 'st-lines' }, rows),
    h('div', { class: 'st-rev__total' }, h('span', null, t('st.sum.total')), h('strong', { class: 'b-num' }, money(est.setup_halalas, l))),
    est.plan.code !== 'none' && h('div', { class: 'st-rev__plan' }, h('span', null, pick(est.plan, 'name', l)),
      h('span', null, t(est.plan.interval === 'yearly' ? 'st.price.yr' : 'st.price.mo', { amount: money(est.plan.amount_halalas, l) }))),
    h('p', { class: 'st-rev__note' }, icon('info'), h('span', null, t('st.sum.note'))));
}

function openBreakdown() {
  if (!S.sheet) return;
  sheet({ title: t('st.sum.label'), content: breakdown(), className: 'st-sheet', actions: [{ label: t('close'), kind: 'ghost', value: null }] });
}

/* ───────────── "just contact me" ───────────── */

function waMessage() {
  const a = answersOut();
  const l = L();
  const lines = [t('st.wa.hello')];
  const name = [a.business.name_ar, a.business.name_en].filter(Boolean).join(' / ');
  if (name) lines.push(t('st.wa.business', { name }));
  if (a.business.kind) lines.push(t('st.wa.kind', { kind: t(`st.kind.${a.business.kind}`) }));
  const reached = (id) => visible().indexOf(S.step) > visible().indexOf(id);
  if (S.started && S.sheet && reached('services')) {
    const n = a.services_later ? a.service_count : a.services.length;
    if (n) lines.push(t('st.wa.services', { count: tn('st.services', n) }));
  }
  if (S.started && S.sheet && reached('business')) {
    const est = estimate(S.sheet, a);
    const opts = est.lines.filter((x) => x.key !== 'base_standard').map((x) => summaryLine(x, l).label);
    if (opts.length) lines.push(t('st.wa.options', { list: opts.join(t('st.sep')) }));
    if (est.plan.code !== 'none') lines.push(t('st.wa.plan', { plan: planSub(est).replace(/^\+\s*/, '') }));
    lines.push(t('st.wa.total', { total: money(est.setup_halalas, l) }));
  }
  if (S.result?.ref) lines.push(t('st.wa.ref', { ref: S.result.ref }));
  return lines.join('\n');
}

function openContactSheet() {
  const msg = waMessage();
  const wa = `https://wa.me/${STUDIO.whatsapp}?text=${encodeURIComponent(msg)}`;
  const mail = `mailto:${STUDIO.email}?subject=${encodeURIComponent(t('st.cm.subject'))}&body=${encodeURIComponent(msg)}`;
  sheet({
    title: t('st.cm.title'),
    className: 'st-sheet',
    actions: [{ label: t('close'), kind: 'quiet', value: null }],
    content: h('div', { class: 'st-cm' },
      h('p', null, t('st.cm.text')),
      h('a', { class: 'b-btn b-btn--primary b-btn--block st-cm__wa', href: wa, target: '_blank', rel: 'noopener' }, ICON.chat(), h('span', null, t('st.cm.wa'))),
      h('a', { class: 'b-btn b-btn--ghost b-btn--block', href: mail }, ICON.mail(), h('span', null, t('st.cm.email'))),
      h('p', { class: 'st-cm__direct' },
        h('span', null, phoneShow(`+${STUDIO.whatsapp}`)),
        h('span', { 'aria-hidden': 'true' }, ' · '),
        h('span', { dir: 'ltr' }, STUDIO.email))),
  });
}

/* ───────────── changes, drafts, autosave ───────────── */

function changed() {
  S.dirty = true;
  renderSummary();
  if (ASSIST) saveSoon(); else persist();
}

let persistTimer = null;
function persist() {
  if (ASSIST || !S.started) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (S.step === 'done') return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        v: 1, step: S.step, a: S.a, rows: S.rows, contact: S.contact, site: S.site, ui: S.ui, saved_at: Date.now(),
      }));
    } catch { /* private mode or full storage */ }
  }, 250);
}
function clearDraft() {
  clearTimeout(persistTimer);
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
}
function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || d.v !== 1 || !d.a || !d.step || d.step === 'welcome' || d.step === 'done') return null;
    return d;
  } catch { return null; }
}

/* assisted: debounced server drafts */
let saveTimer = null;
let saving = null;
let saveAgain = false;
function saveSoon() {
  if (!ASSIST || !S.authed || !S.dirty) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1200);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (saving) { saveAgain = true; return saving; }
  S.dirty = false;
  setSaveState('saving');
  saving = rpc('adm_draft_save', { id: S.draftId || undefined, answers: answersOut(), contact: contactOut(), lang: L() })
    .then((r) => {
      S.draftId = r.id;
      S.ref = r.ref;
      const q = new URLSearchParams(location.search);
      if (q.get('draft') !== r.id) { q.set('assist', '1'); q.set('draft', r.id); history.replaceState(null, '', `?${q}`); }
      setSaveState('saved');
    })
    .catch(() => { S.dirty = true; setSaveState('failed'); })
    .finally(() => { saving = null; if (saveAgain) { saveAgain = false; saveNow(); } });
  return saving;
}
async function flushSave() {
  clearTimeout(saveTimer);
  while (saving) await saving;
}
function setSaveState(state) {
  S.saveState = state;
  const el = $('#assistState');
  if (!el) return;
  el.dataset.state = state || '';
  el.textContent = state === 'saving' ? t('saving') : state === 'saved' ? t('st.as.saved', { ref: S.ref || '' }) : state === 'failed' ? t('st.as.save_failed') : (S.ref || '');
}

/* ───────────── submit ───────────── */

async function submit() {
  if (!validateContact()) { go('contact', 'back'); return; }
  setBusy('submit');
  try {
    const answers = answersOut();
    const local = estimate(S.sheet, answers).setup_halalas;
    const r = await rpc('pub_submit_setup', { answers, contact: contactOut(), lang: L(), website: S.honey || '' });
    S.result = { ...r, local };
    clearDraft();
    setBusy(null);
    go('done');
  } catch (e) {
    setBusy(null);
    submitError(e);
  }
}

function submitError(e) {
  const code = e?.code;
  if (code === 'BAD_PHONE') { go('contact', 'back'); requestAnimationFrame(() => contactFields?.phone.setError(t(errorKey(e)))); return; }
  if (code === 'BAD_NAME') {
    const bizShort = (S.a.business.name_ar.trim() || S.a.business.name_en.trim()).length < 2;
    if (bizShort) { go('business', 'back'); requestAnimationFrame(() => bizFields?.primary.setError(t('st.err.name'))); }
    else { go('contact', 'back'); requestAnimationFrame(() => contactFields?.name.setError(t(errorKey(e)))); }
    return;
  }
  toast(t(errorKey(e)), { kind: 'err', timeout: 6000, action: code === 'RATE_LIMITED' ? { label: t('st.contact_me'), onClick: openContactSheet } : undefined });
}

async function submitAssisted(create) {
  const contactOk = S.contact.name.trim().length >= 2 && normalizePhone(S.contact.phone);
  if (!contactOk) { go('contact', 'back'); requestAnimationFrame(validateContact); return; }
  if ((S.a.business.name_ar.trim() || S.a.business.name_en.trim()).length < 2) { go('business', 'back'); requestAnimationFrame(validateBusiness); return; }
  setBusy(create ? 'create' : 'save');
  try {
    await flushSave();
    const r = await rpc('adm_submit_assisted', {
      id: S.draftId || undefined, answers: answersOut(), contact: contactOut(), lang: L(), create,
      ...(create && S.slug ? { slug: S.slug } : {}),
    });
    S.dirty = false;
    const target = create && r.business_id ? `/admin/#/businesses/${r.business_id}` : `/admin/#/requests/${r.request_id}`;
    location.assign(new URL(target, location.origin).href);
  } catch (e) {
    setBusy(null);
    if (e?.code === 'SLUG_TAKEN' && slugField) { slugField.setError(t(errorKey(e))); slugField.input.focus(); return; }
    toast(t(errorKey(e)), { kind: 'err', timeout: 6000 });
  }
}

/* ───────────── assisted: sign-in ───────────── */

function renderLogin({ notAdmin = false } = {}) {
  S.authed = false;
  const id = field({ label: t('st.as.identifier'), autocomplete: 'username', inputmode: 'email', maxlength: 120 });
  const pw = field({ label: t('st.as.password'), type: 'password', autocomplete: 'current-password', maxlength: 200 });
  id.input.setAttribute('dir', 'ltr');
  pw.input.setAttribute('dir', 'ltr');
  const err = groupError();
  if (notAdmin) err.set(t('st.as.not_admin'));
  const btn = h('button', { type: 'submit', class: 'b-btn b-btn--primary b-btn--block' }, h('span', null, t('st.as.sign_in')));
  const form = h('form', { class: 'st-login', novalidate: true },
    h('span', { class: 'st-login__mark', 'aria-hidden': 'true' }, mark()),
    h('h1', { class: 'b-step__q', id: 'q-login', tabindex: '-1' }, t('st.as.login_title')),
    id.el, pw.el, err.el, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.getAttribute('aria-busy') === 'true') return;
    err.set(null);
    if (!id.input.value.trim()) { id.setError(t('field.required')); id.input.focus(); return; }
    if (!pw.input.value) { pw.setError(t('field.required')); pw.input.focus(); return; }
    btn.setAttribute('aria-busy', 'true');
    try {
      await signIn(id.input.value.trim(), pw.input.value);
      pw.input.value = '';
      await enterAssist();
    } catch (ex) {
      err.set(t(errorKey(ex)));
      pw.input.focus();
    } finally { btn.removeAttribute('aria-busy'); }
  });
  document.body.dataset.step = 'login';
  renderChrome();
  $('#stage').replaceChildren(h('section', { class: 'b-step st-step' }, form));
  $('#foot').hidden = true;
  $('#barActions').replaceChildren();
  S.loginRender = () => renderLogin({ notAdmin });
  (notAdmin ? btn : id.input).focus?.({ preventScroll: true });
}

async function enterAssist() {
  let me;
  try { me = await rpc('own_me', {}); } catch (e) {
    if (e?.code === 'NOT_ALLOWED') { signOut(); renderLogin(); return; }
    toast(t(errorKey(e)), { kind: 'err' });
    renderLogin();
    return;
  }
  if (!me?.is_admin) { renderLogin({ notAdmin: true }); return; }
  S.authed = true;
  S.loginRender = null;
  $('#assist').hidden = false;
  if (S.draftId) {
    $('#stage').replaceChildren(h('section', { class: 'b-step st-step' }, h('p', { class: 'st-mut', role: 'status' }, t('st.as.loading'))));
    try {
      const r = await rpc('adm_request', { id: S.draftId });
      S.a = hydrate(r.answers || {});
      S.rows = rowsFrom(r.answers?.services);
      S.contact = { name: r.contact_name || '', phone: r.phone ? formatPhone(r.phone, 'en') : '', email: r.email || '' };
      S.site = r.answers?.business?.instagram ? `@${r.answers.business.instagram}` : (r.answers?.business?.site_url || '');
      S.ref = r.ref;
      if (r.status !== 'draft') S.draftId = null;
      setSaveState(null);
    } catch (e) {
      S.draftId = null;
      toast(t(errorKey(e)), { kind: 'err' });
    }
  }
  try { await needSheet(); } catch { /* toast already shown */ }
  S.step = ORDER[0];
  renderSummary();
  renderStage('none');
  $('#stage').querySelector('.b-step__q')?.focus({ preventScroll: true });
}

/* ───────────── price sheet ───────────── */

let sheetPromise = null;
function loadSheet() {
  sheetPromise = rpc('pub_price_sheet', {})
    .then((s) => { S.sheet = s; renderSummary(); return s; })
    .catch((e) => { sheetPromise = null; throw e; });
  return sheetPromise;
}
async function needSheet() {
  if (S.sheet) return S.sheet;
  try {
    return await (sheetPromise || loadSheet());
  } catch (e) {
    toast(t('st.err.load'), { kind: 'err', timeout: 8000, action: { label: t('retry'), onClick: () => loadSheet().catch(() => {}) } });
    throw e;
  }
}

/* ───────────── keyboard: Enter to continue ───────────── */

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey) return;
  if (!S.authed || S.busy || moving) return;
  if (document.querySelector('.b-overlay')) return;
  if (S.step === 'review' || S.step === 'done') return;
  const el = e.target;
  if (!(el instanceof Element) || el.closest('.b-topbar, .st-assist, .b-toasts')) return;
  const tag = el.tagName;
  const primary = () => { e.preventDefault(); navActions().find((a) => a.kind === 'primary')?.run(); };
  if (tag === 'TEXTAREA') { if (e.metaKey || e.ctrlKey) primary(); return; }
  if (tag === 'SELECT' || tag === 'A') return;
  if (tag === 'BUTTON') {
    if (el.getAttribute('role') === 'radio' && el.getAttribute('aria-checked') === 'true') primary();
    return;
  }
  if (tag === 'INPUT' && el.type === 'color') return;
  primary();
}, true);

/* ───────────── boot ───────────── */

function wireChrome() {
  $('#back').replaceChildren(icon('back'));
  $('#back').addEventListener('click', back);
  $('#contactMe').prepend(ICON.chat());
  $('#contactMe').addEventListener('click', openContactSheet);
  $('#barSum').addEventListener('click', openBreakdown);
  $('#barChev').replaceChildren(icon('chevronDown'));
  $('#brandMark').replaceChildren(mark());
  $('#madeBy').replaceChildren(madeBy());
  $('#assistMark').replaceChildren(icon('user'));

  // Keep the fixed bar from covering the last answer.
  const bar = $('#bar');
  const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--st-bar-h', `${Math.ceil(bar.offsetHeight)}px`));
  ro.observe(bar);
}

function onLanguage() {
  updateMeta();
  $('#assistLabel').textContent = t('st.as.banner');
  $('#assistAdmin').textContent = t('st.as.admin');
  setSaveState(S.saveState);
  renderSummary();
  if (S.loginRender) { S.loginRender(); return; }
  if (!S.authed) return;
  const focusedInStage = $('#stage').contains(document.activeElement);
  renderStage('none');
  if (focusedInStage) $('#stage').querySelector('.b-step__q')?.focus({ preventScroll: true });
}

async function main() {
  boot();
  wireChrome();
  updateMeta();
  onLang(onLanguage);
  $('#assistLabel').textContent = t('st.as.banner');
  $('#assistAdmin').textContent = t('st.as.admin');

  if (ASSIST) {
    $('#assist').hidden = true;
    loadSheet().catch(() => {});
    renderSummary();
    if (!currentUser()) { renderLogin(); return; }
    await enterAssist();
    return;
  }

  S.draft = readDraft();
  renderSummary();
  renderStage('none');
  loadSheet().catch(() => needSheet().catch(() => {}));
}

main();
