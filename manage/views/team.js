/* ==========================================================
   Team & resources — staff labels per language (labels, not
   names), which services each one does, active flag; shared
   resources with capacity.
   ========================================================== */

import {
  S, t, h, icon, on, call, errText, nm, cfg, btn, chips, field, stepper, switchRow, switchEl, selectField,
  busy, toast, openSheet, loadOverview, emptyState, dg, usesStaff,
} from '../core.js';
import { confirmDelete } from './prices.js';

export function mount(main) {
  const root = h('div', { class: 'mg-team' });
  main.replaceChildren(root);

  function paint() {
    const ov = S.ov;
    const staff = ov.staff.slice().sort((a, b) => a.sort - b.sort);
    const res = ov.resources.slice().sort((a, b) => a.sort - b.sort);
    const showStaff = usesStaff() || staff.length || !res.length;
    const showRes = res.length || ov.services.some((s) => s.mode === 'capacity') || !staff.length;
    const svcCount = (s) => (s.services ? s.services.length : null);

    root.replaceChildren(...[
      showStaff && h('section', { class: 'mg-block' },
        h('div', { class: 'mg-sechead' },
          h('div', { class: 'mg-sechead__text' },
            h('h2', { class: 'mg-sechead__title' }, t('mg.tm.staff')),
            h('p', { class: 'mg-sechead__sub' }, t('mg.tm.staff_hint'))),
          btn(t('mg.tm.add_staff'), { kind: 'ghost', icon: 'plus', onClick: () => openStaff(null) })),
        staff.length ? h('div', { class: 'b-list' }, staff.map((s) => h('div', { class: ['b-row', 'mg-teamrow', !s.active && 'is-hidden'] },
          h('span', { class: 'b-row__lead' }, icon('user')),
          h('button', { type: 'button', class: 'mg-svcrow__main', onClick: () => openStaff(s) },
            h('span', { class: 'b-row__title' }, nm(s, 'label')),
            h('span', { class: 'b-row__sub' }, [
              s.active ? null : t('mg.tm.off'),
              svcCount(s) == null ? t('mg.off.all_services') : t('mg.off.services_n', { n: svcCount(s) }),
            ].filter(Boolean).join(' · '))),
          switchEl({
            checked: s.active, label: `${nm(s, 'label')} · ${t('mg.tm.active')}`,
            onChange: async (v, input) => {
              try { await call('own_staff_upsert', { item: { ...pickStaff(s), active: v } }, { quiet: true }); s.active = v; toast(t('mg.tm.saved'), { kind: 'ok' }); paint(); }
              catch (e) { input.checked = !v; toast(errText(e), { kind: 'err' }); }
            },
          }))))
          : emptyState('user', t('mg.tm.none_staff'), null)),
      showRes && h('section', { class: 'mg-block' },
        h('div', { class: 'mg-sechead' },
          h('div', { class: 'mg-sechead__text' },
            h('h2', { class: 'mg-sechead__title' }, t('mg.tm.resources')),
            h('p', { class: 'mg-sechead__sub' }, t('mg.tm.res_hint'))),
          btn(t('mg.tm.add_res'), { kind: 'ghost', icon: 'plus', onClick: () => openResource(null) })),
        res.length ? h('div', { class: 'b-list' }, res.map((r) => h('div', { class: ['b-row', 'mg-teamrow', !r.active && 'is-hidden'] },
          h('span', { class: 'b-row__lead mg-caplead' }, dg(r.capacity)),
          h('button', { type: 'button', class: 'mg-svcrow__main', onClick: () => openResource(r) },
            h('span', { class: 'b-row__title' }, nm(r, 'label')),
            h('span', { class: 'b-row__sub' }, [r.active ? null : t('mg.tm.off'), t('mg.tm.cap_n', { n: r.capacity })].filter(Boolean).join(' · '))),
          switchEl({
            checked: r.active, label: `${nm(r, 'label')} · ${t('mg.tm.active')}`,
            onChange: async (v, input) => {
              try { await call('own_resource_upsert', { item: { ...pickRes(r), active: v } }, { quiet: true }); r.active = v; toast(t('mg.tm.saved'), { kind: 'ok' }); paint(); }
              catch (e) { input.checked = !v; toast(errText(e), { kind: 'err' }); }
            },
          }))))
          : emptyState('inbox', t('mg.tm.none_res'), null)),
    ].filter(Boolean));
  }
  paint();
  const offs = [on('overview', paint)];
  return () => offs.forEach((f) => f());
}

const pickStaff = (s) => ({ id: s.id, label_ar: s.label_ar, label_en: s.label_en, section_id: s.section_id, services: s.services, active: s.active, sort: s.sort });
const pickRes = (r) => ({ id: r.id, label_ar: r.label_ar, label_en: r.label_en, capacity: r.capacity, section_id: r.section_id, active: r.active, sort: r.sort });

function labelsFields(x) {
  const ar = field({ label: t('mg.tm.label_ar'), value: x.label_ar, maxlength: 40, dir: 'rtl', placeholder: t('mg.tm.ph_ar') });
  const en = field({ label: t('mg.tm.label_en'), value: x.label_en, maxlength: 40, dir: 'ltr', placeholder: t('mg.tm.ph_en') });
  return { ar, en };
}

function sectionField(x) {
  return cfg().sections && S.ov.sections.length > 1 ? selectField({
    label: t('mg.svc.section'), value: x.section_id || '',
    options: [{ value: '', label: t('mg.svc.all_sections') }, ...S.ov.sections.map((s) => ({ value: s.id, label: nm(s) }))],
    onChange: (v) => { x.section_id = v || null; },
  }) : null;
}

function openStaff(s0) {
  const x = s0 ? { ...pickStaff(s0), services: s0.services ? [...s0.services] : null }
    : { id: null, label_ar: '', label_en: '', section_id: null, services: null, active: true, sort: (Math.max(0, ...S.ov.staff.map((s) => s.sort || 0)) + 1) };
  const services = S.ov.services.filter((s) => s.mode === 'staff');
  return openSheet({
    title: s0 ? t('mg.tm.edit_staff') : t('mg.tm.add_staff'),
    build: (ctx) => {
      const { ar, en } = labelsFields(x);
      const svcChips = chips(services.map((s) => ({ value: s.id, label: nm(s) })), x.services || [],
        (v) => { x.services = v; }, { multi: true, label: t('mg.tm.services') });
      svcChips.hidden = x.services == null;
      const allSw = switchRow({
        label: t('mg.off.all_services'), checked: x.services == null,
        onChange: (v) => { x.services = v ? null : (svcChips.get() || []); svcChips.hidden = v; },
      });
      const active = switchRow({ label: t('mg.tm.active'), checked: x.active, onChange: (v) => { x.active = v; } });
      const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
      const save = btn(t('save'), { kind: 'primary', size: null, block: true });
      save.addEventListener('click', () => busy(save, async () => {
        x.label_ar = ar.input.value.trim();
        x.label_en = en.input.value.trim();
        if (!x.label_ar && !x.label_en) { ar.setError(t('mg.svc.need_name')); ar.input.focus(); return; }
        try {
          await call('own_staff_upsert', { item: { ...x, id: x.id || undefined } }, { quiet: true });
          toast(t('mg.tm.saved'), { kind: 'ok' });
          loadOverview();
          ctx.close(true);
        } catch (e) { msg.textContent = errText(e); msg.hidden = false; }
      }));
      const form = h('div', { class: 'mg-step mg-form' },
        h('p', { class: 'mg-hint' }, icon('info'), h('span', null, t('mg.tm.staff_hint'))),
        ar, en,
        h('div', { class: 'mg-fieldset' }, h('span', { class: 'mg-label' }, t('mg.tm.services')), allSw, svcChips),
        sectionField(x), active, msg,
        h('div', { class: 'mg-sheetactions' }, save,
          s0 && btn(t('delete'), {
            kind: 'quiet', size: null, block: true, danger: true,
            onClick: () => ctx.swap(confirmDelete(ctx, nm(s0, 'label'), async () => {
              const r = await call('own_staff_delete', { id: s0.id });
              toast(r.archived ? t('mg.tm.archived') : t('mg.deleted'), { kind: 'ok' });
              loadOverview();
              ctx.close(true);
            }, () => ctx.swap(form, 'back'))),
          })));
      return form;
    },
  });
}

function openResource(r0) {
  const x = r0 ? pickRes(r0) : { id: null, label_ar: '', label_en: '', capacity: 2, section_id: null, active: true, sort: (Math.max(0, ...S.ov.resources.map((r) => r.sort || 0)) + 1) };
  return openSheet({
    title: r0 ? t('mg.tm.edit_res') : t('mg.tm.add_res'),
    build: (ctx) => {
      const { ar, en } = labelsFields(x);
      const cap = h('div', { class: 'mg-ctlrow' }, h('span', { class: 'mg-ctlrow__label' }, t('mg.tm.capacity')),
        stepper({ value: x.capacity, min: 1, max: 500, label: t('mg.tm.capacity'), onChange: (v) => { x.capacity = v; } }));
      const active = switchRow({ label: t('mg.tm.active'), checked: x.active, onChange: (v) => { x.active = v; } });
      const msg = h('p', { class: 'mg-inlinemsg', role: 'alert', hidden: true });
      const save = btn(t('save'), { kind: 'primary', size: null, block: true });
      save.addEventListener('click', () => busy(save, async () => {
        x.label_ar = ar.input.value.trim();
        x.label_en = en.input.value.trim();
        if (!x.label_ar && !x.label_en) { ar.setError(t('mg.svc.need_name')); ar.input.focus(); return; }
        try {
          await call('own_resource_upsert', { item: { ...x, id: x.id || undefined } }, { quiet: true });
          toast(t('mg.tm.saved'), { kind: 'ok' });
          loadOverview();
          ctx.close(true);
        } catch (e) { msg.textContent = errText(e); msg.hidden = false; }
      }));
      const form = h('div', { class: 'mg-step mg-form' },
        h('p', { class: 'mg-hint' }, icon('info'), h('span', null, t('mg.tm.res_hint'))),
        ar, en, cap, sectionField(x), active, msg,
        h('div', { class: 'mg-sheetactions' }, save,
          r0 && btn(t('delete'), {
            kind: 'quiet', size: null, block: true, danger: true,
            onClick: () => ctx.swap(confirmDelete(ctx, nm(r0, 'label'), async () => {
              const r = await call('own_resource_delete', { id: r0.id });
              toast(r.archived ? t('mg.tm.archived') : t('mg.deleted'), { kind: 'ok' });
              loadOverview();
              ctx.close(true);
            }, () => ctx.swap(form, 'back'))),
          })));
      return form;
    },
  });
}

export const title = () => t('mg.more.team');
