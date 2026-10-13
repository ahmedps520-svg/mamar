// Requests inbox — live: a new request slides in with a chime (app.js), a badge and a toast.
import { h, reduced } from '../../platform/ui/kit.js';
import { t } from '../../platform/i18n.js';
import { rpc } from '../../platform/api.js';
import { ic, money, when, pageHead, pill, empty, badge, chipGroup } from '../ui.js';

// The inbox shows the name in the current language when the business gave one.
const nameOf = (r) => (document.documentElement.lang === 'en' ? (r.name_en || r.business_name) : (r.name_ar || r.business_name));

const FILTERS = ['all', 'new', 'reviewing', 'quoted', 'converted', 'declined'];

export default async function requests({ app, root, query }) {
  let filter = FILTERS.includes(query.get('f')) ? query.get('f') : 'all';
  let items = (await rpc('adm_requests', {})).items || [];
  let known = new Set(items.map((r) => r.id));
  const fresh = new Set();
  let animate = new Set();

  const chips = chipGroup(FILTERS.map((f) => ({ value: f, label: t(`req.f.${f}`) })), filter, (f) => {
    filter = f;
    history.replaceState(null, '', f === 'all' ? '#/requests' : `#/requests?f=${f}`);
    paintList();
  }, { label: t('req.filter'), cls: 'b-chips--scroll adm-filters' });
  const list = h('div', { class: 'adm-inbox', 'aria-busy': 'false' });
  const live = h('p', { class: 'b-sr', role: 'status', 'aria-live': 'polite' });

  root.append(
    pageHead({ eyebrow: t('req.eyebrow'), title: t('nav.requests'), sub: t('req.sub') }),
    chips, live, list);

  function paintChips() {
    chips.counts((f) => (f === 'all' ? items.length : items.filter((r) => r.status === f).length));
  }

  function row(r) {
    const nm = nameOf(r);
    const initial = (nm || '?').trim().charAt(0);
    const el = h('a', { class: ['b-row', 'adm-req', r.status === 'new' && 'is-new', fresh.has(r.id) && 'is-fresh'], href: `#/requests/${r.id}` },
      h('span', { class: ['b-row__lead', 'adm-req__lead', `adm-kind--${r.kind || 'other'}`], 'aria-hidden': 'true' }, initial),
      h('span', { class: 'b-row__main' },
        h('span', { class: 'adm-req__top' },
          h('span', { class: 'b-row__title' }, nm || t('home.untitled')),
          r.source === 'assisted' && badge(t('req.assisted'), 'b-badge--line')),
        h('span', { class: 'b-row__sub' }, [r.contact_name, t(`kind.${r.kind || 'other'}`)].filter(Boolean).join(' · ')),
        h('span', { class: 'adm-req__plan' },
          h('span', { class: 'adm-req__amt' }, money(r.setup_halalas)),
          r.plan_code && h('span', { class: 'adm-req__planname' }, ic('plan'), `${t(`plan.name.${r.plan_code}`)} · ${t(`interval.${r.plan_interval || 'monthly'}`)}`))),
      h('span', { class: 'b-row__end adm-req__end' },
        h('span', { class: 'adm-req__time' }, when(r.created_at)),
        pill('req', r.status)));
    if (animate.has(r.id) && !reduced) {
      el.animate([{ opacity: 0, transform: 'translateY(-14px) scale(.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    return el;
  }

  function paintList() {
    const shown = filter === 'all' ? items : items.filter((r) => r.status === filter);
    if (!shown.length) {
      list.replaceChildren(empty({
        icon: 'inbox',
        title: filter === 'all' ? t('req.empty') : t('req.empty_f'),
        text: t('req.empty_sub'),
      }));
      return;
    }
    list.replaceChildren(h('div', { class: 'b-list' }, shown.map(row)));
  }

  paintChips();
  paintList();

  return {
    title: t('nav.requests'),
    async onLive() {
      list.setAttribute('aria-busy', 'true');
      const next = (await rpc('adm_requests', {})).items || [];
      list.setAttribute('aria-busy', 'false');
      const arrived = next.filter((r) => !known.has(r.id));
      arrived.forEach((r) => fresh.add(r.id));
      animate = new Set(arrived.map((r) => r.id));
      known = new Set(next.map((r) => r.id));
      items = next;
      paintChips();
      paintList();
      animate = new Set();
      if (arrived.length) {
        live.textContent = arrived.map((r) => t('req.arrived', { name: nameOf(r) || '' })).join('. ');
        setTimeout(() => { arrived.forEach((r) => fresh.delete(r.id)); list.querySelectorAll('.is-fresh').forEach((x) => x.classList.remove('is-fresh')); }, 6000);
      }
    },
  };
}
