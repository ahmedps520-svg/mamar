// More / Settings: notifications on this device, the chime, language, GitHub token,
// the prayer table, links to Prices and the go-live checklist, sign out.
import { h, toast } from '../../platform/ui/kit.js';
import { t, lang, setLang } from '../../platform/i18n.js';
import { rpc, mode, githubToken, sendTestEmail, errorKey } from '../../platform/api.js';
import { GITHUB_REPO } from '../../platform/config.js';
import { prayerYear } from '../../platform/prayer.js';
import * as fmt from '../../platform/fmt.js';
import { ic, num, pageHead, section, seg, switchRow, field, busy, errToast, linkBtn, ltr, fill } from '../ui.js';
import * as device from '../device.js';

const CHUNK = 60;

export default async function more({ app, root }) {
  const prayer = await rpc('adm_prayer_status', { city: 'jeddah' }).catch(() => null);

  /* ---------- shortcuts ---------- */
  const shortcuts = h('div', { class: 'b-list' },
    h('a', { class: 'b-row', href: '#/prices' },
      h('span', { class: 'b-row__lead' }, ic('tag')),
      h('span', { class: 'b-row__main' }, h('span', { class: 'b-row__title' }, t('nav.prices')), h('span', { class: 'b-row__sub' }, t('more.prices_sub'))),
      ic('forward', { class: 'b-row__chev' })),
    h('a', { class: 'b-row', href: '#/more/golive' },
      h('span', { class: 'b-row__lead' }, ic('flag')),
      h('span', { class: 'b-row__main' }, h('span', { class: 'b-row__title' }, t('golive.title')), h('span', { class: 'b-row__sub' }, mode() === 'cloud' ? t('mode.cloud') : t('mode.local'))),
      ic('forward', { class: 'b-row__chev' })));

  /* ---------- notifications ---------- */
  const pushBox = h('div', { class: 'b-card adm-push' });
  async function paintPush() {
    const st = await device.pushState();
    const statusLine = h('p', { class: ['adm-pushstate', `is-${st}`] }, h('span', { class: 'adm-pushstate__dot', 'aria-hidden': 'true' }), t(`push.state.${st}`));
    const toggleBtn = h('button', { type: 'button', class: st === 'on' ? 'b-btn b-btn--ghost' : 'b-btn b-btn--primary', disabled: st === 'unsupported' || st === 'denied' },
      ic('bell'), h('span', null, st === 'on' ? t('push.off') : t('push.on')));
    toggleBtn.addEventListener('click', () => busy(toggleBtn, async () => {
      if (st === 'on') { await device.unsubscribePush(); toast(t('push.off_done'), { kind: 'ok' }); }
      else { await device.subscribePush(lang()); toast(t('push.on_done'), { kind: 'ok' }); }
      await paintPush();
    }));
    const testBtn = h('button', { type: 'button', class: 'b-btn b-btn--ghost' }, ic('send'), h('span', null, t('push.test')));
    testBtn.addEventListener('click', () => busy(testBtn, async () => {
      await rpc('adm_notify_test', {});
      toast(t('push.test_sent'), { kind: 'ok', timeout: 4200 });
    }));
    // Email test: sends one email right now and shows exactly what happened (Resend's own words on failure).
    const emailBtn = h('button', { type: 'button', class: 'b-btn b-btn--ghost' }, ic('mail'), h('span', null, t('push.test_email')));
    const emailResult = h('p', { class: 'adm-ghresult', role: 'status', 'aria-live': 'polite' });
    emailBtn.addEventListener('click', () => busy(emailBtn, async () => {
      emailResult.textContent = '';
      try {
        const r = await sendTestEmail();
        emailResult.textContent = t('push.test_email_ok', { to: r.to });
        toast(t('push.test_email_ok', { to: r.to }), { kind: 'ok', timeout: 5000 });
      } catch (e) {
        emailResult.textContent = e.code === 'EMAIL_FAILED' ? t('push.test_email_fail', { why: String(e.detail || '') }) : t(errorKey(e));
      }
    }));
    const ios = device.isIOS() && !device.isStandalone();
    fill(pushBox,
      statusLine,
      h('p', { class: 'adm-quiet' }, t('push.explain')),
      st === 'denied' && h('p', { class: 'adm-inlinewarn' }, ic('alert'), t('push.denied_help')),
      h('div', { class: 'adm-quick' }, toggleBtn, testBtn, emailBtn),
      emailResult,
      h('p', { class: 'adm-quiet' }, t('push.test_email_hint')),
      h('div', { class: ['adm-ios', ios && 'is-hot'] },
        h('p', { class: 'adm-ios__title' }, ic('device'), t('push.ios_title')),
        h('ol', { class: 'adm-steps' }, ['push.ios1', 'push.ios2', 'push.ios3'].map((k) => h('li', null, t(k))))));
  }
  await paintPush().catch(() => {});

  /* ---------- sound & language ---------- */
  const prefs = h('div', { class: 'b-card adm-card--list' },
    switchRow({ label: t('more.chime'), sub: t('more.chime_sub'), checked: device.chimeOn(), onChange: (v) => { device.setChime(v); if (v) device.chime({ force: true }); },
      end: h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--sm', onClick: (e) => { e.preventDefault(); device.chime({ force: true }); } }, ic('sound'), h('span', null, t('more.play'))) }),
    h('div', { class: 'adm-switchrow' },
      h('span', { class: 'adm-switchrow__text' }, h('span', { class: 'adm-switchrow__label' }, t('more.language')), h('span', { class: 'adm-switchrow__sub' }, t('more.language_sub'))),
      seg([{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }], lang(), (v) => setLang(v), { label: t('more.language') })));

  /* ---------- GitHub token ---------- */
  const ghBox = h('div', { class: 'b-card adm-form' });
  function paintGh() {
    const has = !!githubToken.get();
    const tok = field({ label: t('gh.token'), type: 'password', dir: 'ltr', mono: true, placeholder: has ? t('gh.saved_ph') : 'github_pat_…',
      attrs: { autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' } });
    const saveBtn = h('button', { type: 'submit', class: 'b-btn b-btn--primary' }, h('span', null, t('save')));
    const checkBtn = h('button', { type: 'button', class: 'b-btn b-btn--ghost', hidden: !has }, ic('shield'), h('span', null, t('gh.check')));
    const rmBtn = h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--danger', hidden: !has }, h('span', null, t('remove')));
    const result = h('p', { class: 'adm-ghresult', role: 'status', 'aria-live': 'polite' });
    const form = h('form', { class: 'b-stack', novalidate: true },
      h('p', { class: ['adm-pushstate', has ? 'is-on' : 'is-off'] }, h('span', { class: 'adm-pushstate__dot', 'aria-hidden': 'true' }), has ? t('gh.has') : t('gh.none')),
      tok.el,
      h('div', { class: 'adm-formbar adm-formbar--start' }, saveBtn, checkBtn, rmBtn),
      result,
      h('details', { class: 'adm-more' },
        h('summary', null, t('gh.how')),
        h('ol', { class: 'adm-steps' },
          h('li', null, t('gh.how1'), ' ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, t('gh.how1_link'))),
          h('li', null, t('gh.how2', { repo: ltr(GITHUB_REPO) })),
          h('li', null, t('gh.how3')),
          h('li', null, t('gh.how4'))),
        h('p', { class: 'adm-quiet' }, t('gh.privacy'))));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      tok.setError('');
      const v = tok.input.value.trim();
      if (!v) { tok.setError(t('field.required')); tok.input.focus(); return; }
      if (/^ghp_/.test(v)) { tok.setError(t('gh.classic')); tok.input.focus(); return; }
      if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(v)) { tok.setError(t('gh.bad')); tok.input.focus(); return; }
      githubToken.set(v);
      toast(t('gh.saved'), { kind: 'ok' });
      paintGh();
    });
    rmBtn.addEventListener('click', () => { githubToken.set(''); toast(t('gh.removed'), { kind: 'ok' }); paintGh(); });
    checkBtn.addEventListener('click', () => busy(checkBtn, async () => {
      result.className = 'adm-ghresult';
      try {
        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
          headers: { authorization: `Bearer ${githubToken.get()}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
        });
        const j = await r.json().catch(() => ({}));
        const ok = r.ok && j.permissions?.push;
        result.className = `adm-ghresult ${ok ? 'is-ok' : 'is-bad'}`;
        result.textContent = ok ? t('gh.works', { repo: ltr(GITHUB_REPO) }) : r.ok ? t('gh.readonly') : t('gh.rejected', { status: r.status });
      } catch {
        result.className = 'adm-ghresult is-bad';
        result.textContent = t('err.NETWORK');
      }
    }));
    ghBox.replaceChildren(form);
  }
  paintGh();

  /* ---------- prayer table ---------- */
  const prBox = h('div', { class: 'b-card adm-prayer' });
  let pr = prayer;
  function paintPrayer(progress) {
    const left = pr?.days_left ?? 0;
    const low = !pr?.last_day || left < 90;
    const btn = h('button', { type: 'button', class: low ? 'b-btn b-btn--primary' : 'b-btn b-btn--ghost' }, ic('moon'), h('span', null, t('prayer.extend')));
    btn.addEventListener('click', () => extend(btn));
    fill(prBox,
      low && h('p', { class: 'adm-inlinewarn is-err' }, ic('alert'), pr?.last_day ? t('prayer.low', { n: left }) : t('prayer.empty')),
      pr?.last_day
        ? h('div', { class: 'adm-prayer__nums' },
            h('div', null, h('span', { class: 'adm-mini__v' }, num(left)), h('span', { class: 'adm-mini__k' }, t('prayer.days_left'))),
            h('div', null, h('span', { class: 'adm-prayer__date' }, fmt.dateShort(pr.last_day, lang(), { year: true })), h('span', { class: 'adm-mini__k' }, t('prayer.last_day'))),
            h('div', null, h('span', { class: 'adm-prayer__date' }, fmt.hijri(pr.last_day, lang())), h('span', { class: 'adm-mini__k' }, t('prayer.hijri'))))
        : null,
      h('p', { class: 'adm-quiet' }, t('prayer.explain')),
      progress != null && h('div', { class: 'b-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(progress * 100)), 'aria-label': t('prayer.extending') },
        h('div', { class: 'b-progress__bar', style: { '--p': String(progress) } })),
      h('div', { class: 'adm-quick' }, btn));
    return btn;
  }
  async function extend(btn) {
    await busy(btn, async () => {
      const from = pr?.last_day ? fmt.addDaysISO(pr.last_day, 1) : fmt.riyadhDateISO();
      const rows = prayerYear(from, 365);
      let res = null;
      for (let i = 0; i < rows.length; i += CHUNK) {
        res = await rpc('adm_prayer_upsert', { city: 'jeddah', rows: rows.slice(i, i + CHUNK) });
        paintPrayer(Math.min(1, (i + CHUNK) / rows.length)).setAttribute('aria-busy', 'true');
      }
      pr = res || await rpc('adm_prayer_status', { city: 'jeddah' });
      paintPrayer();
      toast(t('prayer.done', { date: fmt.dateShort(pr.last_day, lang(), { year: true }) }), { kind: 'ok' });
    });
  }
  paintPrayer();

  /* ---------- account ---------- */
  const account = h('div', { class: 'b-card adm-account' },
    h('div', { class: 'adm-account__who' },
      h('span', { class: 'adm-avatar', 'aria-hidden': 'true' }, (app.me?.email || '?').charAt(0).toUpperCase()),
      h('div', null,
        h('p', { class: 'adm-account__email', dir: 'ltr' }, app.me?.email || ''),
        h('p', { class: 'adm-quiet' }, t('more.admin_role')))),
    h('button', { type: 'button', class: 'b-btn b-btn--ghost', onClick: () => app.signOut() }, ic('logout'), h('span', null, t('sign_out'))));

  root.append(
    pageHead({ eyebrow: t('more.eyebrow'), title: t('nav.settings'), sub: t('more.sub') }),
    h('div', { class: 'adm-cols' },
      h('div', null,
        section(null, shortcuts, { cls: 'adm-sec--tight' }),
        section(t('push.title'), pushBox, { id: 'push', sub: t('push.sub') }),
        section(t('more.prefs'), prefs, { id: 'prefs' }),
        section(t('more.account'), account, { id: 'account' })),
      h('div', null,
        section(t('prayer.title'), prBox, { id: 'prayer', sub: t('prayer.sub') }),
        section(t('gh.title'), ghBox, { id: 'github', sub: t('gh.sub') }))),
    h('p', { class: 'adm-colophon' }, t('more.colophon')));

  return { title: t('nav.settings') };
}
