/* ==========================================================
   Plan & billing — simple and honest. Requests go to Mamar
   (own_plan_request notifies Ahmed); nothing is charged here.
   ========================================================== */

import { S, t, fmt, h, icon, call, errText, nm, fm, btn, seg, busy, toast, emptyState, L, pref } from '../core.js';
import { skeleton, confirmDialog } from '../../platform/ui/kit.js';

export function mount(main) {
  const root = h('div', { class: 'mg-billing' }, skeleton(3));
  main.replaceChildren(root);
  let data = null;
  let interval = pref.get('mamar-manage-interval', null);

  async function load() {
    try {
      data = await call('own_billing', {}, { quiet: true });
      if (!interval) interval = data.subscription?.interval || 'yearly';
      paint();
    } catch (e) {
      root.replaceChildren(emptyState('alert', t('mg.load_failed'), errText(e), btn(t('retry'), { onClick: load })));
    }
  }

  async function request(code, iv, button) {
    await busy(button, async () => {
      try {
        data = await call('own_plan_request', { plan_code: code, interval: iv }, { quiet: true });
        toast(t('mg.bl.sent'), { kind: 'ok' });
        paint();
      } catch (e) { toast(errText(e), { kind: 'err' }); }
    });
  }

  function paint() {
    const sub = data.subscription || { status: 'none' };
    const plans = (data.plans || []).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const current = plans.find((p) => p.code === sub.plan_code);
    const hasPlan = current && ['active', 'pending', 'past_due'].includes(sub.status);
    const req = sub.requested_code;
    const reqPlan = plans.find((p) => p.code === req);

    const status = h('span', { class: `mg-plstatus mg-plstatus--${sub.status || 'none'}` }, t(`mg.bl.st.${sub.status || 'none'}`));
    const currentCard = h('section', { class: 'mg-plancur' },
      h('span', { class: 'mg-label' }, t('mg.bl.current')),
      h('div', { class: 'mg-plancur__row' },
        h('strong', { class: 'mg-plancur__name' }, current ? nm(current) : t('mg.bl.none')),
        status),
      current && h('p', { class: 'mg-plancur__sub' },
        `${sub.interval === 'yearly' ? t('mg.bl.yearly') : t('mg.bl.monthly')} · ${fm(sub.interval === 'yearly' ? current.yearly_halalas : current.monthly_halalas)} ${sub.interval === 'yearly' ? t('mg.bl.per_year') : t('mg.bl.per_month')}`,
        sub.period_end ? ` · ${t('mg.bl.renews', { date: fmt.dateShort(sub.period_end, L(), { year: true }) })}` : ''),
      data.setup_halalas != null && h('dl', { class: 'b-kv mg-kv' },
        h('div', { class: 'b-kv__row' }, h('dt', { class: 'b-kv__k' }, t('mg.bl.setup')), h('dd', { class: 'b-kv__v' }, fm(data.setup_halalas), h('small', { class: 'mg-muted' }, ` · ${t('mg.bl.setup_once')}`)))),
      req && h('p', { class: 'mg-pending' }, icon('clock'),
        h('span', null, req === 'none' ? t('mg.bl.stop_requested')
          : `${t('mg.bl.requested_line', { plan: nm(reqPlan) || req, interval: sub.requested_interval === 'yearly' ? t('mg.bl.yearly') : t('mg.bl.monthly') })} — ${t('mg.bl.requested').split('—').pop().trim()}`)));

    const ivSeg = seg([{ value: 'monthly', label: t('mg.bl.monthly') }, { value: 'yearly', label: t('mg.bl.yearly') }], interval,
      (v) => { interval = v; pref.set('mamar-manage-interval', v); paint(); }, { label: t('mg.bl.interval'), block: false });

    const cards = plans.map((p) => {
      const yearly = interval === 'yearly';
      const amount = yearly ? p.yearly_halalas : p.monthly_halalas;
      const saving = p.monthly_halalas * 12 - p.yearly_halalas;   // computed from the plans themselves
      const isCurrent = hasPlan && sub.plan_code === p.code && sub.interval === interval;
      const isRequested = req === p.code && sub.requested_interval === interval;
      let action;
      if (isCurrent) action = h('span', { class: 'mg-planbtn is-current' }, icon('check'), t('mg.bl.current_btn'));
      else if (isRequested) action = h('span', { class: 'mg-planbtn is-requested', role: 'status' }, icon('clock'), t('mg.bl.requested'));
      else {
        const b = btn(hasPlan ? t('mg.bl.switch') : t('mg.bl.request'), { kind: hasPlan ? 'ghost' : 'primary', size: null, block: true });
        b.addEventListener('click', () => request(p.code, interval, b));
        action = b;
      }
      return h('article', { class: ['mg-plan', isCurrent && 'is-current', p.code === 'live' && 'is-featured'] },
        h('div', { class: 'mg-plan__top' },
          h('h3', { class: 'mg-plan__name' }, nm(p)),
          yearly && saving > 0 && h('span', { class: 'b-badge b-badge--soft' }, t('save_amount', { amount: fm(saving) }))),
        h('p', { class: 'mg-plan__price' },
          h('strong', null, fm(amount)),
          h('span', null, ` ${yearly ? t('mg.bl.per_year') : t('mg.bl.per_month')}`)),
        yearly && h('p', { class: 'mg-plan__equiv' }, t('mg.bl.equiv', { amount: fm(Math.round(p.yearly_halalas / 12 / 100) * 100) })),
        h('p', { class: 'mg-plan__desc' }, nm(p, 'desc')),
        action);
    });

    const stop = hasPlan && req !== 'none' ? btn(t('mg.bl.stop'), {
      kind: 'quiet', danger: true,
      onClick: async (e) => {
        const b = e.currentTarget;
        const ok = await confirmDialog({ title: t('mg.bl.stop_q'), message: t('mg.bl.stop_text'), confirm: t('mg.bl.stop'), danger: true });
        if (ok) request('none', sub.interval || 'monthly', b);
      },
    }) : null;

    root.replaceChildren(...[
      currentCard,
      h('div', { class: 'mg-sechead' },
        h('div', { class: 'mg-sechead__text' }, h('h2', { class: 'mg-sechead__title' }, t('mg.bl.choose'))),
        ivSeg),
      h('div', { class: 'mg-plans' }, cards),
      h('p', { class: 'mg-hint' }, icon('info'), h('span', null, t('mg.bl.honest'))),
      stop && h('div', { class: 'mg-center' }, stop),
    ].filter(Boolean));
  }

  load();
  return () => {};
}

export const title = () => t('mg.more.billing');
export { S };
