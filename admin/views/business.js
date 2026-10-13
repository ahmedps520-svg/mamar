// One business: status pipeline, identity, look, package, owner logins, care plan, payments, link.
// Tabs are sub-routes (#/businesses/<id>/<tab>) so notifications and the setup flow can deep-link.
import { h, sheet, confirmDialog, toast } from '../../platform/ui/kit.js';
import { t, lang } from '../../platform/i18n.js';
import { rpc, mode, publishLinkPage, githubToken } from '../../platform/api.js';
import { linkPageHtml } from '../../platform/linkpage.js';
import { SITE } from '../../platform/config.js';
import * as fmt from '../../platform/fmt.js';
import {
  ic, money, num, pickName, stamp, pageHead, section, pill, badge, kv, field, seg, switchRow,
  busy, errToast, copyRow, copyText, linkBtn, parseSar, sarInput, empty, ltr, chipGroup,
} from '../ui.js';
import lookTab from './biz-look.js';
import loginsTab from './biz-logins.js';

const TABS = ['overview', 'details', 'look', 'package', 'logins', 'plan', 'payments', 'link'];
const TAB_ICON = { overview: 'flag', details: 'doc', look: 'palette', package: 'sparkle', logins: 'users', plan: 'plan', payments: 'card', link: 'link' };
const PIPELINE = ['draft', 'awaiting_payment', 'active', 'paused'];
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const ENT = [
  ['langs_both', 'langs_both'], ['staff_choice', 'staff_choice'], ['sections', 'sections'], ['home_service', 'home_service'],
  ['prayer', 'prayer'], ['payments', 'payments'], ['self_manage', 'self_manage'], ['waitlist', 'waitlist'], ['custom_look', 'look_custom'],
];
const MAX_SVC = [[15, null], [40, 'services_16_40'], [999, 'services_40_plus']];
const PUB_KEY = 'mamar-admin-published';

const published = {
  get(slug) { try { return JSON.parse(localStorage.getItem(PUB_KEY) || '{}')[slug] || null; } catch { return null; } },
  set(slug) {
    try {
      const m = JSON.parse(localStorage.getItem(PUB_KEY) || '{}');
      m[slug] = new Date().toISOString();
      localStorage.setItem(PUB_KEY, JSON.stringify(m));
    } catch { /* private mode */ }
  },
};

export const bookingLink = (slug) => `${SITE}/b/${slug}`;
export const embedSnippet = (slug, l = 'ar') =>
  `<script src="${SITE}/book/embed.js"\n        data-business="${slug}" defer></script>\n<button data-mamar-book>${l === 'en' ? 'Book now' : 'احجز الآن'}</button>`;

export default async function business({ app, root, params }) {
  const [id, tabParam] = params;
  let tab = TABS.includes(tabParam) ? tabParam : 'overview';
  let [d, priceSheet] = await Promise.all([rpc('adm_business', { business_id: id }), rpc('pub_price_sheet', {})]);
  const priceOf = (key) => (priceSheet.items || []).find((i) => i.key === key);

  const headBox = h('div');
  const nav = h('nav', { class: 'b-chips b-chips--scroll adm-subnav', 'aria-label': t('biz.sections') });
  const panel = h('div', { class: 'adm-panel' });
  root.append(headBox, nav, panel);

  const B = () => d.business;
  const name = () => pickName(B()) || B().slug;

  function paintHead() {
    const b = B();
    const head = pageHead({
      back: { href: '#/businesses', label: t('nav.businesses') },
      eyebrow: [`${t(`kind.${b.kind}`)} · `, h('span', { class: 'adm-nocaps', dir: 'ltr' }, `/b/${b.slug}`)],
      title: name(),
    });
    head.querySelector('.adm-head__row').after(h('div', { class: 'adm-head__meta' },
      pill('biz', b.status),
      b.is_demo && badge(t('biz.demo'), 'b-badge--line'),
      badge(b.look === 'custom' ? t('look.custom') : t('look.standard'), 'b-badge--line'),
      d.subscription?.requested_code && badge(t('biz.plan_req_badge'), 'b-badge')));
    headBox.replaceChildren(head);
    nav.replaceChildren(...TABS.map((k) => h('a', {
      class: 'b-chip adm-subnav__item', href: `#/businesses/${id}/${k}`, 'aria-current': k === tab ? 'page' : null,
    }, ic(TAB_ICON[k]), t(`btab.${k}`),
      k === 'payments' && d.pay_flags?.length ? h('span', { class: 'adm-chipcount is-hot' }, num(d.pay_flags.length)) : null,
      k === 'plan' && d.subscription?.requested_code ? h('span', { class: 'adm-dot', 'aria-hidden': 'true' }) : null)));
  }

  async function reload() {
    d = await rpc('adm_business', { business_id: id });
    paintHead();
    paintPanel();
  }

  const ctx = { app, id, get d() { return d; }, priceOf, reload, name, toTab: (k) => app.go(`/businesses/${id}/${k}`) };

  /* ───────── overview: the pipeline ───────── */
  function overview() {
    const b = B();
    const cur = PIPELINE.indexOf(b.status);
    const steps = h('ol', { class: 'adm-pipe' }, PIPELINE.map((s, i) => {
      const here = s === b.status;
      return h('li', { class: ['adm-pipe__step', here && 'is-current', i < cur && 'is-done'] },
        h('span', { class: 'adm-pipe__dot', 'aria-hidden': 'true' }, i < cur ? ic('check') : num(i + 1)),
        h('div', { class: 'adm-pipe__body' },
          h('p', { class: 'adm-pipe__title' }, t(`biz.${s}`), here && badge(t('biz.current'), 'b-badge')),
          h('p', { class: 'adm-pipe__text' }, t(`pipe.${s}`)),
          !here && h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--sm adm-pipe__go', onClick: (e) => setStatus(s, e.currentTarget) },
            h('span', null, s === 'active' ? t('pipe.go_active') : t('pipe.move', { status: t(`biz.${s}`) })))));
    }));

    const counts = d.counts || {};
    const mini = h('div', { class: 'adm-mini' },
      [['today', counts.today], ['upcoming', counts.upcoming], ['waitlist', counts.waitlist]].map(([k, v]) =>
        h('div', { class: 'adm-mini__item' }, h('span', { class: 'adm-mini__v' }, num(v || 0)), h('span', { class: 'adm-mini__k' }, t(`biz.count.${k}`)))));

    const alerts = [];
    if (d.pay_flags?.length) {
      alerts.push(h('a', { class: 'adm-alert is-warn', href: `#/businesses/${id}/payments` }, ic('alert'),
        h('span', null, t('pay.flags_alert', { n: d.pay_flags.length })), ic('forward')));
    }
    if (d.subscription?.requested_code) {
      alerts.push(h('a', { class: 'adm-alert', href: `#/businesses/${id}/plan` }, ic('plan'),
        h('span', null, t('plan.req_alert', { plan: t(`plan.name.${d.subscription.requested_code}`), interval: t(`interval.${d.subscription.requested_interval || 'monthly'}`) })), ic('forward')));
    }

    const req = d.request;
    return h('div', { class: 'adm-cols' },
      h('div', null,
        alerts.length ? h('div', { class: 'b-stack', style: '--_gap:8px' }, alerts) : null,
        section(t('pipe.title'), steps, { id: 'pipe', sub: t('pipe.sub') })),
      h('div', null,
        section(t('biz.at_glance'), mini, { id: 'glance' }),
        section(t('biz.quick'), h('div', { class: 'adm-quick' },
          linkBtn(`/manage/?b=${b.id}`, t('link.owner_dash'), { icon: 'device', external: true }),
          linkBtn(`/book/?b=${b.slug}`, t('link.preview'), { icon: 'eye', external: true }),
          h('a', { class: 'b-btn b-btn--ghost', href: `#/businesses/${id}/link` }, ic('link'), h('span', null, t('btab.link')))), { id: 'quick' }),
        section(t('biz.setup_request'), req
          ? h('a', { class: 'b-row adm-reqlink', href: `#/requests/${req.id}` },
              h('span', { class: 'b-row__lead' }, ic('doc')),
              h('span', { class: 'b-row__main' },
                h('span', { class: 'b-row__title' }, `${t('req.ref')} ${ltr(req.ref)}`),
                h('span', { class: 'b-row__sub' }, `${req.contact_name || ''} · ${stamp(req.created_at)}`)),
              h('span', { class: 'b-row__end' }, money(req.setup_halalas), ic('forward', { class: 'b-row__chev' })))
          : h('p', { class: 'adm-quiet' }, t('biz.no_request')), { id: 'origin' })));
  }

  async function setStatus(s, btn) {
    const b = B();
    if (b.status === 'active' && s !== 'active') {
      const ok = await confirmDialog({ title: t('pipe.leave_title'), message: t('pipe.leave_text'), confirm: t('pipe.move', { status: t(`biz.${s}`) }), danger: true });
      if (!ok) return;
    }
    const done = await busy(btn, async () => {
      await rpc('adm_business_update', { business_id: id, patch: { status: s } });
      await reload();
      return true;
    });
    if (!done) return;
    toast(t('pipe.moved', { status: t(`biz.${s}`) }), { kind: 'ok' });
    if (s === 'active') offerPublish();
  }

  async function offerPublish() {
    const b = B();
    await sheet({
      title: t('pipe.live_title'),
      content: h('div', { class: 'b-stack' },
        h('p', null, t('pipe.live_text')),
        copyRow(t('link.booking'), bookingLink(b.slug))),
      actions: [
        { label: t('later'), value: false, kind: 'ghost' },
        { label: t('link.publish'), kind: 'primary', onClick: async () => (await publish()) ? true : false },
      ],
    });
  }

  async function publish(btn) {
    const b = B();
    if (mode() === 'cloud' && !githubToken.get()) {
      toast(t('err.NO_GITHUB_TOKEN'), { kind: 'warn', timeout: 7000, action: { label: t('nav.settings'), onClick: () => app.go('/more') } });
      return false;
    }
    return busy(btn, async () => {
      await publishLinkPage(b.slug, linkPageHtml(b));
      published.set(b.slug);
      toast(t('link.published'), { kind: 'ok', timeout: 6000, action: { label: t('link.view'), onClick: () => window.open(`/b/${b.slug}/`, '_blank', 'noopener') } });
      if (tab === 'link') paintPanel();
      return true;
    });
  }

  /* ───────── details: identity ───────── */
  function details() {
    const b = B();
    const nameAr = field({ label: t('spec.name_ar'), value: b.name_ar, dir: 'rtl', attrs: { lang: 'ar', maxlength: 80 } });
    const nameEn = field({ label: t('spec.name_en'), value: b.name_en, dir: 'ltr', attrs: { lang: 'en', maxlength: 80 } });
    const slug = field({ label: t('biz.slug'), value: b.slug, dir: 'ltr', mono: true, hint: t('biz.slug_hint'),
      attrs: { autocapitalize: 'none', spellcheck: 'false', maxlength: 40, inputmode: 'url' } });
    slug.el.querySelector('.b-field__box').prepend(h('span', { class: 'b-field__affix adm-affix', dir: 'ltr' }, 'mamar.site/b/'));
    slug.input.addEventListener('input', () => { slug.input.value = slug.input.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); slug.setError(''); });
    const phone = field({ label: t('biz.phone'), value: b.phone ? fmt.formatPhone(b.phone, 'en') : '', type: 'tel', dir: 'ltr', hint: t('biz.phone_hint'), attrs: { inputmode: 'tel', autocomplete: 'off' } });
    const setup = field({ label: t('biz.setup_amount'), value: sarInput(b.setup_halalas), dir: 'ltr', hint: t('biz.setup_hint'), attrs: { inputmode: 'decimal' } });
    setup.el.querySelector('.b-field__box').append(h('span', { class: 'adm-suffix' }, t('sar')));
    let kind = b.kind;
    let langs = (b.langs || ['ar']).length === 2 ? 'both' : b.langs[0];
    let isDemo = !!b.is_demo;
    const kindSeg = seg(['salon', 'carwash', 'activity', 'other'].map((k) => ({ value: k, label: t(`kind.${k}`) })), kind, (v) => { kind = v; }, { label: t('spec.kind') });
    const langSeg = seg(['ar', 'en', 'both'].map((k) => ({ value: k, label: t(`langs.${k}`) })), langs, (v) => { langs = v; }, { label: t('spec.langs') });
    const save = h('button', { type: 'submit', class: 'b-btn b-btn--primary' }, h('span', null, t('save')));

    const form = h('form', { class: 'adm-form', novalidate: true },
      h('div', { class: 'adm-grid2' }, nameAr.el, nameEn.el),
      slug.el,
      h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, t('spec.kind')), kindSeg),
      h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, t('spec.langs')), langSeg,
        h('p', { class: 'b-field__msg' }, t('biz.langs_hint'))),
      h('div', { class: 'adm-grid2' }, phone.el, setup.el),
      h('div', { class: 'b-card adm-card--flat' }, switchRow({ label: t('biz.is_demo'), sub: t('biz.is_demo_sub'), checked: isDemo, onChange: (v) => { isDemo = v; } })),
      h('div', { class: 'adm-formbar' }, save));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      slug.setError(''); phone.setError(''); setup.setError('');
      const patch = {};
      const s = slug.input.value.trim();
      if (!SLUG.test(s)) { slug.setError(t('biz.slug_bad')); slug.input.focus(); return; }
      if (!nameAr.input.value.trim() && !nameEn.input.value.trim()) { nameAr.setError(t('field.required')); nameAr.input.focus(); return; }
      const ph = phone.input.value.trim();
      const e164 = ph ? fmt.normalizePhone(ph) : null;
      if (ph && !e164) { phone.setError(t('field.phone_invalid')); phone.input.focus(); return; }
      const amt = parseSar(setup.input.value);
      if (Number.isNaN(amt)) { setup.setError(t('price.bad')); setup.input.focus(); return; }
      if (s !== b.slug) patch.slug = s;
      if (nameAr.input.value.trim() !== b.name_ar) patch.name_ar = nameAr.input.value.trim();
      if (nameEn.input.value.trim() !== b.name_en) patch.name_en = nameEn.input.value.trim();
      if (kind !== b.kind) patch.kind = kind;
      const nextLangs = langs === 'both' ? ['ar', 'en'] : [langs];
      if (nextLangs.join() !== (b.langs || []).join()) patch.langs = nextLangs;
      if ((e164 || null) !== (b.phone || null)) patch.phone = e164 || '';
      if ((amt ?? null) !== (b.setup_halalas ?? null) && amt != null) patch.setup_halalas = amt;
      if (isDemo !== !!b.is_demo) patch.is_demo = isDemo;
      if (!Object.keys(patch).length) { toast(t('biz.nothing'), { timeout: 1800 }); return; }
      if (patch.slug) {
        const ok = await confirmDialog({ title: t('biz.slug_change_title'), message: t('biz.slug_change_text', { old: ltr(b.slug), new: ltr(s) }), confirm: t('save') });
        if (!ok) return;
      }
      save.setAttribute('aria-busy', 'true');
      try {
        await rpc('adm_business_update', { business_id: id, patch });
        await reload();
        toast(t('saved'), { kind: 'ok', timeout: 1800 });
      } catch (err) {
        if (err.code === 'SLUG_TAKEN') { slug.setError(t('err.SLUG_TAKEN')); slug.input.focus(); }
        else errToast(err);
      } finally { save.removeAttribute('aria-busy'); }
    });
    return section(t('btab.details'), form, { id: 'identity', sub: t('biz.details_sub') });
  }

  /* ───────── package: entitlements ───────── */
  function pkg() {
    const b = B();
    const ent = { ...(b.entitlements || {}) };
    const priceTag = (key) => {
      const it = key && priceOf(key);
      return h('span', { class: 'adm-ent__tag' },
        h('code', { class: 'adm-key', dir: 'ltr' }, key || 'base_standard'),
        h('span', { class: 'adm-ent__price' }, !key ? t('included') : !it ? '—' : it.amount_halalas == null ? t('est.quote') : it.amount_halalas ? money(it.amount_halalas) : t('included')));
    };
    const total = h('span', { class: 'adm-pkgtotal__v' });
    const paintTotal = () => {
      let sum = priceOf('base_standard')?.amount_halalas || 0;
      for (const [k, key] of ENT) if (ent[k]) sum += priceOf(key)?.amount_halalas || 0;
      const ms = MAX_SVC.find(([n]) => n === Number(ent.max_services || 15));
      if (ms?.[1]) sum += priceOf(ms[1])?.amount_halalas || 0;
      total.textContent = money(sum);
    };
    const rows = ENT.map(([k, key]) => {
      const it = priceOf(key);
      return switchRow({
        label: it ? pickName(it, 'label') : t(`feat.${k}`),
        sub: t(`ent.${k}`),
        checked: !!ent[k],
        end: priceTag(key),
        onChange: (v) => { ent[k] = v; paintTotal(); },
      });
    });
    const curMax = Number(ent.max_services || 15);
    const maxSeg = seg(MAX_SVC.map(([n]) => ({ value: n, label: n >= 999 ? t('ent.unlimited') : t('ent.up_to', { n }) })),
      MAX_SVC.some(([n]) => n === curMax) ? curMax : 15, (v) => { ent.max_services = Number(v); keyEl.replaceChildren(priceTag(MAX_SVC.find(([n]) => n === Number(v))[1])); paintTotal(); },
      { label: t('ent.max_services') });
    const keyEl = h('div', null, priceTag(MAX_SVC.find(([n]) => n === curMax)?.[1] ?? null));
    const save = h('button', { type: 'button', class: 'b-btn b-btn--primary' }, h('span', null, t('save')));
    save.addEventListener('click', () => busy(save, async () => {
      await rpc('adm_business_update', { business_id: id, patch: { entitlements: ent } });
      await reload();
      toast(t('saved'), { kind: 'ok', timeout: 1800 });
    }));
    paintTotal();
    return section(t('btab.package'), h('div', { class: 'b-stack' },
      h('div', { class: 'b-card adm-card--list' }, rows),
      h('div', { class: 'b-card adm-maxsvc' },
        h('div', { class: 'adm-maxsvc__head' },
          h('div', null, h('p', { class: 'adm-switchrow__label' }, t('ent.max_services')), h('p', { class: 'adm-switchrow__sub' }, t('ent.max_sub'))),
          keyEl),
        maxSeg),
      h('div', { class: 'adm-pkgtotal' }, h('span', null, t('ent.value')), total),
      h('div', { class: 'adm-formbar' }, save)), { id: 'package', sub: t('ent.sub') });
  }

  /* ───────── care plan ───────── */
  function plan() {
    const s = d.subscription || { status: 'none' };
    const plans = priceSheet.plans || [];
    const today = fmt.riyadhDateISO();
    let code = s.requested_code || (s.plan_code && s.status !== 'cancelled' ? s.plan_code : 'care');
    let interval = s.requested_interval || s.interval || 'monthly';
    let status = 'active';
    let dateTouched = false;
    const nextEnd = (iv) => {
      const [y, m, dd] = today.split('-').map(Number);
      const dt = iv === 'yearly' ? new Date(Date.UTC(y + 1, m - 1, dd)) : new Date(Date.UTC(y, m, dd));
      return dt.toISOString().slice(0, 10);
    };
    const priceFor = (c, iv) => { const p = plans.find((x) => x.code === c); return p ? (iv === 'yearly' ? p.yearly_halalas : p.monthly_halalas) : 0; };

    const cur = h('div', { class: 'b-card adm-plancur' },
      s.plan_code && s.status !== 'none'
        ? h('div', { class: 'adm-plancur__row' },
            h('div', null,
              h('p', { class: 'adm-plancur__name' }, t(`plan.name.${s.plan_code}`)),
              h('p', { class: 'adm-plancur__sub' }, `${t(`interval.${s.interval || 'monthly'}`)} · ${money(priceFor(s.plan_code, s.interval))}${s.period_end ? ` · ${t('plan.until', { date: fmt.dateShort(s.period_end, lang(), { year: true }) })}` : ''}`)),
            pill('plan', s.status))
        : h('p', { class: 'adm-quiet' }, t('plan.none_yet')));

    const req = s.requested_code
      ? h('div', { class: 'adm-alert is-hot' }, ic('plan'),
          h('div', { class: 'adm-alert__body' },
            h('p', { class: 'adm-alert__title' }, t('plan.req_title')),
            h('p', null, t('plan.req_text', { plan: t(`plan.name.${s.requested_code}`), interval: t(`interval.${s.requested_interval || 'monthly'}`), amount: money(priceFor(s.requested_code, s.requested_interval)) }))))
      : null;

    const amountEl = h('span', { class: 'adm-planform__amt' });
    const savingEl = h('span', { class: 'adm-planform__saving' });
    const endF = field({ label: t('plan.period_end'), type: 'date', value: s.period_end || nextEnd(interval), dir: 'ltr', hint: t('plan.period_hint') });
    endF.input.addEventListener('input', () => { dateTouched = true; });
    const paintAmt = () => {
      amountEl.textContent = `${money(priceFor(code, interval))} ${interval === 'yearly' ? t('per.year') : t('per.month')}`;
      const p = plans.find((x) => x.code === code);
      const sv = p && interval === 'yearly' ? p.monthly_halalas * 12 - p.yearly_halalas : 0;
      savingEl.textContent = sv > 0 ? t('est.saving', { amount: money(sv) }) : '';
    };
    const codeSeg = seg(plans.map((p) => ({ value: p.code, label: pickName(p) })), code, (v) => { code = v; paintAmt(); }, { block: true, label: t('spec.plan') });
    const ivSeg = seg(['monthly', 'yearly'].map((v) => ({ value: v, label: t(`interval.${v}`) })), interval, (v) => {
      interval = v; paintAmt();
      if (!dateTouched) endF.input.value = nextEnd(v);
    }, { block: true, label: t('spec.interval') });
    const stSeg = chipGroup(['active', 'pending', 'past_due', 'cancelled'].map((v) => ({ value: v, label: t(`plan.${v}`) })), status, (v) => { status = v; }, { label: t('plan.status') });
    paintAmt();

    const confirmBtn = h('button', { type: 'button', class: 'b-btn b-btn--primary' }, h('span', null, s.requested_code ? t('plan.accept') : t('plan.confirm')));
    confirmBtn.addEventListener('click', () => busy(confirmBtn, async () => {
      await rpc('adm_plan_set', { business_id: id, plan_code: code, interval, status, period_end: endF.input.value || null });
      await reload();
      toast(t('plan.set_done'), { kind: 'ok' });
    }));
    const stopBtn = h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--danger' }, h('span', null, t('plan.stop')));
    stopBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: t('plan.stop_title'), message: t('plan.stop_text'), confirm: t('plan.stop'), danger: true });
      if (!ok) return;
      await busy(stopBtn, async () => {
        await rpc('adm_plan_set', { business_id: id, plan_code: 'none', interval: null });
        await reload();
        toast(t('plan.stopped'), { kind: 'ok' });
      });
    });

    return h('div', { class: 'adm-cols' },
      h('div', null,
        req,
        section(t('plan.current'), cur, { id: 'plancur' }),
        section(s.requested_code ? t('plan.accept_title') : t('plan.set_title'), h('div', { class: 'b-card adm-planform' },
          h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, t('spec.plan')), codeSeg),
          h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, t('spec.interval')), ivSeg),
          h('p', { class: 'adm-planform__price' }, amountEl, savingEl),
          h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, t('plan.status')), stSeg),
          endF.el,
          h('div', { class: 'adm-formbar' }, s.plan_code && s.status !== 'none' ? stopBtn : null, confirmBtn)), { id: 'planform', sub: t('plan.sub') })),
      h('div', null, section(t('plan.prices'), h('div', { class: 'b-card' }, kv(plans.flatMap((p) => [
        [`${pickName(p)} · ${t('interval.monthly')}`, money(p.monthly_halalas)],
        [`${pickName(p)} · ${t('interval.yearly')}`, money(p.yearly_halalas)],
      ]))), { id: 'planprices', sub: t('plan.prices_sub') })));
  }

  /* ───────── payments (Moyasar) ───────── */
  function payments() {
    const b = B();
    const sec = d.secrets || {};
    const ent = !!b.entitlements?.payments;
    const pk = field({ label: t('pay.pk'), value: sec.moyasar_pk || '', dir: 'ltr', mono: true, placeholder: 'pk_test_…', attrs: { autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' } });
    const sk = field({ label: t('pay.sk'), type: 'password', dir: 'ltr', mono: true,
      placeholder: sec.has_sk ? t('pay.sk_saved_ph') : 'sk_test_…', hint: sec.has_sk ? t('pay.sk_saved') : t('pay.sk_hint'),
      attrs: { autocomplete: 'new-password', spellcheck: 'false', autocapitalize: 'none' } });
    const save = h('button', { type: 'submit', class: 'b-btn b-btn--primary' }, h('span', null, t('pay.save')));
    const form = h('form', { class: 'b-card adm-form', novalidate: true }, pk.el, sk.el, h('div', { class: 'adm-formbar' }, save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      pk.setError(''); sk.setError('');
      const p = pk.input.value.trim();
      const s = sk.input.value.trim();
      if (!/^pk_(test|live)_[A-Za-z0-9]+$/.test(p)) { pk.setError(t('pay.pk_bad')); pk.input.focus(); return; }
      if (s && !/^sk_(test|live)_[A-Za-z0-9]+$/.test(s)) { sk.setError(t('pay.sk_bad')); sk.input.focus(); return; }
      if (s && p.split('_')[1] !== s.split('_')[1]) { sk.setError(t('pay.mixed')); sk.input.focus(); return; }
      await busy(save, async () => {
        await rpc('adm_set_moyasar_keys', { business_id: id, pk: p, ...(s ? { sk: s } : {}) });
        sk.input.value = '';
        await reload();
        toast(t('pay.saved'), { kind: 'ok' });
      });
    });

    const st = (on, label) => h('li', { class: ['adm-check', on && 'is-on'] }, on ? ic('check') : ic('minus'), h('span', null, label));
    const status = h('ul', { class: 'adm-checks' },
      st(ent, ent ? t('pay.st_ent') : t('pay.st_no_ent')),
      st(!!sec.moyasar_pk, sec.moyasar_pk ? t('pay.st_pk', { kind: /^pk_live_/.test(sec.moyasar_pk) ? t('pay.live') : t('pay.test') }) : t('pay.st_no_pk')),
      st(!!sec.has_sk, sec.has_sk ? t('pay.st_sk') : t('pay.st_no_sk')),
      st(d.cfg?.payment?.mode !== 'shop', t('pay.st_mode', { mode: t(`payment.${d.cfg?.payment?.mode || 'shop'}`) })));

    const flags = d.pay_flags || [];
    const flagList = flags.length
      ? h('div', { class: 'b-list' }, flags.map((bk) => h('div', { class: 'b-row adm-flag' },
          h('span', { class: 'b-row__lead adm-flag__lead' }, ic('alert')),
          h('span', { class: 'b-row__main' },
            h('span', { class: 'b-row__title' }, `${bk.ref} · ${bk.name || ''}`),
            h('span', { class: 'b-row__sub' }, `${t(`pay.flag.${bk.pay_flag}`)} · ${t('pay.paid_of', { paid: money(bk.paid_halalas || 0), total: money(bk.due_now_halalas || bk.total_halalas || 0) })}`),
            h('span', { class: 'b-row__sub' }, `${pickName(bk, 'service_name')} · ${stamp(bk.starts_at)}`),
            bk.moyasar_id && h('span', { class: 'b-row__sub b-mono', dir: 'ltr' }, bk.moyasar_id)),
          h('span', { class: 'b-row__end adm-flag__acts' },
            bk.phone && h('a', { class: 'b-iconbtn', href: fmt.whatsappUrl(bk.phone) || `tel:${bk.phone}`, target: '_blank', rel: 'noopener', 'aria-label': t('whatsapp') }, ic('whatsapp')),
            bk.moyasar_id && h('button', { type: 'button', class: 'b-iconbtn', 'aria-label': t('pay.copy_id'), onClick: () => copyText(bk.moyasar_id) }, ic('copy'))))))
      : h('p', { class: 'adm-quiet' }, t('pay.no_flags'));

    return h('div', { class: 'adm-cols' },
      h('div', null,
        section(t('pay.keys'), form, { id: 'keys', sub: t('pay.keys_sub') }),
        section(t('pay.flags'), flagList, { id: 'flags', sub: t('pay.flags_sub') })),
      h('div', null,
        section(t('pay.status'), h('div', { class: 'b-card' }, status), { id: 'paystatus' }),
        section(t('pay.how'), h('div', { class: 'b-card adm-explain' },
          h('ol', { class: 'adm-steps' }, ['pay.how1', 'pay.how2', 'pay.how3', 'pay.how4'].map((k) => h('li', null, t(k))))), { id: 'payhow' })));
  }

  /* ───────── link & embed ───────── */
  function link() {
    const b = B();
    const last = published.get(b.slug);
    const pubBtn = h('button', { type: 'button', class: 'b-btn b-btn--primary' }, ic('upload'), h('span', null, last ? t('link.republish') : t('link.publish')));
    pubBtn.addEventListener('click', () => publish(pubBtn));
    const cloudNoToken = mode() === 'cloud' && !githubToken.get();
    const firstLang = (b.langs || ['ar'])[0];
    return h('div', { class: 'adm-cols' },
      h('div', null,
        b.status !== 'active' && h('div', { class: 'adm-alert is-warn' }, ic('alert'), h('span', null, t('link.not_live', { status: t(`biz.${b.status}`) }))),
        section(t('link.booking'), h('div', { class: 'b-stack' },
          copyRow(t('link.booking'), bookingLink(b.slug)),
          h('div', { class: 'adm-quick' },
            linkBtn(`/book/?b=${b.slug}`, t('link.preview'), { icon: 'eye', external: true }),
            linkBtn(`/manage/?b=${b.id}`, t('link.owner_dash'), { icon: 'device', external: true }))), { id: 'blink', sub: t('link.booking_sub') }),
        section(t('link.embed'), h('div', { class: 'b-stack' },
          copyRow(t('link.embed_code'), embedSnippet(b.slug, firstLang), { multiline: true }),
          h('p', { class: 'adm-quiet' }, t('link.embed_hint'))), { id: 'embed', sub: t('link.embed_sub') })),
      h('div', null,
        section(t('link.page'), h('div', { class: 'b-card b-stack' },
          h('p', null, t('link.page_text')),
          cloudNoToken && h('a', { class: 'adm-alert is-warn', href: '#/more' }, ic('key'), h('span', null, t('err.NO_GITHUB_TOKEN')), ic('forward')),
          h('p', { class: 'adm-quiet' }, last ? t('link.last', { when: stamp(last) }) : t('link.never')),
          h('div', { class: 'adm-quick' }, pubBtn,
            last && linkBtn(`/b/${b.slug}/`, t('link.view'), { icon: 'external', external: true }))), { id: 'lpage', sub: mode() === 'local' ? t('link.page_local') : t('link.page_cloud') })));
  }

  const RENDER = {
    overview, details, package: pkg, plan, payments, link,
    look: () => lookTab(ctx),
    logins: () => loginsTab(ctx),
  };

  function paintPanel() {
    let el;
    try { el = RENDER[tab](); } catch (e) { console.error(e); el = empty({ icon: 'alert', title: t('error.generic') }); }
    panel.replaceChildren(el);
  }

  paintHead();
  paintPanel();

  return {
    title: name(),
    back: '#/businesses',
    /** Same business, another tab: swap the panel without a reload. */
    update({ params: p }) {
      if (p[0] !== id) return false;
      tab = TABS.includes(p[1]) ? p[1] : 'overview';
      paintHead();
      paintPanel();
      nav.querySelector('[aria-current="page"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
      panel.querySelector('h2')?.setAttribute('tabindex', '-1');
      return true;
    },
  };
}
