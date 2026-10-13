// Sign-in gate: login · "not an admin" · can't reach the server.
import { h } from '../../platform/ui/kit.js';
import { t, langToggle } from '../../platform/i18n.js';
import { signIn, signOut, rpc, errorKey, mode, sendMagicLink, authRedirectError } from '../../platform/api.js';
import { ic, arch, field } from '../ui.js';

export default function login({ kind = 'login', err, onDone }) {
  const toggle = h('button', { type: 'button', class: 'b-lang' }, h('span', { 'data-lang-label': '' }));
  langToggle(toggle);
  // The gate re-renders itself when the language changes.
  toggle.addEventListener('click', () => setTimeout(() => wrap.replaceWith(login({ kind, err, onDone })), 0));

  const card = h('div', { class: 'adm-gate__card' });
  const wrap = h('div', { class: 'adm-gate' },
    h('div', { class: 'adm-gate__top' }, toggle),
    h('div', { class: 'adm-gate__glow', 'aria-hidden': 'true' }),
    card,
    h('p', { class: 'adm-gate__foot' },
      h('span', { class: ['adm-modechip__dot', mode() === 'cloud' && 'is-cloud'], 'aria-hidden': 'true' }),
      mode() === 'cloud' ? t('mode.cloud') : t('mode.local')));

  const head = (title, sub) => [
    h('div', { class: 'adm-gate__mark' }, arch('adm-arch adm-arch--lg')),
    h('p', { class: 'b-eyebrow' }, t('login.eyebrow')),
    h('h1', { class: 'adm-gate__title', tabindex: '-1' }, title),
    sub && h('p', { class: 'adm-gate__sub' }, sub),
  ].filter(Boolean);

  if (kind === 'not_admin') {
    card.append(...head(t('login.not_admin'), t('login.not_admin_sub')),
      h('div', { class: 'adm-gate__actions' },
        h('a', { class: 'b-btn b-btn--primary b-btn--block', href: '/manage/' }, h('span', null, t('login.to_manage'))),
        h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--block', onClick: () => { signOut(); onDone(); } }, h('span', null, t('login.other_account')))));
    queueMicrotask(() => card.querySelector('h1')?.focus());
    return wrap;
  }

  if (kind === 'offline') {
    card.append(...head(t('login.offline'), t(errorKey(err))),
      h('div', { class: 'adm-gate__actions' },
        h('button', { type: 'button', class: 'b-btn b-btn--primary b-btn--block', onClick: () => onDone() }, ic('refresh'), h('span', null, t('retry'))),
        h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--block', onClick: () => { signOut(); onDone(); } }, h('span', null, t('sign_out')))));
    return wrap;
  }

  const user = field({ label: t('login.user'), type: 'text', name: 'username', dir: 'ltr',
    attrs: { autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, inputmode: 'email' } });
  const pass = field({ label: t('login.pass'), type: 'password', name: 'password', dir: 'ltr',
    attrs: { autocomplete: 'current-password', required: true } });
  const eye = h('button', { type: 'button', class: 'b-iconbtn adm-eye', 'aria-label': t('login.show'), 'aria-pressed': 'false',
    onClick: () => {
      const show = pass.input.type === 'password';
      pass.input.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show));
      eye.setAttribute('aria-label', show ? t('login.hide') : t('login.show'));
    } }, ic('eye'));
  pass.el.querySelector('.b-field__box').appendChild(eye);
  const msg = h('p', { class: 'adm-gate__err', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'b-btn b-btn--primary b-btn--block b-btn--lg' }, h('span', null, t('login.submit')));

  const form = h('form', { class: 'adm-gate__form', novalidate: true }, user.el, pass.el, msg, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.hidden = true;
    user.setError(''); pass.setError('');
    if (!user.input.value.trim()) { user.setError(t('field.required')); user.input.focus(); return; }
    if (!pass.input.value) { pass.setError(t('field.required')); pass.input.focus(); return; }
    submit.setAttribute('aria-busy', 'true');
    try {
      await signIn(user.input.value.trim(), pass.input.value);
      const me = await rpc('own_me');
      if (!me.is_admin) { submit.removeAttribute('aria-busy'); wrap.replaceWith(login({ kind: 'not_admin', onDone })); return; }
      onDone();
    } catch (e2) {
      submit.removeAttribute('aria-busy');
      msg.textContent = t(errorKey(e2));
      msg.hidden = false;
      pass.input.select();
    }
  });

  // On mamar.site (cloud) the main way in is a one-time link emailed to you — no password to create.
  if (mode() === 'cloud') {
    const linkBtn = h('button', { type: 'button', class: 'b-btn b-btn--primary b-btn--block b-btn--lg' }, h('span', null, t('login.magic')));
    const usePw = h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--block' }, h('span', null, t('login.use_password')));
    pass.el.hidden = true;
    submit.hidden = true;
    form.insertBefore(linkBtn, msg.nextSibling);
    form.appendChild(usePw);
    if (authRedirectError) { msg.textContent = t('login.link_expired'); msg.hidden = false; }
    usePw.addEventListener('click', () => {
      pass.el.hidden = false; submit.hidden = false; linkBtn.hidden = true; usePw.hidden = true;
      pass.input.focus();
    });
    linkBtn.addEventListener('click', async () => {
      msg.hidden = true;
      user.setError('');
      const email = user.input.value.trim();
      if (!email.includes('@')) { user.setError(t('login.need_email')); user.input.focus(); return; }
      linkBtn.setAttribute('aria-busy', 'true');
      try {
        await sendMagicLink(email, '/admin/');
        card.replaceChildren(...head(t('login.magic_sent_title'), t('login.magic_sent_sub', { email })),
          h('div', { class: 'adm-gate__actions' },
            h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--block', onClick: () => wrap.replaceWith(login({ kind, onDone })) },
              h('span', null, t('login.magic_again')))));
        queueMicrotask(() => card.querySelector('h1')?.focus());
      } catch (e3) {
        linkBtn.removeAttribute('aria-busy');
        msg.textContent = t(errorKey(e3));
        msg.hidden = false;
      }
    });
  }

  card.append(...head(t('login.title'), t('login.sub')), form,
    h('p', { class: 'adm-gate__note' }, t('login.owner_note'), ' ',
      h('a', { href: '/manage/' }, t('login.owner_link'))));
  queueMicrotask(() => user.input.focus());
  return wrap;
}
