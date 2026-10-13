// Go-live checklist: platform/README.md "Going live", step by step, with what this browser can detect.
import { h } from '../../platform/ui/kit.js';
import { t } from '../../platform/i18n.js';
import { mode, githubToken } from '../../platform/api.js';
import { cloudReady, VAPID_PUBLIC_KEY, GITHUB_REPO } from '../../platform/config.js';
import { ic, num, pageHead, section, copyRow, badge, ltr } from '../ui.js';
import * as device from '../device.js';

const KEY = 'mamar-admin-golive';
const SQL_FILES = [
  'platform/supabase/migrations/001_core.sql', '002_booking.sql', '003_owner.sql', '004_admin.sql', '005_config.sql',
  '999_grants.sql', 'platform/supabase/supabase_only.sql', 'platform/supabase/seed/demo.sql',
];

const done = {
  all() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } },
  set(n, v) { try { const m = done.all(); m[n] = v; localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ } },
};

export default async function golive({ app, root }) {
  const pushOn = (await device.pushState().catch(() => 'off')) === 'on';
  const detect = {
    4: cloudReady(),
    5: !!VAPID_PUBLIC_KEY,
    7: !!githubToken.get(),
    8: device.isStandalone() && pushOn,
  };
  const email = app.me?.email || 'YOUR EMAIL';

  const steps = [
    { n: 1, body: [h('p', null, t('gl.1'))] },
    { n: 2, body: [h('p', null, t('gl.2')), h('ol', { class: 'adm-files' }, SQL_FILES.map((f, i) => h('li', null, h('code', { dir: 'ltr' }, f), i === 7 && h('span', { class: 'adm-quiet' }, ` · ${t('optional')}`), i === 5 && h('span', { class: 'adm-quiet' }, ` · ${t('gl.always_last')}`))))] },
    { n: 3, body: [h('p', null, t('gl.3')), copyRow('SQL', `insert into public.admins (user_id) select id from auth.users where email = '${email.replace(/'/g, "''")}';`, { multiline: true })] },
    { n: 4, body: [h('p', null, t('gl.4')), h('p', { class: 'adm-quiet' }, t('gl.4b'))] },
    { n: 5, body: [h('p', null, t('gl.5')), copyRow(t('gl.cmd'), 'npx web-push generate-vapid-keys'), h('ul', { class: 'adm-bullets' }, ['gl.5a', 'gl.5b', 'gl.5c', 'gl.5d'].map((k) => h('li', null, t(k))))] },
    { n: 6, body: [h('p', null, t('gl.6'))] },
    { n: 7, body: [h('p', null, t('gl.7', { repo: ltr(GITHUB_REPO) })), h('a', { class: 'adm-inlinelink', href: '#/more' }, t('gl.7_link'), ic('forward'))] },
    { n: 8, body: [h('p', null, t('gl.8')), h('a', { class: 'adm-inlinelink', href: '#/more' }, t('gl.8_link'), ic('forward'))] },
    { n: 9, body: [h('p', null, t('gl.9'))] },
  ];

  const progress = h('div', { class: 'b-progress' }, h('div', { class: 'b-progress__bar' }));
  const countEl = h('span', { class: 'adm-golive__count', role: 'status', 'aria-live': 'polite' });
  const list = h('ol', { class: 'adm-golive' });

  function paint() {
    const m = done.all();
    let n = 0;
    list.replaceChildren(...steps.map((s) => {
      const auto = detect[s.n] === true;
      const on = auto || !!m[s.n];
      if (on) n++;
      const id = `gl-${s.n}`;
      const cb = h('input', { type: 'checkbox', id, class: 'adm-golive__cb', checked: on, disabled: auto, 'aria-describedby': `${id}-b` });
      cb.addEventListener('change', () => { done.set(s.n, cb.checked); paint(); });
      return h('li', { class: ['adm-golive__step', on && 'is-done'] },
        h('div', { class: 'adm-golive__head' },
          h('label', { class: 'adm-golive__check', for: id }, cb, h('span', { class: 'adm-golive__box', 'aria-hidden': 'true' }, ic('check'))),
          h('span', { class: 'adm-golive__n', 'aria-hidden': 'true' }, num(s.n)),
          h('label', { class: 'adm-golive__title', for: id }, t(`gl.t${s.n}`)),
          auto && badge(t('gl.detected'), 'b-badge--soft')),
        h('div', { class: 'adm-golive__body', id: `${id}-b` }, s.body));
    }));
    countEl.textContent = t('gl.progress', { n, total: steps.length });
    progress.style.setProperty('--p', String(n / steps.length));
  }
  paint();

  const local = mode() === 'local';
  root.append(
    pageHead({ back: { href: '#/more', label: t('nav.settings') }, eyebrow: t('golive.eyebrow'), title: t('golive.title'), sub: t('golive.sub') }),
    h('div', { class: ['adm-modecard', local ? 'is-local' : 'is-cloud'] },
      h('span', { class: ['adm-modechip__dot', !local && 'is-cloud'], 'aria-hidden': 'true' }),
      h('div', null,
        h('p', { class: 'adm-modecard__title' }, local ? t('mode.local') : t('mode.cloud')),
        h('p', { class: 'adm-modecard__text' }, local ? t('golive.local_text') : (cloudReady() ? t('golive.cloud_text') : t('golive.cloud_missing'))))),
    section(null, h('div', { class: 'b-stack' }, h('div', { class: 'adm-golive__progress' }, countEl, progress), list), { cls: 'adm-sec--tight' }));

  return { title: t('golive.title'), back: '#/more' };
}
