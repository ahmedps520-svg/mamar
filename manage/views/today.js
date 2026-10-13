/* ==========================================================
   Today — greeting, stats, live timeline (staff lanes or
   capacity view), prayer bands, the now line, quick actions.
   ========================================================== */

import {
  S, t, tn, fmt, h, icon, on, cfg, ent, nm, fm, tm, dg, todayISO, dayOf, minOf, hhmm, tmMin, nowMin, range, dur,
  customer, pill, pillClass, statusKey, isLive, activeStaff, staffById, resourceById, service, dayRangesAll,
  dateWithHijri, emptyState, btn, seg, pref, L, when, usesStaff,
} from '../core.js';
import { animateNumber, skeleton, reduced } from '../../platform/ui/kit.js';
import { prayerTimes } from '../../platform/prayer.js';
import { openBooking, openNewBooking, openBlock, openBlockDetail } from './booking.js';

const PPM_PHONE = 1.4;      // px per minute
const PPM_WIDE = 1.6;
const VIEW_KEY = 'mamar-manage-tlview';

export function mount(main) {
  const today = todayISO();
  const root = h('div', { class: 'mg-today' });
  const left = h('div', { class: 'mg-today__side' });
  const right = h('div', { class: 'mg-today__main' });
  root.append(left, right);
  main.replaceChildren(root);

  const hello = h('header', { class: 'mg-hello' });
  const stats = h('div', { class: 'b-stats mg-stats' });
  const next = h('div', { class: 'mg-nextwrap', 'aria-live': 'polite' });
  const actions = h('div', { class: 'mg-quick' },
    btn(t('mg.qa.new'), { kind: 'primary', size: null, icon: 'plus', onClick: () => openNewBooking({ day: today }) }),
    btn(t('mg.qa.block'), { kind: 'ghost', size: null, icon: 'clock', onClick: () => openBlock({ day: today }) }));
  const attention = h('div', { class: 'mg-attention' });
  left.append(hello, stats, next, actions, attention);

  let view = pref.get(VIEW_KEY, 'lanes');
  const viewSeg = seg([{ value: 'lanes', label: t('mg.view.lanes') }, { value: 'list', label: t('mg.view.list') }], view,
    (v) => { view = v; pref.set(VIEW_KEY, v); paintTimeline(); }, { label: t('mg.view.label'), block: false, small: true });
  const tlHead = h('div', { class: 'mg-sechead' },
    h('div', { class: 'mg-sechead__text' },
      h('h2', { class: 'mg-sechead__title' }, t('mg.tl.title')),
      h('p', { class: 'mg-sechead__sub', id: 'mg-hours' })),
    viewSeg);
  const tl = h('div', { class: 'mg-tl', 'aria-busy': 'true' }, skeleton(3));
  right.append(tlHead, tl);

  /* ---------- painters ---------- */

  function paintHello() {
    const hr = fmt.riyadhParts(new Date()).hour;
    const key = hr >= 4 && hr < 12 ? 'mg.hello.morning' : hr < 17 && hr >= 12 ? 'mg.hello.afternoon' : 'mg.hello.evening';
    hello.replaceChildren(
      h('h1', { class: 'mg-hello__title' }, t(key)),
      h('p', { class: 'mg-hello__date' }, dateWithHijri(today)));
  }

  const statEls = {};
  function stat(key, label, value, format, sub) {
    let el = statEls[key];
    if (!el) {
      el = statEls[key] = {
        v: h('strong', { class: 'b-stat__value' }),
        box: null,
      };
      el.box = h('div', { class: 'b-stat' }, h('span', { class: 'b-stat__label' }, label), el.v);
    }
    animateNumber(el.v, null, value, { format });
    return el.box;
  }
  function paintStats() {
    const c = S.ov?.counts || { today: 0, upcoming: 0, waitlist: 0 };
    const tiles = [
      stat('today', t('mg.stat.today'), c.today, (n) => dg(n)),
      stat('upcoming', t('mg.stat.upcoming'), c.upcoming, (n) => dg(n)),
    ];
    if (cfg().waitlist) {
      tiles.push(stat('waitlist', t('mg.stat.waitlist'), c.waitlist, (n) => dg(n)));
    } else {
      const takings = todays().filter((b) => ['confirmed', 'completed', 'pending_payment'].includes(b.status))
        .reduce((a, b) => a + (b.total_halalas || 0), 0);
      tiles.push(stat('takings', t('mg.stat.takings'), Math.round(takings / 100), (n) => fmt.num(n, L())));
      statEls.takings.v.dataset.unit = t('sar');
    }
    stats.replaceChildren(...tiles);
  }

  /** Today's bookings (including late-night ones that run past midnight). */
  function todays() {
    if (!S.win) return [];
    const close = Math.max(1440, ...dayRangesAll(today).map((r) => r[1]));
    return S.win.bookings.filter((b) => {
      const m = minOf(b.starts_at, today);
      return m >= 0 && m < close && b.status !== 'expired';
    });
  }

  function paintNext() {
    const list = todays().filter(isLive).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const now = Date.now();
    const cur = list.find((b) => new Date(b.starts_at) <= now && new Date(b.ends_at) > now);
    const upcoming = list.find((b) => new Date(b.starts_at) > now);
    const b = cur || upcoming;
    if (!b) { next.replaceChildren(h('p', { class: 'mg-next mg-next--none' }, icon('check'), h('span', null, t('mg.next_none')))); return; }
    const mins = Math.max(1, Math.round((new Date(b.starts_at) - now) / 60000));
    const staff = nm(b, 'staff_label');
    next.replaceChildren(h('button', { type: 'button', class: 'mg-next', onClick: () => openBooking(b) },
      h('span', { class: 'mg-next__k' }, t('mg.next')),
      h('span', { class: 'mg-next__main' },
        h('span', { class: 'mg-next__title', dir: 'auto' }, customer(b)),
        h('span', { class: 'mg-next__sub' }, [nm(b, 'service_name'), staff].filter(Boolean).join(' · '))),
      h('span', { class: 'mg-next__end' },
        h('span', { class: 'mg-next__time' }, tm(b.starts_at)),
        h('span', { class: 'mg-next__in' }, cur ? t('mg.next_now') : t('mg.next_in', { mins: dur(mins) })))));
  }

  function paintAttention() {
    const now = Date.now();
    const items = (S.win?.bookings || []).filter((b) => b.pay_flag
      || (b.status === 'pending_payment' && (!b.hold_until || new Date(b.hold_until) > now)));
    if (!items.length) { attention.replaceChildren(); return; }
    attention.replaceChildren(
      h('h2', { class: 'mg-label mg-label--warn' }, icon('alert'), t('mg.attention')),
      h('div', { class: 'b-list' }, items.map((b) => {
        const left = b.hold_until ? Math.ceil((new Date(b.hold_until) - now) / 60000) : null;
        const sub = b.pay_flag
          ? (['amount_mismatch', 'needs_refund'].includes(b.pay_flag) ? t(`mg.flag.${b.pay_flag}`) : t('mg.flag.other'))
          : `${t('mg.hold_until', { time: tm(b.hold_until) })}${left != null && left > 0 ? ` · ${t('mg.hold_left', { mins: dur(left) })}` : ''}`;
        return h('button', { type: 'button', class: 'b-row mg-row--attn', onClick: () => openBooking(b) },
          h('span', { class: ['b-row__lead', b.pay_flag ? 'mg-lead--err' : 'mg-lead--warn'] }, icon(b.pay_flag ? 'alert' : 'clock')),
          h('span', { class: 'b-row__main' },
            h('span', { class: 'b-row__title' }, h('bdi', null, customer(b)), ` · ${when(b.starts_at)}`),
            h('span', { class: 'b-row__sub' }, sub)),
          icon('forward', { class: 'b-row__chev' }));
      })));
  }

  function paintHours() {
    const el = tlHead.querySelector('#mg-hours');
    const rs = dayRangesAll(today);
    el.textContent = rs.length ? t('mg.tl.hours', { range: rs.map((r) => range(tmMin(r[0]), tmMin(r[1]))).join(' · ') }) : t('mg.tl.closed');
  }

  function paintTimeline() {
    if (!S.win || !S.ov) return;
    tl.removeAttribute('aria-busy');
    const list = todays();
    const blocks = (S.win.blocks || []).filter((bl) => minOf(bl.ends_at, today) > 0 && minOf(bl.starts_at, today) < 1440 * 2);
    const rs = dayRangesAll(today);
    if (!rs.length && !list.length) {
      tl.replaceChildren(emptyState('calendar', t('mg.tl.closed'), null));
      return;
    }
    const kids = [];
    if (!list.some(isLive)) {
      kids.push(h('div', { class: 'mg-hint' }, icon('sparkle'),
        h('span', null, h('b', null, t('mg.tl.empty')), ' ', t('mg.tl.empty_text'))));
    }
    kids.push(view === 'list' ? agenda(list, blocks, rs) : lanes(list, blocks, rs));
    const cancelled = list.filter((b) => b.status === 'cancelled').length;
    if (view === 'lanes' && cancelled) kids.push(h('p', { class: 'mg-fine mg-center' }, t('mg.tl.cancelled', { n: cancelled })));
    tl.replaceChildren(...kids);
    // Fresh arrivals: highlight once.
    if (S.fresh.size) {
      const ids = [...S.fresh];
      setTimeout(() => { for (const id of ids) S.fresh.delete(id); }, 2600);
      const first = tl.querySelector('.is-fresh');
      if (first && !reduced) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /* ---------- prayer windows ---------- */

  function prayerWindows() {
    const p = cfg().prayer;
    if (!p?.on) return [];
    let pt;
    try {
      const b = S.ov.business;
      pt = prayerTimes(today, { minutes: true, ...(b.lat && b.lng ? { lat: b.lat, lng: b.lng } : {}) });
    } catch { return []; }
    const friday = fmt.riyadhParts(today).weekday === 5;
    return ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']
      .filter((k) => k !== 'fajr' || p.fajr)
      .map((k) => ({
        k, at: pt[k],
        from: pt[k] - (p.before_min || 0),
        to: pt[k] + (k === 'dhuhr' && friday ? (p.jumuah_min || 60) : (p.after_min || 25)),
      }));
  }

  /* ---------- list (agenda, kit b-tl) ---------- */

  function agenda(list, blocks, rs) {
    const items = list.map((b) => {
      const m = minOf(b.starts_at, today);
      const st = b.status.replace('_', '-').replace('pending-payment', 'pending');
      const staff = nm(b, 'staff_label') || (b.resource_id ? nm(resourceById(b.resource_id), 'label') : '');
      return {
        m,
        el: h('li', { class: ['b-tl__item', `b-tl__item--${st}`, S.fresh.has(b.id) && 'is-fresh'], 'data-id': b.id },
          h('time', { class: 'b-tl__time', datetime: b.starts_at }, tm(b.starts_at), h('small', null, dur(minOf(b.ends_at, today) - m))),
          h('button', { type: 'button', class: 'b-tl__card', onClick: () => openBooking(b) },
            h('div', { class: 'b-tl__top' },
              h('span', { class: 'b-tl__title mg-name', dir: 'auto' }, customer(b)),
              pill(b.status)),
            h('span', { class: 'b-tl__sub' }, [nm(b, 'service_name'), staff, b.qty > 1 ? `× ${dg(b.qty)}` : '', fm(b.total_halalas, { free: true })].filter(Boolean).join(' · ')),
            b.pay_flag && h('span', { class: 'mg-flagline' }, icon('alert'), t('mg.flag.other')))),
      };
    });
    for (const p of prayerWindows()) {
      items.push({ m: p.from, el: h('li', { class: 'b-tl__gap mg-tl-prayer' },
        h('span', { class: 'b-tl__time' }, tmMin(p.at)),
        h('span', null, icon('clock'), `${t('prayer.break', { prayer: t(`prayer.${p.k}`) })} · ${range(tmMin(p.from), tmMin(p.to))}`)) });
    }
    for (const bl of blocks) {
      const a = Math.max(minOf(bl.starts_at, today), 0);
      const target = bl.staff_id ? nm(staffById(bl.staff_id), 'label') : bl.resource_id ? nm(resourceById(bl.resource_id), 'label') : t('mg.block.all');
      items.push({ m: a, el: h('li', { class: 'b-tl__gap mg-tl-block' },
        h('span', { class: 'b-tl__time' }, tm(bl.starts_at)),
        h('button', { type: 'button', class: 'mg-tl-blockbtn', onClick: () => openBlockDetail(bl) },
          icon('close'), `${t('mg.blocked')} · ${target} · ${range(tm(bl.starts_at), tm(bl.ends_at))}${bl.reason ? ` · ${bl.reason}` : ''}`)) });
    }
    const nm0 = nowMin(today);
    const open = rs.length ? rs[0][0] : 0;
    const close = rs.length ? Math.max(...rs.map((r) => r[1])) : 1440;
    if (nm0 >= Math.min(open, ...items.map((i) => i.m)) - 60 && nm0 <= close + 60) {
      items.push({ m: nm0 - 0.1, now: true, el: h('li', { class: 'b-tl__now mg-tl-now' }, h('span', { class: 'b-tl__time' }, t('now'))) });
    }
    items.sort((a, b) => a.m - b.m);
    return h('ol', { class: 'b-tl mg-agenda', 'aria-label': t('mg.tl.title') }, items.map((i) => i.el));
  }

  /* ---------- lanes (staff lanes + capacity view) ---------- */

  function lanes(list, blocks, rs) {
    const ppm = window.matchMedia('(min-width: 1024px)').matches ? PPM_WIDE : PPM_PHONE;
    const live = list.filter((b) => b.status !== 'cancelled');
    const lanesDef = [];
    const staffIds = new Set(live.filter((b) => b.staff_id).map((b) => b.staff_id));
    if (usesStaff() || staffIds.size) {
      for (const s of S.ov.staff.filter((x) => x.active || staffIds.has(x.id))) lanesDef.push({ kind: 'staff', id: s.id, label: nm(s, 'label') });
    }
    const resIds = new Set(live.filter((b) => b.resource_id).map((b) => b.resource_id));
    const capRes = new Set(S.ov.services.filter((s) => s.mode === 'capacity' && s.resource_id).map((s) => s.resource_id));
    for (const r of S.ov.resources.filter((x) => (x.active && capRes.has(x.id)) || resIds.has(x.id))) {
      lanesDef.push({ kind: 'res', id: r.id, label: nm(r, 'label'), cap: r.capacity });
    }
    if (live.some((b) => !b.staff_id && !b.resource_id)) lanesDef.push({ kind: 'none', id: null, label: t('mg.unassigned') });
    if (!lanesDef.length) lanesDef.push({ kind: 'none', id: null, label: nm(S.ov.business) });

    // Time range: opening hours ∪ bookings ∪ now, rounded to whole hours.
    const nm0 = nowMin(today);
    let a = rs.length ? Math.min(...rs.map((r) => r[0])) : 9 * 60;
    let z = rs.length ? Math.max(...rs.map((r) => r[1])) : 21 * 60;
    for (const b of live) { a = Math.min(a, minOf(b.starts_at, today)); z = Math.max(z, minOf(b.ends_at, today)); }
    a = Math.max(0, Math.floor(a / 60) * 60);
    z = Math.ceil(z / 60) * 60;
    const H = (z - a) * ppm;
    const y = (m) => (m - a) * ppm;

    const laneOf = (b) => {
      if (b.staff_id) return lanesDef.findIndex((l) => l.kind === 'staff' && l.id === b.staff_id);
      if (b.resource_id) return lanesDef.findIndex((l) => l.kind === 'res' && l.id === b.resource_id);
      return lanesDef.findIndex((l) => l.kind === 'none');
    };

    const cols = lanesDef.map((l) => h('div', { class: ['mg-lane', l.kind === 'res' && 'mg-lane--cap'], 'data-kind': l.kind, role: 'list', 'aria-label': l.label }));

    // Hour lines and labels.
    const gutter = h('div', { class: 'mg-lanes__gutter', 'aria-hidden': 'true' });
    const grid = h('div', { class: 'mg-lanes__grid', 'aria-hidden': 'true' });
    for (let m = a; m <= z; m += 60) {
      if (Math.abs(m - nm0) > 14) gutter.appendChild(h('span', { class: 'mg-lanes__hour', style: { top: `${y(m)}px` } }, tmMin(m).replace(/:00/, '').replace(/:٠٠/, '')));
      grid.appendChild(h('span', { class: 'mg-lanes__line', style: { top: `${y(m)}px` } }));
      if (m + 30 < z) grid.appendChild(h('span', { class: 'mg-lanes__line mg-lanes__line--half', style: { top: `${y(m + 30)}px` } }));
    }
    // Closed stretches (outside opening hours).
    const open = rs.slice().sort((p, q) => p[0] - q[0]);
    let cur = a;
    for (const [o, c] of open) {
      if (o > cur) grid.appendChild(h('span', { class: 'mg-lanes__closed', style: { top: `${y(cur)}px`, height: `${(o - cur) * ppm}px` } }));
      cur = Math.max(cur, c);
    }
    if (cur < z) grid.appendChild(h('span', { class: 'mg-lanes__closed', style: { top: `${y(cur)}px`, height: `${(z - cur) * ppm}px` } }));

    // Prayer bands.
    const bands = h('div', { class: 'mg-lanes__bands' });
    for (const p of prayerWindows()) {
      if (p.to <= a || p.from >= z) continue;
      bands.appendChild(h('div', {
        class: 'mg-band', style: { top: `${y(Math.max(p.from, a))}px`, height: `${(Math.min(p.to, z) - Math.max(p.from, a)) * ppm}px` },
        title: `${t('prayer.break', { prayer: t(`prayer.${p.k}`) })} · ${range(tmMin(p.from), tmMin(p.to))}`,
      }, h('span', { class: 'mg-band__label' }, icon('clock'), t(`prayer.${p.k}`))));
    }

    // Blocks: whole-business ones span every lane; staff/resource ones sit in their lane.
    for (const bl of blocks) {
      const s = Math.max(minOf(bl.starts_at, today), a);
      const e = Math.min(minOf(bl.ends_at, today), z);
      if (e <= s) continue;
      const el = h('button', {
        type: 'button', class: 'mg-blk', style: { top: `${y(s)}px`, height: `${(e - s) * ppm}px` },
        onClick: () => openBlockDetail(bl),
        'aria-label': `${t('mg.block.label')} ${range(tm(bl.starts_at), tm(bl.ends_at))}`,
      }, h('span', { class: 'mg-blk__label' }, t('mg.blocked'), bl.reason ? ` · ${bl.reason}` : ''));
      const li = bl.staff_id ? lanesDef.findIndex((l) => l.kind === 'staff' && l.id === bl.staff_id)
        : bl.resource_id ? lanesDef.findIndex((l) => l.kind === 'res' && l.id === bl.resource_id) : -1;
      if (li >= 0) cols[li].appendChild(el);
      else { el.classList.add('mg-blk--all'); bands.appendChild(el); }
    }

    // Bookings, packed into sub-columns where they overlap (capacity lanes and forced overlaps).
    const perLane = lanesDef.map(() => []);
    for (const b of live) { const i = laneOf(b); if (i >= 0) perLane[i].push(b); }
    perLane.forEach((items, li) => {
      items.sort((p, q) => p.starts_at.localeCompare(q.starts_at) || q.ends_at.localeCompare(p.ends_at));
      const clusters = [];
      let c = null;
      let cEnd = -Infinity;
      for (const b of items) {
        const s = minOf(b.starts_at, today);
        const e = minOf(b.ends_at, today);
        if (!c || s >= cEnd) { c = []; clusters.push(c); cEnd = e; } else cEnd = Math.max(cEnd, e);
        c.push({ b, s, e });
      }
      for (const cl of clusters) {
        const tracks = [];
        for (const it of cl) {
          let k = tracks.findIndex((end) => end <= it.s);
          if (k < 0) { k = tracks.length; tracks.push(it.e); } else tracks[k] = it.e;
          it.k = k;
        }
        const n = tracks.length;
        for (const it of cl) cols[li].appendChild(card(it.b, it, n, ppm, y));
        if (lanesDef[li].kind === 'res') {
          // Peak seats/bays in use during this cluster.
          let peak = 0;
          for (const it of cl) {
            const used = cl.filter((o) => o.s <= it.s && o.e > it.s).reduce((sum, o) => sum + (o.b.qty || 1), 0);
            peak = Math.max(peak, used);
          }
          const cap = lanesDef[li].cap;
          cols[li].appendChild(h('span', {
            class: ['mg-cap', peak >= cap && 'is-full'], style: { top: `${y(cl[0].s)}px` },
            title: t('mg.cap_used', { used: dg(peak), cap: dg(cap) }),
          }, `${dg(peak)}/${dg(cap)}`));
        }
      }
      // Occupancy strip (capacity lanes).
      if (lanesDef[li].kind === 'res') {
        const cap = lanesDef[li].cap;
        const strip = h('div', { class: 'mg-occ', 'aria-hidden': 'true' });
        for (let m = a; m < z; m += 15) {
          const used = items.filter((b) => minOf(b.starts_at, today) <= m && minOf(b.ends_at, today) > m).reduce((s, b) => s + (b.qty || 1), 0);
          if (used) strip.appendChild(h('span', { style: { top: `${y(m)}px`, height: `${15 * ppm}px`, '--o': Math.min(1, used / cap).toFixed(2) } }));
        }
        cols[li].prepend(strip);
      }
    });

    // Now line.
    const nowEl = nm0 >= a && nm0 <= z ? h('div', { class: 'mg-now', style: { top: `${y(nm0)}px` } }, h('span', { class: 'mg-now__dot' })) : null;
    const nowLabel = nowEl ? h('span', { class: 'mg-lanes__nowlabel', style: { top: `${y(nm0)}px` } }, tmMin(nm0)) : null;
    if (nowLabel) gutter.appendChild(nowLabel);

    const nowUsage = (l, i) => {
      if (l.kind !== 'res') return tn0(perLane[i].length);
      const used = perLane[i].filter((b) => isLive(b) && minOf(b.starts_at, today) <= nm0 && minOf(b.ends_at, today) > nm0).reduce((s, b) => s + (b.qty || 1), 0);
      return t('mg.cap_used', { used: dg(used), cap: dg(l.cap) });
    };
    const head = h('div', { class: 'mg-lanes__head' },
      h('div', { class: 'mg-lanes__corner' }),
      ...lanesDef.map((l, i) => h('div', { class: 'mg-lanes__name' },
        h('span', { class: 'mg-lanes__label' }, l.label),
        h('small', null, nowUsage(l, i)))));

    const wrap = h('div', {
      class: ['mg-lanes', lanesDef.length > 4 && 'mg-lanes--scroll'],
      style: { '--lanes': lanesDef.length, '--h': `${H}px` },
    },
      head,
      h('div', { class: 'mg-lanes__body', style: { height: `${H}px` } },
        gutter,
        h('div', { class: 'mg-lanes__cols' }, grid, ...cols, bands, nowEl)));

    // Keep the now line moving without a full repaint.
    wrap._tick = () => {
      const m = nowMin(today);
      if (nowEl && m >= a && m <= z) {
        nowEl.style.top = `${y(m)}px`;
        nowLabel.style.top = `${y(m)}px`;
        nowLabel.textContent = tmMin(m);
      }
    };
    return wrap;
  }

  const tn0 = (n) => (n ? tn('bookings', n) : '—');

  function card(b, it, n, ppm, y) {
    const st = b.status.replace('_', '-').replace('pending-payment', 'pending');
    const height = Math.max(26, (it.e - it.s) * ppm - 3);
    const compact = height < 48;
    const svc = nm(b, 'service_name');
    const el = h('button', {
      type: 'button',
      class: ['mg-card', `mg-card--${st}`, compact && 'is-compact', S.fresh.has(b.id) && 'is-fresh', b.pay_flag && 'has-flag'],
      style: { top: `${y(it.s) + 1}px`, height: `${height}px`, '--k': it.k, '--n': n },
      'data-id': b.id, role: 'listitem',
      'aria-label': `${customer(b)}, ${svc}, ${range(tm(b.starts_at), tm(b.ends_at))}, ${t(statusKey(b.status))}`,
      onClick: () => openBooking(b),
    },
      h('span', { class: 'mg-card__time' }, tm(b.starts_at), b.qty > 1 ? h('b', { class: 'mg-card__qty' }, `×${dg(b.qty)}`) : null),
      h('span', { class: 'mg-card__name', dir: 'auto' }, customer(b)),
      !compact && h('span', { class: 'mg-card__svc' }, svc),
      (b.status === 'pending_payment' || b.pay_flag) && h('span', { class: 'mg-card__flag', 'aria-hidden': 'true' }, icon(b.pay_flag ? 'alert' : 'clock')));
    return el;
  }

  function paintAll() {
    paintHello();
    paintStats();
    paintNext();
    paintAttention();
    paintHours();
    paintTimeline();
  }

  /* ---------- wiring ---------- */

  paintHello();
  if (S.ov) { paintStats(); paintHours(); }
  if (S.win) paintAll();

  const offs = [
    on('window', () => { paintStats(); paintNext(); paintAttention(); paintTimeline(); }),
    on('overview', () => { paintStats(); paintHours(); paintTimeline(); }),
  ];
  const iv = setInterval(() => {
    tl.querySelector('.mg-lanes')?._tick?.();
    paintNext();
    if (todayISO() !== today) location.reload();
  }, 30000);
  const mq = window.matchMedia('(min-width: 1024px)');
  const onMq = () => paintTimeline();
  mq.addEventListener('change', onMq);

  return () => { offs.forEach((f) => f()); clearInterval(iv); mq.removeEventListener('change', onMq); };
}

export const title = () => t('mg.tab.today');
export { pillClass };
