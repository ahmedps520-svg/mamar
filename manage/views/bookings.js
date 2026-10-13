/* ==========================================================
   Bookings — day / week views, filters, search, bulk cancel.
   ========================================================== */

import {
  S, t, tn, fmt, h, icon, on, call, nm, fm, tm, dg, todayISO, dayOf, customer, pill, isLive, service,
  resourceById, emptyState, btn, seg, chips, selectField, busy, L, touched, toast, pref, haptic,
} from '../core.js';
import { skeleton, confirmDialog } from '../../platform/ui/kit.js';
import { openBooking } from './booking.js';

const STATUSES = [
  { value: 'all', key: 'mg.bks.all' },
  { value: 'confirmed', key: 'status.confirmed' },
  { value: 'pending_payment', key: 'mg.st.pending_payment' },
  { value: 'completed', key: 'status.completed' },
  { value: 'no_show', key: 'status.no_show' },
  { value: 'cancelled', key: 'status.cancelled' },
];

/** Sunday-first week containing day. */
const weekStart = (day) => fmt.addDaysISO(day, -fmt.riyadhParts(day).weekday);

export function mount(main) {
  const st = {
    mode: pref.get('mamar-manage-bksmode', 'day'),
    day: todayISO(),
    status: 'all',
    service: '',
    q: '',
    selecting: false,
    sel: new Set(),
    data: null,
    search: null,       // {at, bookings} — wide window for search
  };

  const root = h('div', { class: 'mg-bookings' });
  main.replaceChildren(root);

  const modeSeg = seg([{ value: 'day', label: t('mg.bks.day') }, { value: 'week', label: t('mg.bks.week') }], st.mode,
    (v) => { st.mode = v; pref.set('mamar-manage-bksmode', v); load(); }, { label: t('mg.view.label'), block: false, small: true });
  const label = h('button', { type: 'button', class: 'mg-datenav__label' });
  const picker = h('input', { type: 'date', class: 'mg-hiddenpick', tabindex: '-1', 'aria-hidden': 'true' });
  label.addEventListener('click', () => { picker.value = st.day; try { picker.showPicker(); } catch { picker.focus(); picker.click(); } });
  picker.addEventListener('change', () => { if (picker.value) { st.day = picker.value; load(); } });
  const prev = h('button', { type: 'button', class: 'b-iconbtn mg-datenav__arrow', 'aria-label': t('mg.bks.prev'), onClick: () => shift(-1) }, icon('back'));
  const next = h('button', { type: 'button', class: 'b-iconbtn mg-datenav__arrow', 'aria-label': t('mg.bks.next'), onClick: () => shift(1) }, icon('forward'));
  const todayChip = h('button', { type: 'button', class: 'b-chip mg-todaychip', onClick: () => { st.day = todayISO(); load(); } }, t('today'));
  const selectBtn = btn(t('mg.bks.select'), { kind: 'quiet', onClick: () => setSelecting(!st.selecting) });

  const search = h('input', {
    type: 'search', class: 'mg-search__input', placeholder: t('mg.bks.search'), 'aria-label': t('mg.bks.search'),
    autocomplete: 'off', enterkeyhint: 'search',
  });
  let qTimer = null;
  search.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { st.q = search.value.trim(); paint(); if (st.q) loadSearch(); }, 180); });

  const statusChips = chips(STATUSES.map((s) => ({ value: s.value, label: t(s.key) })), st.status,
    (v) => { st.status = v || 'all'; paint(); }, { label: t('mg.bks.status'), scroll: true });
  const svcSel = selectField({
    label: t('service'), value: '',
    options: [{ value: '', label: t('mg.bks.all_services') }, ...(S.ov?.services || []).map((s) => ({ value: s.id, label: nm(s) }))],
    onChange: (v) => { st.service = v; paint(); },
  });
  svcSel.classList.add('mg-svcfilter');

  const list = h('div', { class: 'mg-bklist', 'aria-live': 'polite' });
  const bar = h('div', { class: 'mg-bulkbar', hidden: true });

  root.append(
    h('div', { class: 'mg-pagehead' },
      h('h1', { class: 'mg-pagehead__title' }, t('mg.bks.title')),
      selectBtn),
    h('div', { class: 'mg-bktools' },
      h('div', { class: 'mg-datenav' }, modeSeg, h('div', { class: 'mg-datenav__group' }, prev, label, next), todayChip, picker),
      h('label', { class: 'mg-search' }, searchIcon(), search),
      h('div', { class: 'mg-filters' }, statusChips, svcSel)),
    list, bar);

  function shift(n) {
    st.day = fmt.addDaysISO(st.day, n * (st.mode === 'week' ? 7 : 1));
    load();
  }
  function span() {
    if (st.mode === 'week') { const a = weekStart(st.day); return [a, fmt.addDaysISO(a, 6)]; }
    return [st.day, st.day];
  }
  function paintLabel() {
    const [a, z] = span();
    if (st.mode === 'week') {
      label.textContent = `${fmt.dateShort(a, L())} – ${fmt.dateShort(z, L())}`;
    } else {
      const d = fmt.daysFromToday(st.day);
      const word = d === 0 ? t('today') : d === 1 ? t('tomorrow') : d === -1 ? t('yesterday') : fmt.weekday(st.day, L());
      label.replaceChildren(h('b', null, word), h('span', null, fmt.dateShort(st.day, L())));
    }
    todayChip.hidden = st.mode === 'day' ? st.day === todayISO() : weekStart(st.day) === weekStart(todayISO());
  }

  let seq = 0;
  async function load() {
    paintLabel();
    const my = ++seq;
    const [from, to] = span();
    if (!st.data) list.replaceChildren(skeleton(4));
    list.setAttribute('aria-busy', 'true');
    try {
      const r = await call('own_bookings', { from, to }, { quiet: true });
      if (my !== seq) return;
      st.data = { from, to, bookings: r.bookings || [] };
      paint();
    } catch (e) {
      if (my !== seq) return;
      list.replaceChildren(emptyState('alert', t('mg.load_failed'), null, btn(t('retry'), { onClick: load })));
    } finally {
      if (my === seq) list.removeAttribute('aria-busy');
    }
  }
  async function loadSearch(force) {
    if (st.search && !force && Date.now() - st.search.at < 60000) return;
    const from = fmt.addDaysISO(todayISO(), -60);
    const to = fmt.addDaysISO(todayISO(), 30);
    try {
      const r = await call('own_bookings', { from, to }, { quiet: true });
      st.search = { at: Date.now(), bookings: r.bookings || [] };
      if (st.q) paint();
    } catch { /* keep the day's results */ }
  }

  function matches(b, q) {
    const ql = q.toLowerCase();
    const qd = fmt.toLatin(q).replace(/\D/g, '');
    if ((b.name || '').toLowerCase().includes(ql)) return true;
    if ((b.ref || '').toLowerCase().includes(ql.replace(/\s/g, ''))) return true;
    if (qd.length >= 3) {
      const p = (b.phone || '').replace(/\D/g, '');
      const local = p.startsWith('966') ? `0${p.slice(3)}` : p;
      if (p.includes(qd) || local.includes(qd)) return true;
    }
    return false;
  }

  function filtered() {
    const searching = !!st.q;
    let src = searching ? (st.search?.bookings || st.data?.bookings || []) : (st.data?.bookings || []);
    if (searching) src = src.filter((b) => matches(b, st.q));
    if (st.status !== 'all') src = src.filter((b) => b.status === st.status);
    if (st.service) src = src.filter((b) => b.service_id === st.service);
    return src.slice().sort((a, b) => (searching ? b.starts_at.localeCompare(a.starts_at) : a.starts_at.localeCompare(b.starts_at)));
  }

  function row(b) {
    const selected = st.sel.has(b.id);
    const staff = nm(b, 'staff_label') || (b.resource_id ? nm(resourceById(b.resource_id), 'label') : '');
    const canSelect = st.selecting && isLive(b);
    const [time, period] = tm(b.starts_at).split(' ');
    const el = h('button', {
      type: 'button',
      class: ['b-row', 'mg-bkrow', st.selecting && 'is-selecting', selected && 'is-selected', !isLive(b) && 'is-past'],
      role: st.selecting ? 'checkbox' : null,
      'aria-checked': st.selecting ? String(selected) : null,
      disabled: st.selecting && !canSelect,
      'data-id': b.id,
      onClick: () => {
        if (!st.selecting) { openBooking(b); return; }
        if (st.sel.has(b.id)) st.sel.delete(b.id); else st.sel.add(b.id);
        haptic();
        paint();
      },
    },
      st.selecting && h('span', { class: 'mg-check', 'aria-hidden': 'true' }, icon('check')),
      h('span', { class: 'mg-timecell' }, h('b', null, time), h('small', null, period)),
      h('span', { class: 'b-row__main' },
        h('span', { class: 'b-row__title mg-name', dir: 'auto' }, customer(b)),
        h('span', { class: 'b-row__sub' }, [nm(b, 'service_name'), staff, b.qty > 1 ? `× ${dg(b.qty)}` : ''].filter(Boolean).join(' · '))),
      h('span', { class: 'b-row__end mg-bkrow__end' }, pill(b.status), h('span', { class: 'mg-bkrow__price' }, fm(b.total_halalas, { free: true }))));
    return el;
  }

  function paint() {
    if (!st.data && !st.search) return;
    const items = filtered();
    const searching = !!st.q;
    const groups = new Map();
    for (const b of items) {
      const d = dayOf(b.starts_at);
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(b);
    }
    const kids = [];
    if (searching) kids.push(h('p', { class: 'mg-fine' }, `${t('mg.bks.results')} · ${t('mg.bks.search_scope')}`));
    if (!items.length) {
      kids.push(emptyState(searching ? 'inbox' : 'calendar', searching ? t('mg.bks.no_match') : t('mg.bks.none'), searching ? null : t('mg.bks.none_text')));
    }
    for (const [d, list0] of groups) {
      const word = fmt.daysFromToday(d) === 0 ? t('today') : fmt.weekday(d, L());
      kids.push(h('section', { class: 'mg-daygroup' },
        h('h2', { class: 'mg-daygroup__head' },
          h('span', null, `${word} · ${fmt.dateShort(d, L())}`),
          h('small', null, tn('bookings', list0.filter((b) => b.status !== 'cancelled').length))),
        h('div', { class: 'b-list' }, list0.map(row))));
    }
    list.replaceChildren(...kids);
    paintBar();
  }

  function setSelecting(on) {
    st.selecting = on;
    st.sel.clear();
    selectBtn.querySelector('span').textContent = on ? t('done') : t('mg.bks.select');
    selectBtn.setAttribute('aria-pressed', String(on));
    paint();
  }

  function paintBar() {
    bar.hidden = !st.selecting;
    if (!st.selecting) return;
    const n = st.sel.size;
    const cancel = btn(t('mg.bks.cancel_n', { n }), { kind: 'primary', size: null, danger: true, disabled: !n });
    cancel.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: t('mg.bks.bulk_title', { n }), message: t('mg.bks.bulk_text'),
        confirm: t('mg.cancel.yes'), cancel: t('mg.cancel.keep'), danger: true,
      });
      if (!ok) return;
      await busy(cancel, async () => {
        const ids = [...st.sel];
        ids.forEach((id) => S.mine.add(id));
        const r = await call('own_booking_bulk_cancel', { booking_ids: ids });
        toast(t('mg.bks.bulk_done', { n: r.cancelled }), { kind: 'ok' });
        setSelecting(false);
        touched();
        st.search = null;
        load();
      }).catch(() => {});
    });
    bar.replaceChildren(h('span', { class: 'mg-bulkbar__n' }, t('mg.bks.selected_n', { n })), cancel);
  }

  load();
  const offs = [
    on('window', () => { st.search = null; load(); if (st.q) loadSearch(true); }),
  ];
  return () => offs.forEach((f) => f());
}

function searchIcon() {
  return h('svg', { viewBox: '0 0 24 24', class: 'b-icon mg-search__icon', 'aria-hidden': 'true', focusable: 'false' },
    h('circle', { cx: 11, cy: 11, r: 6.5 }), h('path', { d: 'M16 16l4 4' }));
}

export const title = () => t('mg.tab.bookings');
export { service };
