/* ==========================================================
   Booking sheet, move, new (walk-in / phone) booking and
   block time — shared by Today and Bookings.
   ========================================================== */

import {
  S, t, fmt, h, icon, toast, haptic, call, errText, touched, service, staffById, resourceById, activeStaff,
  activeResources, nm, fm, tm, dg, todayISO, dayOf, minOf, atMin, hhmm, tmMin, nowMin, range, dur, when, dayWord,
  dateWithHijri, customer, pill, isLive, openSheet, btn, busy, field, seg, chips, stepper, switchRow, telUrl,
  bizName, cfg, dayRangesAll, dayRanges, L, phoneText,
} from '../core.js';
import { selectable } from '../../platform/ui/kit.js';

/* ---------- small pieces ---------- */

const kvRow = (k, v, cls) => v == null || v === '' ? null
  : h('div', { class: ['b-kv__row', cls] }, h('dt', { class: 'b-kv__k' }, k), h('dd', { class: 'b-kv__v' }, v));

const backBtn = (onClick) => h('button', { type: 'button', class: 'mg-stepback', onClick },
  icon('back'), h('span', null, t('back')));

function stepEl(...kids) {
  return h('div', { class: 'mg-step' }, ...kids);
}

/** A 14-day date strip (b-dates) with today first. */
export function dateStrip({ value, from = todayISO(), days = 21, onChange, disabled }) {
  const list = Array.from({ length: days }, (_, i) => fmt.addDaysISO(from, i));
  if (value && !list.includes(value) && value < from) list.unshift(value);
  const today = todayISO();
  const showHijri = cfg().hijri !== false;
  const strip = h('div', { class: 'b-dates mg-dates', 'aria-label': t('date') }, list.map((d) =>
    h('button', {
      type: 'button', class: ['b-date', d === today && 'is-today'], 'data-value': d,
      'aria-checked': d === value, disabled: disabled?.(d) || null,
      'aria-label': dateWithHijri(d),
    },
      h('span', { class: 'b-date__wd' }, d === today ? t('today') : fmt.weekday(d, L(), true)),
      h('span', { class: 'b-date__d' }, dg(fmt.riyadhParts(d).day)),
      h('span', { class: 'b-date__h' }, showHijri ? fmt.hijriShort(d, L()) : fmt.dateShort(d, L()).split(' ').slice(1).join(' ')))));
  selectable(strip, { onChange });
  requestAnimationFrame(() => strip.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
  return strip;
}

/** Slots grouped into morning / afternoon / evening (b-slots). */
function slotGrid(slots, dayISO, { value, onPick }) {
  const groups = [
    { key: 'morning', test: (m) => m < 720 },
    { key: 'afternoon', test: (m) => m >= 720 && m < 1020 },
    { key: 'evening', test: (m) => m >= 1020 },
  ];
  const wrap = h('div', { class: 'b-slots mg-slots' });
  for (const g of groups) {
    const items = slots.filter((s) => g.test(minOf(s.t, dayISO)));
    if (!items.length) continue;
    const grid = h('div', { class: 'b-slots__grid', role: 'radiogroup', 'aria-label': t(g.key) },
      items.map((s) => h('button', {
        type: 'button', class: 'b-slot', 'data-value': s.t, 'aria-checked': s.t === value,
      }, tm(s.t))));
    selectable(grid, { onChange: (v) => { for (const other of wrap.querySelectorAll('.b-slot[aria-checked="true"]')) if (other.dataset.value !== v) other.setAttribute('aria-checked', 'false'); onPick(v); } });
    wrap.appendChild(h('div', { class: 'b-slots__group' }, h('div', { class: 'b-slots__label' }, t(g.key)), grid));
  }
  return wrap;
}

/** Inline confirm step inside an open sheet (no stacked dialogs). */
function confirmStep(ctx, { title, text, yes, no, danger = true, onYes, onNo }) {
  const yesBtn = btn(yes, { kind: 'primary', size: null, block: true, danger });
  yesBtn.addEventListener('click', () => busy(yesBtn, onYes));
  return stepEl(
    h('div', { class: 'mg-confirm' },
      h('div', { class: ['mg-confirm__mark', danger && 'is-danger'] }, icon('alert')),
      h('h3', { class: 'mg-confirm__title', tabindex: '-1', 'data-step-focus': '' }, title),
      text && h('p', { class: 'mg-confirm__text' }, text)),
    h('div', { class: 'mg-sheetactions' },
      yesBtn,
      btn(no || t('cancel'), { kind: 'ghost', size: null, block: true, onClick: onNo })));
}

/* ---------- booking detail ---------- */

export function openBooking(b) {
  return openSheet({ title: customer(b), build: (ctx) => detail(b, ctx) });
}

function payWarnings(b) {
  const out = [];
  if (b.pay_flag) {
    out.push(h('div', { class: 'mg-alert mg-alert--err', role: 'note' }, icon('alert'),
      h('span', null, ['amount_mismatch', 'needs_refund'].includes(b.pay_flag) ? t(`mg.flag.${b.pay_flag}`) : t('mg.flag.other'))));
  }
  if (b.status === 'pending_payment') {
    const left = b.hold_until ? Math.ceil((new Date(b.hold_until) - Date.now()) / 60000) : null;
    out.push(h('div', { class: 'mg-alert mg-alert--warn', role: 'note' }, icon('clock'),
      h('span', null, t('mg.pending_pay'), ' · ',
        b.hold_until ? t('mg.hold_until', { time: tm(b.hold_until) }) : '',
        left != null ? ` · ${left > 0 ? t('mg.hold_left', { mins: dur(left) }) : t('mg.hold_over')}` : '')));
  }
  return out;
}

function detail(b, ctx) {
  const svc = service(b.service_id);
  const day = dayOf(b.starts_at);
  const staff = b.staff_id ? (nm(b, 'staff_label') || nm(staffById(b.staff_id), 'label')) : null;
  const res = b.resource_id ? nm(resourceById(b.resource_id), 'label') : null;
  const src = t(`mg.bk.src.${b.source}`);
  const phone = b.phone ? phoneText(b.phone) : null;
  const tel = telUrl(b.phone);
  const wa = b.phone ? fmt.whatsappUrl(b.phone, t('mg.wa.msg', { name: customer(b), biz: bizName(), when: when(b.starts_at) }, b.lang === 'en' ? 'en' : 'ar')) : null;
  const paidLeft = Math.max(0, (b.total_halalas || 0) - (b.paid_halalas || 0));

  const set = async (status, doneKey) => {
    S.mine.add(b.id);
    const row = await call('own_booking_status', { booking_id: b.id, status });
    haptic(10);
    toast(t(doneKey), { kind: status === 'cancelled' || status === 'no_show' ? 'info' : 'ok' });
    touched(row?.id || b.id);
    ctx.close(row);
  };

  const actions = [];
  if (isLive(b)) {
    actions.push(
      btn(t('mg.act.complete'), { kind: 'primary', size: null, icon: 'check', onClick: (e) => busy(e.currentTarget, () => set('completed', 'mg.done.completed')).catch(() => {}) }),
      btn(t('mg.act.move'), { kind: 'ghost', size: null, icon: 'calendar', onClick: () => { ctx.setTitle(t('mg.move.title')); ctx.swap(moveStep(b, ctx)); } }),
      btn(t('mg.act.noshow'), { kind: 'ghost', size: null, icon: 'user', onClick: (e) => busy(e.currentTarget, () => set('no_show', 'mg.done.no_show')).catch(() => {}) }),
      btn(t('mg.act.cancel'), {
        kind: 'ghost', size: null, icon: 'close', danger: true,
        onClick: () => ctx.swap(confirmStep(ctx, {
          title: t('mg.cancel.title'), text: t('mg.cancel.text'), yes: t('mg.cancel.yes'), no: t('mg.cancel.keep'),
          onYes: () => set('cancelled', 'mg.done.cancelled').catch(() => {}),
          onNo: () => ctx.swap(detail(b, ctx), 'back'),
        })),
      }));
  } else {
    actions.push(btn(t('mg.act.restore'), { kind: 'ghost', size: null, icon: 'check', onClick: (e) => busy(e.currentTarget, () => set('confirmed', 'mg.done.confirmed')).catch(() => {}) }));
  }

  return stepEl(
    h('div', { class: 'mg-bkhead' },
      pill(b.status),
      h('span', { class: 'mg-bkhead__ref b-mono', dir: 'ltr' }, b.ref),
      h('span', { class: 'mg-bkhead__src' }, src)),
    ...payWarnings(b),
    h('dl', { class: 'b-kv mg-kv' },
      kvRow(t('service'), nm(b, 'service_name') || nm(svc)),
      kvRow(t('date'), dateWithHijri(day, { year: false })),
      kvRow(t('time'), range(tm(b.starts_at), tm(b.ends_at))),
      staff && kvRow(t('mg.bk.with'), staff),
      !staff && !res && svc?.mode === 'staff' && kvRow(t('mg.bk.with'), t('mg.unassigned')),
      res && kvRow(t('mg.bk.place'), res),
      b.qty > 1 && kvRow(t('mg.bk.party'), dg(b.qty)),
      b.location === 'mobile' && kvRow(t('mg.bk.location'), [t('mg.bk.loc_mobile'), b.address ? ` · ${b.address}` : '']),
      phone && kvRow(t('phone'), h('span', { dir: 'ltr' }, phone)),
      b.discount_halalas > 0 && kvRow(t('price'), h('span', { class: 'b-strike' }, fm(b.price_halalas))),
      b.discount_halalas > 0 && kvRow(t('mg.bk.discount'), `− ${fm(b.discount_halalas)}`),
      b.fee_halalas > 0 && kvRow(t('mg.bk.fee'), fm(b.fee_halalas)),
      b.paid_halalas > 0 && kvRow(t('mg.bk.paid'), fm(b.paid_halalas)),
      b.paid_halalas > 0 && paidLeft > 0 && kvRow(t('mg.bk.balance'), fm(paidLeft)),
      kvRow(t('total'), fm(b.total_halalas, { free: true }), 'b-kv__row--total')),
    b.note && h('div', { class: 'mg-note' }, h('span', { class: 'mg-note__k' }, t('mg.bk.note')), h('p', null, b.note)),
    b.status === 'cancelled' && b.cancel_reason && !['owner', 'owner_bulk', 'customer'].includes(b.cancel_reason)
      && h('p', { class: 'mg-muted' }, t('mg.bk.reason', { reason: b.cancel_reason })),
    h('div', { class: 'mg-contact', role: 'group', 'aria-label': t('mg.act.contact') },
      tel ? h('a', { class: 'b-btn b-btn--ghost mg-contact__btn', href: tel }, icon('phone'), h('span', null, t('call')))
        : h('span', { class: 'mg-muted mg-contact__none' }, t('mg.act.no_phone')),
      wa && h('a', { class: 'b-btn b-btn--ghost mg-contact__btn', href: wa, target: '_blank', rel: 'noopener' }, waIcon(), h('span', null, t('whatsapp')))),
    h('div', { class: 'mg-actgrid' }, actions),
    h('div', { class: 'mg-sheetactions' },
      btn(t('mg.edit.open'), { kind: 'quiet', size: null, block: true, icon: 'user', onClick: () => { ctx.setTitle(t('mg.edit.title')); ctx.swap(editStep(b, ctx)); } })),
    h('p', { class: 'mg-fine' }, t('mg.bk.booked', { when: `${fmt.dateShort(b.created_at, L())} · ${tm(b.created_at)}` })));
}

/** Fix the customer's details (a typo in the name, a new number, a note from the call). */
function editStep(b, ctx) {
  const name = field({ label: t('mg.new.name'), value: b.name || '', autocomplete: 'off', maxlength: 80 });
  const phone = field({ label: t('mg.optional_x', { label: t('mg.new.mobile') }), value: b.phone ? fmt.formatPhone(b.phone, 'en') : '',
    type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '05X XXX XXXX', dir: 'ltr' });
  const note = field({ label: t('mg.optional_x', { label: t('mg.new.note') }), value: b.note || '', multiline: true, maxlength: 500 });
  const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
  const ok = btn(t('save'), { kind: 'primary', size: null, block: true });
  ok.addEventListener('click', () => busy(ok, async () => {
    msg.hidden = true;
    const ph = phone.input.value.trim();
    if (ph && !fmt.normalizePhone(ph)) { phone.setError(t('field.phone_invalid')); phone.input.focus(); return; }
    try {
      const row = await call('own_booking_edit', {
        booking_id: b.id, name: name.input.value.trim(), phone: ph ? fmt.normalizePhone(ph) : '', note: note.input.value.trim(),
      }, { quiet: true });
      toast(t('mg.edit.done'), { kind: 'ok' });
      touched(row.id);
      ctx.setTitle(customer(row));
      ctx.swap(detail(row, ctx), 'back');
    } catch (e) {
      msg.replaceChildren(h('span', null, errText(e)));
      msg.hidden = false;
    }
  }));
  return stepEl(
    backBtn(() => { ctx.setTitle(customer(b)); ctx.swap(detail(b, ctx), 'back'); }),
    h('h3', { class: 'mg-picked__title', tabindex: '-1', 'data-step-focus': '' }, t('mg.edit.title')),
    name, phone, note, msg,
    h('div', { class: 'mg-sheetactions' }, ok));
}

export function waIcon() {
  return h('svg', { viewBox: '0 0 24 24', class: 'b-icon', 'aria-hidden': 'true', focusable: 'false' },
    h('path', { d: 'M4.5 19.5l1.1-3.6A8 8 0 1 1 8.4 18.6z' }),
    h('path', { d: 'M9.2 8.6c.2-.5.5-.6.8-.6h.5c.2 0 .4.1.5.4l.6 1.5c.1.2 0 .5-.1.6l-.5.6c.6 1.1 1.4 1.9 2.5 2.5l.6-.5c.2-.1.4-.2.6-.1l1.5.6c.3.1.4.3.4.5v.5c0 .3-.1.6-.6.8-.6.3-1.6.4-3.1-.4a8.6 8.6 0 0 1-3.3-3.3c-.8-1.5-.7-2.5-.4-3.1z' }));
}

/* ---------- move ---------- */

function moveStep(b, ctx) {
  const svc = service(b.service_id);
  const staffMode = svc ? svc.mode === 'staff' : !!b.staff_id;
  const st = {
    day: dayOf(b.starts_at) < todayISO() ? todayISO() : dayOf(b.starts_at),
    staff: b.staff_id || '',
    slot: null,
    force: false,
    forceTime: hhmm(minOf(b.starts_at, dayOf(b.starts_at))),
  };
  const slotsHost = h('div', { class: 'mg-slothost', 'aria-live': 'polite' });
  const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
  const go = btn(t('mg.move.pick'), { kind: 'primary', size: null, block: true, disabled: true });
  const forceTime = h('input', { type: 'time', class: 'b-field__input mg-time', value: st.forceTime, step: 300, 'aria-label': t('mg.new.exact') });
  const forceBox = h('div', { class: 'mg-forcebox', hidden: true },
    h('label', { class: 'mg-forcebox__row' }, h('span', null, t('mg.new.exact')), h('span', { class: 'b-field__box mg-timebox' }, forceTime)),
    h('p', { class: 'mg-fine' }, t('mg.move.force_hint')));

  const target = () => (st.force ? atMin(st.day, toMin(forceTime.value)).toISOString() : st.slot);
  const paint = () => {
    const iso = target();
    go.disabled = !iso;
    go.querySelector('span').textContent = iso ? t('mg.move.to', { when: when(iso) }) : t('mg.move.pick');
  };

  async function load() {
    st.slot = null;
    paint();
    slotsHost.replaceChildren(h('div', { class: 'mg-slots-skel' }, ...Array.from({ length: 6 }, () => h('span', { class: 'b-skel' }))));
    try {
      const r = await call('own_slots', { service_id: b.service_id, day: st.day, staff_id: st.staff || undefined, qty: b.qty, location: b.location, ignore: b.id }, { quiet: true });
      const now = Date.now() - 30 * 60000;
      const slots = (r.slots || []).filter((s) => new Date(s.t).getTime() >= now);
      slotsHost.replaceChildren(slots.length
        ? slotGrid(slots, st.day, { value: null, onPick: (v) => { st.slot = v; paint(); } })
        : h('p', { class: 'mg-noslots' }, icon('calendar'), t('no_slots')));
    } catch (e) {
      slotsHost.replaceChildren(h('p', { class: 'mg-noslots' }, errText(e)));
    }
  }

  const staffPick = staffMode && activeStaff().length > 1
    ? chips([{ value: '', label: t('mg.move.any') }, ...activeStaff().map((s) => ({ value: s.id, label: nm(s, 'label') }))],
      st.staff, (v) => { st.staff = v || ''; load(); }, { label: t('mg.bk.with'), scroll: true })
    : null;

  const forceSw = switchRow({
    label: t('mg.move.force'),
    onChange: (on) => { st.force = on; forceBox.hidden = !on; slotsHost.hidden = on; paint(); },
  });
  forceTime.addEventListener('input', paint);

  async function submit(force = st.force) {
    const iso = target();
    if (!iso) return;
    msg.hidden = true;
    S.mine.add(b.id);
    try {
      const row = await call('own_booking_move', { booking_id: b.id, start: iso, staff_id: st.staff || undefined, force }, { quiet: true });
      toast(t('mg.done.moved', { when: when(row.starts_at) }), { kind: 'ok' });
      touched(b.id);
      ctx.close(row);
    } catch (e) {
      if (e.code === 'SLOT_TAKEN' && !force) {
        msg.replaceChildren(h('span', null, errText(e)), ' ',
          btn(t('mg.move.anyway'), { kind: 'quiet', onClick: (ev) => busy(ev.currentTarget, () => submit(true)) }));
        msg.hidden = false;
      } else {
        msg.textContent = errText(e);
        msg.hidden = false;
      }
    }
  }
  go.addEventListener('click', () => busy(go, () => submit()));
  load();

  return stepEl(
    backBtn(() => { ctx.setTitle(customer(b)); ctx.swap(detail(b, ctx), 'back'); }),
    h('p', { class: 'mg-muted', 'data-step-focus': '', tabindex: '-1' }, t('mg.move.current', { when: when(b.starts_at) })),
    dateStrip({ value: st.day, onChange: (v) => { st.day = v; load(); paint(); } }),
    staffPick,
    slotsHost,
    forceSw,
    forceBox,
    msg,
    h('div', { class: 'mg-sheetactions' }, go));
}

const toMin = (v) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/* ---------- new booking (walk-in / phone) ---------- */

export function openNewBooking({ day = todayISO(), serviceId } = {}) {
  const services = (S.ov?.services || []).filter((s) => s.active);
  return openSheet({
    title: t('mg.new.title'),
    build: (ctx) => {
      if (!services.length) {
        return stepEl(h('p', { class: 'mg-muted' }, t('mg.new.no_services')));
      }
      const st = { day, service: serviceId || (services.length === 1 ? services[0].id : null), staff: '', qty: 1, location: 'shop', slot: null, force: false };
      return st.service ? timeStep(st, ctx, services) : serviceStep(st, ctx, services);
    },
  });
}

function serviceStep(st, ctx, services) {
  const list = h('div', { class: 'b-choices mg-choices', 'aria-label': t('mg.new.service') }, services.map((s) =>
    h('button', { type: 'button', class: 'b-choice b-choice--compact', 'data-value': s.id, 'aria-checked': s.id === st.service },
      h('span', { class: 'b-choice__main' },
        h('span', { class: 'b-choice__title' }, nm(s)),
        h('span', { class: 'b-choice__meta' }, dur(s.duration_min))),
      h('span', { class: 'b-choice__end' },
        h('span', { class: 'b-choice__price' }, fm(s.price?.total ?? s.price_halalas, { free: true }))))));
  selectable(list, { onChange: (v) => { st.service = v; st.slot = null; st.qty = 1; ctx.swap(timeStep(st, ctx, services)); } });
  return stepEl(h('h3', { class: 'mg-steptitle', tabindex: '-1', 'data-step-focus': '' }, t('mg.new.service')), list);
}

function timeStep(st, ctx, services) {
  const svc = service(st.service);
  const staffMode = svc.mode === 'staff';
  const slotsHost = h('div', { class: 'mg-slothost', 'aria-live': 'polite' });
  const next = btn(t('continue'), { kind: 'primary', size: null, block: true, disabled: true });
  const forceTime = h('input', { type: 'time', class: 'b-field__input mg-time', step: 300, 'aria-label': t('mg.new.exact') });
  /* The exact-time default: now (rounded) today, else the day's opening time. */
  const defaultTime = () => {
    if (st.day === todayISO()) return hhmm(Math.ceil(Math.max(nowMin(st.day), 0) / 5) * 5);
    const rs = dayRangesAll(st.day);
    return hhmm(rs.length ? rs[0][0] : 600);
  };
  forceTime.value = defaultTime();
  const forceBox = h('div', { class: 'mg-forcebox', hidden: true },
    h('label', { class: 'mg-forcebox__row' }, h('span', null, t('mg.new.exact')), h('span', { class: 'b-field__box mg-timebox' }, forceTime)),
    h('p', { class: 'mg-fine' }, t('mg.new.anyway_hint')));
  const target = () => (st.force ? atMin(st.day, toMin(forceTime.value)).toISOString() : st.slot);
  const paint = () => { next.disabled = !target(); };
  forceTime.addEventListener('input', paint);

  const showForce = (on) => { st.force = on; forceSw.input.checked = on; forceBox.hidden = !on; slotsHost.hidden = on; paint(); };
  const forceSw = switchRow({
    label: t('mg.new.anyway'), checked: st.force,
    onChange: (on) => { st.autoForce = false; showForce(on); },     // the owner decided
  });
  if (st.force) showForce(true);

  async function load() {
    st.slot = null;
    paint();
    slotsHost.replaceChildren(h('div', { class: 'mg-slots-skel' }, ...Array.from({ length: 6 }, () => h('span', { class: 'b-skel' }))));
    try {
      const r = await call('own_slots', { service_id: st.service, day: st.day, staff_id: st.staff || undefined, qty: st.qty, location: st.location }, { quiet: true });
      const from = st.day === todayISO() ? Date.now() - 20 * 60000 : -Infinity;
      const slots = (r.slots || []).filter((s) => new Date(s.t).getTime() >= from);
      if (slots.length) {
        slotsHost.replaceChildren(slotGrid(slots, st.day, { value: null, onPick: (v) => { st.slot = v; paint(); } }));
        if (st.autoForce) { st.autoForce = false; showForce(false); }   // only undo what we switched on ourselves
      } else {
        slotsHost.replaceChildren(h('div', { class: 'mg-noslots' }, icon('calendar'), h('span', null, t('mg.new.full'))));
        if (!st.force) { st.autoForce = true; showForce(true); }
      }
    } catch (e) {
      slotsHost.replaceChildren(h('p', { class: 'mg-noslots' }, errText(e)));
    }
  }

  const staffPick = staffMode && activeStaff().length > 1
    ? chips([{ value: '', label: t('mg.move.any') }, ...activeStaff().filter((s) => !s.services || s.services.includes(svc.id)).map((s) => ({ value: s.id, label: nm(s, 'label') }))],
      st.staff, (v) => { st.staff = v || ''; load(); }, { label: t('mg.bk.with'), scroll: true })
    : null;
  const qty = svc.mode === 'capacity' && svc.max_qty > 1
    ? h('div', { class: 'mg-ctlrow' }, h('span', { class: 'mg-ctlrow__label' }, t('mg.bk.party')),
      stepper({ value: st.qty, min: 1, max: svc.max_qty, label: t('mg.bk.party'), onChange: (v) => { st.qty = v; load(); } }))
    : null;
  const where = svc.location === 'both' && cfg().home?.on
    ? h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label' }, t('mg.new.where')),
      seg([{ value: 'shop', label: t('mg.bk.loc_shop') }, { value: 'mobile', label: t('mg.bk.loc_mobile') }], st.location, (v) => { st.location = v; load(); }))
    : null;
  if (svc.location === 'mobile') st.location = 'mobile';

  next.addEventListener('click', () => {
    st.start = target();
    ctx.swap(detailsStep(st, ctx, services));
  });
  load();

  return stepEl(
    services.length > 1 && backBtn(() => ctx.swap(serviceStep(st, ctx, services), 'back')),
    h('div', { class: 'mg-picked' },
      h('span', { class: 'mg-picked__title', tabindex: '-1', 'data-step-focus': '' }, nm(svc)),
      h('span', { class: 'mg-picked__meta' }, `${dur(svc.duration_min)} · ${fm(svc.price?.total ?? svc.price_halalas, { free: true })}`)),
    dateStrip({ value: st.day, onChange: (v) => { st.day = v; forceTime.value = defaultTime(); load(); } }),
    staffPick, qty, where,
    slotsHost,
    forceSw,
    forceBox,
    h('div', { class: 'mg-sheetactions' }, next));
}

function detailsStep(st, ctx, services) {
  const svc = service(st.service);
  const kind = seg([{ value: 'walkin', label: t('mg.new.walkin') }, { value: 'phone', label: t('mg.new.phone') }],
    st.kind || (st.day === todayISO() ? 'walkin' : 'phone'), (v) => { st.kind = v; }, { label: t('mg.new.kind') });
  st.kind = kind.get();
  const name = field({ label: t('mg.optional_x', { label: t('mg.new.name') }), value: st.name || '', autocomplete: 'off', maxlength: 80 });
  const phone = field({ label: t('mg.optional_x', { label: t('mg.new.mobile') }), value: st.phone || '', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '05X XXX XXXX' });
  const note = field({ label: t('mg.optional_x', { label: t('mg.new.note') }), value: st.note || '', multiline: true, maxlength: 500 });
  const address = st.location === 'mobile' ? field({ label: t('mg.new.address'), value: st.address || '' }) : null;
  const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
  const ok = btn(t('confirm_booking'), { kind: 'primary', size: null, block: true });
  phone.input.addEventListener('blur', () => {
    const v = phone.input.value.trim();
    const n = v ? fmt.normalizePhone(v) : '';
    phone.setError(v && !n ? t('field.phone_invalid') : '');
    if (n) phone.input.value = fmt.formatPhone(n, 'en');
  });

  ok.addEventListener('click', () => busy(ok, async () => {
    msg.hidden = true;
    const ph = phone.input.value.trim();
    if (ph && !fmt.normalizePhone(ph)) { phone.setError(t('field.phone_invalid')); phone.input.focus(); return; }
    Object.assign(st, { name: name.input.value.trim(), phone: ph, note: note.input.value.trim(), address: address?.input.value.trim() });
    try {
      const r = await call('own_booking_create', {
        service_id: st.service, start: st.start, staff_id: st.staff || undefined, qty: st.qty,
        location: st.location, address: st.address || undefined,
        name: st.name, phone: ph ? fmt.normalizePhone(ph) : undefined, note: st.note || undefined,
        walkin: st.kind === 'walkin', force: st.force, lang: L(),
      }, { quiet: true });
      S.mine.add(r.booking_id);
      haptic(12);
      toast(t('mg.new.done', { when: when(r.starts_at) }), { kind: 'ok' });
      touched(r.booking_id);
      ctx.close(r);
    } catch (e) {
      msg.replaceChildren(h('span', null, errText(e)));
      if (e.code === 'SLOT_TAKEN' && !st.force) {
        msg.append(' ', btn(t('mg.new.anyway'), {
          kind: 'quiet',
          onClick: (ev) => busy(ev.currentTarget, async () => { st.force = true; ok.click(); }),
        }));
      }
      msg.hidden = false;
    }
  }));

  return stepEl(
    backBtn(() => ctx.swap(timeStep(st, ctx, services), 'back')),
    h('div', { class: 'mg-picked' },
      h('span', { class: 'mg-picked__title', tabindex: '-1', 'data-step-focus': '' }, nm(svc)),
      h('span', { class: 'mg-picked__meta' }, [when(st.start), st.staff ? nm(staffById(st.staff), 'label') : null, st.qty > 1 ? `× ${dg(st.qty)}` : null].filter(Boolean).join(' · '))),
    kind, name, phone, address, note, msg,
    h('div', { class: 'mg-sheetactions' }, ok));
}

/* ---------- block time ---------- */

export function openBlock({ day = todayISO(), staffId, resourceId } = {}) {
  return openSheet({ title: t('mg.block.title'), build: (ctx) => blockForm({ day, staffId, resourceId }, ctx) });
}

function blockForm(init, ctx) {
  const ov = S.ov;
  const targets = [{ value: 'all', label: t('mg.block.all') }];
  if (cfg().sections && ov.sections.length > 1) for (const s of ov.sections) targets.push({ value: `sec:${s.id}`, label: nm(s) });
  for (const s of activeStaff()) targets.push({ value: `staff:${s.id}`, label: nm(s, 'label') });
  for (const r of activeResources()) targets.push({ value: `res:${r.id}`, label: nm(r, 'label') });
  const st = {
    target: init.staffId ? `staff:${init.staffId}` : init.resourceId ? `res:${init.resourceId}` : 'all',
    preset: init.day === todayISO() ? 'hour' : 'custom',
    day: init.day,
    offDay: init.day === todayISO() ? fmt.addDaysISO(init.day, 1) : init.day,
  };
  const today = todayISO();
  const n5 = Math.ceil(nowMin(today) / 5) * 5;
  const customDay = h('input', { type: 'date', class: 'b-field__input mg-date', value: st.day, min: today, 'aria-label': t('date') });
  const offDay = h('input', { type: 'date', class: 'b-field__input mg-date', value: st.offDay, min: today, 'aria-label': t('date') });
  const fromT = h('input', { type: 'time', class: 'b-field__input mg-time', step: 300, value: hhmm(st.day === today ? n5 : 600), 'aria-label': t('mg.block.from') });
  const toT = h('input', { type: 'time', class: 'b-field__input mg-time', step: 300, value: hhmm(st.day === today ? n5 + 60 : 660), 'aria-label': t('mg.block.to') });
  const reason = field({ label: t('mg.optional_x', { label: t('mg.block.reason') }), maxlength: 120, autocomplete: 'off' });
  const summary = h('p', { class: 'mg-summary', 'aria-live': 'polite' });
  const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
  const save = btn(t('mg.block.save'), { kind: 'primary', size: null, block: true });

  const customBox = h('div', { class: 'mg-blockcustom' },
    h('label', { class: 'mg-forcebox__row' }, h('span', null, t('date')), h('span', { class: 'b-field__box mg-timebox' }, customDay)),
    h('div', { class: 'mg-two' },
      h('label', { class: 'mg-forcebox__row' }, h('span', null, t('mg.block.from')), h('span', { class: 'b-field__box mg-timebox' }, fromT)),
      h('label', { class: 'mg-forcebox__row' }, h('span', null, t('mg.block.to')), h('span', { class: 'b-field__box mg-timebox' }, toT))));
  const offBox = h('div', { class: 'mg-blockcustom' },
    h('label', { class: 'mg-forcebox__row' }, h('span', null, t('date')), h('span', { class: 'b-field__box mg-timebox' }, offDay)));

  /** → {start: Date, end: Date} or null */
  function span() {
    if (st.preset === 'hour') return { start: atMin(today, n5), end: atMin(today, n5 + 60) };
    if (st.preset === 'rest') {
      const close = Math.max(0, ...dayRangesAll(today).map((r) => r[1]));
      const end = close > n5 ? close : 1440;
      return end > n5 ? { start: atMin(today, n5), end: atMin(today, end) } : null;
    }
    if (st.preset === 'off') {
      const d = offDay.value || st.offDay;
      const rs = dayRangesAll(d);
      const a = rs.length ? Math.min(...rs.map((r) => r[0])) : 0;
      const b = rs.length ? Math.max(...rs.map((r) => r[1])) : 1440;
      return { start: atMin(d, a), end: atMin(d, b) };
    }
    const d = customDay.value || st.day;
    const a = toMin(fromT.value);
    let b = toMin(toT.value);
    if (b <= a) b += 1440;
    return { start: atMin(d, a), end: atMin(d, b) };
  }
  function paint() {
    customBox.hidden = st.preset !== 'custom';
    offBox.hidden = st.preset !== 'off';
    const s = span();
    if (!s) { summary.textContent = t('mg.block.past'); save.disabled = true; return; }
    save.disabled = false;
    const d = dayOf(s.start.toISOString());
    const allDay = st.preset === 'off';
    summary.textContent = `${dayWord(d)} · ${allDay ? t('mg.block.day_off') : range(tm(s.start), tm(s.end))}`;
  }
  for (const el of [customDay, offDay, fromT, toT]) el.addEventListener('input', paint);

  save.addEventListener('click', () => busy(save, async () => {
    msg.hidden = true;
    const s = span();
    if (!s || s.end <= s.start) { msg.textContent = t('mg.block.bad'); msg.hidden = false; return; }
    const [kind, id] = st.target.split(':');
    try {
      await call('own_block_upsert', {
        block: {
          starts_at: s.start.toISOString(), ends_at: s.end.toISOString(),
          section_id: kind === 'sec' ? id : undefined, staff_id: kind === 'staff' ? id : undefined,
          resource_id: kind === 'res' ? id : undefined, reason: reason.input.value.trim(),
        },
      }, { quiet: true });
      haptic(10);
      toast(t('mg.block.done', { range: summary.textContent }), { kind: 'ok' });
      touched();
      ctx.close(true);
    } catch (e) {
      msg.textContent = errText(e);
      msg.hidden = false;
    }
  }));

  const presets = chips([
    ...(init.day === today ? [{ value: 'hour', label: t('mg.block.next_hour') }, { value: 'rest', label: t('mg.block.rest_today') }] : []),
    { value: 'off', label: t('mg.block.day_off') },
    { value: 'custom', label: t('mg.block.custom') },
  ], st.preset, (v) => { st.preset = v; paint(); }, { label: t('mg.block.when') });

  const view = stepEl(
    h('div', { class: 'mg-fieldset' },
      h('span', { class: 'mg-label', tabindex: '-1', 'data-step-focus': '' }, t('mg.block.what')),
      chips(targets, st.target, (v) => { st.target = v || 'all'; }, { label: t('mg.block.what') })),
    h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label' }, t('mg.block.when')), presets),
    customBox, offBox,
    reason,
    summary, msg,
    h('div', { class: 'mg-sheetactions' }, save));
  paint();
  return view;
}

export function openBlockDetail(bl) {
  const target = bl.staff_id ? nm(staffById(bl.staff_id), 'label')
    : bl.resource_id ? nm(resourceById(bl.resource_id), 'label')
      : bl.section_id ? nm(S.ov.sections.find((s) => s.id === bl.section_id)) : t('mg.block.all');
  return openSheet({
    title: t('mg.block.label'),
    build: (ctx) => {
      const rm = btn(t('mg.block.remove'), { kind: 'ghost', size: null, block: true, danger: true });
      rm.addEventListener('click', () => busy(rm, async () => {
        await call('own_block_delete', { id: bl.id });
        toast(t('mg.block.removed'), { kind: 'ok' });
        touched();
        ctx.close(true);
      }).catch(() => {}));
      const sameDay = dayOf(bl.starts_at) === dayOf(new Date(new Date(bl.ends_at).getTime() - 1).toISOString());
      return stepEl(
        h('dl', { class: 'b-kv mg-kv' },
          kvRow(t('date'), sameDay ? dateWithHijri(dayOf(bl.starts_at), { year: false })
            : range(fmt.dateShort(bl.starts_at, L()), fmt.dateShort(bl.ends_at, L()))),
          kvRow(t('time'), range(tm(bl.starts_at), tm(bl.ends_at))),
          kvRow(t('mg.block.what'), target),
          bl.reason && kvRow(t('mg.block.reason'), bl.reason)),
        h('div', { class: 'mg-sheetactions' }, rm));
    },
  });
}

export { dayRanges };
