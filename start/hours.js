/* ==========================================================
   Mamar Booking · /start/ opening-hours editor
   hours = { [weekday 0=Sun..6=Sat]: [[open_min, close_min], …] }
   A missing weekday means closed. close_min may pass midnight
   (up to 2880), open_min stays within the day (0–1439).
   ========================================================== */

import { t, lang } from '../platform/i18n.js';
import { time as fmtTime } from '../platform/fmt.js';
import { h, icon, selectable, haptic } from '../platform/ui/kit.js';

const STEP = 30;
const DAY = 1440;
const MAX_CLOSE = 2880;

/** Saudi week order: Saturday first. */
export const WEEK = [6, 0, 1, 2, 3, 4, 5];

const all = (r, days = [0, 1, 2, 3, 4, 5, 6]) => Object.fromEntries(days.map((d) => [d, r.map((x) => [...x])]));

export const PRESETS = [
  { id: 'std', hours: { ...all([[600, 1320]], [0, 1, 2, 3, 4, 6]), 5: [[960, 1380]] } },
  { id: 'night', hours: all([[960, 1560]]) },
  { id: 'day', hours: all([[540, 1260]], [0, 1, 2, 3, 4, 6]) },
  { id: 'split', hours: { ...all([[540, 780], [960, 1320]], [0, 1, 2, 3, 4, 6]), 5: [[960, 1320]] } },
];

export const cloneHours = (hrs) => Object.fromEntries(Object.entries(hrs || {}).map(([d, r]) => [d, r.map((x) => [...x])]));

const canon = (hrs) => JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => (hrs?.[d] || hrs?.[String(d)] || []).map((r) => [+r[0], +r[1]])));

/** The preset the hours currently match, or null. */
export function matchPreset(hrs) {
  const c = canon(hrs);
  return PRESETS.find((p) => canon(p.hours) === c)?.id || null;
}

/** Clean hours for the server: valid, ordered, non-overlapping ranges only. */
export function sanitizeHours(hrs) {
  const out = {};
  for (let d = 0; d <= 6; d++) {
    const list = (hrs?.[d] || hrs?.[String(d)] || [])
      .map((r) => [Math.round(+r[0]), Math.round(+r[1])])
      .filter(([o, c]) => Number.isFinite(o) && Number.isFinite(c) && o >= 0 && o < DAY && c > o && c <= MAX_CLOSE)
      .sort((a, b) => a[0] - b[0]);
    const clean = [];
    for (const r of list) if (!clean.length || r[0] >= clean[clean.length - 1][1]) clean.push(r);
    if (clean.length) out[d] = clean;
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

/** '10:00 PM' / '١٠:٠٠ م' for a minute-of-day (past midnight wraps). */
export function clock(min, l = lang()) {
  if (min === DAY) return t('st.hours.midnight');
  const m = ((min % DAY) + DAY) % DAY;
  return fmtTime(`${Math.floor(m / 60)}:${pad(m % 60)}`, l);
}

/** A short human summary: '10:00 AM – 10:00 PM' (+ second shift). */
export function rangeText(ranges, l = lang()) {
  return ranges.map(([o, c]) => `${clock(o, l)} – ${clock(c, l)}${c > DAY ? ` (${t('st.hours.next_day')})` : ''}`).join(' · ');
}

/** '6 days a week' style summary for review. */
export function hoursSummary(hrs, tn) {
  const open = [0, 1, 2, 3, 4, 5, 6].filter((d) => (hrs?.[d] || []).length);
  if (!open.length) return t('st.hours.closed');
  const days = tn('st.days', open.length);
  const first = hrs[open.find((d) => d !== 5) ?? open[0]];
  return `${t('st.hours.week', { days })} · ${rangeText(first)}`;
}

/* ---------- the editor ---------- */

function options(from, to) {
  const out = [];
  for (let m = from; m <= to; m += STEP) out.push(m);
  return out;
}

/** A styled native <select> for a time; the visible face shows the time and a "next day" tag. */
function timeSelect(label, onPick) {
  const val = h('span', { class: 'st-time__val' });
  const sel = h('select', { class: 'st-time__sel', 'aria-label': label });
  const wrap = h('label', { class: 'st-time' }, val, h('span', { class: 'st-time__chev', 'aria-hidden': 'true' }, icon('chevronDown')), sel);
  const paint = () => {
    const m = +sel.value;
    val.replaceChildren(h('span', { class: 'st-time__clock' }, clock(m)));
    if (m > DAY) val.appendChild(h('small', { class: 'st-time__tag' }, t('st.hours.next_day')));
  };
  sel.addEventListener('change', () => { onPick(+sel.value); paint(); });
  return {
    el: wrap,
    sel,
    fill(list, value) {
      const want = list.includes(value) ? value : list.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a), list[0]);
      const frag = document.createDocumentFragment();
      for (const m of list) {
        const text = m > DAY ? `${clock(m)} (${t('st.hours.next_day')})` : clock(m);
        const o = h('option', { value: String(m) }, text);
        if (m === want) o.selected = true;
        frag.appendChild(o);
      }
      sel.replaceChildren(frag);
      sel.value = String(want);
      paint();
      return want;
    },
  };
}

/**
 * The hours editor: presets + one row per weekday.
 * @param {{hours:object, memo:object, onChange:(hours:object)=>void}} opts
 *   memo keeps a closed day's last ranges so switching it back on restores them.
 */
export function hoursEditor({ hours, memo, onChange }) {
  let hrs = cloneHours(hours);
  const emit = () => { onChange(cloneHours(hrs)); syncPresets(); };

  /* presets */
  const presetBox = h('div', { class: 'st-presets', role: 'group', 'aria-label': t('st.hours.presets') },
    PRESETS.map((p) => h('button', { type: 'button', class: 'st-preset', 'data-value': p.id, 'aria-pressed': 'false' },
      h('span', { class: 'st-preset__t' }, t(`st.hp.${p.id}`)),
      h('span', { class: 'st-preset__d' }, t(`st.hp.${p.id}_d`)))));
  const presets = selectable(presetBox, {
    multi: true,
    onChange: (_v, el) => {
      const p = PRESETS.find((x) => x.id === el.dataset.value);
      hrs = cloneHours(p.hours);
      for (const d of WEEK) rows.get(d).render();
      emit();
    },
  });
  function syncPresets() { presets.set(matchPreset(hrs) || []); }

  /* day rows */
  const rows = new Map();
  for (const d of WEEK) rows.set(d, dayRow(d));

  function dayRow(d) {
    const name = t(`wd.${d}`);
    const input = h('input', { type: 'checkbox', class: 'b-switch__input', role: 'switch' });
    const sw = h('label', { class: 'b-switch st-day__switch' },
      input, h('span', { class: 'b-switch__track', 'aria-hidden': 'true' }), h('span', { class: 'b-switch__label st-day__name' }, name));
    const closed = h('span', { class: 'st-day__closed' }, t('st.hours.closed'));
    const body = h('div', { class: 'st-day__body' });
    const row = h('div', { class: 'st-day' }, h('div', { class: 'st-day__head' }, sw, closed), body);

    input.addEventListener('change', () => {
      if (input.checked) {
        const prev = memo[d] || hrs[WEEK.find((x) => hrs[x]?.length)] || [[600, 1320]];
        hrs[d] = prev.map((r) => [...r]);
      } else {
        memo[d] = hrs[d];
        delete hrs[d];
      }
      haptic();
      render();
      emit();
    });

    function render(focus) {
      const ranges = hrs[d] || [];
      const open = ranges.length > 0;
      input.checked = open;
      row.classList.toggle('is-open', open);
      if (!open) { body.replaceChildren(); return; }

      const split = ranges.length > 1;
      const s1o = timeSelect(t('st.hours.opens', { day: name }), (v) => { ranges[0][0] = v; fix('o1'); });
      const s1c = timeSelect(t('st.hours.closes', { day: name }), (v) => { ranges[0][1] = v; fix('c1'); });
      const s2o = split ? timeSelect(t('st.hours.opens2', { day: name }), (v) => { ranges[1][0] = v; fix('o2'); }) : null;
      const s2c = split ? timeSelect(t('st.hours.closes2', { day: name }), (v) => { ranges[1][1] = v; fix('c2'); }) : null;

      let memoLen = null;
      // Every select only offers times that keep the day valid, so nothing can overlap.
      function fix(changed) {
        const r1 = ranges[0];
        if (!split) {
          if (changed === 'o1') {                         // moving the opening keeps the length
            const len = Math.max(STEP, (memoLen ?? (r1[1] - r1[0])));
            r1[1] = Math.min(r1[0] + len, r1[0] + DAY, MAX_CLOSE);
          }
          memoLen = r1[1] - r1[0];
          s1o.fill(options(0, DAY - STEP), r1[0]);
          r1[1] = s1c.fill(options(r1[0] + STEP, Math.min(r1[0] + DAY, MAX_CLOSE)), r1[1]);
        } else {
          const r2 = ranges[1];
          r1[0] = s1o.fill(options(0, Math.min(r1[1] - STEP, DAY - STEP)), r1[0]);
          r1[1] = s1c.fill(options(r1[0] + STEP, r2[0]), r1[1]);
          r2[0] = s2o.fill(options(r1[1], Math.min(r2[1] - STEP, DAY - STEP)), r2[0]);
          r2[1] = s2c.fill(options(r2[0] + STEP, Math.min(r1[0] + DAY, MAX_CLOSE)), r2[1]);
        }
        if (changed) emit();
      }

      const dash = () => h('span', { class: 'st-range__dash', 'aria-hidden': 'true' }, '–');
      const lines = [h('div', { class: 'st-range' }, s1o.el, dash(), s1c.el)];
      if (split) {
        lines.push(h('div', { class: 'st-range__break', 'aria-hidden': 'true' }, h('span', null, t('st.hours.break'))));
        lines.push(h('div', { class: 'st-range' }, s2o.el, dash(), s2c.el));
      }
      const r = ranges[0];
      const canSplit = !split && r[1] - r[0] >= 180;
      const toggle = h('button', {
        type: 'button', class: 'st-link st-day__split',
        disabled: !split && !canSplit,
        onClick: () => {
          if (split) {
            hrs[d] = [[ranges[0][0], ranges[1][1]]];
          } else {
            const [o, c] = ranges[0];
            const len = c - o;
            const brk = len >= 360 ? 120 : 60;
            const mid = o + Math.round((len - brk) / 2 / STEP) * STEP;
            hrs[d] = [[o, mid], [mid + brk, c]];
          }
          haptic();
          render(true);
          emit();
        },
      }, icon(split ? 'minus' : 'plus'), h('span', null, t(split ? 'st.hours.merge' : 'st.hours.split')));
      body.replaceChildren(...lines, toggle);
      fix(null);
      if (focus) toggle.focus({ preventScroll: true });
    }

    render();
    return { el: row, render };
  }

  syncPresets();
  return h('div', { class: 'st-hours' },
    h('div', { class: 'st-hours__presets' },
      h('p', { class: 'st-label' }, t('st.hours.presets')),
      presetBox),
    h('div', { class: 'st-week' }, WEEK.map((d) => rows.get(d).el)));
}

