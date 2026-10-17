/* ==========================================================
   Mamar Booking — the customer booking flow.
   mountBooking({slug, source, embed, serviceId, lang}) renders the
   whole concierge into #app: one calm question per screen.
   Used by /book/ (and its embed iframe), /b/<slug> via 404.html,
   and the published /b/<slug>/index.html link pages.
   ========================================================== */

import {
  rpc, errorKey, pick, URLS, F, t, tn, lang, h, icon, toast, selectable,
  pageSetup, earlyLang, businessLang, useTheme, money, signed, num, dur, bizName, estimate, dueNow, offerValue, offerDays,
  cached, invalidate, chrome, messageStep, loadingStep, field, validEmail, whenPicker, waitlistSheet,
  confirmationStep, saveBooking, savedBookings, timeLabel, dayName, dayMinutes, hijriOn, lockIcon, demoBadge, outTarget,
} from './core.js';
import { live } from '../platform/live.js';
import { EMBED } from '../platform/contract.js';
import { VENDOR } from '../platform/config.js';
import { onLang } from '../platform/i18n.js';
import { stepTransition, animateNumber, haptic } from '../platform/ui/kit.js';

const JEDDAH = [21.5433, 39.1728];

export async function mountBooking({ slug, source = 'web', embed = false, serviceId = null, lang: want = null } = {}) {
  const app = document.getElementById('app') || document.body.appendChild(h('div', { id: 'app' }));
  pageSetup();
  earlyLang(want);
  const root = document.documentElement;
  root.classList.toggle('bk-embedded', !!embed);
  slug = String(slug || '').trim().toLowerCase();
  source = ['web', 'embed', 'link'].includes(source) ? source : 'web';

  /* ---------- host page (embed) ---------- */
  const hostOrigin = embed ? (() => {
    try { const a = location.ancestorOrigins; if (a && a.length) return a[0]; } catch { /* not supported */ }
    try { if (document.referrer) return new URL(document.referrer).origin; } catch { /* none */ }
    return null;
  })() : null;
  const post = (msg) => {
    if (!embed || window.parent === window) return;
    try { window.parent.postMessage(msg, hostOrigin || '*'); } catch { /* host gone */ }
  };

  const ui = chrome(app, { onClose: embed ? () => post({ type: EMBED.CLOSE }) : null });
  ui.stage.replaceChildren(loadingStep());

  /* ---------- state ---------- */
  const S = {
    data: null, cur: null, picker: null, done: null, busy: false, pushed: false,
    section: null, service: null, qty: 1, staff: 'any', loc: 'shop',
    lat: null, lng: null, pinSet: false, address: '',
    day: null, slot: null, price: null,
    name: '', phone: '', email: '', note: '', website: '', errs: {},
  };
  // Prefetch the preselected service's days before the business even arrives.
  if (serviceId) cached('pub_days', { service_id: serviceId }).catch(() => {});

  let data;
  try {
    data = await cached('pub_business', { slug }, { ttl: 5000 });
  } catch (e) {
    return fail(e);
  }
  S.data = data;
  const biz = () => S.data.business;
  const flow = () => S.data.flow || {};
  businessLang(biz().langs, want);
  useTheme(biz());
  ui.setLogo(biz().theme?.logo_url);

  /* ---------- derived ---------- */
  const svc = () => S.data.services.find((s) => s.id === S.service) || null;
  const sections = () => S.data.sections || [];
  const showSections = () => sections().length > 1;
  const secOf = (s) => s?.section_id || S.section || sections()[0]?.id || null;
  const servicesIn = () => S.data.services.filter((s) => !showSections() || !s.section_id || s.section_id === S.section);
  const staffFor = (s) => (S.data.staff || []).filter((p) => (!p.services || p.services.includes(s.id))
    && (!p.section_id || p.section_id === secOf(s)));
  const showStaff = (s) => !!(flow().staff_choice && s?.mode === 'staff' && staffFor(s).length > 1);
  const showQty = (s) => s?.mode === 'capacity' && s.max_qty > 1;
  const homeOn = () => !!flow().home?.on;
  const showWhere = (s) => homeOn() && (s?.location === 'both' || s?.location === 'mobile');
  const locFor = (s) => (s?.location === 'mobile' ? 'mobile' : s?.location === 'both' ? S.loc : 'shop');

  function steps() {
    const out = [];
    if (showSections()) out.push('section');
    out.push('service');
    const s = svc();
    if (showQty(s)) out.push('qty');
    if (showStaff(s)) out.push('staff');
    if (showWhere(s)) out.push('where');
    out.push('when', 'details', 'review');
    return out;
  }
  const query = () => {
    const s = svc();
    if (!s) return null;
    return {
      service_id: s.id, section_id: showSections() ? secOf(s) : null,
      staff_id: showStaff(s) && S.staff !== 'any' ? S.staff : null,
      qty: showQty(s) ? S.qty : null, location: locFor(s) === 'mobile' ? 'mobile' : null,
    };
  };
  const curPrice = () => S.price || estimate(S.data, svc(), S.qty, locFor(svc()));

  /* ---------- prefetch ---------- */
  function prefetchWhen() {
    const q = query();
    if (!q) return;
    cached('pub_days', q).then((r) => {
      const d = (r.days || []).find((x) => x.n > 0);
      if (d) cached('pub_slots', { ...q, day: d.day }).catch(() => {});
    }).catch(() => {});
  }

  /* ---------- summary bar ---------- */
  const sum = {
    label: h('span', { class: 'b-summary__label' }),
    sub: h('span', { class: 'b-summary__sub' }),
    total: h('strong', { class: 'b-summary__total bk-num', 'aria-live': 'polite' }),
    cta: h('button', { type: 'button', class: 'b-btn b-btn--primary b-summary__cta', onClick: () => onCta() }),
  };
  const summary = h('div', { class: 'b-summary bk-summary', hidden: true },
    h('div', { class: 'b-summary__in' },
      h('div', { class: 'b-summary__text' }, sum.label, sum.sub), sum.total, sum.cta));
  app.insertBefore(summary, ui.foot);
  let lastTotal = null;

  function paintSummary() {
    const s = svc();
    const st = S.cur;
    const show = !!s && !S.done && st && !(st === 'section') && !(st === 'service' && !s);
    summary.hidden = !show;
    if (!show) return;
    const p = curPrice();
    const due = dueNow(flow(), p.total);
    sum.label.textContent = t('total');
    const when = S.slot ? `${dayName(S.day)} · ${timeLabel(S.slot.t, dayMinutes(S.slot.t, S.day) >= 1440)}` : '';
    const subs = {
      service: `${pick(s, 'name')} · ${dur(s.duration_min)}`,
      qty: `${pick(s, 'name')} · ${qtyLabel(S.qty)}`,
      staff: pick(s, 'name'),
      where: locFor(s) === 'mobile' ? t('bk.home_visit') : t('bk.at_shop'),
      when: when || t('bk.pick_time'),
      details: `${pick(s, 'name')}${when ? ` · ${when}` : ''}`,
      review: `${pick(s, 'name')}${when ? ` · ${when}` : ''}`,
    };
    sum.sub.textContent = st === 'review' && due > 0 ? t('bk.pay_now_sub', { amount: money(due) }) : subs[st] || '';
    const shown = p.total;
    animateNumber(sum.total, lastTotal ?? shown, shown, { format: (v) => money(v), step: 100 });
    lastTotal = shown;
    const ready = canContinue();
    const label = st === 'review' ? (due > 0 ? t('bk.confirm_pay', { amount: money(due) }) : t('confirm_booking')) : t('continue');
    sum.cta.replaceChildren(h('span', null, label));
    sum.cta.disabled = !ready;
    sum.cta.classList.toggle('bk-cta--confirm', st === 'review');
  }

  function canContinue() {
    const s = svc();
    switch (S.cur) {
      case 'section': return !!S.section;
      case 'service': return !!s;
      case 'qty': return S.qty >= 1;
      case 'staff': return !!S.staff;
      case 'where': return locFor(s) === 'shop' || S.pinSet || S.address.trim().length > 3;
      case 'when': return !!S.slot;
      case 'details': return true;
      case 'review': return !!S.slot && !S.busy;
      default: return false;
    }
  }

  /* ---------- navigation ---------- */
  function paintChrome() {
    const list = steps();
    const i = list.indexOf(S.cur);
    ui.setTitle(bizName(biz()));
    ui.setProgress(S.done ? 1 : i >= 0 ? (i + 1) / (list.length + 1) : null);
    const first = list[0];
    ui.setBack(S.done || !S.cur || S.cur === first ? null : () => goBack());
    paintSummary();
  }

  function render(dir) {
    const make = STEP[S.cur];
    if (!make) return;
    if (S.cur !== 'when') S.picker = null;
    const el = make();
    if (dir) {
      stepTransition(ui.stage, el, dir).then(() => {
        if (S.cur === 'where') map.invalidate();
      });
      try { window.scrollTo({ top: 0, behavior: dir ? 'smooth' : 'auto' }); } catch { window.scrollTo(0, 0); }
    } else {
      ui.stage.replaceChildren(el);
    }
    paintChrome();
  }

  function go(name, dir = 'forward', { push = true } = {}) {
    S.cur = name;
    render(dir);
    if (!embed && push) {
      try { history.pushState({ bk: name }, ''); S.pushed = true; } catch { /* sandboxed */ }
    }
  }
  function next() {
    const list = steps();
    const i = list.indexOf(S.cur);
    if (i >= 0 && i < list.length - 1) go(list[i + 1], 'forward');
  }
  function prevStep() {
    const list = steps();
    const i = list.indexOf(S.cur);
    return i > 0 ? list[i - 1] : null;
  }
  function goBack() {
    const p = prevStep();
    if (!p) return;
    go(p, 'back', { push: false });
    if (!embed) { try { history.replaceState({ bk: p }, ''); } catch { /* sandboxed */ } }
  }
  if (!embed) {
    // The phone's back gesture walks back through the steps instead of leaving the page.
    window.addEventListener('popstate', (e) => {
      if (S.done) { restart(null); return; }
      const list = steps();
      let target = list.includes(e.state?.bk) ? e.state.bk : list[0];
      if (target === S.cur) { const p = prevStep(); if (!p) return; target = p; }
      const dir = list.indexOf(target) < list.indexOf(S.cur) ? 'back' : 'forward';
      S.cur = target;
      render(dir);
    });
  }

  /** Re-render the current step in place (language switch, live price change), keeping focus. */
  function rerender() {
    if (!S.cur && !S.done) return;
    const a = document.activeElement;
    const v = a?.dataset?.value;
    const id = a?.id;
    if (S.done) { ui.stage.replaceChildren(doneEl()); paintChrome(); return; }
    if (S.cur === 'when' && S.picker) { S.picker.repaint(); paintChrome(); refreshHead(); return; }
    if (S.cur === 'details') { paintChrome(); refreshHead(); relabelDetails(); return; }
    render(null);
    const back = (v && ui.stage.querySelector(`[data-value="${CSS.escape(v)}"]`)) || (id && document.getElementById(id));
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }
  function refreshHead() {
    const headEl = ui.stage.querySelector('.b-step__head');
    if (headEl) headEl.replaceWith(stepHead(...HEADS[S.cur]()));
  }

  /* ---------- step pieces ---------- */
  function stepHead(q, hint) {
    const list = steps();
    const i = list.indexOf(S.cur);
    return h('div', { class: 'b-step__head' },
      i >= 0 && h('span', { class: 'b-eyebrow' }, t('step_of', { n: i + 1, total: list.length })),
      h('h1', { class: 'b-step__q' }, q),
      hint && h('p', { class: 'b-step__hint' }, hint));
  }
  const qtyLabel = (n) => (svc()?.per_person ? tn('bk.people', n) : tn('bk.units', n));
  const HEADS = {
    section: () => [t('bk.q.section'), t('bk.h.section')],
    service: () => [t('bk.q.service'), null],
    qty: () => [svc()?.per_person ? t('bk.q.people') : t('bk.q.qty'), svc()?.per_person ? t('bk.h.people') : null],
    // "Which chair?" only when the staff really are chairs; named barbers get "Who would you like?"
    staff: () => [t(S.data.business.kind === 'salon' && (S.data.staff || []).length
      && S.data.staff.every((s) => /chair|كرسي/i.test(`${s.label_en || ''} ${s.label_ar || ''}`)) ? 'bk.q.chair' : 'bk.q.staff'), t('bk.h.staff')],
    where: () => [locFor(svc()) === 'mobile' && svc()?.location === 'mobile' ? t('bk.q.where_home') : t('bk.q.where'),
      svc()?.location === 'mobile' ? t('bk.h.where_home') : null],
    when: () => [t('bk.q.when'), whenHint()],
    details: () => [t('bk.q.details'), t('bk.h.details')],
    review: () => [t('bk.q.review'), t('bk.h.review')],
  };
  function whenHint() {
    const s = svc();
    if (!s) return null;
    const parts = [pick(s, 'name'), dur(s.duration_min)];
    if (showQty(s)) parts.push(qtyLabel(S.qty));
    if (showStaff(s) && S.staff !== 'any') parts.push(pick(staffFor(s).find((p) => p.id === S.staff), 'label'));
    return parts.filter(Boolean).join(' · ');
  }

  const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
  /** Radio cards that move on by themselves after a tap (never while arrowing through them). */
  function choose(container, cb, { auto = true } = {}) {
    let lastKey = null;
    container.addEventListener('keydown', (e) => { lastKey = e.key; }, true);
    container.addEventListener('pointerdown', () => { lastKey = null; }, true);
    return selectable(container, {
      selector: '.b-choice',
      onChange: (v) => {
        const nav = NAV_KEYS.includes(lastKey);
        lastKey = null;
        cb(v);
        paintSummary();
        if (auto && !nav) {
          const at = S.cur;
          setTimeout(() => { if (S.cur === at && canContinue()) next(); }, 260);
        }
      },
    });
  }

  /* ---------- 1. section ---------- */
  function stepSection() {
    const group = h('div', { class: 'b-choices' }, sections().map((x) => h('button', {
      type: 'button', class: 'b-choice', 'data-value': x.id, 'aria-checked': x.id === S.section,
    },
    h('span', { class: 'b-choice__lead' }, h('span', { class: 'b-choice__tick' })),
    h('span', { class: 'b-choice__main' }, h('span', { class: 'b-choice__title' }, pick(x, 'name'))),
    icon('forward', { class: 'bk-choice__chev' }))));
    choose(group, (v) => {
      if (S.section !== v) { S.section = v; const s = svc(); if (s?.section_id && s.section_id !== v) S.service = null; }
    });
    return h('section', { class: 'b-step' }, stepHead(...HEADS.section()), group);
  }

  /* ---------- 2. service ---------- */
  function welcome() {
    const b = biz();
    const mine = savedBookings().filter((x) => x.slug === b.slug && x.starts_at && Date.parse(x.starts_at) > Date.now());
    const tagline = pick(b, 'tagline');
    const addr = pick(b, 'address');
    return h('div', { class: 'bk-welcome' },
      h('p', { class: 'b-eyebrow' }, t('bk.welcome')),
      h('h1', { class: 'bk-welcome__name', 'data-step-focus': '' }, bizName(b)),
      tagline && h('p', { class: 'bk-welcome__tag' }, tagline),
      addr && h('p', { class: 'bk-welcome__addr' }, icon('pin'), h('span', null, addr)),
      b.is_demo && demoBadge(),
      mine.length > 0 && h('a', { class: 'bk-mine', href: URLS.manage(mine[0].token), target: outTarget() },
        icon('calendar'),
        h('span', { class: 'bk-mine__t' },
          h('b', null, t('bk.mine')),
          h('span', null, `${pick(mine[0], 'service_name')} · ${dayName(F.riyadhDateISO(mine[0].starts_at))} ${F.time(mine[0].starts_at, lang())}`)),
        icon('forward')));
  }

  function offersBlock() {
    const list = S.data.offers || [];
    if (!list.length) return null;
    return h('div', { class: 'bk-offers', role: 'list', 'aria-label': t('bk.offers') }, list.map((o) => {
      const one = o.service_ids?.length === 1 && servicesIn().find((s) => s.id === o.service_ids[0]);
      const meta = [offerDays(o), o.ends_at && t('bk.offer.until', { date: F.dateShort(o.ends_at, lang()) })].filter(Boolean).join(' · ');
      const inner = [
        h('span', { class: 'bk-offer__icon', 'aria-hidden': 'true' }, icon('sparkle')),
        h('span', { class: 'bk-offer__main' },
          h('span', { class: 'bk-offer__title' }, pick(o, 'title')),
          meta && h('span', { class: 'bk-offer__meta' }, meta)),
        o.kind !== 'banner' && h('span', { class: 'b-badge bk-offer__v' }, offerValue(o)),
      ];
      return one
        ? h('button', {
          type: 'button', class: ['bk-offer', o.kind === 'banner' && 'is-banner'], role: 'listitem',
          onClick: () => { S.service = one.id; resetAfterService(); paintSummary(); prefetchWhen(); next(); },
        }, ...inner)
        : h('div', { class: ['bk-offer', o.kind === 'banner' && 'is-banner'], role: 'listitem' }, ...inner);
    }));
  }

  function serviceCard(s) {
    const p = s.price || {};
    const offer = p.discount > 0;
    const later = !offer && (S.data.offers || []).find((o) => o.kind !== 'banner' && o.weekdays?.length
      && (!o.service_ids || o.service_ids.includes(s.id)));
    const priceText = s.price_from ? t('from_price', { price: money(p.total) }) : money(p.total);
    const desc = pick(s, 'desc');
    return h('button', {
      type: 'button', class: 'b-choice bk-svc', 'data-value': s.id, 'aria-checked': s.id === S.service,
      onPointerenter: () => cached('pub_days', { service_id: s.id }).catch(() => {}),
      onFocus: () => cached('pub_days', { service_id: s.id }).catch(() => {}),
    },
    offer && h('span', { class: 'b-choice__badge b-badge' }, p.offer_id ? offerValue((S.data.offers || []).find((o) => o.id === p.offer_id)) || t('offer') : t('offer')),
    h('span', { class: 'b-choice__main' },
      h('span', { class: 'b-choice__title' }, pick(s, 'name')),
      h('span', { class: 'b-choice__meta' }, [dur(s.duration_min), desc].filter(Boolean).join(' · ')),
      later && h('span', { class: 'bk-svc__later' }, icon('sparkle'), `${offerDays(later)} ${offerValue(later)}`.trim()),
      s.location !== 'shop' && homeOn() && h('span', { class: 'bk-svc__home' }, icon('car'), t(s.location === 'mobile' ? 'bk.home_only' : 'bk.home_too'))),
    h('span', { class: 'b-choice__end' },
      offer && h('span', { class: 'b-choice__was' }, money(p.price)),
      h('span', { class: ['b-choice__price', offer && 'b-choice__price--offer'] }, priceText),
      s.per_person && h('span', { class: 'bk-svc__per' }, t('bk.per_person'))));
  }

  function stepService() {
    const list = servicesIn();
    const cats = (S.data.categories || []).filter((c) => list.some((s) => s.category_id === c.id));
    const menu = h('div', { class: 'bk-menu', 'aria-label': t('bk.q.service') });
    const groups = cats.map((c) => ({ title: pick(c, 'name'), items: list.filter((s) => s.category_id === c.id) }));
    const rest = list.filter((s) => !cats.some((c) => c.id === s.category_id));
    if (rest.length) groups.push({ title: groups.length ? t('bk.more_services') : null, items: rest });
    for (const g of groups) {
      menu.append(h('div', { class: 'bk-menu__group' },
        g.title && h('h2', { class: 'b-slots__label bk-menu__label' }, g.title),
        h('div', { class: 'b-choices' }, g.items.map(serviceCard))));
    }
    if (!list.length) menu.append(h('p', { class: 'b-mut' }, t('bk.no_services')));
    choose(menu, (v) => {
      if (S.service !== v) { S.service = v; resetAfterService(); }
      prefetchWhen();
      if (showWhere(svc())) loadLeaflet().catch(() => {});
    });
    return h('section', { class: 'b-step bk-step--service' },
      welcome(), offersBlock(),
      h('div', { class: 'b-step__head' },
        h('span', { class: 'b-eyebrow' }, t('step_of', { n: steps().indexOf('service') + 1, total: steps().length })),
        h('h2', { class: 'b-step__q' }, t('bk.q.service'))),
      menu);
  }

  function resetAfterService() {
    const s = svc();
    S.qty = 1;
    S.staff = 'any';
    S.loc = s?.location === 'mobile' ? 'mobile' : 'shop';
    S.day = null; S.slot = null; S.price = null;
    if (s?.section_id) S.section = s.section_id;
  }

  /* ---------- 3. party size ---------- */
  function stepQty() {
    const s = svc();
    const max = s.max_qty;
    const val = h('output', { class: 'bk-qty__val', 'aria-live': 'polite' });
    const each = h('p', { class: 'bk-qty__each' });
    const total = h('p', { class: 'bk-qty__total bk-num' });
    const minus = h('button', { type: 'button', class: 'b-stepper__btn bk-qty__btn', 'aria-label': t('bk.less'), onClick: () => set(S.qty - 1) }, icon('minus'));
    const plus = h('button', { type: 'button', class: 'b-stepper__btn bk-qty__btn', 'aria-label': t('bk.more'), onClick: () => set(S.qty + 1) }, icon('plus'));
    let shown = null;
    let chips = null;
    function paint() {
      chips?.querySelectorAll('.b-chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === String(S.qty))));
      val.textContent = num(S.qty);
      val.setAttribute('aria-label', qtyLabel(S.qty));
      minus.disabled = S.qty <= 1;
      plus.disabled = S.qty >= max;
      const p = estimate(S.data, s, S.qty, locFor(s));
      const unit = s.price?.price || 0;
      each.textContent = s.per_person ? `${num(S.qty)} × ${money(unit)}${p.discount ? ` − ${money(p.discount)}` : ''}` : '';
      animateNumber(total, shown ?? p.total, p.total, { format: (v) => money(v), step: 100 });
      shown = p.total;
    }
    function set(n) {
      const v = Math.max(1, Math.min(max, n));
      if (v === S.qty) return;
      S.qty = v; S.day = null; S.slot = null; S.price = null;
      haptic();
      paint();
      paintSummary();
      clearTimeout(set._t);
      set._t = setTimeout(prefetchWhen, 350);
    }
    chips = h('div', { class: 'b-chips bk-qty__chips', role: 'group', 'aria-label': t('bk.quick_pick') },
      [1, 2, 4, 6, 8].filter((n) => n <= max).map((n) => h('button', {
        type: 'button', class: 'b-chip', 'data-value': String(n), 'aria-pressed': S.qty === n,
        'aria-label': qtyLabel(n), onClick: () => set(n),
      }, num(n))));
    const wrap = h('div', { class: 'bk-qty' },
      h('div', { class: 'bk-qty__row' }, minus, val, plus),
      chips,
      h('div', { class: 'bk-qty__sum' }, each, total),
      h('p', { class: 'bk-qty__max' }, t('bk.max_party', { n: num(max) })));
    paint();
    return h('section', { class: 'b-step' }, stepHead(...HEADS.qty()), wrap);
  }

  /* ---------- 4. staff ---------- */
  function stepStaff() {
    const s = svc();
    const people = staffFor(s);
    const group = h('div', { class: 'b-choices' },
      h('button', { type: 'button', class: 'b-choice bk-any', 'data-value': 'any', 'aria-checked': S.staff === 'any' },
        h('span', { class: 'b-choice__media bk-any__mark' }, icon('sparkle')),
        h('span', { class: 'b-choice__main' },
          h('span', { class: 'b-choice__title' }, t('bk.any')),
          h('span', { class: 'b-choice__meta' }, t('bk.any_meta'))),
        h('span', { class: 'b-choice__end' }, h('span', { class: 'b-badge b-badge--soft' }, t('bk.fastest')))),
      people.map((p, i) => h('button', { type: 'button', class: 'b-choice', 'data-value': p.id, 'aria-checked': S.staff === p.id },
        h('span', { class: 'b-choice__media bk-chair' }, num(i + 1)),
        h('span', { class: 'b-choice__main' }, h('span', { class: 'b-choice__title' }, pick(p, 'label'))),
        icon('forward', { class: 'bk-choice__chev' }))));
    choose(group, (v) => {
      if (S.staff !== v) { S.staff = v; S.day = null; S.slot = null; }
      prefetchWhen();
    });
    return h('section', { class: 'b-step' }, stepHead(...HEADS.staff()), group);
  }

  /* ---------- 5. location ---------- */
  let leafletP = null;
  function loadLeaflet() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      if (!document.querySelector('link[data-leaflet]')) {
        document.head.append(h('link', { rel: 'stylesheet', href: VENDOR.leafletCss, 'data-leaflet': '', crossorigin: '' }));
      }
      const sc = h('script', { src: VENDOR.leafletJs, async: true, crossorigin: '' });
      sc.onload = () => (window.L?.map ? res(window.L) : rej(new Error('leaflet')));
      sc.onerror = () => { leafletP = null; sc.remove(); rej(new Error('leaflet')); };
      document.head.append(sc);
    });
    return leafletP;
  }
  const map = { m: null, invalidate() { try { this.m?.invalidateSize(); } catch { /* gone */ } } };

  function mapPanel() {
    const b = biz();
    const canvas = h('div', { class: 'bk-map__canvas', dir: 'ltr', 'aria-label': t('bk.map_label'), role: 'region' });
    const pin = h('div', { class: ['bk-map__pin', S.pinSet && 'is-set'], 'aria-hidden': 'true' },
      h('svg', { viewBox: '0 0 32 44' },
        h('path', { d: 'M16 43s14-14.6 14-26.4A14 14 0 0 0 2 16.6C2 28.4 16 43 16 43z' }),
        h('circle', { cx: 16, cy: 16.5, r: 5.2 })));
    const status = h('p', { class: 'bk-map__status', 'aria-live': 'polite' }, S.pinSet ? t('bk.pin_set') : t('bk.pin_hint'));
    const locBtn = h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--sm bk-map__me' },
      icon('pin'), h('span', null, t('bk.use_location')));
    const addr = field({
      label: t('bk.address'), name: 'address', autocomplete: 'street-address', value: S.address, maxlength: 300,
      hint: t('bk.address_hint'), onInput: (v) => { S.address = v; paintSummary(); },
    });
    const fee = flow().home?.fee_halalas || 0;
    const frame = h('div', { class: 'bk-map__frame' }, canvas, pin, h('span', { class: 'bk-map__shade', 'aria-hidden': 'true' }));
    const panel = h('div', { class: 'bk-map' },
      frame,
      h('div', { class: 'bk-map__bar' }, status, locBtn),
      addr.el,
      fee > 0 && h('p', { class: 'bk-note' }, icon('car'), t('bk.home_fee_note', { fee: money(fee), min: num(flow().home?.travel_min || 0) })));
    const setPin = (lat, lng) => {
      S.lat = Math.round(lat * 1e6) / 1e6; S.lng = Math.round(lng * 1e6) / 1e6; S.pinSet = true;
      pin.classList.add('is-set');
      status.textContent = t('bk.pin_set');
      paintSummary();
    };
    let touched = false;
    for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) canvas.addEventListener(ev, () => { touched = true; }, { passive: true });
    locBtn.addEventListener('click', () => {
      if (!navigator.geolocation) { toast(t('bk.geo_off'), { kind: 'warn' }); return; }
      locBtn.setAttribute('aria-busy', 'true');
      navigator.geolocation.getCurrentPosition((pos) => {
        locBtn.removeAttribute('aria-busy');
        const { latitude, longitude } = pos.coords;
        setPin(latitude, longitude);
        map.m?.setView([latitude, longitude], 17);
      }, () => {
        locBtn.removeAttribute('aria-busy');
        toast(t('bk.geo_off'), { kind: 'warn' });
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
    loadLeaflet().then((L) => {
      const start = () => {
        if (!canvas.isConnected) { requestAnimationFrame(start); return; }
        const center = S.lat != null ? [S.lat, S.lng] : (b.lat != null && b.lng != null ? [b.lat, b.lng] : JEDDAH);
        const m = L.map(canvas, { zoomControl: true, attributionControl: true }).setView(center, S.lat != null ? 17 : 12);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(m);
        m.on('moveend', () => { if (touched) { const c = m.getCenter(); setPin(c.lat, c.lng); } });
        map.m = m;
        frame.classList.add('is-ready');
        setTimeout(() => map.invalidate(), 350);
      };
      start();
    }).catch(() => {
      frame.classList.add('is-failed');
      canvas.replaceChildren(h('p', { class: 'bk-map__fail' }, t('bk.map_fail')));
    });
    return panel;
  }

  function stepWhere() {
    const s = svc();
    const b = biz();
    const fee = flow().home?.fee_halalas || 0;
    const parts = [stepHead(...HEADS.where())];
    const mapHost = h('div', { class: 'bk-where__map' });
    if (s.location === 'both') {
      const group = h('div', { class: 'b-choices' },
        h('button', { type: 'button', class: 'b-choice', 'data-value': 'shop', 'aria-checked': S.loc === 'shop' },
          h('span', { class: 'b-choice__media' }, icon('pin')),
          h('span', { class: 'b-choice__main' },
            h('span', { class: 'b-choice__title' }, t('bk.at_shop')),
            h('span', { class: 'b-choice__meta' }, pick(b, 'address') || bizName(b)))),
        h('button', { type: 'button', class: 'b-choice', 'data-value': 'mobile', 'aria-checked': S.loc === 'mobile' },
          h('span', { class: 'b-choice__media' }, icon('car')),
          h('span', { class: 'b-choice__main' },
            h('span', { class: 'b-choice__title' }, t('bk.at_home')),
            h('span', { class: 'b-choice__meta' }, t('bk.at_home_meta'))),
          h('span', { class: 'b-choice__end' }, h('span', { class: 'b-choice__price' }, fee ? signed(fee, '+') : t('free')))));
      selectable(group, {
        selector: '.b-choice',
        onChange: (v) => {
          S.loc = v; S.day = null; S.slot = null; S.price = null;
          paintSummary();
          prefetchWhen();
          if (v === 'mobile') { if (!mapHost.firstChild) mapHost.append(mapPanel()); mapHost.hidden = false; setTimeout(() => map.invalidate(), 60); }
          else { mapHost.hidden = true; setTimeout(() => { if (canContinue()) next(); }, 240); }
        },
      });
      parts.push(group);
      if (S.loc === 'mobile') mapHost.append(mapPanel()); else mapHost.hidden = true;
    } else {
      mapHost.append(mapPanel());
    }
    parts.push(mapHost);
    return h('section', { class: 'b-step' }, ...parts);
  }

  /* ---------- 6 + 7. day and time ---------- */
  function stepWhen() {
    const s = svc();
    const picker = whenPicker({
      data: S.data, query: query(), service: s, sectionId: secOf(s), day: S.day, t: S.slot?.t,
      onPick: ({ day, slot, price }) => {
        S.day = day; S.slot = slot; if (price) S.price = price;
        paintSummary();
      },
      onWaitlist: flow().waitlist ? (day) => waitlistSheet({
        data: S.data, service: s, day, qty: S.qty, preset: { name: S.name, phone: S.phone },
      }) : null,
    });
    S.picker = picker;
    return h('section', { class: 'b-step bk-step--when' }, stepHead(...HEADS.when()), picker.el);
  }

  /* ---------- 8. details ---------- */
  let det = null;
  function stepDetails() {
    const mode = flow().customer?.email || 'off';
    const name = field({ label: t('bk.your_name'), name: 'name', autocomplete: 'name', value: S.name, maxlength: 80, onInput: (v) => { S.name = v; } });
    const phone = field({
      label: t('phone'), type: 'tel', name: 'phone', autocomplete: 'tel', inputmode: 'tel', value: S.phone, maxlength: 20,
      hint: t('bk.phone_hint'), dir: 'ltr', onInput: (v) => { S.phone = v; },
    });
    const email = mode !== 'off' ? field({
      label: t('email'), type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', value: S.email,
      optional: mode === 'optional', maxlength: 120, dir: 'ltr', hint: t('bk.email_hint'), onInput: (v) => { S.email = v; },
    }) : null;
    const note = field({ label: t('bk.note'), name: 'note', multiline: true, optional: true, value: S.note, maxlength: 500, onInput: (v) => { S.note = v; } });
    const hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', value: S.website });
    hp.addEventListener('input', () => { S.website = hp.value; });
    phone.input.addEventListener('blur', () => {
      const n = F.normalizePhone(phone.input.value);
      if (phone.input.value.trim() && !n) phone.error(t('field.phone_invalid'));
    });
    det = { name, phone, email, note };
    for (const [k, msg] of Object.entries(S.errs)) det[k]?.error(msg);
    S.errs = {};
    const form = h('form', {
      class: 'bk-form', novalidate: true,
      onSubmit: (e) => { e.preventDefault(); onCta(); },
    },
    name.el, phone.el, email?.el, note.el,
    h('div', { class: 'bk-hp', 'aria-hidden': 'true' }, h('label', null, 'Website', hp)),
    h('button', { type: 'submit', hidden: true, tabindex: '-1' }));
    return h('section', { class: 'b-step' },
      stepHead(...HEADS.details()),
      form,
      h('p', { class: 'bk-privacy' }, lockIcon(), h('span', null, t('bk.privacy'))));
  }
  function relabelDetails() {
    if (!det) return;
    const relabel = (f, key, opt) => {
      if (!f) return;
      const lab = f.el.querySelector('.b-field__label');
      lab.textContent = opt ? `${t(key)} · ${t('optional')}` : t(key);
    };
    relabel(det.name, 'bk.your_name');
    relabel(det.phone, 'phone');
    relabel(det.email, 'email', flow().customer?.email === 'optional');
    relabel(det.note, 'bk.note', true);
    const p = ui.stage.querySelector('.bk-privacy span');
    if (p) p.textContent = t('bk.privacy');
  }
  function validateDetails() {
    if (!det) return true;
    let first = null;
    const bad = (f, msg) => { f.error(msg); first = first || f.input; };
    if (S.name.trim().length < 2) bad(det.name, t('err.BAD_NAME'));
    if (!F.normalizePhone(S.phone)) bad(det.phone, S.phone.trim() ? t('field.phone_invalid') : t('field.required'));
    const mode = flow().customer?.email || 'off';
    if (det.email) {
      if (mode === 'required' && !S.email.trim()) bad(det.email, t('field.required'));
      else if (S.email.trim() && !validEmail(S.email)) bad(det.email, t('field.email_invalid'));
    }
    if (first) { first.focus(); haptic([10, 40, 10]); return false; }
    return true;
  }

  /* ---------- 9. review ---------- */
  function stepReview() {
    const s = svc();
    const p = curPrice();
    const due = dueNow(flow(), p.total);
    const late = S.slot ? dayMinutes(S.slot.t, S.day) >= 1440 : false;
    const row = (k, v, edit, cls) => h('div', { class: ['b-kv__row', cls] },
      h('dt', { class: 'b-kv__k' }, k),
      h('dd', { class: 'b-kv__v' }, v, edit && h('button', {
        type: 'button', class: 'bk-edit', onClick: () => go(edit, 'back'), 'aria-label': `${t('change')} · ${k}`,
      }, t('change'))));
    const staff = showStaff(s) ? (S.staff === 'any' ? t('bk.any') : pick(staffFor(s).find((x) => x.id === S.staff), 'label')) : null;
    const where = locFor(s) === 'mobile'
      ? h('span', null, S.address.trim() || t('bk.home_pinned'), h('small', { class: 'bk-kv__sub' }, t('bk.home_visit')))
      : h('span', null, pick(biz(), 'address') || bizName(biz()));
    const facts = h('dl', { class: 'b-kv bk-kv' },
      row(t('service'), h('span', null, pick(s, 'name'), showQty(s) && h('small', { class: 'bk-kv__sub' }, qtyLabel(S.qty))), 'service'),
      staff && row(t('bk.with'), staff, 'staff'),
      row(t('date'), h('span', null, F.dateLong(S.day, lang()), hijriOn(S.data) && h('small', { class: 'bk-kv__sub' }, F.hijri(S.day, lang()))), 'when'),
      row(t('time'), timeLabel(S.slot.t, late), 'when'),
      row(t('bk.where_k'), where, showWhere(s) ? 'where' : null),
      row(t('bk.contact'), h('span', null, S.name.trim(), h('small', { class: 'bk-kv__sub bk-phone', dir: 'ltr' }, F.formatPhone(S.phone, lang()).replace(/[⁦-⁩]/g, ''))), 'details'));
    const offerTitle = p.discount > 0 ? (lang() === 'en' ? p.offer_en || p.offer_ar : p.offer_ar || p.offer_en) : '';
    const priceRows = h('dl', { class: 'b-kv bk-kv' },
      row(showQty(s) && s.per_person ? `${pick(s, 'name')} × ${num(S.qty)}` : pick(s, 'name'), money(p.price)),
      p.discount > 0 && row(h('span', null, t('bk.discount'), offerTitle && h('small', { class: 'bk-kv__sub' }, offerTitle)), signed(p.discount, '−'), null, 'bk-kv--offer'),
      p.fee > 0 && row(t('bk.home_fee'), signed(p.fee, '+')),
      row(t('total'), money(p.total), null, 'b-kv__row--total'),
      due > 0 && row(h('span', null, t('bk.pay_now'), h('small', { class: 'bk-kv__sub' }, depositLabel())), money(due), null, 'bk-kv--due'),
      due > 0 && due < p.total && row(t('bk.pay_at_shop'), money(p.total - due)));
    const sm = flow().self_manage;
    return h('section', { class: 'b-step' },
      stepHead(...HEADS.review()),
      h('div', { class: 'b-card bk-card' }, facts),
      h('div', { class: 'b-card bk-card bk-card--price' }, priceRows),
      due > 0 && h('p', { class: 'bk-note' }, lockIcon(), t('bk.pay_note', { min: num(flow().hold_min || 15) })),
      sm?.on && h('p', { class: 'bk-note' }, icon('info'), t('bk.policy', { hours: tn('hours', sm.cutoff_hours ?? 3) })),
      h('p', { class: 'bk-note bk-note--vat' }, t('vat_included')));
  }
  function depositLabel() {
    const pay = flow().payment || {};
    if (pay.mode === 'full') return t('bk.full_now');
    return pay.deposit_kind === 'amount' ? t('bk.deposit') : t('bk.deposit_pct', { n: num(pay.deposit_value) });
  }

  /* ---------- submit ---------- */
  async function onCta() {
    if (sum.cta.disabled && S.cur !== 'details') return;
    if (S.cur === 'details') { if (validateDetails()) next(); return; }
    if (S.cur !== 'review') { if (canContinue()) next(); return; }
    if (S.busy) return;
    S.busy = true;
    sum.cta.setAttribute('aria-busy', 'true');
    const s = svc();
    const loc = locFor(s);
    try {
      const r = await rpc('pub_book', {
        service_id: s.id, start: S.slot.t, name: S.name.trim(), phone: F.normalizePhone(S.phone) || S.phone,
        email: S.email.trim() || undefined, note: S.note.trim() || undefined,
        section_id: showSections() ? secOf(s) : undefined,
        staff_id: showStaff(s) && S.staff !== 'any' ? S.staff : undefined,
        qty: S.qty, location: loc,
        lat: loc === 'mobile' && S.pinSet ? S.lat : undefined, lng: loc === 'mobile' && S.pinSet ? S.lng : undefined,
        address: loc === 'mobile' ? S.address.trim() || undefined : undefined,
        lang: lang(), source, website: S.website,
      });
      invalidate('pub_days');
      invalidate('pub_slots');
      if (!r.booking_id) { // the honeypot answer: polite, stores nothing
        S.done = { bot: true };
        ui.stage.replaceChildren(messageStep({ mark: 'check', title: t('bk.done.title'), text: '' }));
        paintChrome();
        return;
      }
      saveBooking({ ...r, slug: biz().slug });
      if (r.status === 'pending_payment') { toPay(r); return; }
      let view;
      try { view = await rpc('pub_booking', { token: r.token }); } catch { view = viewFromBooking(r); }
      S.done = { view, token: r.token };
      haptic([10, 30, 10]);
      showDone();
      post({ type: EMBED.BOOKED, ref: r.ref, starts_at: r.starts_at, service_id: s.id });
    } catch (e) {
      onBookError(e);
    } finally {
      S.busy = false;
      sum.cta.removeAttribute('aria-busy');
      paintSummary();
    }
  }

  function viewFromBooking(r) {
    return {
      booking: { ...r, id: r.booking_id, service_id: svc()?.id, section_id: secOf(svc()), address: S.address, paid_halalas: 0 },
      business: biz(), can_cancel: false, can_reschedule: false,
    };
  }

  function onBookError(e) {
    const code = e?.code;
    if (code === 'SLOT_TAKEN' || code === 'TOO_SOON') {
      invalidate('pub_days'); invalidate('pub_slots');
      S.slot = null;
      go('when', 'back', { push: false });
      try { history.replaceState({ bk: 'when' }, ''); } catch { /* ignore */ }
      toast(t(errorKey(e)), { kind: 'warn', timeout: 5000 });
      return;
    }
    if (code === 'BAD_NAME' || code === 'BAD_PHONE' || code === 'BAD_EMAIL') {
      S.errs = { [code === 'BAD_NAME' ? 'name' : code === 'BAD_PHONE' ? 'phone' : 'email']: t(errorKey(e)) };
      go('details', 'back', { push: false });
      return;
    }
    if (code === 'NEED_LOCATION' && showWhere(svc())) {
      go('where', 'back', { push: false });
      toast(t(errorKey(e)), { kind: 'warn' });
      return;
    }
    if (code === 'NOT_FOUND') { refreshCatalog(true); }
    toast(t(errorKey(e)), { kind: 'err', timeout: 5000 });
  }

  function toPay(r) {
    let url = `${URLS.pay(r.booking_id, r.token)}&lang=${lang()}`;
    if (embed) {
      const back = document.referrer || hostOrigin;
      if (back && /^https?:/.test(back)) url += `&back=${encodeURIComponent(back)}`;
      const abs = new URL(url, location.origin).href;
      S.done = { pay: abs };
      ui.stage.replaceChildren(h('section', { class: 'b-step bk-msg' },
        h('div', { class: 'b-empty' },
          h('span', { class: 'b-empty__mark' }, lockIcon()),
          h('h1', { class: 'b-empty__title', 'data-step-focus': '' }, t('bk.to_pay')),
          h('p', { class: 'b-empty__text' }, t('bk.to_pay_text', { min: num(flow().hold_min || 15) })),
          h('a', { class: 'b-btn b-btn--primary', href: abs, target: '_top' }, h('span', null, t('bk.continue_pay'))))));
      paintChrome();
      post({ type: EMBED.PAY, url: abs });
      return;
    }
    location.assign(url);
  }

  /* ---------- 10. confirmation ---------- */
  function doneEl() {
    const d = S.done;
    if (!d?.view) return messageStep({ mark: 'check', title: t('bk.done.title') });
    return confirmationStep(d.view, d.token, S.data, { onAnother: () => restart(null) });
  }
  function showDone() {
    S.cur = null;
    stepTransition(ui.stage, doneEl(), 'forward');
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* old */ }
    if (!embed) { try { history.replaceState({ bk: 'done' }, ''); } catch { /* ignore */ } }
    paintChrome();
  }

  function restart(service) {
    Object.assign(S, {
      done: null, section: null, service: null, qty: 1, staff: 'any', loc: 'shop', lat: null, lng: null, pinSet: false,
      address: '', day: null, slot: null, price: null, note: '', errs: {},
    });
    start(service, 'back');
  }

  function start(preset, dir) {
    const list0 = steps();
    let first = list0[0];
    const pre = preset && S.data.services.find((s) => s.id === preset);
    if (pre) {
      S.service = pre.id;
      resetAfterService();
      const list = steps();
      first = list[list.indexOf('service') + 1] || 'when';
      prefetchWhen();
      if (showWhere(pre)) loadLeaflet().catch(() => {});
    }
    S.cur = first;
    if (!embed) { try { history.replaceState({ bk: first }, ''); S.pushed = false; } catch { /* ignore */ } }
    render(dir || null);
    if (!dir) {
      const f = ui.stage.querySelector('[data-step-focus], .b-step__q');
      if (f && embed) { f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); }
    }
  }

  /* ---------- live ---------- */
  async function refreshCatalog(force = true) {
    let d;
    try { d = await cached('pub_business', { slug }, { force, ttl: 1000 }); } catch { return; }
    S.data = d;
    useTheme(d.business);
    ui.setLogo(d.business.theme?.logo_url);
    invalidate('pub_slots');
    if (S.service && !svc()) {
      S.service = null; S.slot = null;
      if (!S.done) { toast(t('bk.service_gone'), { kind: 'warn' }); go('service', 'back', { push: false }); }
      return;
    }
    if (S.done) return;
    if (['section', 'service', 'qty', 'staff', 'review'].includes(S.cur)) rerender();
    else if (S.cur === 'when' && S.picker) S.picker.refresh();
    else if (S.day && query()) {
      cached('pub_slots', { ...query(), day: S.day }, { force: true }).then((r) => { S.price = r.price || S.price; paintSummary(); }).catch(() => {});
    }
    paintSummary();
  }
  async function refreshSlots() {
    invalidate('pub_days');
    invalidate('pub_slots');
    if (S.done || !query()) return;
    if (S.cur === 'when' && S.picker) {
      const had = S.slot?.t;
      await S.picker.refresh();
      if (had && !S.picker.t) toast(t('bk.slot_gone'), { kind: 'warn', timeout: 5000 });
      return;
    }
    if (S.slot && ['details', 'review'].includes(S.cur)) {
      try {
        const r = await cached('pub_slots', { ...query(), day: S.day }, { force: true });
        if (!(r.slots || []).some((x) => x.t === S.slot.t)) {
          S.slot = null;
          go('when', 'back', { push: false });
          toast(t('bk.slot_gone'), { kind: 'warn', timeout: 5000 });
        } else { S.price = r.price || S.price; paintSummary(); }
      } catch { /* offline: the server still guards the booking */ }
    }
  }
  live(biz().id, async (k) => {
    if (k.catalog) await refreshCatalog(true);
    if (k.slots && !(k.catalog && S.cur === 'when')) await refreshSlots();
  });

  /* ---------- language ---------- */
  onLang(() => {
    ui.relabel();
    if (!embed) document.title = pageTitle();
    rerender();
  });
  const pageTitle = () => `${t('bk.title')} · ${bizName(biz())}`;
  if (!embed) document.title = pageTitle();

  /* ---------- embed wiring ---------- */
  if (embed) {
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent) return;
      if (hostOrigin && e.origin !== hostOrigin) return;
      const m = e.data;
      if (!m || typeof m !== 'object' || m.type !== EMBED.OPEN) return;
      if (m.lang === 'ar' || m.lang === 'en') businessLang(biz().langs, m.lang);
      const sid = typeof m.service_id === 'string' ? m.service_id : null;
      if (S.done) restart(sid);
      else if (sid && sid !== S.service) restart(sid);
      const f = ui.stage.querySelector('[data-step-focus], .b-step__q');
      if (f) { f.setAttribute('tabindex', '-1'); setTimeout(() => f.focus({ preventScroll: true }), 60); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.querySelector('.b-overlay')) post({ type: EMBED.CLOSE });
    });
    let lastH = 0;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const hgt = Math.ceil(ui.bar.offsetHeight + ui.inner.offsetHeight + (summary.hidden ? 0 : summary.offsetHeight) + ui.foot.offsetHeight);
      if (Math.abs(hgt - lastH) > 4) { lastH = hgt; post({ type: EMBED.HEIGHT, h: hgt }); }
    };
    try {
      const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(measure); });
      ro.observe(ui.inner);
      ro.observe(summary);
    } catch { /* old engine */ }
  }

  /* ---------- go ---------- */
  const STEP = {
    section: stepSection, service: stepService, qty: stepQty, staff: stepStaff, where: stepWhere,
    when: stepWhen, details: stepDetails, review: stepReview,
  };
  start(serviceId, null);
  post({ type: EMBED.READY });

  function fail(e) {
    const nf = e?.code === 'NOT_FOUND' || !slug;
    ui.setTitle(t('bk.title'));
    ui.stage.replaceChildren(messageStep({
      mark: nf ? 'alert' : 'info',
      title: nf ? t('bk.nf.title') : t(errorKey(e)),
      text: nf ? t('bk.nf.text') : '',
      actions: nf
        ? [h('a', { class: 'b-btn b-btn--ghost', href: 'https://mamar.site', target: embed ? '_top' : null }, h('span', null, t('bk.nf.home')))]
        : [h('button', { type: 'button', class: 'b-btn b-btn--primary', onClick: () => location.reload() }, h('span', null, t('retry')))],
    }));
    if (!embed) document.title = t('bk.title');
    post({ type: EMBED.READY });
  }
}
