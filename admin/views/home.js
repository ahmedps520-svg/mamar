// Home: the day at a glance, the assisted-setup button, drafts and the notifications feed.
import { h, animateNumber } from '../../platform/ui/kit.js';
import { t, lang } from '../../platform/i18n.js';
import { rpc } from '../../platform/api.js';
import { URLS } from '../../platform/contract.js';
import * as fmt from '../../platform/fmt.js';
import { ic, num, money, pickName, when, pageHead, section, empty, errToast, enter } from '../ui.js';

const KIND_ICON = { setup_request: 'inbox', plan_request: 'plan', payment_flag: 'card', test: 'bell', chat_contact: 'chat' };

export default async function home({ app, root }) {
  const [ov, drafts] = await Promise.all([rpc('adm_overview'), rpc('adm_requests', { status: 'draft' })]);
  let state = { ov, drafts: drafts.items || [] };

  const now = new Date();
  const hr = fmt.riyadhParts(now).hour;
  const greet = hr >= 4 && hr < 12 ? t('home.morning') : t('home.evening');
  const dateLine = `${fmt.dateLong(now, lang(), { year: false })} · ${fmt.hijri(now, lang())}`;

  const subEl = h('p', { class: 'adm-head__sub' });
  const head = pageHead({ eyebrow: dateLine, title: greet });
  head.appendChild(subEl);

  const cta = h('a', { class: 'adm-hero', href: URLS.assisted() },
    h('span', { class: 'adm-hero__ic' }, ic('plus')),
    h('span', { class: 'adm-hero__text' },
      h('span', { class: 'adm-hero__title' }, t('home.new_system')),
      h('span', { class: 'adm-hero__sub' }, t('home.new_system_sub'))),
    ic('forward', { class: 'adm-hero__go' }));

  const stats = h('div', { class: 'adm-stats' });
  const draftsBox = h('div');
  const feed = h('div');
  const markAll = h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--sm', onClick: () => readAll() }, h('span', null, t('home.mark_all')));

  root.append(
    head,
    h('div', { class: 'adm-home' },
      h('div', { class: 'adm-home__main' },
        enter(cta),
        section(t('home.today'), stats, { id: 'today' }),
        section(t('home.drafts'), draftsBox, { id: 'drafts', sub: t('home.drafts_sub') })),
      h('div', { class: 'adm-home__side' },
        section(t('home.feed'), feed, { id: 'feed', action: markAll }))));

  function paint(first = false) {
    const o = state.ov;
    const newN = o.requests?.new || 0;
    subEl.textContent = newN ? t('home.sub_new', { n: newN }) : t('home.sub_clear');

    const tile = (href, label, value, sub, opts = {}) => {
      const v = h('span', { class: 'b-stat__value' }, typeof value === 'number' ? num(value) : value);
      const el = h('a', { class: ['b-stat', 'adm-stat', opts.wide && 'adm-stat--wide', opts.hot && 'is-hot'], href },
        h('span', { class: 'b-stat__label' }, label), v,
        sub && h('span', { class: 'b-stat__delta' }, sub));
      if (typeof value === 'number' && opts.count && first) animateNumber(v, 0, value, { format: num, duration: 700 });
      return el;
    };
    stats.replaceChildren(
      tile('#/requests?f=new', t('stat.new_requests'), newN, t('stat.open', { n: o.requests?.open || 0 }), { hot: newN > 0, count: true }),
      tile('#/businesses', t('stat.bookings_today'), o.bookings_today || 0, t('stat.across'), { count: true }),
      tile('#/businesses?f=active', t('stat.active'), o.businesses?.active || 0, t('stat.demo', { n: o.businesses?.demo || 0 }), { count: true }),
      tile('#/businesses?f=awaiting_payment', t('stat.awaiting'), o.businesses?.awaiting_payment || 0, t('stat.drafts', { n: o.businesses?.draft || 0 }), { count: true }),
      tile('#/businesses', t('stat.mrr'), money(Math.round((o.plans?.mrr_halalas || 0) / 100) * 100),
        o.plans?.requested ? t('stat.plans_req', { n: o.plans?.active || 0, r: o.plans.requested }) : t('stat.plans', { n: o.plans?.active || 0 }),
        { wide: true }));

    const d = state.drafts;
    draftsBox.replaceChildren(d.length
      ? h('div', { class: 'b-list' }, d.map((r) => h('div', { class: 'b-row adm-draft' },
          h('span', { class: 'b-row__lead' }, ic('doc')),
          h('span', { class: 'b-row__main' },
            h('span', { class: 'b-row__title' }, r.business_name || t('home.untitled')),
            h('span', { class: 'b-row__sub' }, [r.contact_name, money(r.setup_halalas), when(r.updated_at || r.created_at)].filter(Boolean).join(' · '))),
          h('a', { class: 'b-btn b-btn--ghost b-btn--sm', href: URLS.assisted(r.id) }, h('span', null, t('home.resume'))))))
      : h('p', { class: 'adm-quiet' }, t('home.no_drafts')));

    const items = o.notifications || [];
    markAll.hidden = !(o.unread > 0);
    feed.replaceChildren(items.length
      ? h('ul', { class: 'b-list adm-feed' }, items.map((n) => h('li', null,
          h('button', { type: 'button', class: ['b-row', 'adm-note', !n.read_at && 'is-unread'], onClick: () => openNote(n) },
            h('span', { class: ['b-row__lead', `adm-note__ic--${n.kind}`] }, ic(KIND_ICON[n.kind] || 'bell')),
            h('span', { class: 'b-row__main' },
              h('span', { class: 'b-row__title' }, pickName(n, 'title')),
              (pickName(n, 'body')) && h('span', { class: 'b-row__sub' }, pickName(n, 'body'))),
            h('span', { class: 'b-row__end adm-note__end' },
              h('span', { class: 'adm-note__time' }, when(n.created_at)),
              !n.read_at && h('span', { class: 'adm-unread', role: 'img', 'aria-label': t('home.unread') }))))))
      : empty({ icon: 'bell', title: t('home.feed_empty'), text: t('home.feed_empty_sub') }));
  }

  async function openNote(n) {
    if (!n.read_at) {
      n.read_at = new Date().toISOString();
      rpc('adm_notifications_read', { ids: [n.id] }).then(() => app.pulse()).catch(() => {});
    }
    if (n.url) app.open(n.url);
  }

  async function readAll() {
    try {
      await rpc('adm_notifications_read', { all: true });
      await app.pulse();
    } catch (e) { errToast(e); }
  }

  paint(true);

  return {
    title: t('nav.home'),
    async onLive({ ov: next }) {
      const dr = await rpc('adm_requests', { status: 'draft' }).catch(() => null);
      state = { ov: next, drafts: dr ? dr.items || [] : state.drafts };
      paint();
    },
  };
}
