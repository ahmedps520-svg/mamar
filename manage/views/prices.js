/* ==========================================================
   Prices & services — live prices are the headline feature.
   Services grouped by category with inline SAR edit, active
   toggle and reorder; the service editor; categories; offers
   with a live customer preview.
   ========================================================== */

import {
  S, t, tn, fmt, h, icon, on, call, errText, nm, fm, dg, cfg, ent, emptyState, btn, seg, chips, stepper,
  field, sarField, selectField, switchRow, switchEl, busy, toast, haptic, openSheet, parseSar, sarValue, bizName,
  studioWa, loadOverview, dur, L, pref,
} from '../core.js';
import { reduced } from '../../platform/ui/kit.js';

const SVC_FIELDS = ['name_ar', 'name_en', 'desc_ar', 'desc_en', 'duration_min', 'buffer_min', 'step_min', 'mode', 'resource_id',
  'max_qty', 'per_person', 'price_halalas', 'price_from', 'location', 'active', 'sort', 'section_id', 'category_id'];
const payload = (s, patch = {}) => {
  const out = { id: s.id };
  for (const k of SVC_FIELDS) out[k] = s[k] ?? null;
  return { ...out, ...patch };
};
const maxServices = () => Number(ent().max_services ?? 15);
const activeCount = () => (S.ov?.services || []).filter((s) => s.active).length;

/** Save one service and keep the local copy in step (the live ping reloads the rest). */
async function saveService(s, patch, { quiet } = {}) {
  const body = payload(s, patch);
  const r = await call('own_service_upsert', { service: body }, { quiet });
  const local = S.ov.services.find((x) => x.id === (s.id || r.id));
  if (local) Object.assign(local, patch);
  return r;
}

export function mount(main, { sub } = {}) {
  const wide = window.matchMedia('(min-width: 1024px)');
  let tab = ['services', 'offers', 'categories'].includes(sub) ? sub : pref.get('mamar-manage-prtab', 'services');
  let reorder = false;
  let editing = false;     // an inline price input is open: hold repaints until it closes
  let pending = false;

  const root = h('div', { class: 'mg-prices' });
  main.replaceChildren(root);

  const tabSeg = seg([
    { value: 'services', label: t('mg.pr.services') },
    { value: 'offers', label: t('mg.pr.offers') },
    { value: 'categories', label: t('mg.pr.categories') },
  ], tab, (v) => { tab = v; pref.set('mamar-manage-prtab', v); layout(); }, { label: t('mg.pr.title') });

  const svcBox = h('section', { class: 'mg-pane mg-pane--services', 'aria-label': t('mg.pr.services') });
  const offBox = h('section', { class: 'mg-pane mg-pane--offers', 'aria-label': t('mg.pr.offers') });
  const catBox = h('section', { class: 'mg-pane mg-pane--cats', 'aria-label': t('mg.pr.categories') });

  root.append(
    h('div', { class: 'mg-pagehead' },
      h('div', null,
        h('h1', { class: 'mg-pagehead__title' }, t('mg.pr.title')),
        h('p', { class: 'mg-pagehead__sub' }, h('span', { class: 'mg-livedot', 'aria-hidden': 'true' }), t('mg.pr.live_hint')))),
    h('div', { class: 'mg-prtabs' }, tabSeg),
    h('div', { class: 'mg-prgrid' }, svcBox, h('div', { class: 'mg-prside' }, offBox, catBox)));

  function layout() {
    const w = wide.matches;
    root.classList.toggle('is-wide', w);
    svcBox.hidden = !w && tab !== 'services';
    offBox.hidden = !w && tab !== 'offers';
    catBox.hidden = !w && tab !== 'categories';
  }

  /* ---------- services ---------- */

  function groups() {
    const cats = (S.ov.categories || []).slice().sort((a, b) => a.sort - b.sort);
    const svcs = (S.ov.services || []).slice().sort((a, b) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)));
    const out = cats.map((c) => ({ cat: c, items: svcs.filter((s) => s.category_id === c.id) }));
    const rest = svcs.filter((s) => !s.category_id || !cats.some((c) => c.id === s.category_id));
    if (rest.length) out.push({ cat: null, items: rest });
    return out.filter((g) => g.items.length);
  }

  function priceCell(s) {
    const show = () => {
      const b = h('button', {
        type: 'button', class: 'mg-price', 'aria-label': t('mg.pr.edit_price', { name: nm(s) }),
        onClick: () => editPrice(s, wrap),
      },
        s.price_from && h('small', { class: 'mg-price__from' }, t('from_price', { price: '' }).trim()),
        h('span', { class: 'mg-price__v' }, fm(s.price_halalas, { free: true })),
        s.per_person && h('small', { class: 'mg-price__per' }, t('mg.pr.per_person')),
        s.price && s.price.discount > 0 && h('span', { class: 'mg-price__offer' }, fm(s.price.total)));
      return b;
    };
    const wrap = h('span', { class: 'mg-pricecell' }, show());
    wrap.reset = () => wrap.replaceChildren(show());
    return wrap;
  }

  function editPrice(s, wrap) {
    editing = true;
    const input = h('input', {
      class: 'mg-priceinput__input', inputmode: 'decimal', autocomplete: 'off', dir: 'ltr', enterkeyhint: 'done',
      'aria-label': t('mg.pr.edit_price', { name: nm(s) }), value: sarValue(s.price_halalas),
    });
    const box = h('span', { class: 'mg-priceinput' }, input, h('span', { class: 'mg-priceinput__unit' }, t('sar')));
    wrap.replaceChildren(box);
    input.focus();
    input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      const v = parseSar(input.value);
      if (commit && (v == null || Number.isNaN(v))) {
        box.classList.add('is-invalid');
        toast(t('mg.pr.bad_price'), { kind: 'err' });
        input.focus();
        return;
      }
      done = true;
      if (!commit || v === s.price_halalas) { editing = false; wrap.reset(); flush(); return; }
      box.classList.add('is-saving');
      input.disabled = true;
      try {
        await saveService(s, { price_halalas: v }, { quiet: true });
        haptic(10);
        wrap.reset();
        const p = wrap.querySelector('.mg-price');
        p?.classList.add('is-live');
        p?.focus({ preventScroll: true });
        toast(t('mg.pr.live'), { kind: 'ok' });
      } catch (e) {
        toast(errText(e), { kind: 'err' });
        wrap.reset();
      } finally {
        editing = false;
        flush();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function svcRow(s, g, i) {
    const sub = [dur(s.duration_min)];
    if (s.mode === 'capacity') {
      const r = S.ov.resources.find((x) => x.id === s.resource_id);
      if (r) sub.push(nm(r, 'label'));
      if (s.per_person) sub.push(t('mg.pr.per_person'));
    }
    if (s.location === 'mobile') sub.push(t('mg.svc.loc_mobile'));
    if (s.location === 'both') sub.push(t('mg.svc.loc_both'));
    const row = h('div', { class: ['b-row', 'mg-svcrow', !s.active && 'is-hidden'], 'data-id': s.id, role: 'listitem' },
      reorder && h('button', { type: 'button', class: 'mg-handle', 'aria-label': t('mg.pr.drag'), title: t('mg.pr.drag') }, gripIcon()),
      h('button', { type: 'button', class: 'mg-svcrow__main', onClick: () => openServiceEditor(s), 'aria-label': t('mg.pr.edit', { name: nm(s) }) },
        h('span', { class: 'b-row__title' }, nm(s)),
        h('span', { class: 'b-row__sub' }, s.active ? sub.join(' · ') : `${t('mg.pr.hidden')} · ${sub.join(' · ')}`)),
      reorder
        ? h('span', { class: 'mg-arrows' },
          h('button', { type: 'button', class: 'b-iconbtn', 'aria-label': t('mg.pr.move_up'), disabled: i === 0, onClick: () => move(g, i, -1) }, icon('arrowUp')),
          h('button', { type: 'button', class: 'b-iconbtn', 'aria-label': t('mg.pr.move_down'), disabled: i === g.items.length - 1, onClick: () => move(g, i, 1) }, icon('arrowDown')))
        : priceCell(s),
      !reorder && switchEl({
        checked: s.active, label: `${nm(s)} · ${t('mg.pr.shown')}`,
        onChange: async (v, input) => {
          try {
            await saveService(s, { active: v }, { quiet: true });
            row.classList.toggle('is-hidden', !v);
            toast(t('mg.pr.live'), { kind: 'ok' });
            paintLimit();
          } catch (e) { input.checked = !v; toast(errText(e), { kind: 'err' }); }
        },
      }));
    if (reorder) dragify(row, g);
    return row;
  }

  async function saveOrder(order) {
    // order: array of service objects in their new global order
    const changed = [];
    order.forEach((s, idx) => { const sort = (idx + 1) * 10; if (s.sort !== sort) changed.push([s, sort]); });
    if (!changed.length) return;
    try {
      for (const [s, sort] of changed) await saveService(s, { sort }, { quiet: true });
      toast(t('mg.pr.order_saved'), { kind: 'ok', timeout: 1600 });
    } catch (e) { toast(errText(e), { kind: 'err' }); }
    paintServices();
  }
  const globalOrder = (gs) => gs.flatMap((g) => g.items);
  function move(g, i, d) {
    const gs = groups();
    const gg = gs.find((x) => (x.cat?.id || null) === (g.cat?.id || null));
    const items = gg.items;
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    haptic();
    saveOrder(globalOrder(gs));
  }

  function dragify(row, g) {
    const handle = row.querySelector('.mg-handle');
    let startY = 0;
    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
      row.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const listEl = row.parentElement;
      const dy = e.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      const sibs = [...listEl.children].filter((x) => x !== row);
      const mid = row.getBoundingClientRect().top + row.offsetHeight / 2;
      for (const sb of sibs) {
        const r = sb.getBoundingClientRect();
        const c = r.top + r.height / 2;
        if (dy > 0 && mid > c && sb.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING) {
          listEl.insertBefore(row, sb.nextSibling); startY += r.height; row.style.transform = `translateY(${e.clientY - startY}px)`; break;
        }
        if (dy < 0 && mid < c && sb.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) {
          listEl.insertBefore(row, sb); startY -= r.height; row.style.transform = `translateY(${e.clientY - startY}px)`; break;
        }
      }
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      row.classList.remove('is-dragging');
      row.style.transform = '';
      const ids = [...row.parentElement.children].map((x) => x.dataset.id);
      const gs = groups();
      const gg = gs.find((x) => (x.cat?.id || null) === (g.cat?.id || null));
      gg.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      saveOrder(globalOrder(gs));
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  const limitBox = h('div', { class: 'mg-limitwrap' });
  function paintLimit() {
    const max = maxServices();
    const n = activeCount();
    limitBox.replaceChildren(n >= max ? limitCard(max) : h('p', { class: 'mg-fine' }, t('mg.pr.count', { shown: dg(n), max: dg(max) })));
  }

  function paintServices() {
    if (!S.ov) return;
    const addBtn = btn(t('mg.pr.add'), { kind: 'primary', icon: 'plus', onClick: () => openServiceEditor(null) });
    const reorderBtn = btn(reorder ? t('done') : t('mg.pr.reorder'), {
      kind: 'quiet', 'aria-pressed': String(reorder),
      onClick: () => { reorder = !reorder; paintServices(); },
    });
    const gs = groups();
    paintLimit();
    svcBox.replaceChildren(
      h('div', { class: 'mg-sechead' },
        h('div', { class: 'mg-sechead__text' }, h('h2', { class: 'mg-sechead__title' }, t('mg.pr.services'))),
        h('div', { class: 'mg-sechead__actions' }, gs.length > 0 && reorderBtn, addBtn)),
      limitBox,
      ...(gs.length ? gs.map((g) => h('div', { class: 'mg-svcgroup' },
        h('h3', { class: 'mg-label' }, g.cat ? nm(g.cat) : t('mg.pr.other'), h('small', null, tn('mg.services', g.items.length))),
        h('div', { class: ['b-list', 'mg-svclist', reorder && 'is-reorder'], role: 'list' }, g.items.map((s, i) => svcRow(s, g, i)))))
        : [emptyState('sparkle', t('mg.new.no_services'), null)]));
  }

  /* ---------- offers ---------- */

  function offerState(o) {
    const now = Date.now();
    if (!o.active) return ['paused', 'mg.off.paused'];
    if (o.ends_at && new Date(o.ends_at) <= now) return ['ended', 'mg.off.ended'];
    if (o.starts_at && new Date(o.starts_at) > now) return ['scheduled', 'mg.off.scheduled'];
    return ['running', 'mg.off.running'];
  }

  function paintOffers() {
    if (!S.ov) return;
    const offers = S.ov.offers || [];
    offBox.replaceChildren(
      h('div', { class: 'mg-sechead' },
        h('div', { class: 'mg-sechead__text' }, h('h2', { class: 'mg-sechead__title' }, t('mg.pr.offers'))),
        btn(t('mg.off.new'), { kind: 'ghost', icon: 'plus', onClick: () => openOfferEditor(null) })),
      offers.length
        ? h('div', { class: 'mg-offers' }, offers.map((o) => {
          const [k, key] = offerState(o);
          return h('div', { class: ['mg-offer', `is-${k}`] },
            h('button', { type: 'button', class: 'mg-offer__main', onClick: () => openOfferEditor(o) },
              h('span', { class: 'mg-offer__top' },
                h('span', { class: `mg-offerstate mg-offerstate--${k}` }, t(key)),
                o.kind !== 'banner' && h('span', { class: 'b-badge b-badge--soft' }, offerValue(o))),
              h('span', { class: 'mg-offer__title' }, nm(o, 'title')),
              h('span', { class: 'mg-offer__sub' }, offerSummary(o, { short: true }))),
            switchEl({
              checked: o.active, label: `${nm(o, 'title')} · ${t('mg.off.active')}`,
              onChange: async (v, input) => {
                try {
                  await call('own_offer_upsert', { offer: offerPayload(o, { active: v }) }, { quiet: true });
                  o.active = v;
                  toast(v ? t('mg.off.saved') : t('mg.off.saved_off'), { kind: 'ok' });
                  paintOffers();
                } catch (e) { input.checked = !v; toast(errText(e), { kind: 'err' }); }
              },
            }));
        }))
        : emptyState('sparkle', t('mg.off.none'), t('mg.off.none_text')));
  }

  /* ---------- categories ---------- */

  function paintCats() {
    if (!S.ov) return;
    const cats = (S.ov.categories || []).slice().sort((a, b) => a.sort - b.sort);
    const count = (id) => S.ov.services.filter((s) => s.category_id === id).length;
    const moveCat = async (i, d) => {
      const j = i + d;
      if (j < 0 || j >= cats.length) return;
      [cats[i], cats[j]] = [cats[j], cats[i]];
      haptic();
      try {
        for (const [idx, c] of cats.entries()) {
          const sort = (idx + 1) * 10;
          if (c.sort !== sort) { await call('own_category_upsert', { category: { id: c.id, name_ar: c.name_ar, name_en: c.name_en, section_id: c.section_id, sort } }, { quiet: true }); c.sort = sort; }
        }
        toast(t('mg.pr.order_saved'), { kind: 'ok', timeout: 1600 });
      } catch (e) { toast(errText(e), { kind: 'err' }); }
      paintCats();
      paintServices();
    };
    catBox.replaceChildren(
      h('div', { class: 'mg-sechead' },
        h('div', { class: 'mg-sechead__text' }, h('h2', { class: 'mg-sechead__title' }, t('mg.pr.categories'))),
        btn(t('mg.cat.new'), { kind: 'ghost', icon: 'plus', onClick: () => openCategory(null) })),
      cats.length
        ? h('div', { class: 'b-list' }, cats.map((c, i) => h('div', { class: 'b-row mg-catrow' },
          h('button', { type: 'button', class: 'mg-svcrow__main', onClick: () => openCategory(c) },
            h('span', { class: 'b-row__title' }, nm(c)),
            h('span', { class: 'b-row__sub' }, tn('mg.services', count(c.id)))),
          h('span', { class: 'mg-arrows' },
            h('button', { type: 'button', class: 'b-iconbtn', 'aria-label': `${nm(c)} · ${t('mg.pr.move_up')}`, disabled: i === 0, onClick: () => moveCat(i, -1) }, icon('arrowUp')),
            h('button', { type: 'button', class: 'b-iconbtn', 'aria-label': `${nm(c)} · ${t('mg.pr.move_down')}`, disabled: i === cats.length - 1, onClick: () => moveCat(i, 1) }, icon('arrowDown'))))))
        : emptyState('inbox', t('mg.cat.none'), t('mg.cat.none_text')));
  }

  function paintAll() {
    if (editing || document.querySelector('.b-overlay')) { pending = true; return; }
    pending = false;
    paintServices();
    paintOffers();
    paintCats();
    layout();
  }
  function flush() { if (pending) paintAll(); }

  paintAll();
  const offs = [on('overview', paintAll), on('sheet-closed', flush)];
  const onMq = () => layout();
  wide.addEventListener('change', onMq);
  return () => { offs.forEach((f) => f()); wide.removeEventListener('change', onMq); };
}

/* ---------- shared bits ---------- */

function gripIcon() {
  return h('svg', { viewBox: '0 0 24 24', class: 'b-icon', 'aria-hidden': 'true', focusable: 'false' },
    h('path', { d: 'M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01', 'stroke-width': 2.6 }));
}

function limitCard(max) {
  const url = studioWa(t('mg.pr.upgrade_msg', { biz: bizName() }));
  return h('div', { class: 'mg-limit', role: 'note' },
    h('div', { class: 'mg-limit__mark' }, icon('sparkle')),
    h('div', { class: 'mg-limit__text' },
      h('strong', null, t('mg.pr.limit_title')),
      h('p', null, t('mg.pr.limit_text', { n: max }))),
    url && h('a', { class: 'b-btn b-btn--primary b-btn--sm', href: url, target: '_blank', rel: 'noopener' }, h('span', null, t('mg.pr.upgrade'))));
}

const DURATIONS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480, 600, 720];
const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
const STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const minuteOptions = (list, cur) => [...new Set([...list, cur].filter((x) => x != null))].sort((a, b) => a - b)
  .map((m) => ({ value: m, label: m === 0 ? t('mg.svc.none') : dur(m) }));

export function openServiceEditor(s0) {
  const isNew = !s0;
  if (isNew && activeCount() >= maxServices()) {
    return openSheet({ title: t('mg.pr.add'), build: () => h('div', { class: 'mg-step' }, limitCard(maxServices())) });
  }
  const ov = S.ov;
  const caps = ov.resources.filter((r) => r.active);
  const s = s0 ? { ...s0 } : {
    id: null, name_ar: '', name_en: '', desc_ar: '', desc_en: '', duration_min: 30, buffer_min: 0, step_min: 15,
    mode: ov.services.some((x) => x.mode === 'capacity') && !ov.staff.length ? 'capacity' : 'staff',
    resource_id: caps[0]?.id || null, max_qty: 1, per_person: false, price_halalas: 0, price_from: false, location: 'shop',
    active: true, sort: (Math.max(0, ...ov.services.map((x) => x.sort || 0)) + 10), section_id: null, category_id: null,
  };
  const homeOn = !!ent().home_service;

  return openSheet({
    title: isNew ? t('mg.svc.new') : t('mg.svc.edit'),
    wide: true,
    build: (ctx) => {
      const nameAr = field({ label: t('mg.svc.name_ar'), value: s.name_ar, maxlength: 80, dir: 'rtl' });
      const nameEn = field({ label: t('mg.svc.name_en'), value: s.name_en, maxlength: 80, dir: 'ltr' });
      const descAr = field({ label: t('mg.optional_x', { label: t('mg.svc.desc_ar') }), value: s.desc_ar, multiline: true, maxlength: 300, dir: 'rtl' });
      const descEn = field({ label: t('mg.optional_x', { label: t('mg.svc.desc_en') }), value: s.desc_en, multiline: true, maxlength: 300, dir: 'ltr' });
      const price = sarField({ label: t('price'), halalas: s.price_halalas });
      const from = switchRow({ label: t('mg.svc.price_from'), checked: s.price_from, onChange: (v) => { s.price_from = v; } });
      const cat = selectField({
        label: t('mg.svc.category'), value: s.category_id || '',
        options: [{ value: '', label: t('mg.svc.none') }, ...ov.categories.map((c) => ({ value: c.id, label: nm(c) }))],
        onChange: (v) => { s.category_id = v || null; },
      });
      const section = cfg().sections && ov.sections.length > 1 ? selectField({
        label: t('mg.svc.section'), value: s.section_id || '',
        options: [{ value: '', label: t('mg.svc.all_sections') }, ...ov.sections.map((x) => ({ value: x.id, label: nm(x) }))],
        onChange: (v) => { s.section_id = v || null; },
      }) : null;
      const duration = selectField({ label: t('duration'), value: s.duration_min, options: minuteOptions(DURATIONS, s.duration_min), onChange: (v) => { s.duration_min = Number(v); } });
      const buffer = selectField({ label: t('mg.svc.buffer'), value: s.buffer_min, options: minuteOptions(BUFFERS, s.buffer_min), onChange: (v) => { s.buffer_min = Number(v); } });
      const step = selectField({ label: t('mg.svc.step'), value: s.step_min, options: minuteOptions(STEPS, s.step_min), onChange: (v) => { s.step_min = Number(v); } });

      const capBox = h('div', { class: 'mg-stack' });
      const paintCap = () => {
        capBox.hidden = s.mode !== 'capacity';
        if (s.mode !== 'capacity') return;
        capBox.replaceChildren(
          caps.length ? selectField({ label: t('mg.svc.resource'), value: s.resource_id || caps[0].id,
            options: caps.map((r) => ({ value: r.id, label: `${nm(r, 'label')} · ${t('mg.tm.cap_n', { n: r.capacity })}` })),
            onChange: (v) => { s.resource_id = v; } }) : h('p', { class: 'mg-inlinemsg' }, t('mg.svc.no_resource')),
          h('div', { class: 'mg-ctlrow' }, h('span', { class: 'mg-ctlrow__label' }, t('mg.svc.max_qty')),
            stepper({ value: s.max_qty || 1, min: 1, max: 50, label: t('mg.svc.max_qty'), onChange: (v) => { s.max_qty = v; } })),
          switchRow({ label: t('mg.svc.per_person'), checked: s.per_person, onChange: (v) => { s.per_person = v; } }));
        if (!s.resource_id && caps[0]) s.resource_id = caps[0].id;
      };
      const mode = seg([{ value: 'staff', label: t('mg.svc.mode_staff') }, { value: 'capacity', label: t('mg.svc.mode_capacity') }], s.mode,
        (v) => { s.mode = v; paintCap(); }, { label: t('mg.svc.mode') });
      paintCap();
      const loc = homeOn ? h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label' }, t('mg.svc.location')),
        seg([{ value: 'shop', label: t('mg.svc.loc_shop') }, { value: 'mobile', label: t('mg.svc.loc_mobile') }, { value: 'both', label: t('mg.svc.loc_both') }],
          s.location, (v) => { s.location = v; }, { label: t('mg.svc.location') })) : null;
      const active = switchRow({ label: t('mg.pr.shown'), checked: s.active, onChange: (v) => { s.active = v; } });
      const msg = h('div', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
      const save = btn(t('save'), { kind: 'primary', size: null, block: true });

      save.addEventListener('click', () => busy(save, async () => {
        msg.hidden = true;
        const p = price.value();
        if (p == null || Number.isNaN(p)) { price.setError(t('mg.pr.bad_price')); price.input.focus(); return; }
        Object.assign(s, {
          name_ar: nameAr.input.value.trim(), name_en: nameEn.input.value.trim(),
          desc_ar: descAr.input.value.trim(), desc_en: descEn.input.value.trim(), price_halalas: p,
        });
        if (!s.name_ar && !s.name_en) { nameAr.setError(t('mg.svc.need_name')); nameAr.input.focus(); return; }
        try {
          await call('own_service_upsert', { service: payload(s) }, { quiet: true });
          toast(t('mg.svc.saved'), { kind: 'ok' });
          loadOverview();
          ctx.close(true);
        } catch (e) {
          if (e.code === 'LIMIT_SERVICES') msg.replaceChildren(limitCard(e.detail?.limit || maxServices()));
          else msg.textContent = errText(e);
          msg.hidden = false;
          msg.scrollIntoView({ block: 'nearest' });
        }
      }));

      const del = !isNew && btn(t('mg.svc.delete'), {
        kind: 'quiet', size: null, block: true, danger: true,
        onClick: () => ctx.swap(confirmDelete(ctx, nm(s0), async () => {
          const r = await call('own_service_delete', { id: s.id });
          toast(r.archived ? t('mg.svc.archived') : t('mg.svc.deleted'), { kind: 'ok' });
          loadOverview();
          ctx.close(true);
        }, () => ctx.swap(form, 'back'))),
      });

      const form = h('div', { class: 'mg-step mg-form' },
        h('div', { class: 'mg-formgrid' },
          h('div', { class: 'mg-stack' },
            h('h3', { class: 'mg-group__title' }, t('mg.svc.basics')),
            nameAr, nameEn, price, from, cat, section, descAr, descEn),
          h('div', { class: 'mg-stack' },
            h('h3', { class: 'mg-group__title' }, t('mg.svc.timing')),
            duration, h('div', { class: 'mg-two' }, buffer, step),
            h('h3', { class: 'mg-group__title' }, t('mg.svc.booking')),
            mode, capBox, loc, active)),
        msg,
        h('div', { class: 'mg-sheetactions' }, save, del));
      return form;
    },
  });
}

/** Inline delete confirmation inside a sheet. */
export function confirmDelete(ctx, name, onYes, onNo, text) {
  const yes = btn(t('delete'), { kind: 'primary', size: null, block: true, danger: true });
  yes.addEventListener('click', () => busy(yes, onYes).catch(() => {}));
  return h('div', { class: 'mg-step' },
    h('div', { class: 'mg-confirm' },
      h('div', { class: 'mg-confirm__mark is-danger' }, icon('alert')),
      h('h3', { class: 'mg-confirm__title', tabindex: '-1', 'data-step-focus': '' }, t('mg.delete_q', { name })),
      text && h('p', { class: 'mg-confirm__text' }, text)),
    h('div', { class: 'mg-sheetactions' }, yes, btn(t('cancel'), { kind: 'ghost', size: null, block: true, onClick: onNo })));
}

/* ---------- categories ---------- */

function openCategory(c) {
  return openSheet({
    title: c ? t('mg.cat.edit') : t('mg.cat.new'),
    build: (ctx) => {
      const ar = field({ label: t('mg.cat.name_ar'), value: c?.name_ar || '', maxlength: 60, dir: 'rtl' });
      const en = field({ label: t('mg.cat.name_en'), value: c?.name_en || '', maxlength: 60, dir: 'ltr' });
      const save = btn(t('save'), { kind: 'primary', size: null, block: true });
      save.addEventListener('click', () => busy(save, async () => {
        const a = ar.input.value.trim();
        const e = en.input.value.trim();
        if (!a && !e) { ar.setError(t('mg.svc.need_name')); ar.input.focus(); return; }
        const sort = c?.sort ?? (Math.max(0, ...S.ov.categories.map((x) => x.sort || 0)) + 10);
        await call('own_category_upsert', { category: { id: c?.id, name_ar: a, name_en: e, section_id: c?.section_id || null, sort } });
        toast(t('saved'), { kind: 'ok' });
        loadOverview();
        ctx.close(true);
      }).catch(() => {}));
      const form = h('div', { class: 'mg-step mg-form' }, ar, en,
        h('div', { class: 'mg-sheetactions' }, save,
          c && btn(t('delete'), {
            kind: 'quiet', size: null, block: true, danger: true,
            onClick: () => ctx.swap(confirmDelete(ctx, nm(c), async () => {
              await call('own_category_delete', { id: c.id });
              toast(t('mg.deleted'), { kind: 'ok' });
              loadOverview();
              ctx.close(true);
            }, () => ctx.swap(form, 'back'), t('mg.cat.delete_text'))),
          })));
      return form;
    },
  });
}

/* ---------- offers ---------- */

const offerPayload = (o, patch = {}) => ({
  id: o.id || undefined, kind: o.kind, value: o.value, title_ar: o.title_ar, title_en: o.title_en,
  service_ids: o.service_ids?.length ? o.service_ids : null, weekdays: o.weekdays?.length ? o.weekdays : null,
  starts_at: o.starts_at || null, ends_at: o.ends_at || null, active: o.active, ...patch,
});

function offerValue(o) {
  if (o.kind === 'percent') return t('mg.off.p_percent', { v: o.value });
  if (o.kind === 'amount') return t('mg.off.p_amount', { v: fm(o.value) });
  return t('mg.off.kind_banner');
}

function offerSummary(o, { short } = {}) {
  const parts = [];
  if (o.kind !== 'banner' && !short) parts.push(offerValue(o));
  const ids = o.service_ids || [];
  if (o.kind !== 'banner') {
    if (!ids.length) parts.push(t('mg.off.p_on', { what: t('mg.off.p_all') }));
    else {
      const names = ids.map((id) => nm(S.ov.services.find((s) => s.id === id))).filter(Boolean);
      parts.push(t('mg.off.p_on', { what: names.length > 2 ? t('mg.off.services_n', { n: names.length }) : names.join(L() === 'ar' ? ' و' : ' & ') }));
    }
  }
  if (o.weekdays?.length) {
    const days = o.weekdays.slice().sort((a, b) => a - b).map((d) => t(`wd.${d}`)).join(L() === 'ar' ? '، ' : ', ');
    parts.push(t('mg.off.p_days', { days }));
  }
  if (o.starts_at && new Date(o.starts_at) > Date.now()) parts.push(t('mg.off.p_from', { date: fmt.dateShort(o.starts_at, L()) }));
  if (o.ends_at) parts.push(t('mg.off.p_until', { date: fmt.dateShort(new Date(new Date(o.ends_at).getTime() - 1), L()) }));
  return parts.join(' · ');
}

function openOfferEditor(o0) {
  const services = S.ov.services.filter((s) => s.active);
  const o = o0 ? { ...o0, service_ids: o0.service_ids ? [...o0.service_ids] : [], weekdays: o0.weekdays ? [...o0.weekdays] : [] } : {
    id: null, kind: 'percent', value: 15, title_ar: '', title_en: '', service_ids: [], weekdays: [], starts_at: null, ends_at: null, active: true,
  };
  const toDay = (iso, end) => (iso ? fmt.riyadhDateISO(end ? new Date(new Date(iso).getTime() - 1) : iso) : '');

  return openSheet({
    title: o0 ? t('mg.off.edit') : t('mg.off.new'),
    wide: true,
    build: (ctx) => {
      const preview = h('div', { class: 'mg-preview', 'aria-live': 'polite' });
      const valueBox = h('div');
      const kind = seg([
        { value: 'percent', label: t('mg.off.kind_percent') },
        { value: 'amount', label: t('mg.off.kind_amount') },
        { value: 'banner', label: t('mg.off.kind_banner') },
      ], o.kind, (v) => {
        if (v !== o.kind) o.value = v === 'percent' ? 15 : v === 'amount' ? 1000 : 0;
        o.kind = v; paintValue(); paintPreview(); svcBox.hidden = v === 'banner';
      }, { label: t('mg.off.kind') });
      let valueField = null;
      function paintValue() {
        if (o.kind === 'percent') {
          valueField = field({ label: t('mg.off.value_percent'), value: String(o.value || ''), inputmode: 'numeric', suffix: L() === 'ar' ? '٪' : '%', dir: 'ltr', maxlength: 2 });
          valueField.input.addEventListener('input', () => { o.value = Number(fmt.toLatin(valueField.input.value).replace(/\D/g, '')) || 0; paintPreview(); });
          valueBox.replaceChildren(valueField);
        } else if (o.kind === 'amount') {
          valueField = sarField({ label: t('mg.off.value_amount'), halalas: o.value || null });
          valueField.input.addEventListener('input', () => { const v = parseSar(valueField.input.value); if (!Number.isNaN(v) && v != null) { o.value = v; paintPreview(); } });
          valueBox.replaceChildren(valueField);
        } else {
          valueField = null;
          valueBox.replaceChildren();
        }
      }
      const titleAr = field({ label: t('mg.off.title_ar'), value: o.title_ar, maxlength: 80, dir: 'rtl', onInput: (v) => { o.title_ar = v; paintPreview(); } });
      const titleEn = field({ label: t('mg.off.title_en'), value: o.title_en, maxlength: 80, dir: 'ltr', onInput: (v) => { o.title_en = v; paintPreview(); } });

      const svcChips = chips(services.map((s) => ({ value: s.id, label: nm(s) })), o.service_ids,
        (v) => { o.service_ids = v; paintPreview(); }, { multi: true, label: t('mg.off.services') });
      const allSw = switchRow({
        label: t('mg.off.all_services'), checked: !o.service_ids.length,
        onChange: (v) => { svcChips.hidden = v; if (v) { o.service_ids = []; svcChips.set([]); } paintPreview(); },
      });
      svcChips.hidden = !o.service_ids.length;
      const svcBox = h('div', { class: 'mg-fieldset', hidden: o.kind === 'banner' }, h('span', { class: 'mg-label' }, t('mg.off.services')), allSw, svcChips);

      const dayChips = chips([0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(`wds.${d}`) })), o.weekdays.map(String),
        (v) => { o.weekdays = v.map(Number); paintPreview(); }, { multi: true, label: t('mg.off.days') });
      const fromD = h('input', { type: 'date', class: 'b-field__input mg-date', value: toDay(o.starts_at), 'aria-label': t('mg.off.from') });
      const toD = h('input', { type: 'date', class: 'b-field__input mg-date', value: toDay(o.ends_at, true), 'aria-label': t('mg.off.to') });
      const syncDates = () => {
        o.starts_at = fromD.value ? fmt.riyadhInstant(fromD.value, '00:00').toISOString() : null;
        o.ends_at = toD.value ? fmt.riyadhInstant(fmt.addDaysISO(toD.value, 1), '00:00').toISOString() : null;
        paintPreview();
      };
      fromD.addEventListener('input', syncDates);
      toD.addEventListener('input', syncDates);
      const active = switchRow({ label: t('mg.off.active'), checked: o.active, onChange: (v) => { o.active = v; paintPreview(); } });

      function paintPreview() {
        const title = nm(o, 'title') || t('mg.off.new');
        const sample = (o.service_ids.length ? services.filter((s) => o.service_ids.includes(s.id)) : services)[0];
        let example = null;
        if (sample && o.kind !== 'banner' && o.value > 0) {
          const base = sample.price_halalas;
          const disc = Math.min(base, o.kind === 'percent' ? Math.round(base * o.value / 100) : o.value);
          example = t('mg.off.p_example', { name: nm(sample), now: fm(base - disc, { free: true }), was: fm(base) });
        }
        preview.replaceChildren(
          h('span', { class: 'mg-label' }, t('mg.off.preview')),
          h('div', { class: ['mg-preview__card', !o.active && 'is-off'] },
            h('span', { class: 'b-badge' }, o.kind === 'banner' ? t('offer') : offerValue(o)),
            h('strong', { class: 'mg-preview__title' }, title),
            h('span', { class: 'mg-preview__sub' }, offerSummary(o, { short: true }) || '—'),
            example && h('span', { class: 'mg-preview__ex' }, example)));
      }
      paintValue();
      paintPreview();

      const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
      const save = btn(t('save'), { kind: 'primary', size: null, block: true });
      save.addEventListener('click', () => busy(save, async () => {
        msg.hidden = true;
        o.title_ar = titleAr.input.value.trim();
        o.title_en = titleEn.input.value.trim();
        if (!o.title_ar && !o.title_en) { titleAr.setError(t('mg.off.need_title')); titleAr.input.focus(); return; }
        if (o.kind === 'percent' && (o.value < 1 || o.value > 90)) { valueField?.setError(t('mg.off.bad_percent')); valueField?.input.focus(); return; }
        if (o.kind === 'amount') {
          const v = valueField.value();
          if (v == null || Number.isNaN(v) || v <= 0) { valueField.setError(t('mg.off.bad_value')); valueField.input.focus(); return; }
          o.value = v;
        }
        if (o.starts_at && o.ends_at && new Date(o.ends_at) <= new Date(o.starts_at)) { msg.textContent = t('mg.off.bad_dates'); msg.hidden = false; return; }
        try {
          await call('own_offer_upsert', { offer: offerPayload(o) }, { quiet: true });
          toast(o.active ? t('mg.off.saved') : t('mg.off.saved_off'), { kind: 'ok' });
          loadOverview();
          ctx.close(true);
        } catch (e) { msg.textContent = errText(e); msg.hidden = false; }
      }));

      const form = h('div', { class: 'mg-step mg-form' },
        h('div', { class: 'mg-formgrid' },
          h('div', { class: 'mg-stack' },
            h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label' }, t('mg.off.kind')), kind),
            valueBox, titleAr, titleEn, svcBox),
          h('div', { class: 'mg-stack' },
            h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label' }, t('mg.off.days')), dayChips, h('p', { class: 'mg-fine' }, t('mg.off.days_hint'))),
            h('div', { class: 'mg-two' },
              h('label', { class: 'mg-forcebox__row mg-col' }, h('span', null, t('mg.off.from')), h('span', { class: 'b-field__box mg-timebox' }, fromD)),
              h('label', { class: 'mg-forcebox__row mg-col' }, h('span', null, t('mg.off.to')), h('span', { class: 'b-field__box mg-timebox' }, toD))),
            h('p', { class: 'mg-fine' }, t('mg.off.dates_hint')),
            active,
            preview)),
        msg,
        h('div', { class: 'mg-sheetactions' }, save,
          o0 && btn(t('delete'), {
            kind: 'quiet', size: null, block: true, danger: true,
            onClick: () => ctx.swap(confirmDelete(ctx, nm(o0, 'title'), async () => {
              await call('own_offer_delete', { id: o0.id });
              toast(t('mg.off.deleted'), { kind: 'ok' });
              loadOverview();
              ctx.close(true);
            }, () => ctx.swap(form, 'back'))),
          })));
      return form;
    },
  });
}

export const title = () => t('mg.tab.prices');
export { reduced };
