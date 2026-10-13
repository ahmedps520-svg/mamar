/* ==========================================================
   Mamar Booking — payment page (/book/pay/?bk&t).
   Always top level (3-D Secure and Apple Pay need it).
   Local dev server: a clearly labelled demo payment sheet.
   Cloud: Moyasar's form with the business's own publishable key.
   ========================================================== */

import { mode, demoPay } from '../../platform/api.js';
import { VENDOR } from '../../platform/config.js';
import { onLang } from '../../platform/i18n.js';
import {
  rpc, errorKey, pick, URLS, F, t, tn, lang, h, icon, toast,
  pageSetup, earlyLang, businessLang, useTheme, chrome, messageStep, loadingStep, cached, money, num, bizName,
  bookingFacts, lockIcon, demoBadge, bookUrl, waIcon,
} from '../core.js';

export async function mountPay() {
  const q = new URLSearchParams(location.search);
  const bk = q.get('bk') || '';
  const tok = q.get('t') || '';
  const backRaw = q.get('back') || '';
  pageSetup();
  earlyLang();
  const app = document.getElementById('app');
  const ui = chrome(app);
  ui.setTitle(t('bk.pay.title'));
  ui.stage.replaceChildren(loadingStep());
  document.title = t('bk.pay.title');

  if (!bk || !tok) return show(messageStep({ mark: 'alert', title: t('err.NOT_FOUND'), text: t('bk.pay.missing') }));

  let view;
  let st;
  try {
    [view, st] = await Promise.all([
      rpc('pub_booking', { token: tok }),
      rpc('pub_payment_status', { booking_id: bk, token: tok }),
    ]);
  } catch (e) {
    return show(messageStep({ mark: 'alert', title: t(errorKey(e)), text: e?.code === 'NOT_FOUND' ? t('bk.pay.missing') : '' }));
  }
  const biz = view.business;
  businessLang(biz.langs);
  useTheme(biz);
  ui.setLogo(biz.theme?.logo_url);
  const data = await cached('pub_business', { slug: biz.slug }).catch(() => null);

  const doneUrl = (extra = '') => {
    let u = URLS.done(bk, tok);
    if (backRaw) u += `&back=${encodeURIComponent(backRaw)}`;
    return `${u}&lang=${lang()}${extra}`;
  };
  if (st.status === 'confirmed') { location.replace(doneUrl()); return; }

  let timer = 0;
  let expired = false;
  render();
  onLang(() => { ui.relabel(); render(); });

  function show(el) { ui.stage.replaceChildren(el); }

  function render() {
    clearInterval(timer);
    ui.setTitle(bizName(biz), t('bk.pay.sub'));
    document.title = `${t('bk.pay.title')} · ${bizName(biz)}`;
    const holdMs = st.hold_until ? Date.parse(st.hold_until) - Date.now() : 0;
    if (st.status !== 'pending_payment' || holdMs <= 0 || expired) return show(expiredStep());
    show(payStep());
  }

  function expiredStep() {
    return messageStep({
      mark: 'clock',
      title: t('bk.pay.expired'),
      text: t('bk.pay.expired_text'),
      actions: [h('a', { class: 'b-btn b-btn--primary', href: bookUrl(biz.slug) }, h('span', null, t('bk.pick_another')))],
    });
  }

  function countdown() {
    const el = h('span', { class: 'bk-hold__t bk-num', role: 'timer', 'aria-live': 'off' });
    const label = h('span', { class: 'bk-hold' }, icon('clock'), h('span', null, t('bk.pay.held')), el);
    const tick = () => {
      const ms = Date.parse(st.hold_until) - Date.now();
      if (ms <= 0) { expired = true; render(); return; }
      const s = Math.floor(ms / 1000);
      el.textContent = F.digits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, lang());
      label.classList.toggle('is-low', s < 120);
      label.setAttribute('aria-label', t('bk.pay.held_for', { time: tn('minutes', Math.ceil(s / 60)) }));
    };
    tick();
    timer = setInterval(tick, 1000);
    return label;
  }

  function payStep() {
    const f = bookingFacts(view, data);
    const b = view.booking;
    const due = st.due_now_halalas;
    const rest = b.total_halalas - due;
    const summary = h('div', { class: 'b-card bk-card bk-paycard' },
      h('div', { class: 'bk-paycard__top' },
        h('div', { class: 'bk-paycard__what' },
          h('b', null, f.service + (f.qty ? ` · ${f.qty}` : '')),
          h('span', null, `${f.date} · ${f.time}`),
          f.hijri && h('small', null, f.hijri)),
        h('div', { class: 'bk-paycard__amt' },
          h('span', { class: 'bk-paycard__k' }, t('bk.pay_now')),
          h('strong', { class: 'bk-num' }, money(due)))),
      rest > 0 && h('p', { class: 'bk-paycard__rest' }, t('bk.pay.rest', { amount: money(rest), total: money(b.total_halalas) })));
    const body = mode() === 'local' ? demoSheet(due) : moyasarBox(due);
    return h('section', { class: 'b-step bk-pay' },
      h('div', { class: 'b-step__head' },
        h('span', { class: 'b-eyebrow' }, t('bk.pay.eyebrow')),
        h('h1', { class: 'b-step__q', 'data-step-focus': '' }, rest > 0 ? t('bk.pay.q_deposit') : t('bk.pay.q_full')),
        h('p', { class: 'b-step__hint' }, t('bk.pay.hint', { biz: bizName(biz) }))),
      countdown(),
      biz.is_demo && demoBadge(),
      summary,
      body,
      h('p', { class: 'bk-privacy' }, lockIcon(), h('span', null, mode() === 'local' ? t('bk.pay.local_note') : t('bk.pay.secure'))),
      h('p', { class: 'bk-note bk-pay__ref' }, `${t('bk.ref')}: `, h('b', { dir: 'ltr' }, b.ref)));
  }

  /* ---------- local: the demo sheet ---------- */
  function demoSheet(due) {
    const payBtn = h('button', { type: 'button', class: 'b-btn b-btn--primary b-btn--block b-btn--lg' },
      lockIcon(), h('span', null, t('bk.pay.pay', { amount: money(due) })));
    const noBtn = h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--block' }, h('span', null, t('bk.pay.decline')));
    const go = async (outcome, btn) => {
      if (payBtn.getAttribute('aria-busy') === 'true' || noBtn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      try {
        await demoPay(bk, tok, outcome);
        clearInterval(timer);
        location.assign(doneUrl(outcome === 'failed' ? '&status=failed' : '&status=paid'));
      } catch (e) {
        btn.removeAttribute('aria-busy');
        toast(t(errorKey(e)), { kind: 'err' });
      }
    };
    payBtn.addEventListener('click', () => go('paid', payBtn));
    noBtn.addEventListener('click', () => go('failed', noBtn));
    return h('div', { class: 'bk-demopay', role: 'group', 'aria-labelledby': 'bk-demopay-t' },
      h('div', { class: 'bk-demopay__grip', 'aria-hidden': 'true' }),
      h('p', { class: 'bk-demopay__label', id: 'bk-demopay-t' }, h('span', { class: 'bk-demopay__dot', 'aria-hidden': 'true' }), t('bk.pay.demo_label')),
      h('p', { class: 'bk-demopay__text' }, t('bk.pay.demo_text')),
      h('div', { class: 'bk-demopay__card', 'aria-hidden': 'true' },
        h('span', { class: 'bk-demopay__chip' }),
        h('span', { class: 'bk-demopay__num', dir: 'ltr' }, '4242  ••••  ••••  4242'),
        h('span', { class: 'bk-demopay__meta', dir: 'ltr' }, 'DEMO · 12/30')),
      h('div', { class: 'bk-demopay__actions' }, payBtn, noBtn));
  }

  /* ---------- cloud: Moyasar ---------- */
  function moyasarBox(due) {
    const box = h('div', { class: 'bk-moyasar' }, h('div', { class: 'mysr-form' }));
    if (!biz.moyasar_pk) {
      const wa = biz.phone ? F.whatsappUrl(biz.phone, `${t('bk.ref')}: ${view.booking.ref}`) : null;
      return h('div', { class: 'bk-empty' },
        h('p', { class: 'bk-empty__t' }, t('bk.pay.not_ready')),
        wa && h('div', { class: 'bk-empty__actions' },
          h('a', { class: 'b-btn b-btn--ghost b-btn--sm', href: wa, target: '_blank', rel: 'noopener' }, waIcon(), h('span', null, t('whatsapp')))));
    }
    const skel = h('div', { class: 'b-skel-list', 'aria-busy': 'true' }, h('span', { class: 'b-skel b-skel--card' }), h('span', { class: 'b-skel b-skel--card' }));
    box.prepend(skel);
    loadMoyasar().then((Moyasar) => {
      skel.remove();
      Moyasar.init({
        element: box.querySelector('.mysr-form'),
        amount: due,
        currency: 'SAR',
        description: `${pick(view.booking, 'service_name')} · ${bizName(biz)} · ${view.booking.ref}`.slice(0, 255),
        publishable_api_key: biz.moyasar_pk,
        callback_url: new URL(doneUrl(), location.origin).href,
        methods: ['creditcard', 'applepay'],
        apple_pay: { country: 'SA', label: bizName(biz), validate_merchant_url: 'https://api.moyasar.com/v1/applepay/initiate' },
        language: lang(),
        metadata: { booking_id: bk },
        on_completed: async (payment) => {
          await rpc('pub_attach_payment', { booking_id: bk, token: tok, moyasar_id: payment.id });
        },
      });
    }).catch(() => {
      skel.remove();
      box.replaceChildren(h('div', { class: 'bk-empty' },
        h('p', { class: 'bk-empty__t' }, t('err.NETWORK')),
        h('div', { class: 'bk-empty__actions' },
          h('button', { type: 'button', class: 'b-btn b-btn--ghost b-btn--sm', onClick: () => location.reload() }, h('span', null, t('retry'))))));
    });
    return box;
  }
}

let moyasarP = null;
function loadMoyasar() {
  if (window.Moyasar?.init) return Promise.resolve(window.Moyasar);
  if (moyasarP) return moyasarP;
  moyasarP = new Promise((res, rej) => {
    document.head.append(h('link', { rel: 'stylesheet', href: VENDOR.moyasarCss }));
    const s = h('script', { src: VENDOR.moyasarJs, async: true });
    s.onload = () => (window.Moyasar?.init ? res(window.Moyasar) : rej(new Error('moyasar')));
    s.onerror = () => { moyasarP = null; rej(new Error('moyasar')); };
    document.head.append(s);
  });
  return moyasarP;
}
