// Business → Look: standard (Mamar Signature) or the business's own colours, font and logo,
// with a live preview of the booking card painted by platform/theme.js applyTheme().
import { h, toast } from '../../platform/ui/kit.js';
import { t, lang } from '../../platform/i18n.js';
import { rpc, uploadLogo, ApiError } from '../../platform/api.js';
import { applyTheme, FONTS, themeVars, contrastRatio, loadFont, parseHex, toHex } from '../../platform/theme.js';
import * as fmt from '../../platform/fmt.js';
import { ic, money, num, pickName, section, seg, switchRow, busy, errToast, fill } from '../ui.js';

const PRESETS = ['#FF4A2B', '#C8A24A', '#1F8A5B', '#0E7C86', '#2F5FB3', '#6B4BB8', '#D9466F', '#1C1C1E'];
const HEX = /^#[0-9A-F]{6}$/i;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const norm = (v) => { const c = parseHex(v); return c ? toHex(c) : null; };
const clean = (th) => {
  const o = {};
  o.mode = th.mode === 'dark' ? 'dark' : 'light';
  for (const k of ['accent', 'bg', 'ink']) { const v = norm(th[k]); if (v) o[k] = v; }
  if (th.font) o.font = th.font;
  if (th.radius != null && th.radius !== '') o.radius = Math.max(0, Math.min(28, Number(th.radius) || 0));
  if (th.logo_url) o.logo_url = th.logo_url;
  return o;
};

export default function lookTab(ctx) {
  const b = ctx.d.business;
  const saved = JSON.stringify({ look: b.look, theme: clean({ mode: 'light', ...(b.theme || {}) }) });
  let look = b.look === 'custom' ? 'custom' : 'standard';
  const th = { mode: b.theme?.mode === 'dark' ? 'dark' : 'light', accent: norm(b.theme?.accent) || '#FF4A2B', ...clean(b.theme || {}) };
  if (!b.theme?.mode) th.mode = look === 'custom' ? 'light' : 'dark';

  const controls = h('div', { class: 'adm-look__controls' });
  const phone = h('div', { class: 'adm-phone' });
  const contrast = h('p', { class: 'adm-contrast', role: 'status' });
  const dirty = h('span', { class: 'adm-dirty', hidden: true }, t('look.unsaved'));
  const save = h('button', { type: 'button', class: 'b-btn b-btn--primary' }, h('span', null, t('look.save')));

  /* ---------- preview ---------- */
  const svcs = (ctx.d.services || []).filter((s) => s.active !== false).slice(0, 2);
  const samples = svcs.length
    ? svcs.map((s) => ({ name: pickName(s), dur: s.duration_min, price: s.price?.total ?? s.price_halalas ?? 0 }))
    : [{ name: t('pv.svc1'), dur: 30, price: 8000 }, { name: t('pv.svc2'), dur: 45, price: 12000 }];

  function paintPreview() {
    const today = fmt.riyadhDateISO();
    const days = [0, 1, 2, 3].map((i) => fmt.addDaysISO(today, i));
    const name = pickName(b) || b.slug;
    const logo = look === 'custom' && th.logo_url;
    const inner = h('div', { class: 'adm-phone__screen', inert: true, 'aria-hidden': 'true' },
      h('div', { class: 'adm-phone__bar' },
        logo ? h('img', { class: 'adm-phone__logo', src: th.logo_url, alt: '' }) : h('span', { class: 'adm-phone__mono' }, name.charAt(0)),
        h('span', { class: 'adm-phone__name' }, name),
        h('span', { class: 'adm-phone__lang' }, lang() === 'ar' ? 'EN' : 'ع')),
      h('div', { class: 'adm-phone__body' },
        h('p', { class: 'b-eyebrow' }, t('pv.eyebrow')),
        h('p', { class: 'b-h3 adm-phone__h' }, t('pv.title')),
        h('div', { class: 'b-choices' }, samples.map((s, i) => h('div', { class: ['b-choice', 'b-choice--compact', i === 0 && 'is-selected'] },
          h('span', { class: 'b-choice__lead' }, h('span', { class: 'b-choice__tick' })),
          h('span', { class: 'b-choice__main' }, h('span', { class: 'b-choice__title' }, s.name), h('span', { class: 'b-choice__meta' }, fmt.durationMin(s.dur, lang()))),
          h('span', { class: 'b-choice__end' }, h('span', { class: 'b-choice__price' }, money(s.price)))))),
        h('div', { class: 'b-dates adm-phone__dates' }, days.map((dd, i) => h('div', { class: ['b-date', i === 1 && 'is-selected', i === 0 && 'is-today'] },
          h('span', { class: 'b-date__wd' }, fmt.weekday(dd, lang(), true)),
          h('span', { class: 'b-date__d' }, num(Number(dd.slice(8)))),
          h('span', { class: 'b-date__h' }, fmt.hijriShort(dd, lang()))))),
        h('div', { class: 'b-slots__grid' }, ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30'].map((x, i) =>
          h('span', { class: ['b-slot', i === 2 && 'is-selected'], 'aria-disabled': i === 4 ? 'true' : null }, fmt.time(x, lang()))))),
      h('div', { class: 'adm-phone__cta' },
        h('span', { class: 'adm-phone__total' }, h('small', null, t('total')), money(samples[0].price)),
        h('span', { class: 'b-btn b-btn--primary' }, h('span', null, t('confirm_booking')))));
    phone.replaceChildren(inner);
    const res = applyTheme(phone, { look, theme: look === 'custom' ? th : { mode: th.mode } });

    // contrast note (custom only)
    if (look === 'custom') {
      const v = themeVars(th);
      const r = contrastRatio(v['--b-accent'], v['--b-bg']);
      const rt = contrastRatio(v['--b-ink'], v['--b-bg']);
      const verdict = rt < 4.5 ? 'bad_text' : r >= 3 ? 'good' : 'soft';
      contrast.className = `adm-contrast is-${verdict}`;
      fill(contrast,ic(verdict === 'good' ? 'check' : 'alert'),
        h('span', null, t(`look.contrast_${verdict}`, { ratio: fmt.num(Math.round(r * 10) / 10, lang()) })));
      contrast.hidden = false;
    } else {
      contrast.hidden = true;
    }
    const now = JSON.stringify({ look, theme: clean(th) });
    dirty.hidden = now === saved;
    return res;
  }

  /* ---------- controls ---------- */
  function colorRow(key, label, sub, optional) {
    const enabled = !optional || !!th[key];
    const val = th[key] || (key === 'bg' ? (th.mode === 'dark' ? '#0A0B0D' : '#F6F3EE') : key === 'ink' ? (th.mode === 'dark' ? '#EEEAE3' : '#151412') : '#FF4A2B');
    const picker = h('input', { type: 'color', class: 'adm-color', 'aria-label': label, value: val.toLowerCase() });
    const hex = h('input', { type: 'text', class: 'adm-hex b-mono', dir: 'ltr', 'aria-label': `${label} (hex)`, value: val.toUpperCase(), maxlength: 7, spellcheck: 'false', autocapitalize: 'characters' });
    const box = h('div', { class: 'adm-colorrow', hidden: !enabled }, picker, hex);
    picker.addEventListener('input', () => { th[key] = picker.value.toUpperCase(); hex.value = th[key]; paintPreview(); });
    hex.addEventListener('input', () => {
      let v = hex.value.trim().toUpperCase();
      if (v && v[0] !== '#') v = `#${v}`;
      if (HEX.test(v)) { th[key] = v; picker.value = v.toLowerCase(); hex.removeAttribute('aria-invalid'); paintPreview(); }
      else hex.setAttribute('aria-invalid', 'true');
    });
    if (!optional) return h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, label), sub && h('p', { class: 'b-field__msg' }, sub), box);
    const sw = switchRow({ label, sub, checked: enabled, onChange: (on) => {
      box.hidden = !on;
      if (on) th[key] = hex.value; else delete th[key];
      paintPreview();
    } });
    return h('div', { class: 'adm-fieldset adm-fieldset--opt' }, sw, box);
  }

  function accentRow() {
    const sw = h('div', { class: 'adm-swatches', role: 'radiogroup', 'aria-label': t('look.accent') });
    const row = colorRow('accent', t('look.accent'), t('look.accent_sub'), false);
    sw.append(...PRESETS.map((c) => h('button', {
      type: 'button', class: 'adm-swatchbtn', role: 'radio', 'aria-label': c, dataset: { c },
      style: { '--c': c },
      onClick: () => {
        th.accent = c;
        row.querySelector('.adm-color').value = c.toLowerCase();
        row.querySelector('.adm-hex').value = c;
        paintSw(); paintPreview();
      },
    })));
    const paintSw = () => sw.querySelectorAll('.adm-swatchbtn').forEach((b) => b.setAttribute('aria-checked', String(norm(th.accent) === b.dataset.c)));
    paintSw();
    row.querySelector('.adm-color').addEventListener('input', paintSw);
    row.querySelector('.adm-hex').addEventListener('input', paintSw);
    row.insertBefore(sw, row.querySelector('.adm-colorrow'));
    return row;
  }

  function fontRow() {
    const grid = h('div', { class: 'adm-fonts', role: 'radiogroup', 'aria-label': t('look.font') });
    const opts = [{ family: null }, ...FONTS];
    grid.append(...opts.map((f) => h('button', {
      type: 'button', role: 'radio', class: 'adm-font', dataset: { family: f.family || '' },
      onClick: () => { if (f.family) th.font = f.family; else delete th.font; paint(); paintPreview(); },
    },
      h('span', { class: 'adm-font__sample', style: f.family ? { fontFamily: `'${f.family}', 'Noto Kufi Arabic', sans-serif` } : null }, 'Aa أب'),
      h('span', { class: 'adm-font__name' }, f.family || t('look.font_default')),
      f.family && h('span', { class: 'adm-font__role' }, t(`look.font_${f.role}`)))));
    const paint = () => grid.querySelectorAll('.adm-font').forEach((b) => b.setAttribute('aria-checked', String((th.font || '') === b.dataset.family)));
    for (const f of FONTS) loadFont(f.family);
    paint();
    return h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, t('look.font')), h('p', { class: 'b-field__msg' }, t('look.font_sub')), grid);
  }

  function radiusRow() {
    const v = th.radius ?? 14;
    const out = h('output', { class: 'adm-range__v b-mono', dir: 'ltr' }, `${v}px`);
    const range = h('input', { type: 'range', class: 'adm-range', min: 0, max: 28, step: 2, value: v, 'aria-label': t('look.radius') });
    range.addEventListener('input', () => { th.radius = Number(range.value); out.textContent = `${th.radius}px`; paintPreview(); });
    return h('div', { class: 'adm-fieldset' }, h('div', { class: 'adm-range__head' }, h('p', { class: 'adm-label' }, t('look.radius')), out), range);
  }

  function logoRow() {
    const file = h('input', { type: 'file', accept: TYPES.join(','), class: 'b-sr', id: 'adm-logo-file' });
    const upBtn = h('label', { class: 'b-btn b-btn--ghost b-btn--sm', for: 'adm-logo-file', tabindex: '0', role: 'button' }, ic('upload'), h('span', null, th.logo_url ? t('look.logo_replace') : t('look.logo_upload')));
    upBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    const rm = h('button', { type: 'button', class: 'b-btn b-btn--quiet b-btn--sm b-btn--danger', hidden: !th.logo_url }, ic('trash'), h('span', null, t('remove')));
    const thumb = h('div', { class: 'adm-logo__thumb' });
    const paintThumb = () => {
      thumb.replaceChildren(th.logo_url ? h('img', { src: th.logo_url, alt: t('look.logo_alt') }) : ic('palette'));
      rm.hidden = !th.logo_url;
      upBtn.querySelector('span').textContent = th.logo_url ? t('look.logo_replace') : t('look.logo_upload');
    };
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      if (!TYPES.includes(f.type)) { errToast(new ApiError('BAD_INPUT')); return; }
      if (f.size > 2e6) { errToast(new ApiError('TOO_LARGE')); return; }
      await busy(upBtn, async () => {
        let url = await uploadLogo(f, b.id);
        // Local server: keep a same-origin path so theme.js accepts it (it only takes https:// or /paths).
        try { const u = new URL(url, location.href); if (u.origin === location.origin && u.protocol === 'http:') url = u.pathname; } catch { /* keep as is */ }
        th.logo_url = url;
        paintThumb(); paintPreview();
        toast(t('look.logo_done'), { kind: 'ok', timeout: 2200 });
      });
    });
    rm.addEventListener('click', () => { delete th.logo_url; paintThumb(); paintPreview(); });
    paintThumb();
    return h('div', { class: 'adm-fieldset' },
      h('p', { class: 'adm-label' }, t('look.logo')),
      h('div', { class: 'adm-logo' }, thumb, h('div', { class: 'adm-logo__acts' }, h('p', { class: 'b-field__msg' }, t('look.logo_sub')), h('div', { class: 'adm-quick' }, upBtn, rm))),
      file);
  }

  function paintControls() {
    const lookSeg = seg([{ value: 'standard', label: t('look.standard') }, { value: 'custom', label: t('look.custom') }], look,
      (v) => { look = v; paintControls(); paintPreview(); }, { block: true, label: t('spec.look') });
    const modeSeg = seg([{ value: 'light', label: t('theme.light') }, { value: 'dark', label: t('theme.dark') }], th.mode,
      (v) => { th.mode = v; paintControls(); paintPreview(); }, { block: true, label: t('spec.mode') });
    const ent = !!b.entitlements?.custom_look;
    fill(controls,
      h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, t('spec.look')), lookSeg,
        h('p', { class: 'b-field__msg' }, look === 'custom' ? t('look.custom_sub') : t('look.standard_sub')),
        look === 'custom' && !ent && h('p', { class: 'adm-inlinewarn' }, ic('info'), t('look.not_sold'))),
      h('div', { class: 'adm-fieldset' }, h('p', { class: 'adm-label' }, t('spec.mode')), modeSeg),
      ...(look === 'custom' ? [
        accentRow(),
        colorRow('bg', t('look.bg'), t('look.bg_sub'), true),
        colorRow('ink', t('look.ink'), t('look.ink_sub'), true),
        fontRow(),
        radiusRow(),
        logoRow(),
      ] : []));
  }

  save.addEventListener('click', () => busy(save, async () => {
    const theme = look === 'custom' ? clean(th) : { ...(clean(b.theme || {})), mode: th.mode };
    await rpc('adm_business_update', { business_id: b.id, patch: { look, theme } });
    await ctx.reload();
    toast(t('saved'), { kind: 'ok', timeout: 1800 });
  }));

  paintControls();
  paintPreview();

  return h('div', { class: 'adm-look' },
    section(t('btab.look'), h('div', { class: 'b-card adm-form' }, controls), { id: 'look', sub: t('look.sub'), cls: 'adm-look__left' }),
    h('div', { class: 'adm-look__right' },
      section(t('look.preview'), h('figure', { class: 'adm-preview' },
        h('div', { class: 'adm-bezel' }, phone),
        h('figcaption', { class: 'adm-preview__cap' }, t('look.preview_cap'))), { id: 'preview' }),
      contrast),
    h('div', { class: 'adm-formbar adm-formbar--sticky adm-look__bar' }, dirty, save));
}
