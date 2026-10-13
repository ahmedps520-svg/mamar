// One setup request: the answers as a readable spec, the itemised estimate, contact,
// status + autosaved notes, and the actions (create business · decline · delete spam).
import { h, sheet, confirmDialog, toast } from '../../platform/ui/kit.js';
import { t, lang } from '../../platform/i18n.js';
import { rpc } from '../../platform/api.js';
import { URLS } from '../../platform/contract.js';
import * as fmt from '../../platform/fmt.js';
import {
  ic, money, num, when, stamp, pageHead, section, pill, badge, kv, field, busy, errToast, debounce, linkBtn, ltr, chipGroup,
} from '../ui.js';

const STATUSES = ['new', 'reviewing', 'quoted', 'converted', 'declined'];
const HEX = /^#[0-9a-f]{6}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);

/** minutes after midnight → '9:30 PM' (+ '(next day)' past midnight) */
function clock(min) {
  const m = Number(min) || 0;
  const wrapped = ((m % 1440) + 1440) % 1440;
  const s = fmt.time(`${Math.floor(wrapped / 60)}:${String(wrapped % 60).padStart(2, '0')}`, lang());
  return m >= 1440 ? `${s} ${t('spec.next_day')}` : s;
}

function yes(on) {
  return h('span', { class: ['adm-yn', on ? 'is-on' : 'is-off'] }, on ? ic('check') : ic('minus'), on ? t('yes') : t('no'));
}

export function specView(a = {}, est = {}) {
  const b = a.business || {};
  const blocks = [];
  const block = (key, icon, body) => blocks.push(h('section', { class: 'adm-spec', 'aria-labelledby': `spec-${key}` },
    h('h3', { class: 'adm-spec__title', id: `spec-${key}` }, ic(icon), t(`spec.h.${key}`)), body));

  // business
  block('business', 'store', kv([
    [t('spec.name_ar'), h('span', { lang: 'ar', dir: 'rtl' }, b.name_ar || '—')],
    [t('spec.name_en'), h('span', { lang: 'en', dir: 'ltr' }, b.name_en || '—')],
    [t('spec.kind'), t(`kind.${b.kind || 'other'}`)],
    b.site_url && [t('spec.site'), h('a', { href: /^https?:\/\//i.test(b.site_url) ? b.site_url : `https://${b.site_url}`, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr' }, b.site_url)],
    b.instagram && [t('spec.instagram'), h('a', { href: `https://instagram.com/${String(b.instagram).replace(/^@/, '')}`, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr' }, `@${String(b.instagram).replace(/^@/, '')}`)],
  ]));

  // services
  const svcs = Array.isArray(a.services) ? a.services : [];
  const capacity = a.slots?.mode === 'capacity';
  if (a.services_later || !svcs.length) {
    block('services', 'tag', h('p', { class: 'adm-spec__text' }, t('spec.services_later', { n: Number(a.service_count) || est.service_count || 0 })));
  } else {
    block('services', 'tag', h('div', { class: 'adm-tablewrap' }, h('table', { class: 'adm-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, t('service')),
        h('th', { scope: 'col' }, t('duration')),
        h('th', { scope: 'col', class: 'is-num' }, t('price')),
        capacity && h('th', { scope: 'col', class: 'is-num' }, t('spec.max_qty')))),
      h('tbody', null, svcs.map((s) => {
        const ar = s.name_ar || s.name || s.name_en || '';
        const en = s.name_en || s.name || s.name_ar || '';
        const main = lang() === 'en' ? en : ar;
        const other = lang() === 'en' ? ar : en;
        return h('tr', null,
          h('th', { scope: 'row' }, h('span', { class: 'adm-table__name' }, main), other && other !== main && h('span', { class: 'adm-table__alt' }, other)),
          h('td', null, fmt.durationMin(s.duration_min, lang())),
          h('td', { class: 'is-num' }, money(Math.round((Number(s.price_sar) || 0) * 100))),
          capacity && h('td', { class: 'is-num' }, num(Number(s.max_qty) || 1)));
      })))),
      h('p', { class: 'adm-spec__foot' }, t('spec.services_n', { n: svcs.length })));
  }

  // hours
  const hours = a.hours && typeof a.hours === 'object' ? a.hours : {};
  block('hours', 'clock', h('div', { class: 'adm-hours' }, [6, 0, 1, 2, 3, 4, 5].map((d) => {
    const ranges = Array.isArray(hours[d]) ? hours[d] : Array.isArray(hours[String(d)]) ? hours[String(d)] : [];
    return h('div', { class: ['adm-hours__row', !ranges.length && 'is-closed'] },
      h('span', { class: 'adm-hours__day' }, t(`wd.${d}`)),
      h('span', { class: 'adm-hours__val' }, ranges.length
        ? ranges.map((r) => `${clock(r[0])} – ${clock(r[1])}`).join(lang() === 'en' ? ', ' : '، ')
        : t('closed')));
  })));

  // slots
  block('slots', 'users', kv([
    [t('spec.slot_mode'), capacity ? t('spec.mode_capacity') : t('spec.mode_staff')],
    capacity ? [t('spec.capacity'), num(Number(a.slots?.capacity) || 1)] : [t('spec.staff_count'), num(Number(a.slots?.staff_count) || 1)],
    [t('spec.branches'), num(Math.max(1, Number(a.branches) || 1))],
  ]));

  // features
  const feat = [
    ['staff_choice', a.staff_choice], ['sections', a.sections], ['home_service', a.home_service],
    ['prayer', a.prayer], ['hijri', a.hijri !== false], ['self_manage', a.extras?.self_manage], ['waitlist', a.extras?.waitlist],
  ];
  block('features', 'sparkle', h('ul', { class: 'adm-feats' }, feat.map(([k, on]) =>
    h('li', { class: ['adm-feat', on ? 'is-on' : 'is-off'] }, h('span', null, t(`feat.${k}`)), yes(!!on)))));

  // look & brand
  const br = a.brand || {};
  const lookRows = [[t('spec.look'), a.look === 'custom' ? t('look.custom') : t('look.standard')]];
  if (a.look === 'custom') {
    lookRows.push([t('spec.mode'), br.mode === 'dark' ? t('theme.dark') : t('theme.light')]);
    if (HEX.test(br.accent || '')) {
      lookRows.push([t('spec.accent'), h('span', { class: 'adm-swatchval' }, h('span', { class: 'adm-swatch', style: { background: br.accent } }), h('span', { class: 'b-mono', dir: 'ltr' }, br.accent.toUpperCase()))]);
    }
    if (br.logo_note) lookRows.push([t('spec.logo_note'), br.logo_note]);
    if (br.fonts_note) lookRows.push([t('spec.fonts_note'), br.fonts_note]);
  }
  block('look', 'palette', kv(lookRows));

  // languages, customers, payment
  block('booking', 'card', kv([
    [t('spec.langs'), t(`langs.${['ar', 'en', 'both'].includes(a.langs) ? a.langs : 'ar'}`)],
    [t('spec.customer'), t(`customer.${a.customer || 'name_phone'}`)],
    [t('spec.payment'), t(`payment.${a.payment || 'shop'}`)],
  ]));

  // care plan
  const plan = a.plan?.code && a.plan.code !== 'none' ? a.plan : null;
  block('plan', 'plan', plan
    ? kv([[t('spec.plan'), t(`plan.name.${plan.code}`)], [t('spec.interval'), t(`interval.${plan.interval === 'yearly' ? 'yearly' : 'monthly'}`)]])
    : h('p', { class: 'adm-spec__text' }, t('spec.no_plan')));

  return h('div', { class: 'adm-specs' }, blocks);
}

export function estimateView(est = {}) {
  const lines = est.lines || [];
  const rows = lines.map((l) => {
    const label = lang() === 'en' ? (l.label_en || l.label_ar) : (l.label_ar || l.label_en);
    const v = l.quote ? badge(t('est.quote'), 'b-badge--soft') : l.amount_halalas ? money(l.amount_halalas) : h('span', { class: 'adm-included' }, t('included'));
    return h('div', { class: 'b-kv__row' },
      h('span', { class: 'b-kv__k adm-est__k' }, label, l.qty > 1 && h('span', { class: 'adm-est__qty' }, `× ${num(l.qty)}`),
        h('span', { class: 'adm-est__key b-mono', dir: 'ltr' }, l.key)),
      h('span', { class: 'b-kv__v' }, v));
  });
  const plan = est.plan && est.plan.code && est.plan.code !== 'none' ? est.plan : null;
  return h('div', { class: 'adm-est' },
    h('div', { class: 'b-kv' }, rows,
      h('div', { class: 'b-kv__row b-kv__row--total' },
        h('span', { class: 'b-kv__k' }, t('est.setup')),
        h('span', { class: 'b-kv__v' }, money(est.setup_halalas || 0)))),
    est.has_quote && h('p', { class: 'adm-est__note' }, ic('info'), t('est.has_quote')),
    plan && h('div', { class: 'adm-est__plan' },
      h('div', null,
        h('p', { class: 'adm-est__planname' }, `${lang() === 'en' ? plan.name_en : plan.name_ar} · ${t(`interval.${plan.interval}`)}`),
        plan.saving_halalas > 0 && h('p', { class: 'adm-est__saving' }, t('est.saving', { amount: money(plan.saving_halalas) }))),
      h('p', { class: 'adm-est__planamt' }, money(plan.amount_halalas), h('small', null, plan.interval === 'yearly' ? t('per.year') : t('per.month')))));
}

export default async function request({ app, root, params }) {
  const [id] = params;
  let r = await rpc('adm_request', { id });
  const isDraft = r.status === 'draft';
  const rl = r.lang === 'en' ? 'en' : 'ar';
  const bn = r.answers?.business || {};
  const shownName = (lang() === 'en' ? bn.name_en || bn.name_ar : bn.name_ar || bn.name_en) || r.business_name;

  const headPill = h('span', null, pill('req', r.status));
  const head = pageHead({
    back: { href: '#/requests', label: t('nav.requests') },
    eyebrow: `${t('req.ref')} ${ltr(r.ref)}`,
    title: shownName || t('home.untitled'),
    sub: `${t(`kind.${r.answers?.business?.kind || 'other'}`)} · ${t('req.received', { when: stamp(r.created_at) })}`,
  });
  head.querySelector('.adm-head__row').after(h('div', { class: 'adm-head__meta' }, headPill,
    r.source === 'assisted' && badge(t('req.assisted'), 'b-badge--line'),
    badge(rl === 'en' ? t('lang.en') : t('lang.ar'), 'b-badge--line')));

  /* contact */
  const phone = r.phone ? fmt.formatPhone(r.phone, 'en') : '';
  const opening = t('req.wa_open', { name: r.contact_name || '', business: r.business_name || '', ref: r.ref }, rl);
  const wa = r.phone ? fmt.whatsappUrl(r.phone, opening) : null;
  const contact = h('div', { class: 'b-card adm-contact' },
    h('div', { class: 'adm-contact__who' },
      h('span', { class: 'adm-avatar', 'aria-hidden': 'true' }, (r.contact_name || '?').trim().charAt(0)),
      h('div', null,
        h('p', { class: 'adm-contact__name' }, r.contact_name || '—'),
        phone && h('p', { class: 'adm-contact__line' }, h('span', { dir: 'ltr' }, phone)),
        r.email && h('p', { class: 'adm-contact__line' }, h('span', { dir: 'ltr' }, r.email)))),
    h('div', { class: 'adm-contact__acts' },
      wa && h('a', { class: 'b-btn b-btn--primary adm-wa', href: wa, target: '_blank', rel: 'noopener' }, ic('whatsapp'), h('span', null, t('whatsapp'))),
      r.phone && h('a', { class: 'b-btn b-btn--ghost', href: `tel:${r.phone}` }, ic('phone'), h('span', null, t('call'))),
      r.email && h('a', { class: 'b-btn b-btn--ghost', href: `mailto:${r.email}?subject=${encodeURIComponent(`Mamar · ${r.business_name}`)}&body=${encodeURIComponent(opening)}` }, ic('mail'), h('span', null, t('req.email_btn')))),
    wa && h('p', { class: 'adm-contact__hint' }, t('req.wa_hint', { lang: rl === 'en' ? t('lang.en') : t('lang.ar') })));

  /* status + notes */
  const statusRow = chipGroup(STATUSES.map((s) => ({ value: s, label: t(`req.${s}`), cls: `adm-st--${s}` })), r.status,
    (s, btn) => setStatus(s, btn), { label: t('req.status'), cls: 'adm-statuses' });
  const paintStatus = () => {
    statusRow.set(r.status);
    headPill.replaceChildren(pill('req', r.status));
  };
  async function setStatus(s, btn) {
    if (s === r.status) return;
    const ok = await busy(btn, async () => {
      r = { ...r, ...(await rpc('adm_request_update', { id: r.id, status: s })) };
      return true;
    });
    paintStatus();
    if (!ok) return;
    paintActions();
    toast(t('req.status_set', { status: t(`req.${s}`) }), { kind: 'ok', timeout: 1800 });
  }

  const notes = field({ label: t('req.notes'), value: r.note || '', multiline: true, placeholder: t('req.notes_ph'), attrs: { rows: 4, maxlength: 4000 } });
  const saveState = h('span', { class: 'adm-autosave', role: 'status', 'aria-live': 'polite' });
  const saveNote = debounce(async () => {
    saveState.textContent = t('saving');
    saveState.className = 'adm-autosave is-saving';
    try {
      await rpc('adm_request_update', { id: r.id, note: notes.input.value });
      r.note = notes.input.value;
      saveState.replaceChildren(ic('check'), t('saved'));
      saveState.className = 'adm-autosave is-saved';
    } catch (e) {
      saveState.textContent = t('req.note_failed');
      saveState.className = 'adm-autosave is-err';
      errToast(e);
    }
  }, 800);
  notes.input.addEventListener('input', () => { saveState.textContent = ''; saveNote(); });
  notes.input.addEventListener('blur', () => saveNote.flush());

  const statusCard = h('div', { class: 'b-card adm-statuscard' },
    !isDraft && h('div', { class: 'adm-statuscard__row' }, h('p', { class: 'adm-label' }, t('req.status')), statusRow),
    notes.el,
    h('div', { class: 'adm-statuscard__foot' }, h('span', { class: 'adm-quiet' }, t('req.notes_hint')), saveState));

  /* actions */
  const actions = h('div', { class: 'adm-actions' });
  function paintActions() {
    if (isDraft) {
      actions.replaceChildren(
        h('a', { class: 'b-btn b-btn--primary b-btn--block', href: URLS.assisted(r.id) }, ic('wand'), h('span', null, t('home.resume'))),
        h('p', { class: 'adm-quiet' }, t('req.draft_note')));
      return;
    }
    actions.replaceChildren(
      r.business_id
        ? h('a', { class: 'b-btn b-btn--primary b-btn--block', href: `#/businesses/${r.business_id}` }, ic('store'), h('span', null, t('req.open_business')))
        : h('button', { type: 'button', class: 'b-btn b-btn--primary b-btn--block', onClick: createBusiness }, ic('plus'), h('span', null, t('req.create_business'))),
      h('div', { class: 'adm-actions__row' },
        r.status !== 'declined' && !r.business_id && h('button', { type: 'button', class: 'b-btn b-btn--ghost', onClick: decline }, h('span', null, t('req.decline'))),
        !r.business_id && h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--danger', onClick: del }, ic('trash'), h('span', null, t('req.delete_spam')))));
  }

  async function createBusiness() {
    const want = slugify(r.answers?.business?.name_en || '') || '';
    const slugF = field({ label: t('biz.slug'), value: want, dir: 'ltr', mono: true, hint: t('req.slug_hint'),
      attrs: { autocapitalize: 'none', spellcheck: 'false', maxlength: 40, inputmode: 'url' } });
    const prefix = h('span', { class: 'b-field__affix adm-affix', dir: 'ltr' }, 'mamar.site/b/');
    slugF.el.querySelector('.b-field__box').prepend(prefix);
    slugF.input.addEventListener('input', () => { slugF.input.value = slugF.input.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); slugF.setError(''); });
    const created = await sheet({
      title: t('req.create_title'),
      content: h('div', { class: 'b-stack' }, h('p', null, t('req.create_text')), slugF.el),
      actions: [
        { label: t('cancel'), value: null, kind: 'ghost' },
        {
          label: t('req.create_business'), kind: 'primary', autofocus: false,
          onClick: async () => {
            const slug = slugF.input.value.trim();
            if (slug && !SLUG.test(slug)) { slugF.setError(t('biz.slug_bad')); slugF.input.focus(); return false; }
            try {
              const res = await rpc('adm_business_create', { request_id: r.id, ...(slug ? { slug } : {}) });
              return res;
            } catch (e) { errToast(e); return false; }
          },
        },
      ],
    });
    // sheet() resolves with the action's label when onClick returns a value; read the request again instead.
    if (created) {
      const fresh = await rpc('adm_request', { id: r.id });
      if (fresh.business_id) {
        toast(t('req.created'), { kind: 'ok' });
        app.go(`/businesses/${fresh.business_id}`);
      }
    }
  }

  async function decline() {
    const ok = await confirmDialog({ title: t('req.decline_title'), message: t('req.decline_text'), confirm: t('req.decline') });
    if (!ok) return;
    try {
      r = { ...r, ...(await rpc('adm_request_update', { id: r.id, status: 'declined' })) };
      paintStatus(); paintActions();
      toast(t('req.declined_done'), { kind: 'ok' });
    } catch (e) { errToast(e); }
  }

  async function del() {
    const ok = await confirmDialog({ title: t('req.delete_title'), message: t('req.delete_text'), confirm: t('delete'), danger: true });
    if (!ok) return;
    try {
      const res = await rpc('adm_request_delete', { id: r.id });
      if (!res.ok) { toast(t('req.delete_blocked'), { kind: 'warn' }); return; }
      toast(t('req.deleted'), { kind: 'ok' });
      app.go('/requests');
    } catch (e) { errToast(e); }
  }

  paintStatus();
  paintActions();

  root.append(head, h('div', { class: 'adm-detail' },
    h('div', { class: 'adm-detail__aside' },
      section(t('req.contact'), contact, { id: 'contact' }),
      section(isDraft ? t('req.notes') : t('req.status_notes'), statusCard, { id: 'status' }),
      section(null, actions, { cls: 'adm-sec--actions' })),
    h('div', { class: 'adm-detail__main' },
      section(t('req.estimate'), h('div', { class: 'b-card' }, estimateView(r.estimate || {})), { id: 'estimate', sub: t('req.estimate_sub') }),
      section(t('req.spec'), specView(r.answers || {}, r.estimate || {}), { id: 'spec' }))));

  return {
    title: shownName || t('nav.requests'),
    back: '#/requests',
    destroy() { saveNote.flush(); },
  };
}
