/* ==========================================================
   Booking settings — only what this business is entitled to
   (own_overview.business.entitlements + cfg). Each change is
   saved with own_settings_update and the returned cfg is shown.
   ========================================================== */

import {
  S, t, tn, h, call, errText, cfg, ent, dur, dg, fm, group, ctlRow, seg, stepper, switchRow, selectField, sarField,
  toast, debounce, icon, sarValue, L,
} from '../core.js';

const NOTICE = [0, 15, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440, 2880];
const HORIZON = [3, 7, 14, 21, 30, 45, 60, 90];

export function mount(main) {
  const root = h('div', { class: 'mg-settings' });
  main.replaceChildren(root);
  const setters = [];      // [(cfg, settings) => void] — show what the server kept

  function sync() {
    for (const f of setters) { try { f(cfg(), S.ov.business.settings || {}); } catch { /* control gone */ } }
  }

  async function save(patch) {
    try {
      const r = await call('own_settings_update', { settings: patch }, { quiet: true });
      S.ov.cfg = r.cfg;
      S.ov.business.settings = r.settings;
      sync();
      toast(t('mg.st.saved'), { kind: 'ok', timeout: 1600 });
    } catch (e) {
      toast(errText(e), { kind: 'err' });
      sync();
    }
  }

  function paint() {
    setters.length = 0;
    const c = cfg();
    const e = ent();
    const st = S.ov.business.settings || {};
    const groups = [];

    /* booking window */
    const notice = selectField({
      label: t('mg.st.notice'), value: c.notice_min,
      options: [...new Set([...NOTICE, c.notice_min])].sort((a, b) => a - b).map((m) => ({ value: m, label: m ? dur(m) : t('mg.st.no_notice') })),
      onChange: (v) => save({ notice_min: Number(v) }),
    });
    const horizon = selectField({
      label: t('mg.st.horizon'), value: c.horizon_days,
      options: [...new Set([...HORIZON, c.horizon_days])].sort((a, b) => a - b).map((d) => ({ value: d, label: tn('mg.days', d) })),
      onChange: (v) => save({ horizon_days: Number(v) }),
    });
    setters.push((k) => { notice.input.value = String(k.notice_min); horizon.input.value = String(k.horizon_days); });
    groups.push(group(t('mg.st.window'), h('div', { class: 'mg-two' }, notice, horizon)));

    /* prayer */
    if (e.prayer) {
      const sp = st.prayer || {};
      const p = {
        on: c.prayer?.on ?? false,
        fajr: c.prayer?.fajr ?? sp.fajr ?? false,
        before_min: c.prayer?.before_min ?? sp.before_min ?? 0,
        after_min: c.prayer?.after_min ?? sp.after_min ?? 25,
        jumuah_min: c.prayer?.jumuah_min ?? sp.jumuah_min ?? 60,
      };
      const push = debounce(() => save({ prayer: { ...p } }), 500);
      const details = h('div', { class: 'mg-stack mg-sub', hidden: !p.on });
      const onSw = switchRow({ label: t('mg.st.prayer_on'), checked: p.on, onChange: (v) => { p.on = v; details.hidden = !v; save({ prayer: { ...p } }); } });
      const after = stepper({ value: p.after_min, min: 5, max: 60, step: 5, format: (v) => dur(v), label: t('mg.st.after'), onChange: (v) => { p.after_min = v; push(); } });
      const before = stepper({ value: p.before_min, min: 0, max: 30, step: 5, format: (v) => (v ? dur(v) : '—'), label: t('mg.st.before'), onChange: (v) => { p.before_min = v; push(); } });
      const jum = stepper({ value: p.jumuah_min, min: 15, max: 120, step: 5, format: (v) => dur(v), label: t('mg.st.jumuah'), onChange: (v) => { p.jumuah_min = v; push(); } });
      const fajr = switchRow({ label: t('mg.st.fajr'), checked: p.fajr, onChange: (v) => { p.fajr = v; save({ prayer: { ...p } }); } });
      details.append(ctlRow(t('mg.st.after'), after), ctlRow(t('mg.st.before'), before), ctlRow(t('mg.st.jumuah'), jum), fajr);
      setters.push((k) => {
        onSw.input.checked = !!k.prayer?.on;
        details.hidden = !k.prayer?.on;
        if (k.prayer?.on) { after.set(k.prayer.after_min); before.set(k.prayer.before_min); jum.set(k.prayer.jumuah_min); fajr.input.checked = !!k.prayer.fajr; }
      });
      groups.push(group(t('mg.st.prayer'), onSw, details));
    }

    /* payment */
    if (e.payments) {
      const pay = { mode: c.payment?.mode || 'shop', deposit_kind: c.payment?.deposit_kind || 'percent', deposit_value: c.payment?.deposit_value ?? 20 };
      const depBox = h('div', { class: 'mg-stack mg-sub', hidden: pay.mode !== 'deposit' });
      const valBox = h('div');
      const pushDep = debounce(() => save({ payment: { ...pay } }), 500);
      const paintVal = () => {
        if (pay.deposit_kind === 'percent') {
          if (pay.deposit_value > 100) pay.deposit_value = 25;
          valBox.replaceChildren(ctlRow(t('mg.st.deposit'), stepper({
            value: pay.deposit_value || 20, min: 5, max: 100, step: 5, label: t('mg.st.deposit'),
            format: (v) => `${dg(v)}${L() === 'ar' ? '٪' : '%'}`,
            onChange: (v) => { pay.deposit_value = v; pushDep(); },
          })));
        } else {
          const f = sarField({ label: t('mg.st.deposit'), halalas: pay.deposit_value || 5000, onChange: (v) => { if (v != null && !Number.isNaN(v)) { pay.deposit_value = v; save({ payment: { ...pay } }); } } });
          valBox.replaceChildren(f);
        }
      };
      const kind = seg([{ value: 'percent', label: t('mg.st.dep_percent') }, { value: 'amount', label: t('mg.st.dep_amount') }], pay.deposit_kind,
        (v) => { pay.deposit_kind = v; pay.deposit_value = v === 'percent' ? 25 : 5000; paintVal(); save({ payment: { ...pay } }); }, { label: t('mg.st.deposit') });
      paintVal();
      depBox.append(kind, valBox);
      const mode = seg([
        { value: 'shop', label: t('mg.st.pay_shop') }, { value: 'deposit', label: t('mg.st.pay_deposit') }, { value: 'full', label: t('mg.st.pay_full') },
      ], pay.mode, (v) => { pay.mode = v; depBox.hidden = v !== 'deposit'; save({ payment: { ...pay } }); }, { label: t('mg.st.pay_mode') });
      setters.push((k) => { mode.set(k.payment.mode); depBox.hidden = k.payment.mode !== 'deposit'; });
      groups.push(group(t('mg.st.payment'),
        h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label' }, t('mg.st.pay_mode')), mode),
        depBox,
        !c.payment?.ready && h('p', { class: 'mg-hint' }, icon('info'), h('span', null, t('mg.st.pay_not_ready')))));
    }

    /* self-manage */
    if (e.self_manage) {
      const hint = (v) => (v ? t('mg.st.cutoff_v', { h: tn('hours', v) }) : t('now'));
      const push = debounce((v) => save({ self_manage: { cutoff_hours: v } }), 500);
      const cut = stepper({
        value: c.self_manage?.cutoff_hours ?? 3, min: 0, max: 72, label: t('mg.st.cutoff'),
        format: (v) => (v ? tn('hours', v) : t('now')),
        onChange: (v) => { row.querySelector('.mg-ctlrow__hint').textContent = hint(v); push(v); },
      });
      const row = ctlRow(t('mg.st.cutoff'), cut, hint(cut.get()));
      setters.push((k) => { cut.set(k.self_manage?.cutoff_hours ?? 3); row.querySelector('.mg-ctlrow__hint').textContent = hint(cut.get()); });
      groups.push(group(t('mg.st.self'), row));
    }

    /* home service */
    if (e.home_service) {
      const fee = sarField({ label: t('mg.st.home_fee'), halalas: c.home?.fee_halalas ?? 0, onChange: (v) => { if (v != null && !Number.isNaN(v)) save({ home: { fee_halalas: v } }); } });
      const travel = stepper({
        value: c.home?.travel_min ?? 30, min: 0, max: 180, step: 5, label: t('mg.st.travel'), format: (v) => (v ? dur(v) : '—'),
        onChange: debounce((v) => save({ home: { travel_min: v } }), 500),
      });
      setters.push((k) => { fee.input.value = sarValue(k.home?.fee_halalas ?? 0); travel.set(k.home?.travel_min ?? 30); });
      groups.push(group(t('mg.st.home'), fee, ctlRow(t('mg.st.travel'), travel)));
    }

    /* customer details */
    const email = seg([
      { value: 'off', label: t('mg.st.email_off') }, { value: 'optional', label: t('optional') }, { value: 'required', label: t('required') },
    ], c.customer?.email || 'off', (v) => save({ customer: { email: v } }), { label: t('mg.st.email') });
    setters.push((k) => email.set(k.customer?.email || 'off'));
    groups.push(group(t('mg.st.customer'), h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label' }, t('mg.st.email')), email)));

    /* general */
    const hijri = switchRow({ label: t('mg.st.hijri'), checked: c.hijri !== false, onChange: (v) => save({ hijri: v }) });
    const perPhone = stepper({ value: c.max_per_phone ?? 3, min: 1, max: 10, label: t('mg.st.max_phone'), onChange: debounce((v) => save({ max_per_phone: v }), 500) });
    const choice = e.staff_choice ? switchRow({ label: t('mg.st.staff_choice'), checked: !!c.staff_choice, onChange: (v) => save({ staff_choice: v }) }) : null;
    setters.push((k) => { hijri.input.checked = k.hijri !== false; perPhone.set(k.max_per_phone ?? 3); if (choice) choice.input.checked = !!k.staff_choice; });
    groups.push(group(t('mg.st.general'), hijri, choice, ctlRow(t('mg.st.max_phone'), perPhone)));

    root.replaceChildren(...groups);
  }
  paint();
  return () => {};
}

export const title = () => t('mg.more.settings');
export { fm };
