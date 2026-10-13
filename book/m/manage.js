/* ==========================================================
   Mamar Booking — manage a booking (/book/m/?t=<token>).
   View it, move it with the same day + time pickers, or cancel it,
   inside the business's self-service window.
   ========================================================== */

import { live } from '../../platform/live.js';
import { onLang } from '../../platform/i18n.js';
import { confirmDialog, stepTransition } from '../../platform/ui/kit.js';
import {
  rpc, errorKey, F, t, tn, lang, h, icon, toast,
  pageSetup, earlyLang, businessLang, useTheme, chrome, messageStep, loadingStep, cached, invalidate, bizName,
  detailsList, bookingActions, bookingFacts, statusPill, demoBadge, whenPicker, timeLabel, dayName, dayMinutes, bookUrl, waIcon,
} from '../core.js';

export async function mountManage() {
  const tok = new URLSearchParams(location.search).get('t') || '';
  pageSetup();
  earlyLang();
  const app = document.getElementById('app');
  const ui = chrome(app);
  ui.setTitle(t('bk.m.title'));
  ui.stage.replaceChildren(loadingStep());
  document.title = t('bk.m.title');
  if (!tok) { ui.stage.replaceChildren(messageStep({ mark: 'alert', title: t('err.NOT_FOUND'), text: t('bk.m.missing') })); return; }

  let view;
  try { view = await rpc('pub_booking', { token: tok }); } catch (e) {
    ui.stage.replaceChildren(messageStep({ mark: 'alert', title: t(errorKey(e)), text: e?.code === 'NOT_FOUND' ? t('bk.m.missing') : '' }));
    return;
  }
  const biz = view.business;
  businessLang(biz.langs);
  useTheme(biz);
  ui.setLogo(biz.theme?.logo_url);
  let data = await cached('pub_business', { slug: biz.slug }).catch(() => null);

  const M = { mode: 'view', picker: null, pick: null, busy: false };
  render(null);
  onLang(() => { ui.relabel(); render(null); });
  live(biz.id, async (k) => {
    if (k.catalog) { data = await cached('pub_business', { slug: biz.slug }, { force: true }).catch(() => data); }
    if (k.slots || k.catalog) {
      invalidate('pub_');
      try { view = await rpc('pub_booking', { token: tok }); } catch { /* keep what we have */ }
      if (M.mode === 'move' && M.picker) { await M.picker.refresh(); if (M.pick?.slot && !M.picker.t) { M.pick = null; paintMoveBar(); toast(t('bk.slot_gone'), { kind: 'warn' }); } }
      else render(null);
    }
  });

  function render(dir) {
    ui.setTitle(bizName(biz), t('bk.m.title'));
    document.title = `${t('bk.m.title')} · ${bizName(biz)}`;
    const el = M.mode === 'move' ? moveStep() : viewStep();
    if (dir) stepTransition(ui.stage, el, dir); else ui.stage.replaceChildren(el);
    ui.setBack(M.mode === 'move' ? () => { M.mode = 'view'; M.picker = null; render('back'); } : null);
  }

  function viewStep() {
    const b = view.booking;
    const f = bookingFacts(view, data);
    const live2 = ['confirmed', 'pending_payment'].includes(b.status);
    const cutoff = view.cutoff_hours ?? 3;
    const tel = biz.phone ? F.normalizePhone(biz.phone) : null;
    const wa = biz.phone ? F.whatsappUrl(biz.phone, t('bk.m.wa', { ref: b.ref })) : null;
    const contact = h('div', { class: 'bk-actions__row' },
      wa && h('a', { class: 'b-btn b-btn--ghost', href: wa, target: '_blank', rel: 'noopener' }, waIcon(), h('span', null, t('whatsapp'))),
      tel && h('a', { class: 'b-btn b-btn--ghost', href: `tel:${tel}` }, icon('phone'), h('span', null, t('call'))));
    let manage = null;
    if (live2 && (view.can_cancel || view.can_reschedule)) {
      manage = h('div', { class: 'bk-manage' },
        h('h2', { class: 'bk-manage__t' }, t('bk.m.change')),
        h('p', { class: 'bk-note' }, icon('info'), t('bk.policy', { hours: tn('hours', cutoff) })),
        h('div', { class: 'bk-manage__btns' },
          view.can_reschedule && h('button', {
            type: 'button', class: 'b-btn b-btn--primary b-btn--block',
            onClick: () => { M.mode = 'move'; M.pick = null; render('forward'); },
          }, icon('calendar'), h('span', null, t('bk.m.move'))),
          view.can_cancel && h('button', {
            type: 'button', class: 'b-btn b-btn--ghost b-btn--danger b-btn--block', onClick: cancel,
          }, h('span', null, t('bk.m.cancel')))));
    } else if (live2) {
      manage = h('div', { class: 'bk-manage bk-manage--locked' },
        h('h2', { class: 'bk-manage__t' }, t('bk.m.locked_title')),
        h('p', { class: 'bk-note' }, icon('info'), data?.flow?.self_manage?.on === false ? t('bk.m.no_self') : t('bk.m.locked', { hours: tn('hours', cutoff) })),
        contact);
    }
    const cancelled = b.status === 'cancelled' || b.status === 'expired';
    return h('section', { class: 'b-step bk-m' },
      h('div', { class: 'b-step__head' },
        h('div', { class: 'bk-m__top' }, h('span', { class: 'b-eyebrow' }, t('bk.m.eyebrow')), statusPill(b.status)),
        h('h1', { class: 'b-step__q', 'data-step-focus': '' }, f.service),
        h('p', { class: 'b-step__hint' }, cancelled ? t('bk.m.cancelled_text') : `${dayName(f.day)} · ${f.time}`)),
      biz.is_demo && demoBadge(),
      h('div', { class: 'bk-ref' }, h('span', { class: 'bk-ref__k' }, t('bk.ref')), h('b', { class: 'bk-ref__v', dir: 'ltr' }, b.ref)),
      h('div', { class: ['b-card', 'bk-card', cancelled && 'is-cancelled'] }, detailsList(view, data)),
      live2 && bookingActions(view, tok, data, { manage: false }),
      manage,
      cancelled && h('div', { class: 'bk-actions' },
        h('a', { class: 'b-btn b-btn--primary b-btn--block', href: bookUrl(biz.slug) }, h('span', null, t('bk.m.book_again')))));
  }

  const moveBar = { el: null };
  function paintMoveBar() {
    if (!moveBar.el) return;
    const p = M.pick;
    const ok = !!p?.slot;
    const late = ok ? dayMinutes(p.slot.t, p.day) >= 1440 : false;
    moveBar.el.querySelector('.b-summary__sub').textContent = ok ? `${dayName(p.day)} · ${timeLabel(p.slot.t, late)}` : t('bk.pick_time');
    moveBar.el.querySelector('button').disabled = !ok || M.busy;
  }

  function moveStep() {
    const b = view.booking;
    const svc = data?.services?.find((s) => s.id === b.service_id) || { id: b.service_id, mode: b.qty > 1 ? 'capacity' : 'staff' };
    const showSec = (data?.sections || []).length > 1;
    const f = bookingFacts(view, data);
    M.picker = whenPicker({
      data: data || { flow: {}, hours: [], sections: [], services: [] },
      query: {
        service_id: b.service_id, section_id: showSec ? b.section_id : null,
        qty: b.qty > 1 ? b.qty : null, location: b.location === 'mobile' ? 'mobile' : null,
        token: tok,   // the server treats this booking's own seat/chair as free while moving it
      },
      service: svc, sectionId: b.section_id, day: f.day, exclude: b.starts_at,
      onPick: (p) => { M.pick = p; paintMoveBar(); },
    });
    const cta = h('button', { type: 'button', class: 'b-btn b-btn--primary b-summary__cta', disabled: true, onClick: move }, h('span', null, t('bk.m.confirm_move')));
    moveBar.el = h('div', { class: 'b-summary bk-summary' },
      h('div', { class: 'b-summary__in' },
        h('div', { class: 'b-summary__text' },
          h('span', { class: 'b-summary__label' }, t('bk.m.new_time')),
          h('span', { class: 'b-summary__sub' }, t('bk.pick_time'))),
        cta));
    paintMoveBar();
    return h('div', { class: 'bk-m-move' },
      h('section', { class: 'b-step' },
        h('div', { class: 'b-step__head' },
          h('span', { class: 'b-eyebrow' }, t('bk.m.move')),
          h('h1', { class: 'b-step__q', 'data-step-focus': '' }, t('bk.m.move_q')),
          h('p', { class: 'b-step__hint' }, t('bk.m.now', { when: `${dayName(f.day)} ${F.dateShort(f.day, lang())} · ${f.time}` }))),
        M.picker.el),
      moveBar.el);
  }

  async function move() {
    if (!M.pick?.slot || M.busy) return;
    M.busy = true;
    const btn = moveBar.el.querySelector('button');
    btn.setAttribute('aria-busy', 'true');
    try {
      view = await rpc('pub_reschedule', { token: tok, start: M.pick.slot.t });
      invalidate('pub_');
      const f = bookingFacts(view, data);
      M.mode = 'view';
      M.picker = null;
      render('back');
      toast(t('bk.m.moved', { when: `${dayName(f.day)} · ${f.time}` }), { kind: 'ok', timeout: 4200 });
    } catch (e) {
      toast(t(errorKey(e)), { kind: e?.code === 'SLOT_TAKEN' ? 'warn' : 'err', timeout: 5000 });
      if (e?.code === 'SLOT_TAKEN') { invalidate('pub_'); M.pick = null; await M.picker?.refresh(); }
      if (e?.code === 'TOO_LATE') { try { view = await rpc('pub_booking', { token: tok }); } catch { /* keep */ } M.mode = 'view'; render('back'); }
    } finally {
      M.busy = false;
      btn.removeAttribute('aria-busy');
      paintMoveBar();
    }
  }

  async function cancel() {
    const f = bookingFacts(view, data);
    const ok = await confirmDialog({
      title: t('bk.m.cancel_q'),
      message: t('bk.m.cancel_text', { service: f.service, when: `${dayName(f.day)} · ${f.time}` }),
      confirm: t('bk.m.cancel_yes'),
      cancel: t('bk.m.keep'),
      danger: true,
    });
    if (!ok) return;
    try {
      view = await rpc('pub_cancel', { token: tok, reason: 'customer' });
      invalidate('pub_');
      render(null);
      toast(t('bk.m.cancelled_toast'), { kind: 'ok' });
    } catch (e) {
      toast(t(errorKey(e)), { kind: 'err' });
      try { view = await rpc('pub_booking', { token: tok }); render(null); } catch { /* keep */ }
    }
  }
}
