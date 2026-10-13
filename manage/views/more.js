/* ==========================================================
   More — menu plus waitlist, profile, booking link and
   account pages. Hours, team, settings and billing live in
   their own modules. Phones: menu → page. Desktop: two panes.
   ========================================================== */

import {
  S, t, fmt, h, icon, on, call, errText, nm, cfg, ent, btn, seg, field, switchRow, busy, toast, emptyState,
  copyText, bookingLink, bizName, telUrl, L, group, ctlRow, loadOverview, dayWord, SITE, xicon, phoneText,
} from '../core.js';
import { skeleton, confirmDialog } from '../../platform/ui/kit.js';
import { setLang, lang } from '../../platform/i18n.js';
import { signOut } from '../../platform/api.js';
import { URLS } from '../../platform/contract.js';
import { themePref, setThemePref, chimeOn, setChime, install, isStandalone, isIOS } from '../prefs.js';
import { waIcon } from './booking.js';
import * as hours from './hours.js';
import * as team from './team.js';
import * as settings from './settings.js';
import * as billing from './billing.js';

export const PAGES = {
  hours: { icon: 'clock', title: () => t('mg.more.hours'), sub: () => t('mg.more.hours_sub'), mount: hours.mount },
  team: { icon: 'user', title: () => t('mg.more.team'), sub: () => t('mg.more.team_sub'), mount: team.mount },
  waitlist: { icon: 'inbox', title: () => t('mg.more.waitlist'), sub: () => t('mg.more.waitlist_sub'), mount: mountWaitlist, when: () => cfg().waitlist },
  settings: { icon: 'sparkle', title: () => t('mg.more.settings'), sub: () => t('mg.more.settings_sub'), mount: settings.mount },
  profile: { icon: 'pin', title: () => t('mg.more.profile'), sub: () => t('mg.more.profile_sub'), mount: mountProfile },
  billing: { icon: 'calendar', title: () => t('mg.more.billing'), sub: () => t('mg.more.billing_sub'), mount: billing.mount },
  link: { icon: 'globe', title: () => t('mg.more.link'), sub: () => t('mg.more.link_sub'), mount: mountLink },
  account: { icon: 'user', title: () => t('mg.more.account'), sub: () => t('mg.more.account_sub'), mount: mountAccount },
};
const visible = () => Object.entries(PAGES).filter(([, p]) => !p.when || p.when());

export function mount(main, { sub } = {}) {
  const wide = window.matchMedia('(min-width: 1024px)');
  const root = h('div', { class: 'mg-more' });
  main.replaceChildren(root);
  let cleanup = () => {};

  function menu(active) {
    const counts = S.ov?.counts || {};
    return h('nav', { class: 'mg-menu', 'aria-label': t('mg.more.title') },
      h('h1', { class: 'mg-pagehead__title mg-menu__title' }, t('mg.more.title')),
      h('div', { class: 'b-list' }, visible().map(([k, p]) => h('a', {
        class: ['b-row', 'mg-menurow', active === k && 'is-active'], href: `#/more/${k}`,
        'aria-current': active === k ? 'page' : null,
      },
        h('span', { class: 'b-row__lead' }, icon(p.icon)),
        h('span', { class: 'b-row__main' }, h('span', { class: 'b-row__title' }, p.title()), h('span', { class: 'b-row__sub' }, p.sub())),
        k === 'waitlist' && counts.waitlist > 0 && h('span', { class: 'mg-count' }, fmt.digits(String(counts.waitlist), L())),
        icon('forward', { class: 'b-row__chev' })))),
      h('div', { class: 'mg-menu__foot' }, madeByLink()));
  }

  function page(k) {
    const p = PAGES[k];
    const host = h('div', { class: 'mg-page' });
    const head = h('div', { class: 'mg-pagehead' }, h('h1', { class: 'mg-pagehead__title', tabindex: '-1' }, p.title()));
    const body = h('div', { class: 'mg-page__body' });
    host.append(head, body);
    cleanup = p.mount(body) || (() => {});
    return host;
  }

  const k = sub && PAGES[sub] && (!PAGES[sub].when || PAGES[sub].when()) ? sub : null;
  if (wide.matches) {
    const key = k || 'hours';
    root.classList.add('is-split');
    root.append(menu(key), page(key));
  } else {
    root.append(k ? page(k) : menu(null));
  }
  const onMq = () => { if (!k) { cleanup(); mount(main, { sub }); } };
  wide.addEventListener('change', onMq);
  return () => { cleanup(); wide.removeEventListener('change', onMq); };
}

function madeByLink() {
  return h('a', { class: 'b-madeby', href: 'https://mamar.site', target: '_blank', rel: 'noopener' },
    h('svg', { viewBox: '0 0 34 34', 'aria-hidden': 'true', focusable: 'false' },
      h('path', { d: 'M6 28V14a11 11 0 0 1 22 0v14' }), h('path', { d: 'M12.5 28V14.5a4.5 4.5 0 0 1 9 0V28' })),
    t('made_by'));
}

/* ---------- waitlist ---------- */

function mountWaitlist(main) {
  const root = h('div', { class: 'mg-waitlist' }, skeleton(3));
  main.replaceChildren(root);
  async function load() {
    try {
      const r = await call('own_waitlist', {}, { quiet: true });
      paint(r.items || []);
    } catch (e) {
      root.replaceChildren(emptyState('alert', t('mg.load_failed'), errText(e), btn(t('retry'), { onClick: load })));
    }
  }
  async function set(item, status, button) {
    await busy(button, async () => {
      try {
        await call('own_waitlist_update', { id: item.id, status }, { quiet: true });
        toast(t('mg.wl.updated'), { kind: 'ok', timeout: 1600 });
        load();
        loadOverview();
      } catch (e) { toast(errText(e), { kind: 'err' }); }
    });
  }
  function paint(items) {
    if (!items.length) { root.replaceChildren(emptyState('inbox', t('mg.wl.none'), t('mg.wl.none_text'))); return; }
    const byDay = new Map();
    for (const it of items) { if (!byDay.has(it.day)) byDay.set(it.day, []); byDay.get(it.day).push(it); }
    root.replaceChildren(...[...byDay].map(([day, list]) => h('section', { class: 'mg-daygroup' },
      h('h2', { class: 'mg-daygroup__head' }, h('span', null, `${dayWord(day)} · ${fmt.dateShort(day, L())}`)),
      h('div', { class: 'mg-wl' }, list.map((it) => {
        const part = it.part === 'any' ? t('mg.wl.part.any') : t(it.part);
        const msg = t('mg.wl.msg', { name: it.name || t('mg.guest'), biz: bizName(), day: `${dayWord(day)} ${fmt.dateShort(day, L())}`, service: nm(it, 'service_name') });
        const wa = fmt.whatsappUrl(it.phone, msg);
        const tel = telUrl(it.phone);
        return h('article', { class: ['mg-wlitem', `is-${it.status}`] },
          h('div', { class: 'mg-wlitem__top' },
            h('strong', null, it.name || t('mg.guest')),
            h('span', { class: `b-pill ${it.status === 'contacted' ? 'b-pill--completed' : 'b-pill--pending'}` }, t(`mg.wl.st.${it.status}`))),
          h('p', { class: 'mg-wlitem__sub' }, [nm(it, 'service_name'), part, it.qty > 1 ? t('mg.wl.qty', { n: it.qty }) : null].filter(Boolean).join(' · ')),
          h('p', { class: 'mg-wlitem__phone', dir: 'ltr' }, phoneText(it.phone)),
          h('div', { class: 'mg-wlitem__acts' },
            wa && h('a', { class: 'b-btn b-btn--primary b-btn--sm', href: wa, target: '_blank', rel: 'noopener', onClick: () => { if (it.status === 'waiting') setTimeout(() => set(it, 'contacted'), 400); } }, waIcon(), h('span', null, t('whatsapp'))),
            tel && h('a', { class: 'b-btn b-btn--ghost b-btn--sm', href: tel }, icon('phone'), h('span', null, t('call'))),
            it.status === 'waiting' && btn(t('mg.wl.mark_contacted'), { kind: 'ghost', onClick: (e) => set(it, 'contacted', e.currentTarget) }),
            btn(t('mg.wl.mark_booked'), { kind: 'ghost', icon: 'check', onClick: (e) => set(it, 'booked', e.currentTarget) }),
            btn(t('remove'), { kind: 'quiet', danger: true, onClick: (e) => set(it, 'removed', e.currentTarget) })));
      })))));
  }
  load();
  const off = on('window', load);
  return off;
}

/* ---------- profile ---------- */

function mountProfile(main) {
  const b = S.ov.business;
  const f = {
    phone: field({ label: t('mg.pf.phone'), value: b.phone ? fmt.formatPhone(b.phone, 'en') : '', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '05X XXX XXXX' }),
    address_ar: field({ label: t('mg.pf.address_ar'), value: b.address_ar, maxlength: 200, dir: 'rtl' }),
    address_en: field({ label: t('mg.pf.address_en'), value: b.address_en, maxlength: 200, dir: 'ltr' }),
    maps_url: field({ label: t('mg.pf.maps'), value: b.maps_url || '', type: 'url', inputmode: 'url', placeholder: 'https://maps.app.goo.gl/…', dir: 'ltr' }),
    tagline_ar: field({ label: t('mg.pf.tagline_ar'), value: b.tagline_ar, maxlength: 140, dir: 'rtl' }),
    tagline_en: field({ label: t('mg.pf.tagline_en'), value: b.tagline_en, maxlength: 140, dir: 'ltr' }),
    instagram: field({ label: t('mg.pf.instagram'), value: b.instagram || '', placeholder: '@yourshop', dir: 'ltr', autocomplete: 'off' }),
    site_url: field({ label: t('mg.pf.site'), value: b.site_url || '', type: 'url', inputmode: 'url', placeholder: 'https://', dir: 'ltr' }),
  };
  const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
  const save = btn(t('save'), { kind: 'primary', size: null, block: true });
  save.addEventListener('click', () => busy(save, async () => {
    msg.hidden = true;
    const ph = f.phone.input.value.trim();
    if (ph && !fmt.normalizePhone(ph)) { f.phone.setError(t('field.phone_invalid')); f.phone.input.focus(); return; }
    f.phone.setError('');
    const profile = {};
    for (const [k, el] of Object.entries(f)) profile[k] = el.input.value.trim();
    profile.phone = ph ? fmt.normalizePhone(ph) : '';
    profile.instagram = profile.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/$/, '');
    try {
      await call('own_profile_update', { profile }, { quiet: true });
      toast(t('mg.pf.saved'), { kind: 'ok' });
      loadOverview();
    } catch (e) {
      if (e.code === 'BAD_PHONE') { f.phone.setError(errText(e)); f.phone.input.focus(); } else { msg.textContent = errText(e); msg.hidden = false; }
    }
  }));
  main.replaceChildren(h('div', { class: 'mg-form mg-profile' },
    group(t('mg.pf.contact'), f.phone),
    group(t('mg.pf.place'), h('div', { class: 'mg-two' }, f.address_ar, f.address_en), f.maps_url),
    group(t('mg.pf.words'), h('div', { class: 'mg-two' }, f.tagline_ar, f.tagline_en)),
    group(t('mg.pf.links'), h('div', { class: 'mg-two' }, f.instagram, f.site_url)),
    msg,
    h('div', { class: 'mg-sheetactions mg-sheetactions--page' }, save)));
  return () => {};
}

/* ---------- booking link & embed ---------- */

function mountLink(main) {
  const b = S.ov.business;
  const url = bookingLink(b.slug);
  const snippet = `<script src="${SITE}/book/embed.js" data-business="${b.slug}" defer></script>\n<button data-mamar-book>${t('book_now')}</button>`;
  const share = async () => {
    const data = { title: bizName(), text: t('mg.lk.share_text', { biz: bizName() }), url };
    if (navigator.share) { try { await navigator.share(data); } catch { /* dismissed */ } } else copyText(url);
  };
  main.replaceChildren(h('div', { class: 'mg-link' },
    h('section', { class: 'mg-linkcard' },
      h('p', { class: 'mg-muted' }, t('mg.lk.lede')),
      h('div', { class: 'mg-linkcard__url', dir: 'ltr' }, h('span', { class: 'mg-linkcard__host' }, url.replace(/^https:\/\//, '').replace(b.slug, '')), h('strong', null, b.slug)),
      h('div', { class: 'mg-linkcard__acts' },
        btn(t('mg.lk.copy_link'), { kind: 'primary', size: null, icon: 'copy', onClick: () => copyText(url) }),
        btn(t('share'), { kind: 'ghost', size: null, icon: 'share', onClick: share }),
        h('a', { class: 'b-btn b-btn--quiet', href: URLS.link(b.slug), target: '_blank', rel: 'noopener' }, xicon('external'), h('span', null, t('mg.lk.preview'))))),
    h('section', { class: 'mg-embed' },
      h('h2', { class: 'mg-sechead__title' }, t('mg.lk.embed')),
      h('p', { class: 'mg-muted' }, ...t('mg.lk.embed_text').split('data-mamar-book').flatMap((part, i) => (i ? [h('code', { class: 'mg-inlinecode', dir: 'ltr' }, 'data-mamar-book'), part] : [part]))),
      h('pre', { class: 'mg-code', dir: 'ltr', tabindex: '0', 'aria-label': t('mg.lk.embed') }, h('code', null, snippet)),
      btn(t('mg.lk.copy_code'), { kind: 'ghost', size: null, icon: 'copy', onClick: () => copyText(snippet) }))));
  return () => {};
}

/* ---------- account ---------- */

function mountAccount(main) {
  const paint = () => {
    const theme = seg([
      { value: 'auto', label: t('mg.ac.auto') }, { value: 'light', label: t('mg.ac.light') }, { value: 'dark', label: t('mg.ac.dark') },
    ], themePref(), (v) => setThemePref(v), { label: t('mg.ac.theme') });
    const langSeg = seg([{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }], lang(), (v) => setLang(v), { label: t('mg.ac.lang') });
    langSeg.querySelector('[data-value="ar"]').setAttribute('lang', 'ar');
    langSeg.querySelector('[data-value="en"]').setAttribute('lang', 'en');
    const chime = switchRow({ label: t('mg.ac.chime'), hint: t('mg.ac.chime_hint'), checked: chimeOn(), onChange: (v) => setChime(v) });
    const out = btn(t('sign_out'), {
      kind: 'ghost', size: null, block: true, danger: true,
      onClick: async () => { if (await confirmDialog({ title: t('mg.ac.signout_q'), confirm: t('sign_out'), danger: true })) signOut(); },
    });
    let installRow = null;
    if (!isStandalone()) {
      if (install.evt) {
        installRow = ctlRow(t('mg.ac.install'), btn(t('mg.ac.install_btn'), {
          kind: 'ghost', onClick: async () => { try { await install.evt.prompt(); } catch { /* dismissed */ } install.evt = null; paint(); },
        }));
      } else if (isIOS()) {
        installRow = ctlRow(t('mg.ac.install'), null, t('mg.ac.install_ios'));
      }
    }
    main.replaceChildren(h('div', { class: 'mg-account' },
      h('div', { class: 'mg-who' },
        h('span', { class: 'mg-who__mark', 'aria-hidden': 'true' }, (S.me?.email || '?').slice(0, 1).toUpperCase()),
        h('span', { class: 'mg-who__text' },
          h('small', null, t('mg.ac.signed_in')),
          h('strong', { dir: 'ltr' }, S.me?.email || ''),
          S.me?.is_admin && h('span', { class: 'b-badge b-badge--soft' }, t('mg.admin')))),
      group(t('mg.ac.lang'), langSeg),
      group(t('mg.ac.theme'), theme, h('p', { class: 'mg-fine' }, t('mg.ac.auto_hint'))),
      group(t('mg.ac.sound'), chime),
      installRow && group(null, installRow),
      out,
      h('div', { class: 'mg-center' }, madeByLink())));
  };
  paint();
  return () => {};
}

export const title = () => t('mg.tab.more');
export { ent, ctlRow };
