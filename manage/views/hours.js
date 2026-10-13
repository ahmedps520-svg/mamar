/* ==========================================================
   Opening hours — weekly per section with split shifts and
   past-midnight closing (close_min may exceed 1440), plus
   special hours with Ramadan / Eid / Closed presets.
   ========================================================== */

import {
  S, t, fmt, h, icon, on, call, errText, nm, cfg, todayISO, hhmm, tmMin, range, btn, seg, chips, field,
  switchRow, selectField, busy, toast, openSheet, loadOverview, emptyState, L, haptic,
} from '../core.js';
import { confirmDelete } from './prices.js';

const ORDER = [0, 1, 2, 3, 4, 5, 6];   // Sunday first, as the Saudi working week
const toMin = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Time-range editor rows for a list of [open, close] (close may run past midnight). */
function rangesEditor(ranges, onChange) {
  const box = h('div', { class: 'mg-ranges' });
  const paint = () => {
    box.replaceChildren(...ranges.map((r, i) => {
      const o = h('input', { type: 'time', class: 'b-field__input mg-time', step: 300, value: hhmm(r[0]), 'aria-label': t('mg.h.open_at') });
      const c = h('input', { type: 'time', class: 'b-field__input mg-time', step: 300, value: hhmm(r[1]), 'aria-label': t('mg.h.close_at') });
      const tag = h('span', { class: 'mg-nextday', hidden: r[1] <= 1440 }, t('mg.h.next_day'));
      const sync = () => {
        const a = toMin(o.value);
        let z = toMin(c.value);
        if (a == null || z == null) return;
        if (z <= a) z += 1440;            // closes after midnight
        r[0] = a;
        r[1] = z;
        tag.hidden = z <= 1440;
        onChange();
      };
      o.addEventListener('change', sync);
      c.addEventListener('change', sync);
      return h('div', { class: 'mg-range' },
        h('span', { class: 'b-field__box mg-timebox' }, o),
        h('span', { class: 'mg-range__dash', 'aria-hidden': 'true' }, '–'),
        h('span', { class: 'b-field__box mg-timebox mg-timebox--close' }, c, tag),
        h('button', {
          type: 'button', class: 'b-iconbtn mg-range__x', 'aria-label': t('mg.h.remove_shift'),
          onClick: () => { ranges.splice(i, 1); haptic(); paint(); onChange(); },
        }, icon('close')));
    }));
  };
  paint();
  box.repaint = paint;
  return box;
}

function validate(byDay) {
  for (const d of ORDER) {
    const rs = (byDay.get(d) || []).slice().sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < rs.length; i++) {
      if (rs[i][1] <= rs[i][0]) return t('mg.h.bad', { day: t(`wd.${d}`) });
      if (i && rs[i][0] < rs[i - 1][1]) return t('mg.h.overlap', { day: t(`wd.${d}`) });
    }
  }
  return null;
}

export function mount(main) {
  const ov = () => S.ov;
  let section = ov().sections[0]?.id || null;
  let byDay = null;
  let dirty = false;

  const root = h('div', { class: 'mg-hours' });
  main.replaceChildren(root);
  const weekBox = h('div', { class: 'mg-week' });
  const specialBox = h('div', { class: 'mg-special' });
  const bar = h('div', { class: 'mg-savebar', hidden: true, role: 'region', 'aria-label': t('mg.h.unsaved') });
  const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });

  const secSeg = cfg().sections && ov().sections.length > 1
    ? seg(ov().sections.map((s) => ({ value: s.id, label: nm(s) })), section, (v) => { section = v; load(); paintWeek(); }, { label: t('mg.svc.section') })
    : null;

  function load() {
    byDay = new Map(ORDER.map((d) => [d, []]));
    for (const x of ov().hours.filter((x) => x.section_id === section)) byDay.get(x.weekday).push([x.open_min, x.close_min]);
    for (const d of ORDER) byDay.get(d).sort((a, b) => a[0] - b[0]);
    setDirty(false);
  }
  function setDirty(v) {
    dirty = v;
    bar.hidden = !v;
    root.classList.toggle('has-savebar', v);
  }

  function dayCard(d) {
    const ranges = byDay.get(d);
    const editor = rangesEditor(ranges, () => setDirty(true));
    const open = switchEl2(ranges.length > 0, (v) => {
      if (v && !ranges.length) ranges.push([600, 1320]);
      if (!v) ranges.splice(0, ranges.length);
      editor.repaint();
      card.classList.toggle('is-closed', !ranges.length);
      setDirty(true);
    }, t(`wd.${d}`));
    const card = h('div', { class: ['mg-day', !ranges.length && 'is-closed'] },
      h('div', { class: 'mg-day__head' },
        h('span', { class: 'mg-day__name' }, t(`wd.${d}`)),
        h('span', { class: 'mg-day__state' }, ranges.length ? '' : t('mg.h.closed_day')),
        open),
      editor,
      h('div', { class: 'mg-day__foot' },
        btn(t('mg.h.add_shift'), {
          kind: 'quiet', icon: 'plus',
          onClick: () => {
            const last = ranges[ranges.length - 1];
            const start = last ? Math.min(last[1] + 60, 1380) : 600;
            ranges.push([start % 1440, Math.min(start + 240, 2880)]);
            open.input.checked = true;
            card.classList.remove('is-closed');
            editor.repaint();
            setDirty(true);
          },
        }),
        btn(t('mg.h.copy_all'), {
          kind: 'quiet',
          onClick: () => {
            for (const o of ORDER) if (o !== d) byDay.set(o, ranges.map((r) => [...r]));
            setDirty(true);
            paintWeek();
            toast(t('mg.h.copied', { day: t(`wd.${d}`) }), { kind: 'info' });
          },
        })));
    return card;
  }

  function paintWeek() {
    weekBox.replaceChildren(...ORDER.map(dayCard));
  }

  async function save(button) {
    msg.hidden = true;
    const err = validate(byDay);
    if (err) { msg.textContent = err; msg.hidden = false; msg.scrollIntoView({ block: 'nearest' }); return; }
    const hours = [];
    for (const d of ORDER) for (const [o, c] of byDay.get(d)) hours.push({ weekday: d, open_min: o, close_min: c });
    await busy(button, async () => {
      try {
        await call('own_hours_set', { section_id: section, hours }, { quiet: true });
        toast(t('mg.h.saved'), { kind: 'ok' });
        setDirty(false);
        await loadOverview();
      } catch (e) { msg.textContent = errText(e); msg.hidden = false; }
    });
  }
  const saveBtn = btn(t('mg.h.save'), { kind: 'primary', size: null, onClick: (e) => save(e.currentTarget) });
  bar.append(h('span', { class: 'mg-savebar__text' }, t('mg.h.unsaved')),
    btn(t('mg.h.discard'), { kind: 'quiet', onClick: () => { load(); paintWeek(); } }), saveBtn);

  /* ---------- special hours ---------- */

  function paintSpecial() {
    const items = (ov().special_hours || []).filter((x) => x.to_date >= todayISO())
      .sort((a, b) => a.from_date.localeCompare(b.from_date));
    specialBox.replaceChildren(
      h('div', { class: 'mg-sechead' },
        h('div', { class: 'mg-sechead__text' },
          h('h2', { class: 'mg-sechead__title' }, t('mg.h.special')),
          h('p', { class: 'mg-sechead__sub' }, t('mg.h.special_hint'))),
        btn(t('add'), { kind: 'ghost', icon: 'plus', onClick: () => openSpecial(null) })),
      items.length
        ? h('div', { class: 'b-list' }, items.map((x) => h('button', { type: 'button', class: 'b-row', onClick: () => openSpecial(x) },
          h('span', { class: 'b-row__lead' }, icon(x.ranges?.length ? 'clock' : 'close')),
          h('span', { class: 'b-row__main' },
            h('span', { class: 'b-row__title' }, nm(x, 'label') || t('mg.h.special_new')),
            h('span', { class: 'b-row__sub' }, `${dateSpan(x.from_date, x.to_date)} · ${x.ranges?.length ? x.ranges.map((r) => range(tmMin(r[0]), tmMin(r[1]))).join(' · ') : t('mg.h.closed_all')}`)),
          icon('forward', { class: 'b-row__chev' }))))
        : h('p', { class: 'mg-fine mg-pad' }, t('mg.h.special_none')));
  }

  load();
  root.append(...[
    secSeg && h('div', { class: 'mg-pad-b' }, secSeg),
    h('div', { class: 'mg-sechead' }, h('div', { class: 'mg-sechead__text' }, h('h2', { class: 'mg-sechead__title' }, t('mg.h.weekly')))),
    weekBox, msg, specialBox, bar,
  ].filter(Boolean));
  paintWeek();
  paintSpecial();

  const offs = [on('overview', () => { if (!dirty) { load(); paintWeek(); } paintSpecial(); })];
  return () => offs.forEach((f) => f());
}

function switchEl2(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', class: 'b-switch__input', role: 'switch', checked, 'aria-label': `${label} · ${t('open')}` });
  input.addEventListener('change', () => { haptic(); onChange(input.checked); });
  const el = h('span', { class: 'b-switch' }, input, h('span', { class: 'b-switch__track', 'aria-hidden': 'true' }));
  el.input = input;
  return el;
}

function dateSpan(a, b) {
  return a === b ? fmt.dateShort(a, L(), { weekday: true }) : t('mg.h.days_range', { from: fmt.dateShort(a, L()), to: fmt.dateShort(b, L()) });
}

/** Next date range (from today) whose Hijri month/day match. */
function nextHijri(test, len = 400) {
  let start = null;
  let end = null;
  for (let i = 0; i < len; i++) {
    const d = fmt.addDaysISO(todayISO(), i);
    const p = fmt.hijriParts(d);
    if (!p) return null;
    if (test(p)) { if (!start) start = d; end = d; } else if (start) break;
  }
  return start ? [start, end] : null;
}

function presetFor(kind) {
  if (kind === 'ramadan') {
    const r = nextHijri((p) => p.month === 9);
    return { from: r?.[0], to: r?.[1], ranges: [[780, 1020], [1260, 1620]], ar: t('mg.h.lbl_ramadan', null, 'ar'), en: t('mg.h.lbl_ramadan', null, 'en') };
  }
  if (kind === 'eid') {
    const fitr = nextHijri((p) => p.month === 10 && p.day <= 3);
    const adha = nextHijri((p) => p.month === 12 && p.day >= 10 && p.day <= 13);
    const r = [fitr, adha].filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]))[0];
    return { from: r?.[0], to: r?.[1], ranges: [[960, 1440]], ar: t('mg.h.lbl_eid', null, 'ar'), en: t('mg.h.lbl_eid', null, 'en') };
  }
  if (kind === 'closed') {
    const d = fmt.addDaysISO(todayISO(), 1);
    return { from: d, to: d, ranges: [], ar: t('mg.h.lbl_closed', null, 'ar'), en: t('mg.h.lbl_closed', null, 'en') };
  }
  return null;
}

function openSpecial(x0) {
  const x = x0 ? { ...x0, ranges: (x0.ranges || []).map((r) => [Number(r[0]), Number(r[1])]) }
    : { id: null, from_date: fmt.addDaysISO(todayISO(), 1), to_date: fmt.addDaysISO(todayISO(), 1), ranges: [[600, 1320]], label_ar: '', label_en: '', section_id: null };
  return openSheet({
    title: x0 ? (nm(x0, 'label') || t('mg.h.special_new')) : t('mg.h.add_special'),
    wide: true,
    build: (ctx) => {
      const fromD = h('input', { type: 'date', class: 'b-field__input mg-date', value: x.from_date, 'aria-label': t('mg.h.from_date') });
      const toD = h('input', { type: 'date', class: 'b-field__input mg-date', value: x.to_date, 'aria-label': t('mg.h.to_date') });
      const labelAr = field({ label: t('mg.h.label_ar'), value: x.label_ar, maxlength: 60, dir: 'rtl' });
      const labelEn = field({ label: t('mg.h.label_en'), value: x.label_en, maxlength: 60, dir: 'ltr' });
      const editor = rangesEditor(x.ranges, () => {});
      const closedSw = switchRow({
        label: t('mg.h.closed_all'), checked: !x.ranges.length,
        onChange: (v) => { if (v) x.ranges.splice(0); else if (!x.ranges.length) x.ranges.push([600, 1320]); editor.repaint(); rangeBox.hidden = v; },
      });
      const add = btn(t('mg.h.add_shift'), { kind: 'quiet', icon: 'plus', onClick: () => { const l = x.ranges[x.ranges.length - 1]; const s = l ? Math.min(l[1] + 60, 1380) % 1440 : 600; x.ranges.push([s, s + 240]); editor.repaint(); } });
      const rangeBox = h('div', { class: 'mg-stack', hidden: !x.ranges.length }, editor, add);
      const section = cfg().sections && S.ov.sections.length > 1 ? selectField({
        label: t('mg.svc.section'), value: x.section_id || '',
        options: [{ value: '', label: t('mg.svc.all_sections') }, ...S.ov.sections.map((s) => ({ value: s.id, label: nm(s) }))],
        onChange: (v) => { x.section_id = v || null; },
      }) : null;
      const presets = x0 ? null : chips([
        { value: 'ramadan', label: t('mg.h.preset_ramadan') },
        { value: 'eid', label: t('mg.h.preset_eid') },
        { value: 'closed', label: t('mg.h.preset_closed') },
        { value: 'custom', label: t('mg.h.preset_custom') },
      ], 'custom', (v) => {
        const p = presetFor(v);
        if (!p) return;
        if (p.from) { fromD.value = p.from; toD.value = p.to; }
        labelAr.input.value = p.ar;
        labelEn.input.value = p.en;
        x.ranges.splice(0, x.ranges.length, ...p.ranges.map((r) => [...r]));
        closedSw.input.checked = !x.ranges.length;
        rangeBox.hidden = !x.ranges.length;
        editor.repaint();
      }, { label: t('mg.h.preset') });

      const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
      const save = btn(t('save'), { kind: 'primary', size: null, block: true });
      save.addEventListener('click', () => busy(save, async () => {
        msg.hidden = true;
        if (!fromD.value || !toD.value || toD.value < fromD.value) { msg.textContent = t('mg.h.bad_dates'); msg.hidden = false; return; }
        const bad = x.ranges.find((r) => r[1] <= r[0]);
        if (bad) { msg.textContent = t('mg.block.bad'); msg.hidden = false; return; }
        try {
          await call('own_special_hours_upsert', {
            item: {
              id: x.id || undefined, section_id: x.section_id || null, from_date: fromD.value, to_date: toD.value,
              ranges: x.ranges.slice().sort((a, b) => a[0] - b[0]), label_ar: labelAr.input.value.trim(), label_en: labelEn.input.value.trim(),
            },
          }, { quiet: true });
          toast(t('mg.h.special_saved'), { kind: 'ok' });
          loadOverview();
          ctx.close(true);
        } catch (e) { msg.textContent = errText(e); msg.hidden = false; }
      }));

      const form = h('div', { class: 'mg-step mg-form' },
        presets && h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label', tabindex: '-1', 'data-step-focus': '' }, t('mg.h.preset')), presets),
        h('div', { class: 'mg-two' },
          h('label', { class: 'mg-forcebox__row mg-col' }, h('span', null, t('mg.h.from_date')), h('span', { class: 'b-field__box mg-timebox' }, fromD)),
          h('label', { class: 'mg-forcebox__row mg-col' }, h('span', null, t('mg.h.to_date')), h('span', { class: 'b-field__box mg-timebox' }, toD))),
        closedSw, rangeBox, section,
        h('div', { class: 'mg-two' }, labelAr, labelEn),
        msg,
        h('div', { class: 'mg-sheetactions' }, save,
          x0 && btn(t('delete'), {
            kind: 'quiet', size: null, block: true, danger: true,
            onClick: () => ctx.swap(confirmDelete(ctx, nm(x0, 'label') || dateSpan(x0.from_date, x0.to_date), async () => {
              await call('own_special_hours_delete', { id: x0.id });
              toast(t('mg.deleted'), { kind: 'ok' });
              loadOverview();
              ctx.close(true);
            }, () => ctx.swap(form, 'back'))),
          })));
      return form;
    },
  });
}

export const title = () => t('mg.more.hours');
export { emptyState };
