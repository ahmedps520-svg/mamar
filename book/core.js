/* ==========================================================
   Mamar Booking — customer side, shared pieces.
   Used by the booking flow (book.js), the payment page (pay/),
   the result page (done/) and the manage page (m/).
   Business and customer text only ever goes in as text nodes.
   ========================================================== */

import { rpc, errorKey } from '../platform/api.js';
import { pick, URLS } from '../platform/contract.js';
import * as F from '../platform/fmt.js';
import { register, t, tn, lang, setLang, allowLangs, langToggle } from '../platform/i18n.js';
import errors from '../platform/i18n/errors.js';
import { applyTheme } from '../platform/theme.js';
import { prayerTimes } from '../platform/prayer.js';
import { icsEvent, googleCalUrl, downloadIcs } from '../platform/ics.js';
import { h, icon, madeBy, toast, sheet, selectable, skeleton, watchStuck } from '../platform/ui/kit.js';
import dict from './i18n.js';

register(errors);
register(dict);

export { rpc, errorKey, pick, URLS, F, t, tn, lang, h, icon, toast, sheet, selectable, skeleton };

/* ---------- page setup ---------- */

const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700'
  + '&family=JetBrains+Mono:wght@400;500&family=Noto+Kufi+Arabic:wght@400;500;600;700'
  + '&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap';

/** Fonts + theme-color meta, once per page. */
export function pageSetup() {
  if (!document.getElementById('bk-fonts')) {
    document.head.append(h('link', { id: 'bk-fonts', rel: 'stylesheet', href: FONTS_URL }));
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    document.head.append(h('meta', { name: 'theme-color', content: '#08090B' }));
  }
}

/* ---------- language ---------- */

const LANGS = ['ar', 'en'];
const urlLang = () => {
  try { const q = new URLSearchParams(location.search).get('lang'); return LANGS.includes(q) ? q : null; } catch { return null; }
};
const savedLang = () => {
  try { const s = localStorage.getItem('mamar-lang'); return LANGS.includes(s) ? s : null; } catch { return null; }
};

/** Before the business is known: ?lang → the stored choice → Arabic. */
export function earlyLang(want) {
  const l = (LANGS.includes(want) && want) || urlLang() || savedLang() || 'ar';
  setLang(l, { persist: false, silent: true });
  return l;
}

/** Once it is: ?lang (if offered) → the stored choice (if offered) → the business's first language. */
export function businessLang(langs, want) {
  const list = (Array.isArray(langs) ? langs : []).filter((l) => LANGS.includes(l));
  const offered = list.length ? list : LANGS;
  const q = (LANGS.includes(want) && want) || urlLang();
  const s = savedLang();
  const l = q && offered.includes(q) ? q : s && offered.includes(s) ? s : offered[0];
  allowLangs(offered);
  setLang(l, { persist: false });
  return l;
}

/* ---------- theme ---------- */

export function useTheme(biz) {
  const root = document.documentElement;
  const custom = biz?.look === 'custom';
  applyTheme(root, { look: custom ? 'custom' : 'standard', theme: biz?.theme || {} });
  root.toggleAttribute('data-bk-signature', !custom);
  let grain = document.querySelector('.b-grain');
  if (!custom && root.getAttribute('data-mode') !== 'light') {
    if (!grain) document.body.append(h('div', { class: 'b-grain', 'aria-hidden': 'true' }));
  } else grain?.remove();
}

/** https: or same-origin path only, nothing that could break out of an attribute. */
export function safeUrl(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim();
  return /^(https:\/\/|\/(?!\/))[^\s"'<>\\]+$/i.test(s) ? s : null;
}

/* ---------- formatting in the current language ---------- */

export const money = (v, o) => F.money(v, lang(), o);
/** A fee or discount. Arabic shows the bare amount (the label says which; a leading sign flips sides in RTL). */
export const signed = (v, sign) => (lang() === 'ar' ? money(v) : `${sign}${money(v)}`);
export const num = (n) => F.digits(String(n), lang());
export const dur = (m) => F.durationMin(m, lang());
export const bizName = (b) => pick(b, 'name', lang());
/** Inside the embed overlay, pages outside the flow open top level. */
export const outTarget = () => (document.documentElement.classList.contains('bk-embedded') ? '_top' : null);

/** Opening hours of one weekday for a section (falls back to the first section). */
export function hoursFor(data, sectionId, weekday) {
  const rows = data?.hours || [];
  const sec = sectionId || data?.sections?.[0]?.id || null;
  return rows.filter((r) => r.weekday === weekday && (!sec || !r.section_id || r.section_id === sec));
}

/** Minutes from the business day's local midnight (> 1440 = after midnight). */
export function dayMinutes(tISO, day) {
  return Math.round((Date.parse(tISO) - F.riyadhInstant(day, '00:00').getTime()) / 60000);
}

/** The business day an instant belongs to: 00:30 on Friday after a Thursday that runs to 1 AM is Thursday. */
export function businessDay(startsISO, data, sectionId) {
  const iso = F.riyadhDateISO(startsISO);
  const p = F.riyadhParts(startsISO);
  const m = p.hour * 60 + p.minute;
  const prev = F.addDaysISO(iso, -1);
  let late;
  if (data?.hours?.length) {
    late = hoursFor(data, sectionId, F.riyadhParts(prev).weekday).some((r) => r.close_min > 1440 && m + 1440 < r.close_min);
  } else {
    late = p.hour < 5;
  }
  return late ? { day: prev, late: true } : { day: iso, late: false };
}

export function timeLabel(tISO, late = false) {
  const s = F.time(tISO, lang());
  return late ? `${s} ${t('bk.after_midnight_paren')}` : s;
}

/** 'Today' · 'Tomorrow' · 'Tonight' (yesterday's late slots) · weekday. */
export function dayName(day, { short = false } = {}) {
  const today = F.riyadhDateISO();
  if (day < today) return t('bk.tonight');
  if (day === today) return t('today');
  if (day === F.addDaysISO(today, 1)) return t('tomorrow');
  return F.weekday(day, lang(), short);
}

export const hijriOn = (data) => data?.flow?.hijri !== false;

/* ---------- prices ---------- */

/** Client-side estimate (mirrors the server's _price) until pub_slots returns the real one for a day. */
export function estimate(data, s, qty = 1, loc = 'shop') {
  const p = s?.price || {};
  const n = s?.per_person ? Math.max(1, qty) : 1;
  const base = (p.price ?? 0) * n;
  const off = p.offer_id && (data?.offers || []).find((o) => o.id === p.offer_id);
  let discount = 0;
  if (off) discount = Math.min(base, off.kind === 'percent' ? Math.round((base * off.value) / 100) : off.value);
  else if (p.discount) discount = Math.min(base, p.discount * n);
  const fee = loc === 'mobile' ? (data?.flow?.home?.fee_halalas || 0) : 0;
  return { price: base, discount, fee, total: base - discount + fee, offer_id: p.offer_id, offer_ar: p.offer_ar, offer_en: p.offer_en };
}

/** What the customer pays online now (mirrors the server's _due). */
export function dueNow(flow, total) {
  const pay = flow?.payment || {};
  if (pay.mode === 'full') return total;
  if (pay.mode === 'deposit') {
    const v = Number(pay.deposit_value) || 0;
    return Math.min(total, pay.deposit_kind === 'amount' ? v : Math.ceil((total * v) / 100));
  }
  return 0;
}

/** Offer label: 'خصم ١٥٪' / '−15%' · 'خصم ٢٠ ر.س' / '−20 SAR'. */
export function offerValue(o) {
  if (!o) return '';
  const v = o.kind === 'percent' ? `${num(o.value)}${lang() === 'ar' ? '٪' : '%'}` : o.kind === 'amount' ? money(o.value) : '';
  if (!v) return '';
  return t('bk.off', { v });
}

/** 'Every Sunday' / 'Sun & Thu' for weekday-limited offers. */
export function offerDays(o) {
  const wd = Array.isArray(o?.weekdays) ? o.weekdays : null;
  if (!wd || !wd.length || wd.length === 7) return '';
  const names = wd.map((d) => t(lang() === 'ar' ? `wds.${d}` : `wd.${d}`));
  if (names.length === 1) return t('bk.offer.every', { day: names[0] });
  return names.join(lang() === 'ar' ? '، ' : ', ');
}

/* ---------- bookings on this device ---------- */

const SAVED = 'mamar-bookings';
export function savedBookings() {
  try { const v = JSON.parse(localStorage.getItem(SAVED) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveBooking(e) {
  try {
    const list = savedBookings().filter((b) => b && b.booking_id !== e.booking_id && b.ref !== e.ref);
    list.unshift({
      ref: e.ref, token: e.token, booking_id: e.booking_id, slug: e.slug, starts_at: e.starts_at,
      service_name_ar: e.service_name_ar, service_name_en: e.service_name_en,
    });
    localStorage.setItem(SAVED, JSON.stringify(list.slice(0, 20)));
  } catch { /* private mode */ }
}

/* ---------- small cached reads ---------- */

const cache = new Map();
const keyOf = (name, args) => `${name}:${JSON.stringify(Object.keys(args).sort().reduce((o, k) => {
  if (args[k] != null && args[k] !== '') o[k] = args[k];
  return o;
}, {}))}`;

/** rpc() with a short memory, so prefetches are reused and a live ping can drop them. */
export function cached(name, args = {}, { ttl = 45000, force = false } = {}) {
  const key = keyOf(name, args);
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.p;
  const clean = {};
  for (const [k, v] of Object.entries(args)) if (v != null && v !== '') clean[k] = v;
  const p = rpc(name, clean);
  cache.set(key, { at: Date.now(), p });
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key); });
  return p;
}
export function invalidate(prefix = '') {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

/* ---------- page chrome ---------- */

/**
 * Top bar (back · business · language · close) + main stage + footer credit.
 * @returns {{app, bar, stage, main, foot, setBack(fn|null), setTitle(name, sub), setProgress(p|null), setLogo(url)}}
 */
export function chrome(app, { onClose } = {}) {
  app.classList.add('b-app', 'bk');
  let backFn = null;
  const back = h('button', {
    type: 'button', class: 'b-iconbtn bk-bar__back', 'aria-label': t('back'),
    onClick: () => backFn && backFn(),
  }, icon('back'));
  const logo = h('img', { class: 'bk-bar__logo', alt: '', hidden: true, decoding: 'async' });
  const name = h('span', { class: 'bk-bar__name' });
  const sub = h('small', { class: 'bk-bar__sub' });
  const title = h('div', { class: 'b-topbar__title bk-bar__title' }, h('span', { class: 'bk-bar__brand' }, logo, name), sub);
  const langBtn = h('button', { type: 'button', class: 'b-lang' }, h('span', { 'data-lang-label': '' }, 'EN'));
  const close = onClose ? h('button', {
    type: 'button', class: 'b-iconbtn bk-bar__close', 'aria-label': t('close'), onClick: onClose,
  }, icon('close')) : null;
  const prog = h('div', { class: 'b-progress__bar' });
  const progress = h('div', { class: 'b-progress bk-bar__progress', 'aria-hidden': 'true', hidden: true }, prog);
  const bar = h('header', { class: 'b-topbar bk-bar' },
    h('div', { class: 'b-topbar__start' }, back), title, h('div', { class: 'b-topbar__end' }, langBtn, close), progress);
  const stage = h('div', { class: 'b-stage bk-stage' });
  const inner = h('div', { class: 'b-shell bk-shell' }, stage);
  const main = h('main', { class: 'bk-main', id: 'bk-main' }, inner);
  const foot = h('footer', { class: 'bk-foot' }, madeBy());
  app.replaceChildren(bar, main, foot);
  langToggle(langBtn);
  watchStuck(bar);
  back.hidden = true;
  return {
    app, bar, stage, main, inner, foot, langBtn, close,
    setBack(fn) { backFn = fn; back.hidden = !fn; back.setAttribute('aria-label', t('back')); },
    setTitle(n, s = '') { name.textContent = n || ''; sub.textContent = s || ''; sub.hidden = !s; },
    setProgress(p) {
      progress.hidden = p == null;
      if (p != null) progress.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
    },
    setLogo(url) {
      const u = safeUrl(url);
      logo.hidden = !u;
      if (u) logo.src = u; else logo.removeAttribute('src');
    },
    relabel() {
      back.setAttribute('aria-label', t('back'));
      close?.setAttribute('aria-label', t('close'));
      foot.replaceChildren(madeBy());
    },
  };
}

/** A calm error / empty screen. */
export function messageStep({ mark = 'info', title, text, actions = [] }) {
  return h('section', { class: 'b-step bk-msg' },
    h('div', { class: 'b-empty' },
      h('span', { class: 'b-empty__mark' }, icon(mark)),
      h('h1', { class: 'b-empty__title', 'data-step-focus': '' }, title),
      text && h('p', { class: 'b-empty__text' }, text),
      actions.length && h('div', { class: 'bk-msg__actions' }, actions)));
}

export function loadingStep() {
  return h('section', { class: 'b-step bk-loading', 'aria-busy': 'true' },
    h('div', { class: 'b-step__head' },
      h('span', { class: 'b-skel', style: { '--w': '34%' } }),
      h('span', { class: 'b-skel b-skel--title', style: { '--w': '72%' } })),
    skeleton(4));
}

/* ---------- form field ---------- */

let fid = 0;
/** Floating-label text field from the kit. */
export function field({ label, type = 'text', name, value = '', autocomplete, inputmode, optional = false, hint = '',
  multiline = false, maxlength, onInput, dir } = {}) {
  const id = `bk-f-${++fid}`;
  const msgId = `${id}-m`;
  const input = h(multiline ? 'textarea' : 'input', {
    id, name, class: 'b-field__input', placeholder: ' ', autocomplete, inputmode, maxlength, dir,
    type: multiline ? null : type, rows: multiline ? 3 : null, 'aria-describedby': msgId,
    spellcheck: type === 'tel' || type === 'email' ? 'false' : null,
  });
  input.value = value || '';
  const lab = h('label', { class: 'b-field__label', for: id }, optional ? `${label} · ${t('optional')}` : label);
  const msg = h('p', { class: 'b-field__msg', id: msgId }, hint);
  const el = h('div', { class: 'b-field' }, h('div', { class: 'b-field__box' }, input, lab), msg);
  input.addEventListener('input', () => {
    if (el.classList.contains('is-invalid')) { el.classList.remove('is-invalid'); input.removeAttribute('aria-invalid'); msg.textContent = hint; }
    onInput?.(input.value);
  });
  return {
    el, input,
    error(text) { el.classList.add('is-invalid'); input.setAttribute('aria-invalid', 'true'); msg.textContent = text; },
    ok() { el.classList.remove('is-invalid'); input.removeAttribute('aria-invalid'); msg.textContent = hint; },
  };
}

export const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());

/* ---------- the day + time picker ---------- */

const PARTS = [
  { key: 'morning', to: 720 },
  { key: 'afternoon', to: 1020 },
  { key: 'evening', to: 1440 },
  { key: 'bk.late', to: Infinity },
];

/**
 * Date strip (pub_days) + time grid (pub_slots), shared by the booking flow and rescheduling.
 * @param {{data:object, query:object, service:object, day?:string, t?:string, sectionId?:string,
 *          onPick:(sel:{day:string, slot:object|null, price:object|null})=>void,
 *          onWaitlist?:(day:string)=>void, exclude?:string}} o
 */
export function whenPicker(o) {
  const st = { day: o.day || null, t: o.t || null, days: null, slots: null, price: null, seq: 0 };
  const monthEl = h('div', { class: 'b-dates__month bk-month' });
  const strip = h('div', { class: 'b-dates bk-dates', 'aria-label': t('bk.pick_day') });
  const dayHost = h('div', { class: 'bk-when__days' }, monthEl, strip);
  const slotsHost = h('div', { class: 'bk-when__slots' });
  const said = h('p', { class: 'b-sr', role: 'status', 'aria-live': 'polite' });
  const el = h('div', { class: 'bk-when' }, dayHost, slotsHost, said);
  const announce = (n) => { said.textContent = st.day ? `${dayName(st.day)} — ${tn('bk.times', n)}` : ''; };
  let daySel = null;
  let slotSel = null;
  const flow = o.data.flow || {};
  const today = () => F.riyadhDateISO();

  function status(d) {
    if (d.n > 0) return 'open';
    if (d.closed === true) return 'closed';   // server knows special hours (Eid, Ramadan) and closed weekdays
    const wd = F.riyadhParts(d.day).weekday;
    const ranges = hoursFor(o.data, o.sectionId, wd);
    if (!ranges.length) return 'closed';
    if (d.day <= today()) {
      const now = F.riyadhParts(new Date());
      const m = now.hour * 60 + now.minute + (flow.notice_min || 0);
      if (!ranges.some((r) => r.close_min > m)) return 'closed';
    }
    return 'full';
  }

  function paintMonth() {
    const d = st.day || today();
    monthEl.replaceChildren(
      h('b', null, F.monthYear(d, lang())),
      hijriOn(o.data) ? h('span', null, F.hijriMonthYear(d, lang())) : null);
  }

  function paintDays() {
    const days = st.days || [];
    const hij = hijriOn(o.data);
    strip.replaceChildren(...days.map((d) => {
      const s = status(d);
      const selectableDay = s === 'open' || (s === 'full' && flow.waitlist);
      const rel = dayName(d.day);
      const long = `${rel === F.weekday(d.day, lang()) ? '' : `${rel} — `}${F.dateLong(d.day, lang())}${hij ? ` — ${F.hijri(d.day, lang())}` : ''}`;
      return h('button', {
        type: 'button', class: ['b-date', 'bk-date', d.day === today() && 'is-today', s !== 'open' && `is-${s}`],
        'data-value': d.day, disabled: !selectableDay, 'aria-checked': d.day === st.day,
        'aria-label': s === 'open' ? long : `${long} — ${t(s === 'full' ? 'bk.day.full' : 'bk.day.closed')}`,
      },
      h('span', { class: 'b-date__wd' }, dayName(d.day, { short: true })),
      h('span', { class: 'b-date__d' }, num(F.riyadhParts(d.day).day)),
      hij && h('span', { class: 'b-date__h' }, F.hijriShort(d.day, lang())),
      h('span', { class: 'bk-date__n' }, s === 'open' ? h('i', { class: 'bk-date__dot', 'aria-hidden': 'true' })
        : t(s === 'full' ? 'bk.day.full' : 'bk.day.closed')));
    }));
    daySel?.destroy();
    daySel = selectable(strip, { selector: '.b-date', onChange: (v) => pickDay(v, true) });
    const on = strip.querySelector('[aria-checked="true"]');
    if (on) requestAnimationFrame(() => scrollIntoStrip(on));
  }

  function scrollIntoStrip(btn) {
    const sr = strip.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    if (br.left < sr.left + 16 || br.right > sr.right - 16) {
      strip.scrollBy({ left: br.left - sr.left - (sr.width - br.width) / 2, behavior: 'smooth' });
    }
  }

  const q = (extra = {}) => ({ ...o.query, ...extra });

  async function loadDays(force = false) {
    if (!st.days) strip.replaceChildren(...Array.from({ length: 6 }, () => h('span', { class: 'b-skel bk-date-skel' })));
    try {
      const r = await cached('pub_days', q(), { force });
      st.days = r.days || [];
    } catch (e) {
      slotsHost.replaceChildren(errorBox(e, () => loadDays(true)));
      return;
    }
    const keep = st.day && st.days.find((d) => d.day === st.day && (d.n > 0 || status(d) === 'full'));
    if (!keep) st.day = (st.days.find((d) => d.n > 0) || st.days.find((d) => d.day >= today()))?.day || null;
    paintMonth();
    paintDays();
    if (st.day) await loadSlots(st.day, force);
    else slotsHost.replaceChildren(emptyBox(t('bk.no_days'), null));
    // prefetch the next open day so a tap feels instant
    const i = st.days.findIndex((d) => d.day === st.day);
    const nxt = st.days.slice(i + 1).find((d) => d.n > 0);
    if (nxt) cached('pub_slots', q({ day: nxt.day })).catch(() => {});
  }

  async function pickDay(day, user = false) {
    if (st.day !== day) { st.t = null; }
    st.day = day;
    paintMonth();
    const btn = strip.querySelector(`[data-value="${day}"]`);
    if (btn && user) scrollIntoStrip(btn);
    o.onPick?.({ day, slot: null, price: st.price });
    await loadSlots(day, false);
  }

  async function loadSlots(day, force = false) {
    const seq = ++st.seq;
    const d = (st.days || []).find((x) => x.day === day);
    if (d && d.n === 0) { st.slots = []; paintSlots(); return; }
    slotsHost.setAttribute('aria-busy', 'true');
    if (!force) slotsHost.replaceChildren(slotSkeleton());
    let r;
    try {
      r = await cached('pub_slots', q({ day }), { force });
    } catch (e) {
      if (seq === st.seq) slotsHost.replaceChildren(errorBox(e, () => loadSlots(day, true)));
      return;
    } finally {
      if (seq === st.seq) slotsHost.removeAttribute('aria-busy');
    }
    if (seq !== st.seq) return;
    st.slots = r.slots || [];
    st.price = r.price || null;
    const chosen = st.t && st.slots.find((s) => s.t === st.t);
    if (st.t && !chosen) st.t = null;
    paintSlots();
    o.onPick?.({ day, slot: chosen || null, price: st.price });
    // a neighbouring day for the next tap
    const i = (st.days || []).findIndex((x) => x.day === day);
    const nxt = (st.days || []).slice(i + 1).find((x) => x.n > 0);
    if (nxt) cached('pub_slots', q({ day: nxt.day })).catch(() => {});
  }

  function paintSlots() {
    const day = st.day;
    const slots = (st.slots || []).filter((s) => !o.exclude || s.t !== o.exclude);
    if (!slots.length) {
      const next = (st.days || []).find((x) => x.day > day && x.n > 0);
      const d = (st.days || []).find((x) => x.day === day);
      const full = d ? status(d) === 'full' : true;
      slotsHost.replaceChildren(emptyBox(full ? t('bk.day_full') : t('no_slots'), next, full && flow.waitlist && o.onWaitlist));
      announce(0);
      return;
    }
    const capacity = o.service?.mode === 'capacity';
    const items = slots.map((s) => ({ kind: 'slot', m: dayMinutes(s.t, day), s }));
    for (const p of prayerGaps(day, items)) items.push(p);
    items.sort((a, b) => a.m - b.m || (a.kind === 'pause' ? -1 : 1));
    const groups = PARTS.map((p) => ({ ...p, items: [] }));
    for (const it of items) groups.find((g) => it.m < g.to).items.push(it);
    const wrap = h('div', { class: 'b-slots bk-slots' });
    for (const g of groups) {
      if (!g.items.some((x) => x.kind === 'slot')) continue;
      const grid = h('div', { class: 'b-slots__grid' });
      for (const it of g.items) {
        if (it.kind === 'pause') {
          grid.append(h('div', { class: 'b-slots__pause bk-pause' },
            h('span', { class: 'bk-pause__icon', 'aria-hidden': 'true' }, crescent()),
            h('span', null, `${t('bk.prayer_time')} · ${t(`prayer.${it.k}`)}`),
            h('span', { class: 'bk-pause__t' }, `${F.time(hhmm(it.from), lang())} – ${F.time(hhmm(it.to), lang())}`)));
          continue;
        }
        const late = it.m >= 1440;
        const tl = F.time(it.s.t, lang());
        const left = capacity ? tn('bk.left', it.s.n) : '';
        grid.append(h('button', {
          type: 'button', class: ['b-slot', 'bk-slot', late && 'is-late', capacity && it.s.n <= 2 && 'is-low'],
          'data-value': it.s.t, 'aria-checked': it.s.t === st.t,
          'aria-label': [tl, late && t('bk.after_midnight'), left].filter(Boolean).join(' · '),
        },
        h('span', { class: 'bk-slot__t' }, tl),
        (late || capacity) && h('span', { class: 'bk-slot__sub' }, late ? t('bk.after_midnight') : left)));
      }
      const label = g.key === 'bk.late' ? t('bk.late') : t(g.key);
      wrap.append(h('div', { class: 'b-slots__group' }, h('p', { class: 'b-slots__label' }, label), grid));
    }
    slotsHost.replaceChildren(wrap);
    announce(slots.length);
    slotSel?.destroy();
    slotSel = selectable(wrap, {
      selector: '.b-slot',
      onChange: (v) => {
        st.t = v;
        o.onPick?.({ day, slot: st.slots.find((s) => s.t === v) || null, price: st.price });
      },
    });
  }

  function prayerGaps(day, items) {
    const pr = flow.prayer;
    if (!pr?.on || !items.length) return [];
    let p;
    try { p = prayerTimes(day, { minutes: true }); } catch { return []; }
    const fri = F.riyadhParts(day).weekday === 5;
    const names = ['dhuhr', 'asr', 'maghrib', 'isha'];
    if (pr.fajr) names.unshift('fajr');
    const ranges = hoursFor(o.data, o.sectionId, F.riyadhParts(day).weekday);
    const first = items[0].m;
    const last = items[items.length - 1].m;
    const out = [];
    for (const k of names) {
      const from = p[k] - (pr.before_min || 0);
      const to = p[k] + (k === 'dhuhr' && fri ? (pr.jumuah_min || 60) : (pr.after_min || 25));
      const open = !ranges.length || ranges.some((r) => from < r.close_min && to > r.open_min);
      if (open && first < from && last >= to - 5) out.push({ kind: 'pause', m: from, k, from, to });
    }
    return out;
  }

  function emptyBox(text, next, waitlist) {
    return h('div', { class: 'bk-empty' },
      h('p', { class: 'bk-empty__t' }, text),
      h('div', { class: 'bk-empty__actions' },
        waitlist && h('button', {
          type: 'button', class: 'b-btn b-btn--primary b-btn--sm', onClick: () => o.onWaitlist(st.day),
        }, h('span', null, t('bk.wl.cta'))),
        next && h('button', {
          type: 'button', class: 'b-btn b-btn--ghost b-btn--sm',
          onClick: () => { daySel?.set(next.day); pickDay(next.day, true); },
        }, h('span', null, t('bk.next_open', { day: `${dayName(next.day)} ${num(F.riyadhParts(next.day).day)}` })))));
  }

  function errorBox(e, retry) {
    return h('div', { class: 'bk-empty' },
      h('p', { class: 'bk-empty__t' }, t(errorKey(e))),
      h('div', { class: 'bk-empty__actions' },
        h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--sm', onClick: retry }, h('span', null, t('retry')))));
  }

  loadDays();
  return {
    el,
    get day() { return st.day; },
    get t() { return st.t; },
    /** Live update: re-read days and the open day without losing the choice. */
    async refresh() { await loadDays(true); },
    repaint() { if (st.days) { paintMonth(); paintDays(); } if (st.slots) paintSlots(); },
    clear() { st.t = null; if (st.slots) paintSlots(); },
    slotStillThere(tISO) { return !!(st.slots || []).find((s) => s.t === tISO); },
  };
}

export function slotSkeleton() {
  const grid = h('div', { class: 'bk-slot-skel', role: 'status', 'aria-label': t('loading') });
  for (let i = 0; i < 9; i++) grid.append(h('span', { class: 'b-skel' }));
  return h('div', { class: 'b-slots' }, h('span', { class: 'b-skel', style: { '--w': '30%' } }), grid);
}

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;

function crescent() {
  return h('svg', { viewBox: '0 0 24 24', class: 'b-icon' },
    h('path', { d: 'M15.5 4.6A8 8 0 1 0 19.4 16a6.5 6.5 0 0 1-3.9-11.4z' }));
}

export function lockIcon() {
  return h('svg', { viewBox: '0 0 24 24', class: 'b-icon', 'aria-hidden': 'true' },
    h('rect', { x: 5.5, y: 10.5, width: 13, height: 9.5, rx: 2 }),
    h('path', { d: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5' }));
}

export function waIcon() {
  return h('svg', { viewBox: '0 0 24 24', class: 'b-icon', 'aria-hidden': 'true' },
    h('path', { d: 'M4.5 19.5l1.1-3.6A7.8 7.8 0 1 1 8.4 18.6z' }),
    h('path', { d: 'M9.3 8.6c.3 2.6 2.4 4.8 5.1 5.4l1-1.2-1.6-.9-.7.7c-1-.4-1.9-1.3-2.3-2.3l.7-.7-.9-1.6z' }));
}

/* ---------- waitlist ---------- */

export function waitlistSheet({ data, service, day, qty = 1, preset = {} }) {
  let part = 'any';
  const name = field({ label: t('name'), name: 'name', autocomplete: 'name', value: preset.name, maxlength: 80 });
  const phone = field({
    label: t('phone'), type: 'tel', name: 'phone', autocomplete: 'tel', inputmode: 'tel', value: preset.phone,
    hint: t('bk.phone_hint'), dir: 'ltr',
  });
  const seg = h('div', { class: 'b-seg b-seg--block', 'aria-label': t('bk.wl.part') },
    ['any', 'morning', 'afternoon', 'evening'].map((p) => h('button', {
      type: 'button', class: 'b-seg__opt', 'data-value': p, 'aria-checked': p === part,
    }, t(p === 'any' ? 'bk.wl.any' : p))));
  selectable(seg, { onChange: (v) => { part = v; } });
  const when = `${dayName(day)} ${F.dateLong(day, lang(), { weekday: false, year: false })}`;
  return sheet({
    title: t('bk.wl.title'),
    className: 'bk-wl',
    content: h('div', { class: 'b-stack' },
      h('p', null, t('bk.wl.text', { service: pick(service, 'name'), day: when })),
      h('div', { class: 'b-stack', style: { '--_gap': '8px' } }, h('span', { class: 'bk-label' }, t('bk.wl.part')), seg),
      name.el, phone.el),
    actions: [
      { label: t('cancel'), kind: 'ghost', value: false },
      {
        label: t('bk.wl.join'), kind: 'primary', value: true,
        onClick: async () => {
          let bad = false;
          if (name.input.value.trim().length < 2) { name.error(t('err.BAD_NAME')); bad = true; }
          if (!F.normalizePhone(phone.input.value)) { phone.error(t('field.phone_invalid')); bad = true; }
          if (bad) { (name.el.classList.contains('is-invalid') ? name.input : phone.input).focus(); return false; }
          try {
            await rpc('pub_waitlist_join', {
              service_id: service.id, day, part, qty, name: name.input.value.trim(), phone: F.normalizePhone(phone.input.value),
            });
            toast(t('bk.wl.done'), { kind: 'ok', timeout: 4200 });
            return true;
          } catch (e) {
            toast(t(errorKey(e)), { kind: 'err' });
            return false;
          }
        },
      },
    ],
  });
}

/* ---------- confirmation ---------- */

export function successMark() {
  return h('div', { class: 'bk-success', 'aria-hidden': 'true' },
    h('svg', { viewBox: '0 0 64 64' },
      h('circle', { class: 'bk-success__ring', cx: 32, cy: 32, r: 29 }),
      h('path', { class: 'bk-success__tick', d: 'M20 33.5 28.5 42 45 24' })));
}

export function statusPill(status) {
  const map = {
    confirmed: ['confirmed', 'status.confirmed'], pending_payment: ['pending', 'bk.status.pending_payment'],
    cancelled: ['cancelled', 'status.cancelled'], expired: ['cancelled', 'bk.status.expired'],
    completed: ['completed', 'status.completed'], no_show: ['no-show', 'status.no_show'],
  };
  const [cls, key] = map[status] || ['pending', 'status.pending'];
  return h('span', { class: `b-pill b-pill--${cls}` }, t(key));
}

export function demoBadge() {
  return h('p', { class: 'bk-demo' }, icon('sparkle'), t('bk.demo_booking'));
}

const kvRow = (k, v, cls) => h('div', { class: ['b-kv__row', cls] }, h('dt', { class: 'b-kv__k' }, k), h('dd', { class: 'b-kv__v' }, v));

function mapsUrl(lat, lng, text) {
  if (lat != null && lng != null) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  if (text) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
  return null;
}

/** Where / when lines for a booking view ({booking, business}). */
export function bookingFacts(view, data) {
  const b = view.booking;
  const biz = view.business || {};
  const { day, late } = businessDay(b.starts_at, data, b.section_id);
  const svcRow = data?.services?.find((s) => s.id === b.service_id);
  const qty = b.qty > 1 ? (svcRow?.per_person !== false ? tn('bk.people', b.qty) : `× ${num(b.qty)}`) : '';
  const where = b.location === 'mobile'
    ? { text: b.address || t('bk.home_pinned'), sub: t('bk.home_visit'), href: mapsUrl(b.lat, b.lng, b.address) }
    : { text: pick(biz, 'address') || bizName(biz), sub: '', href: safeUrl(biz.maps_url) || mapsUrl(null, null, pick(biz, 'address')) };
  return {
    day, late, qty,
    service: pick(b, 'service_name'),
    staff: pick(b, 'staff_label'),
    date: F.dateLong(day, lang()),
    hijri: hijriOn(data) ? F.hijri(day, lang()) : '',
    time: timeLabel(b.starts_at, late),
    where,
  };
}

/** The booking's details as a key/value list. */
export function detailsList(view, data, { prices = true } = {}) {
  const b = view.booking;
  const f = bookingFacts(view, data);
  const rows = [
    kvRow(t('service'), h('span', null, f.service, f.qty && h('small', { class: 'bk-kv__sub' }, f.qty))),
    f.staff && kvRow(t('bk.with'), f.staff),
    kvRow(t('date'), h('span', null, f.date, f.hijri && h('small', { class: 'bk-kv__sub' }, f.hijri))),
    kvRow(t('time'), f.time),
    kvRow(t('bk.where_k'), h('span', null,
      f.where.href ? h('a', { href: f.where.href, target: '_blank', rel: 'noopener', class: 'bk-link' }, f.where.text) : f.where.text,
      f.where.sub && h('small', { class: 'bk-kv__sub' }, f.where.sub))),
  ];
  if (prices) {
    if (b.discount_halalas > 0) rows.push(kvRow(t('bk.discount'), signed(b.discount_halalas, '−'), 'bk-kv--offer'));
    if (b.fee_halalas > 0) rows.push(kvRow(t('bk.home_fee'), signed(b.fee_halalas, '+')));
    rows.push(kvRow(t('total'), money(b.total_halalas), 'b-kv__row--total'));
    if (b.paid_halalas > 0) {
      rows.push(kvRow(t('bk.paid_online'), money(b.paid_halalas), 'bk-kv--paid'));
      if (b.total_halalas - b.paid_halalas > 0) rows.push(kvRow(t('bk.pay_at_shop'), money(b.total_halalas - b.paid_halalas)));
    } else if (b.due_now_halalas > 0 && b.status === 'pending_payment') {
      rows.push(kvRow(t('bk.due_now'), money(b.due_now_halalas)));
    }
  }
  return h('dl', { class: 'b-kv bk-kv' }, rows);
}

function absolute(path) { return new URL(path, location.origin).href; }

export function whatsappText(view, data) {
  const f = bookingFacts(view, data);
  return t('bk.wa_msg', {
    biz: bizName(view.business), service: f.service + (f.qty ? ` (${f.qty})` : ''), date: f.date, time: f.time, ref: view.booking.ref,
  });
}

/** Calendar, WhatsApp, manage — the actions under a confirmed booking. */
export function bookingActions(view, token, data, { manage = true } = {}) {
  const b = view.booking;
  const biz = view.business || {};
  const f = bookingFacts(view, data);
  const title = `${f.service} · ${bizName(biz)}`;
  const manageUrl = token ? absolute(URLS.manage(token)) : '';
  const desc = [`${t('bk.ref')}: ${b.ref}`, f.staff, f.qty, manageUrl && `${t('bk.manage')}: ${manageUrl}`].filter(Boolean).join('\n');
  const ev = { uid: `${b.id}@mamar.site`, start: b.starts_at, end: b.ends_at, title, description: desc, location: f.where.text, url: manageUrl || undefined, alarmMin: 60 };
  const wa = biz.phone ? F.whatsappUrl(biz.phone, whatsappText(view, data)) : null;
  const tel = biz.phone ? F.normalizePhone(biz.phone) : null;
  const live = ['confirmed', 'pending_payment'].includes(b.status);
  return h('div', { class: 'bk-actions' },
    wa && live && h('a', { class: 'b-btn b-btn--primary b-btn--block bk-wa', href: wa, target: '_blank', rel: 'noopener' },
      waIcon(), h('span', null, t('bk.send_wa'))),
    live && h('div', { class: 'bk-actions__row' },
      h('button', {
        type: 'button', class: 'b-btn b-btn--ghost', onClick: () => downloadIcs(`${b.ref}`, icsEvent(ev)),
      }, icon('calendar'), h('span', null, t('bk.ics'))),
      h('a', { class: 'b-btn b-btn--ghost', href: googleCalUrl(ev), target: '_blank', rel: 'noopener' },
        icon('calendar'), h('span', null, t('bk.gcal')))),
    manage && view.can_cancel && token && h('a', { class: 'b-btn b-btn--quiet b-btn--block', href: URLS.manage(token), target: outTarget() },
      h('span', null, t('bk.manage')), icon('forward')),
    !live && tel && h('a', { class: 'b-btn b-btn--ghost b-btn--block', href: `tel:${tel}` }, icon('phone'), h('span', null, t('call'))));
}

/** The calm success screen (booking flow, done page). */
export function confirmationStep(view, token, data, { onAnother, back } = {}) {
  const b = view.booking;
  const biz = view.business || {};
  const f = bookingFacts(view, data);
  const paid = b.paid_halalas > 0;
  const copy = h('button', {
    type: 'button', class: 'b-iconbtn bk-ref__copy', 'aria-label': t('copy'),
    onClick: async () => {
      try { await navigator.clipboard.writeText(b.ref); toast(t('copied'), { kind: 'ok', timeout: 1600 }); } catch { /* denied */ }
    },
  }, copyIcon());
  return h('section', { class: 'b-step bk-done' },
    h('div', { class: 'bk-done__hero' },
      successMark(),
      h('span', { class: 'b-eyebrow' }, paid ? t('bk.done.paid') : t('bk.done.eyebrow')),
      h('h1', { class: 'b-step__q bk-done__q', 'data-step-focus': '' }, t('bk.done.title')),
      h('p', { class: 'b-step__hint' }, t('bk.done.text', { biz: bizName(biz), day: `${dayName(f.day)}`, time: f.time }))),
    biz.is_demo && demoBadge(),
    h('div', { class: 'bk-ref' },
      h('span', { class: 'bk-ref__k' }, t('bk.ref')),
      h('b', { class: 'bk-ref__v', dir: 'ltr' }, b.ref),
      copy),
    h('div', { class: 'b-card bk-card' }, detailsList(view, data)),
    bookingActions(view, token, data),
    h('p', { class: 'bk-note' }, t('bk.done.saved')),
    (onAnother || back) && h('div', { class: 'bk-actions__row bk-actions__row--quiet' },
      onAnother && h('button', { type: 'button', class: 'b-btn b-btn--quiet', onClick: onAnother }, h('span', null, t('bk.another'))),
      back && h('a', { class: 'b-btn b-btn--quiet', href: back.href }, icon('back'), h('span', null, back.label))));
}

function copyIcon() {
  return h('svg', { viewBox: '0 0 24 24', class: 'b-icon', 'aria-hidden': 'true' },
    h('rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 }),
    h('path', { d: 'M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5' }));
}

/** ?back= on pay/done pages: only http(s) links, shown by host name. */
export function backLink(raw) {
  try {
    if (!raw) return null;
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    return { href: u.href, label: t('bk.back_to', { site: u.host }) };
  } catch { return null; }
}

/** Booking link for "pick another time". */
export const bookUrl = (slug) => (slug ? URLS.link(slug) : '/');
