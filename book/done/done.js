/* ==========================================================
   Mamar Booking — after payment (/book/done/?bk&t[&id&status]).
   Cloud: Moyasar sends the customer back here with ?id → verify it.
   Local: read the status the demo payment left behind.
   Then the same confirmation as the booking flow, or a calm
   "try again / pick another time" when the payment didn't land.
   ========================================================== */

import { mode, verifyPayment } from '../../platform/api.js';
import { onLang } from '../../platform/i18n.js';
import {
  rpc, errorKey, URLS, t, h, pageSetup, earlyLang, businessLang, useTheme, chrome, messageStep, loadingStep, cached,
  bizName, confirmationStep, saveBooking, backLink, bookUrl,
} from '../core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mountDone() {
  const q = new URLSearchParams(location.search);
  const bk = q.get('bk') || '';
  const tok = q.get('t') || '';
  const pid = q.get('id') || '';
  const hint = q.get('status') || '';
  const backRaw = q.get('back') || '';
  pageSetup();
  earlyLang();
  const app = document.getElementById('app');
  const ui = chrome(app);
  ui.setTitle(t('bk.done.page'));
  ui.stage.replaceChildren(loadingStep());
  document.title = t('bk.done.page');
  if (!bk || !tok) { show(messageStep({ mark: 'alert', title: t('err.NOT_FOUND'), text: t('bk.pay.missing') })); return; }

  let st;
  let verifyErr = null;
  try {
    if (mode() === 'cloud' && pid) {
      try { await verifyPayment(bk, tok, pid); } catch (e) { verifyErr = e; }
    }
    st = await rpc('pub_payment_status', { booking_id: bk, token: tok });
    // 3-D Secure can land a moment after the redirect: look again briefly before saying no.
    for (let i = 0; i < 3 && st.status === 'pending_payment' && pid && hint !== 'failed'; i++) {
      await sleep(1500);
      if (mode() === 'cloud') { try { await verifyPayment(bk, tok, pid); } catch (e) { verifyErr = e; } }
      st = await rpc('pub_payment_status', { booking_id: bk, token: tok });
    }
  } catch (e) {
    show(messageStep({ mark: 'alert', title: t(errorKey(e)) }));
    return;
  }

  let view;
  try { view = await rpc('pub_booking', { token: tok }); } catch (e) { show(messageStep({ mark: 'alert', title: t(errorKey(e)) })); return; }
  const biz = view.business;
  businessLang(biz.langs);
  useTheme(biz);
  ui.setLogo(biz.theme?.logo_url);
  const data = await cached('pub_business', { slug: biz.slug }).catch(() => null);
  const back = () => backLink(backRaw);

  if (st.status === 'confirmed' || view.booking.status === 'confirmed') {
    saveBooking({ ...view.booking, booking_id: view.booking.id, token: tok, slug: biz.slug });
  }
  render();
  onLang(() => { ui.relabel(); render(); });

  function show(el) { ui.stage.replaceChildren(el); }

  function render() {
    ui.setTitle(bizName(biz));
    const b = view.booking;
    if (b.status === 'confirmed' || b.status === 'completed') {
      document.title = `${t('bk.done.title')} · ${bizName(biz)}`;
      ui.setProgress(1);
      show(confirmationStep(view, tok, data, { back: back() }));
      return;
    }
    const pickAnother = h('a', { class: 'b-btn b-btn--ghost', href: bookUrl(biz.slug) }, h('span', null, t('bk.pick_another')));
    const holdLeft = b.hold_until ? Date.parse(b.hold_until) - Date.now() : 0;
    if (b.status === 'pending_payment' && holdLeft > 0) {
      document.title = `${t('bk.done.failed')} · ${bizName(biz)}`;
      let pay = URLS.pay(bk, tok);
      if (backRaw) pay += `&back=${encodeURIComponent(backRaw)}`;
      show(messageStep({
        mark: 'alert',
        title: t('bk.done.failed'),
        text: verifyErr && verifyErr.code !== 'SERVER_ERROR' ? t(errorKey(verifyErr)) : t('bk.done.failed_text'),
        actions: [h('a', { class: 'b-btn b-btn--primary', href: `${pay}&lang=${document.documentElement.lang}` }, h('span', null, t('retry'))), pickAnother],
      }));
      return;
    }
    document.title = `${t('bk.pay.expired')} · ${bizName(biz)}`;
    show(messageStep({
      mark: 'clock',
      title: b.status === 'cancelled' ? t('bk.m.cancelled_title') : t('bk.pay.expired'),
      text: b.status === 'cancelled' ? t('bk.m.cancelled_text') : t('bk.pay.expired_text'),
      actions: [h('a', { class: 'b-btn b-btn--primary', href: bookUrl(biz.slug) }, h('span', null, t('bk.pick_another')))],
    }));
  }
}
