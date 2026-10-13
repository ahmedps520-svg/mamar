// Businesses: every client (and the demos), with status, plan, owners and upcoming bookings.
import { h } from '../../platform/ui/kit.js';
import { t } from '../../platform/i18n.js';
import { rpc } from '../../platform/api.js';
import { ic, pickName, pageHead, pill, empty, badge, chipGroup } from '../ui.js';

const FILTERS = ['all', 'active', 'awaiting_payment', 'draft', 'paused', 'demo'];

export default async function businesses({ root, query }) {
  let filter = FILTERS.includes(query.get('f')) ? query.get('f') : 'all';
  let items = (await rpc('adm_businesses', {})).items || [];

  const chips = chipGroup(FILTERS.map((f) => ({ value: f, label: t(`biz.f.${f}`) })), filter, (f) => {
    filter = f;
    history.replaceState(null, '', f === 'all' ? '#/businesses' : `#/businesses?f=${f}`);
    paint();
  }, { label: t('biz.filter'), cls: 'b-chips--scroll adm-filters' });
  const list = h('div');
  root.append(pageHead({ eyebrow: t('biz.eyebrow'), title: t('nav.businesses'), sub: t('biz.sub') }), chips, list);

  const match = (b, f) => (f === 'all' ? true : f === 'demo' ? b.is_demo : b.status === f && !b.is_demo);

  function paintChips() {
    chips.counts((f) => items.filter((b) => match(b, f)).length);
  }

  function planLine(b) {
    if (b.plan_requested) {
      return h('span', { class: 'adm-bizrow__plan is-req' }, ic('plan'),
        t('biz.plan_requested', { plan: t(`plan.name.${b.plan_requested}`) }));
    }
    if (!b.plan_code || b.plan_status === 'none') return h('span', { class: 'adm-bizrow__plan is-none' }, t('biz.no_plan'));
    return h('span', { class: 'adm-bizrow__plan' }, ic('plan'),
      `${t(`plan.name.${b.plan_code}`)} · ${t(`interval.${b.plan_interval || 'monthly'}`)} · ${t(`plan.${b.plan_status}`)}`);
  }

  function row(b) {
    const name = pickName(b);
    return h('a', { class: ['b-row', 'adm-bizrow', b.is_demo && 'is-demo'], href: `#/businesses/${b.id}` },
      h('span', { class: ['b-row__lead', 'adm-bizrow__lead', `adm-kind--${b.kind}`], 'aria-hidden': 'true' }, name.trim().charAt(0) || '·'),
      h('span', { class: 'b-row__main' },
        h('span', { class: 'adm-req__top' },
          h('span', { class: 'b-row__title' }, name),
          b.is_demo && badge(t('biz.demo'), 'b-badge--line'),
          b.look === 'custom' && h('span', { class: 'adm-lookdot', title: t('look.custom'), 'aria-label': t('look.custom'), role: 'img' })),
        h('span', { class: 'b-row__sub', dir: 'ltr' }, `/b/${b.slug}`),
        h('span', { class: 'adm-bizrow__meta' },
          planLine(b),
          h('span', null, ic('users'), t('biz.owners_n', { n: b.owners || 0 })),
          h('span', null, ic('calendar'), t('biz.upcoming_n', { n: b.upcoming || 0 })))),
      h('span', { class: 'b-row__end' }, pill('biz', b.status), ic('forward', { class: 'b-row__chev' })));
  }

  function paint() {
    const shown = items.filter((b) => match(b, filter));
    list.replaceChildren(shown.length
      ? h('div', { class: 'b-list' }, shown.map(row))
      : empty({ icon: 'store', title: t('biz.empty'), text: t('biz.empty_sub') }));
  }

  paintChips();
  paint();

  return {
    title: t('nav.businesses'),
    async onLive() {
      items = (await rpc('adm_businesses', {})).items || [];
      paintChips(); paint();
    },
  };
}
