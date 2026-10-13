/* ==========================================================
   Mamar Booking · /start/ live look preview
   A tiny phone built from the real kit components and themed with
   applyTheme(), scaled down. Purely decorative: aria-hidden + inert.
   ========================================================== */

import { t, lang } from '../platform/i18n.js';
import { money } from '../platform/fmt.js';
import { applyTheme } from '../platform/theme.js';
import { h, mark } from '../platform/ui/kit.js';

/** The theme a look answer maps to (same rules the server uses when it creates the business). */
export function lookTheme(look, brand = {}) {
  if (look !== 'custom') return { look: 'standard', theme: { mode: 'dark' } };
  return { look: 'custom', theme: { mode: brand.mode === 'dark' ? 'dark' : 'light', accent: brand.accent || '#0E6B5C' } };
}

/**
 * @param {{look:'standard'|'custom', brand?:object, name?:string, items?:Array<{title:string, price:number}>}} opts
 * @returns {{el:HTMLElement, update:(opts:object)=>void}}
 */
export function phoneMock(opts) {
  const inner = h('div', { class: 'st-phone__inner' });
  const el = h('div', { class: 'st-phone', 'aria-hidden': 'true', inert: true },
    h('div', { class: 'st-phone__frame' }, h('span', { class: 'st-phone__island' }), inner));

  function paint(o) {
    const l = lang();
    const items = (o.items && o.items.length ? o.items : []).slice(0, 2);
    const logo = h('span', { class: 'st-mock__logo' }, mark());
    inner.replaceChildren(
      h('div', { class: 'st-mock__bar' },
        logo,
        h('span', { class: 'st-mock__name' }, o.name || t('st.look.preview_name')),
        h('span', { class: 'st-mock__lang' }, l === 'ar' ? 'EN' : 'ع')),
      h('div', { class: 'st-mock__dots' },
        h('span', { class: 'b-dots__dot is-current' }), h('span', { class: 'b-dots__dot' }), h('span', { class: 'b-dots__dot' })),
      h('div', { class: 'st-mock__body' },
        h('p', { class: 'b-step__q st-mock__q' }, t('st.look.preview_q')),
        h('div', { class: 'b-choices' }, items.map((it, i) =>
          h('div', { class: 'b-choice', 'aria-checked': String(i === 0) },
            h('span', { class: 'b-choice__lead' }, h('span', { class: 'b-choice__tick' })),
            h('span', { class: 'b-choice__main' }, h('span', { class: 'b-choice__title' }, it.title)),
            h('span', { class: 'b-choice__end' }, h('span', { class: 'b-choice__price' }, money(it.price, l))))))),
      h('div', { class: 'st-mock__foot' },
        h('span', { class: 'b-btn b-btn--primary b-btn--block' }, t('continue'))));
    applyTheme(inner, lookTheme(o.look, o.brand));
  }

  paint(opts);
  return {
    el,
    update(next) { Object.assign(opts, next); paint(opts); },
  };
}
