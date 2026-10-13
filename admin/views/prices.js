// Prices: the configurator's price sheet (blank = custom quote), care plans with the live yearly
// saving, and an example total recomputed with platform/estimate.js as you type.
import { h, toast, animateNumber, confirmDialog } from '../../platform/ui/kit.js';
import { t } from '../../platform/i18n.js';
import { rpc } from '../../platform/api.js';
import { estimate } from '../../platform/estimate.js';
import * as fmt from '../../platform/fmt.js';
import { ic, money, num, pickName, pageHead, section, parseSar, sarInput, errToast, enter, fill } from '../ui.js';

const GROUPS = ['package', 'language', 'booking', 'local', 'payment', 'customer', 'extras', 'scale'];
const EXAMPLE = {
  business: { kind: 'salon' },
  services: Array.from({ length: 8 }, (_, i) => ({ name: `s${i}`, duration_min: 30, price_sar: 60 })),
  services_later: false,
  look: 'standard', langs: 'both', prayer: true, hijri: true, payment: 'shop', customer: 'name_phone',
  staff_choice: false, sections: false, home_service: false,
  extras: { self_manage: true, waitlist: false }, branches: 1, plan: { code: 'none' },
};

export default async function prices({ root }) {
  let sheet = await rpc('pub_price_sheet', {});
  const itemEdits = new Map();   // key → halalas | null
  const planEdits = new Map();   // code → {monthly_halalas, yearly_halalas}
  const invalid = new Set();

  const itemsBox = h('div', { class: 'adm-prices' });
  const plansBox = h('div', { class: 'adm-plans' });
  const exampleBox = h('div', { class: 'b-card adm-example' });
  const countEl = h('span', { class: 'adm-savebar__count', role: 'status', 'aria-live': 'polite' });
  const discard = h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--sm' }, h('span', null, t('price.discard')));
  const save = h('button', { type: 'button', class: 'b-btn b-btn--primary b-btn--sm' }, h('span', null, t('price.save')));
  const bar = h('div', { class: 'adm-savebar', hidden: true }, countEl, h('div', { class: 'adm-savebar__acts' }, discard, save));

  root.append(
    pageHead({ eyebrow: t('price.eyebrow'), title: t('nav.prices'), sub: t('price.sub') }),
    h('div', { class: 'adm-cols adm-cols--prices' },
      h('div', null, section(t('price.sheet'), itemsBox, { id: 'sheet', sub: t('price.sheet_sub') })),
      h('div', { class: 'adm-sticky' },
        section(t('price.example_title'), exampleBox, { id: 'example', sub: t('price.example') }),
        section(t('price.plans'), plansBox, { id: 'plans', sub: t('price.plans_sub') }))),
    bar);

  const effective = () => ({
    items: (sheet.items || []).map((i) => (itemEdits.has(i.key) ? { ...i, amount_halalas: itemEdits.get(i.key) } : i)),
    plans: (sheet.plans || []).map((p) => (planEdits.has(p.code) ? { ...p, ...planEdits.get(p.code) } : p)),
  });

  function paintBar() {
    const n = itemEdits.size + planEdits.size;
    bar.hidden = n === 0;
    countEl.textContent = t('price.changes', { n });
    save.disabled = invalid.size > 0;
  }

  /* ---------- items ---------- */
  function itemRow(it) {
    const id = `pi-${it.key}`;
    const input = h('input', {
      id, class: 'adm-sar__input b-num', type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off',
      placeholder: t('est.quote'), value: sarInput(it.amount_halalas), 'aria-describedby': `${id}-d`,
    });
    const row = h('div', { class: 'adm-price' },
      h('div', { class: 'adm-price__main' },
        h('label', { class: 'adm-price__label', for: id }, pickName(it, 'label')),
        h('p', { class: 'adm-price__meta', id: `${id}-d` },
          h('code', { class: 'adm-key', dir: 'ltr' }, it.key),
          it.per_unit && h('span', null, t('price.per_unit')),
          h('span', { class: 'adm-price__desc' }, pickName(it, 'desc')))),
      h('div', { class: 'adm-sar' }, input, h('span', { class: 'adm-sar__cur', 'aria-hidden': 'true' }, t('sar'))));
    input.addEventListener('input', () => {
      const v = parseSar(input.value);
      const bad = Number.isNaN(v);
      input.setAttribute('aria-invalid', String(bad));
      row.classList.toggle('is-invalid', bad);
      if (bad) invalid.add(it.key); else invalid.delete(it.key);
      if (!bad && v !== (it.amount_halalas ?? null)) itemEdits.set(it.key, v); else itemEdits.delete(it.key);
      row.classList.toggle('is-changed', itemEdits.has(it.key));
      row.classList.toggle('is-quote', !bad && v == null);
      paintBar(); paintExample();
    });
    input.addEventListener('blur', () => {
      const v = parseSar(input.value);
      if (!Number.isNaN(v)) input.value = sarInput(v);
    });
    if (it.amount_halalas == null) row.classList.add('is-quote');
    return row;
  }

  function paintItems() {
    const items = sheet.items || [];
    const groups = [...new Set([...GROUPS, ...items.map((i) => i.grp)])].filter((g) => items.some((i) => i.grp === g));
    itemsBox.replaceChildren(...groups.map((g) => h('div', { class: 'adm-pricegrp' },
      h('h3', { class: 'adm-pricegrp__title' }, t(`price.grp.${g}`)),
      h('div', { class: 'b-card adm-card--list' }, items.filter((i) => i.grp === g).map(itemRow)))));
  }

  /* ---------- plans ---------- */
  function planCard(p) {
    const cur = { monthly_halalas: p.monthly_halalas, yearly_halalas: p.yearly_halalas };
    const mk = (k, label) => {
      const id = `pl-${p.code}-${k}`;
      const input = h('input', { id, class: 'adm-sar__input b-num', type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', value: sarInput(p[k]) });
      return { input, el: h('div', { class: 'adm-planin' }, h('label', { for: id, class: 'adm-label' }, label), h('div', { class: 'adm-sar' }, input, h('span', { class: 'adm-sar__cur', 'aria-hidden': 'true' }, t('sar')))) };
    };
    const m = mk('monthly_halalas', t('interval.monthly'));
    const y = mk('yearly_halalas', t('interval.yearly'));
    const saving = h('p', { class: 'adm-saving', role: 'status', 'aria-live': 'polite' });
    const card = h('div', { class: 'b-card adm-plancard' },
      h('div', { class: 'adm-plancard__head' }, h('p', { class: 'adm-plancard__name' }, pickName(p)), h('code', { class: 'adm-key', dir: 'ltr' }, p.code)),
      h('p', { class: 'adm-plancard__desc' }, pickName(p, 'desc')),
      h('div', { class: 'adm-grid2' }, m.el, y.el),
      saving);
    const paintSaving = () => {
      const mv = parseSar(m.input.value);
      const yv = parseSar(y.input.value);
      if (mv == null || yv == null || Number.isNaN(mv) || Number.isNaN(yv)) { saving.textContent = t('price.plan_bad'); saving.className = 'adm-saving is-bad'; return false; }
      const sv = mv * 12 - yv;
      saving.className = `adm-saving ${sv > 0 ? 'is-good' : 'is-none'}`;
      saving.replaceChildren(sv > 0 ? ic('check') : ic('info'), h('span', null, sv > 0
        ? t('price.saving', { amount: money(sv), months: num(Math.round((sv / mv) * 10) / 10) })
        : t('price.no_saving')));
      return true;
    };
    const onInput = () => {
      const ok = paintSaving();
      const mv = parseSar(m.input.value);
      const yv = parseSar(y.input.value);
      if (ok) { invalid.delete(`plan-${p.code}`); } else invalid.add(`plan-${p.code}`);
      if (ok && (mv !== cur.monthly_halalas || yv !== cur.yearly_halalas)) planEdits.set(p.code, { monthly_halalas: mv, yearly_halalas: yv });
      else planEdits.delete(p.code);
      card.classList.toggle('is-changed', planEdits.has(p.code));
      paintBar(); paintExample();
    };
    m.input.addEventListener('input', onInput);
    y.input.addEventListener('input', onInput);
    paintSaving();
    return card;
  }

  function paintPlans() { plansBox.replaceChildren(...(sheet.plans || []).map(planCard)); }

  /* ---------- example ---------- */
  const totalEl = h('span', { class: 'adm-example__total' });
  let lastTotal = null;
  function paintExample() {
    const eff = effective();
    const est = estimate(eff, EXAMPLE);
    const care = eff.plans.find((p) => p.code === 'care');
    fill(exampleBox,
      h('div', { class: 'b-kv' }, est.lines.map((l) => h('div', { class: ['b-kv__row', itemEdits.has(l.key) && 'is-changed'] },
        h('span', { class: 'b-kv__k' }, pickName(l, 'label')),
        h('span', { class: 'b-kv__v' }, l.quote ? t('est.quote') : l.amount_halalas ? money(l.amount_halalas) : t('included'))))),
      h('div', { class: 'adm-example__foot' },
        h('span', null, t('est.setup')), totalEl),
      care && h('p', { class: 'adm-quiet' }, t('price.example_plan', { amount: money(care.monthly_halalas) })));
    animateNumber(totalEl, lastTotal, est.setup_halalas, { format: (v) => money(v), step: 100, duration: 420 });
    lastTotal = est.setup_halalas;
  }

  /* ---------- save ---------- */
  save.addEventListener('click', async () => {
    if (invalid.size) return;
    save.setAttribute('aria-busy', 'true');
    try {
      const n = itemEdits.size + planEdits.size;
      if (itemEdits.size) {
        const r = await rpc('adm_price_items_update', { items: [...itemEdits].map(([key, amount_halalas]) => ({ key, amount_halalas })) });
        sheet = { items: r.items, plans: r.plans };
      }
      if (planEdits.size) {
        const r = await rpc('adm_plans_update', { plans: [...planEdits].map(([code, v]) => ({ code, ...v })) });
        sheet = { items: r.items, plans: r.plans };
      }
      itemEdits.clear(); planEdits.clear();
      paintItems(); paintPlans(); paintExample(); paintBar();
      toast(t('price.saved', { n }), { kind: 'ok' });
    } catch (e) { errToast(e); }
    finally { save.removeAttribute('aria-busy'); }
  });
  discard.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: t('price.discard_title'), message: t('price.discard_text'), confirm: t('price.discard') });
    if (!ok) return;
    itemEdits.clear(); planEdits.clear(); invalid.clear();
    paintItems(); paintPlans(); paintExample(); paintBar();
  });

  paintItems();
  paintPlans();
  paintExample();
  enter(exampleBox);

  const beforeUnload = (e) => { if (itemEdits.size || planEdits.size) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return {
    title: t('nav.prices'),
    destroy() { window.removeEventListener('beforeunload', beforeUnload); },
  };
}
