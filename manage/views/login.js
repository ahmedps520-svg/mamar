/* ==========================================================
   Login — username (→ @owners.mamar.site) or email + password.
   ========================================================== */

import { t, h, icon, field, studioWa, btn } from '../core.js';
import { signIn, errorKey, mode, sendMagicLink, authRedirectError } from '../../platform/api.js';
import { langToggle } from '../../platform/i18n.js';
import { madeBy } from '../../platform/ui/kit.js';

export function mountLogin(root, { onDone }) {
  const id = field({ label: t('mg.login.id'), autocomplete: 'username', dir: 'ltr', name: 'username', inputmode: 'email' });
  id.input.setAttribute('autocapitalize', 'none');
  id.input.setAttribute('spellcheck', 'false');
  const pw = field({ label: t('mg.login.pw'), type: 'password', autocomplete: 'current-password', dir: 'ltr', name: 'password' });
  const eye = h('button', { type: 'button', class: 'mg-eye', 'aria-label': t('mg.login.show'), 'aria-pressed': 'false' }, eyeIcon(false));
  eye.addEventListener('click', () => {
    const show = pw.input.type === 'password';
    pw.input.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? t('mg.login.hide') : t('mg.login.show'));
    eye.replaceChildren(eyeIcon(show));
    pw.input.focus();
  });
  pw.querySelector('.b-field__box').appendChild(eye);

  const err = h('p', { class: 'mg-loginerr', role: 'alert', 'aria-live': 'assertive' });
  const submit = h('button', { type: 'submit', class: 'b-btn b-btn--primary b-btn--block b-btn--lg' }, h('span', null, t('mg.login.submit')));
  const form = h('form', { class: 'mg-loginform', novalidate: true }, id, pw, err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const who = id.input.value.trim();
    const pass = pw.input.value;
    if (!who || !pass) { err.textContent = t('mg.login.need'); (who ? pw : id).input.focus(); return; }
    submit.setAttribute('aria-busy', 'true');
    try {
      await signIn(who, pass);
      onDone();
    } catch (ex) {
      err.textContent = t(errorKey(ex));
      pw.input.select();
      pw.input.focus();
    } finally {
      submit.removeAttribute('aria-busy');
    }
  });

  // On mamar.site (cloud) owners sign in with a link emailed to the address Mamar registered for them.
  if (mode() === 'cloud') {
    const linkBtn = h('button', { type: 'button', class: 'b-btn b-btn--primary b-btn--block b-btn--lg' }, h('span', null, t('mg.login.magic')));
    const usePw = h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--block' }, h('span', null, t('mg.login.use_password')));
    pw.hidden = true;
    submit.hidden = true;
    form.insertBefore(linkBtn, err.nextSibling);
    form.appendChild(usePw);
    if (authRedirectError) err.textContent = t('mg.login.link_expired');
    usePw.addEventListener('click', () => { pw.hidden = false; submit.hidden = false; linkBtn.hidden = true; usePw.hidden = true; pw.input.focus(); });
    linkBtn.addEventListener('click', async () => {
      err.textContent = '';
      const email = id.input.value.trim();
      if (!email.includes('@')) { err.textContent = t('mg.login.need_email'); id.input.focus(); return; }
      linkBtn.setAttribute('aria-busy', 'true');
      try {
        await sendMagicLink(email, '/manage/');
        form.replaceWith(h('div', { class: 'mg-loginform' },
          h('h2', { class: 'mg-login__title', tabindex: '-1' }, t('mg.login.magic_sent_title')),
          h('p', { class: 'mg-login__lede' }, t('mg.login.magic_sent_sub', { email })),
          h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--block', onClick: () => mountLogin(root, { onDone }) },
            h('span', null, t('mg.login.magic_again')))));
      } catch (ex) {
        err.textContent = t(errorKey(ex));
      } finally {
        linkBtn.removeAttribute('aria-busy');
      }
    });
  }

  const help = studioWa(t('mg.login.help_msg'));
  const lang = h('button', { type: 'button', class: 'b-lang' });
  root.replaceChildren(h('div', { class: 'mg-login' },
    h('div', { class: 'mg-login__top' }, lang),
    h('main', { class: 'mg-login__card', id: 'main' },
      h('div', { class: 'mg-login__mark', 'aria-hidden': 'true' }, archMark()),
      h('span', { class: 'b-eyebrow' }, t('mg.login.eyebrow')),
      h('h1', { class: 'mg-login__title' }, t('mg.login.title')),
      h('p', { class: 'mg-login__lede' }, t('mg.login.lede')),
      form,
      h('p', { class: 'mg-login__help' }, t('mg.login.help'), ' ',
        help && h('a', { href: help, target: '_blank', rel: 'noopener' }, t('mg.login.help_cta')))),
    h('footer', { class: 'mg-login__foot' }, madeBy())));
  langToggle(lang);
  requestAnimationFrame(() => id.input.focus({ preventScroll: true }));
}

export function archMark() {
  return h('svg', { viewBox: '0 0 34 34', focusable: 'false' },
    h('path', { d: 'M6 28V14a11 11 0 0 1 22 0v14' }),
    h('path', { d: 'M12.5 28V14.5a4.5 4.5 0 0 1 9 0V28' }));
}

function eyeIcon(open) {
  return h('svg', { viewBox: '0 0 24 24', class: 'b-icon', 'aria-hidden': 'true', focusable: 'false' },
    h('path', { d: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z' }),
    h('circle', { cx: 12, cy: 12, r: 2.8 }),
    open && h('path', { d: 'M4 20L20 4' }));
}

export { icon, btn };
