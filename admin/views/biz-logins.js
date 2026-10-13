// Business → Owner logins. Local: create the login here (dev server). Cloud: Supabase dashboard,
// then attach by email. Credentials are shown once, with copy buttons and a WhatsApp prefill.
import { h, sheet, confirmDialog, toast } from '../../platform/ui/kit.js';
import { t } from '../../platform/i18n.js';
import { rpc, mode, adminCreateUser, toEmail } from '../../platform/api.js';
import { SITE } from '../../platform/config.js';
import * as fmt from '../../platform/fmt.js';
import { ic, pickName, section, field, busy, errToast, copyRow, copyText, empty, ltr } from '../ui.js';

const ALPHA = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 4 groups of 4 from an unambiguous alphabet (~93 bits), easy to read aloud: 'h7Kq-…'. */
export function strongPassword() {
  const out = [];
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 16; i++) out.push(ALPHA[buf[i] % ALPHA.length]);
  return [0, 4, 8, 12].map((i) => out.slice(i, i + 4).join('')).join('-');
}

const manageUrl = () => (mode() === 'local' ? `${location.origin}/manage/` : `${SITE}/manage/`);

export default function loginsTab(ctx) {
  const b = ctx.d.business;
  const members = ctx.d.members || [];
  const local = mode() === 'local';
  const firstLang = (b.langs || ['ar'])[0] === 'en' ? 'en' : 'ar';

  /* members */
  const list = members.length
    ? h('div', { class: 'b-list' }, members.map((m) => h('div', { class: 'b-row' },
        h('span', { class: 'b-row__lead' }, ic('user')),
        h('span', { class: 'b-row__main' },
          h('span', { class: 'b-row__title', dir: 'ltr' }, m.email),
          h('span', { class: 'b-row__sub' }, m.email.endsWith('@owners.mamar.site') ? t('own.username', { user: ltr(m.email.split('@')[0]) }) : t(`own.role.${m.role || 'owner'}`))),
        h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--sm b-btn--danger', onClick: (e) => detach(m, e.currentTarget) },
          h('span', null, t('own.detach'))))))
    : empty({ icon: 'users', title: t('own.none'), text: t('own.none_sub') });

  async function detach(m, btn) {
    const ok = await confirmDialog({ title: t('own.detach_title'), message: t('own.detach_text', { email: ltr(m.email) }), confirm: t('own.detach'), danger: true });
    if (!ok) return;
    await busy(btn, async () => {
      await rpc('adm_detach_owner', { business_id: b.id, user_id: m.user_id });
      await ctx.reload();
      toast(t('own.detached'), { kind: 'ok' });
    });
  }

  /* create (local) */
  function createForm() {
    const user = field({ label: t('own.user'), value: b.slug.replace(/-/g, '').slice(0, 24), dir: 'ltr', mono: true, hint: t('own.user_hint'),
      attrs: { autocapitalize: 'none', spellcheck: 'false', maxlength: 60, autocomplete: 'off' } });
    user.input.addEventListener('input', () => { user.input.value = user.input.value.toLowerCase().replace(/[^a-z0-9._@+-]/g, ''); user.setError(''); });
    const go = h('button', { type: 'submit', class: 'b-btn b-btn--primary' }, ic('key'), h('span', null, t('own.create')));
    const form = h('form', { class: 'b-card adm-form', novalidate: true },
      h('p', null, t('own.create_text')), user.el, h('div', { class: 'adm-formbar' }, go));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = user.input.value.trim();
      if (!/^[a-z0-9._+-]{3,}(@[^@\s]+\.[^@\s]+)?$/.test(id)) { user.setError(t('own.user_bad')); user.input.focus(); return; }
      const email = toEmail(id);
      const pw = strongPassword();
      go.setAttribute('aria-busy', 'true');
      try {
        await adminCreateUser(id, pw);
        await rpc('adm_attach_owner', { business_id: b.id, email });
      } catch (err) {
        go.removeAttribute('aria-busy');
        if (err.code === 'USER_EXISTS') user.setError(t('own.exists'));
        else errToast(err);
        return;
      }
      go.removeAttribute('aria-busy');
      await showCredentials(id.includes('@') ? email : id, pw);
      await ctx.reload();
    });
    return form;
  }

  async function showCredentials(username, pw) {
    const url = manageUrl();
    const msg = t('own.wa_msg', { business: pickName(b) || b.slug, url, user: username, pass: pw }, firstLang);
    const wa = b.phone ? fmt.whatsappUrl(b.phone, msg) : null;
    await sheet({
      title: t('own.creds_title'),
      dismissible: true,
      content: h('div', { class: 'b-stack adm-creds' },
        h('p', { class: 'adm-inlinewarn' }, ic('lock'), t('own.creds_once')),
        copyRow(t('own.creds_url'), url),
        copyRow(t('own.creds_user'), username),
        copyRow(t('own.creds_pass'), pw),
        h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--sm', onClick: () => copyText(`${url}\n${username}\n${pw}`) },
          ic('copy'), h('span', null, t('own.copy_all'))),
        wa
          ? h('a', { class: 'b-btn b-btn--primary b-btn--block', href: wa, target: '_blank', rel: 'noopener' }, ic('whatsapp'), h('span', null, t('own.send_wa', { phone: ltr(fmt.formatPhone(b.phone, 'en')) })))
          : h('p', { class: 'adm-quiet' }, t('own.no_phone'))),
      actions: [{ label: t('done'), value: true, kind: 'ghost' }],
    });
  }

  /* cloud: an invite — the owner's first email-link sign-in attaches them */
  async function showInvite(email) {
    const url = manageUrl();
    const msg = t('own.invite_wa', { business: pickName(b) || b.slug, url, email }, firstLang);
    const wa = b.phone ? fmt.whatsappUrl(b.phone, msg) : null;
    await sheet({
      title: t('own.invited'),
      dismissible: true,
      content: h('div', { class: 'b-stack adm-creds' },
        h('p', null, t('own.invited_text')),
        copyRow(t('own.creds_url'), url),
        copyRow(t('email'), email),
        wa
          ? h('a', { class: 'b-btn b-btn--primary b-btn--block', href: wa, target: '_blank', rel: 'noopener' }, ic('whatsapp'), h('span', null, t('own.send_wa', { phone: ltr(fmt.formatPhone(b.phone, 'en')) })))
          : h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--sm', onClick: () => copyText(msg) }, ic('copy'), h('span', null, t('own.copy_all')))),
      actions: [{ label: t('done'), value: true, kind: 'ghost' }],
    });
  }

  const pending = h('div', { class: 'b-stack' });
  if (!local) {
    rpc('adm_invites', { business_id: b.id }).then((r) => {
      if (!r.items.length) return;
      pending.replaceChildren(h('p', { class: 'b-eyebrow' }, t('own.pending')), h('div', { class: 'b-list' }, r.items.map((iv) => h('div', { class: 'b-row' },
        h('span', { class: 'b-row__lead' }, ic('mail')),
        h('span', { class: 'b-row__main' }, h('span', { class: 'b-row__title', dir: 'ltr' }, iv.email)),
        h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--sm b-btn--danger', onClick: (e) => busy(e.currentTarget, async () => {
          await rpc('adm_invite_cancel', { business_id: b.id, email: iv.email });
          await ctx.reload();
        }) }, h('span', null, t('own.invite_cancel')))))));
    }).catch(() => {});
  }

  /* attach by email (cloud, and "existing user" locally) */
  function attachForm({ steps }) {
    const email = field({ label: t('email'), type: 'email', dir: 'ltr', placeholder: 'owner@example.com', hint: t('own.attach_hint'),
      attrs: { autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', inputmode: 'email' } });
    const go = h('button', { type: 'submit', class: 'b-btn b-btn--primary' }, ic('link'), h('span', null, t('own.attach')));
    const form = h('form', { class: 'b-card adm-form', novalidate: true },
      steps && h('ol', { class: 'adm-steps' }, ['own.cloud1', 'own.cloud2', 'own.cloud3'].map((k) => h('li', null, t(k)))),
      email.el, h('div', { class: 'adm-formbar' }, go));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      email.setError('');
      const v = toEmail(email.input.value.trim());
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { email.setError(t('field.email_invalid')); email.input.focus(); return; }
      go.setAttribute('aria-busy', 'true');
      try {
        const r = await rpc('adm_attach_owner', { business_id: b.id, email: v });
        if (r.invited) await showInvite(v);
        else toast(t('own.attached'), { kind: 'ok' });
        await ctx.reload();
      } catch (err) {
        if (err.code === 'USER_NOT_FOUND') email.setError(t('err.USER_NOT_FOUND'));
        else errToast(err);
      } finally { go.removeAttribute('aria-busy'); }
    });
    return form;
  }

  return h('div', { class: 'adm-cols' },
    h('div', null,
      section(t('own.members'), h('div', { class: 'b-stack' }, list, pending), { id: 'members', sub: t('own.members_sub') })),
    h('div', null,
      local
        ? section(t('own.create_title'), h('div', { class: 'b-stack' },
            createForm(),
            h('details', { class: 'adm-more' },
              h('summary', null, t('own.existing')),
              attachForm({ steps: false }))), { id: 'create', sub: t('own.local_sub') })
        : section(t('own.cloud_title'), attachForm({ steps: false }), { id: 'create', sub: t('own.cloud_sub') })));
}
