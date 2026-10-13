/* ==========================================================
   Mamar Booking — theming
   look 'standard' → Mamar Signature (dark) or Signature light.
   look 'custom'   → a business's own colours, font and radius,
                     mapped onto the --b-* tokens kit.css is built on.
   Colour maths is pure; DOM writes are guarded so the module
   imports cleanly in Node (the admin can preview themes server-side).
   ========================================================== */

/* ---------- curated fonts (Google Fonts, loaded on demand) ---------- */

/**
 * role 'both'    → used for headings and body.
 * role 'display' → headings only; body keeps the Signature UI face.
 * script 'arabic' fonts also carry Latin; Latin-only fonts fall back to
 * Noto Kufi Arabic / IBM Plex Sans Arabic for Arabic glyphs.
 */
export const FONTS = Object.freeze([
  { family: 'Inter', role: 'both', script: 'latin', kind: 'sans', weights: [400, 500, 600, 700] },
  { family: 'Manrope', role: 'both', script: 'latin', kind: 'sans', weights: [400, 500, 600, 700, 800] },
  { family: 'Playfair Display', role: 'display', script: 'latin', kind: 'serif', weights: [400, 500, 600, 700] },
  { family: 'Cormorant Garamond', role: 'display', script: 'latin', kind: 'serif', weights: [400, 500, 600, 700] },
  { family: 'DM Serif Display', role: 'display', script: 'latin', kind: 'serif', weights: [400] },
  { family: 'Tajawal', role: 'both', script: 'arabic', kind: 'sans', weights: [400, 500, 700, 800] },
  { family: 'IBM Plex Sans Arabic', role: 'both', script: 'arabic', kind: 'sans', weights: [400, 500, 600, 700] },
  { family: 'Noto Kufi Arabic', role: 'both', script: 'arabic', kind: 'sans', weights: [400, 500, 600, 700] },
  { family: 'Readex Pro', role: 'both', script: 'arabic', kind: 'sans', weights: [400, 500, 600, 700] },
].map(Object.freeze));

const AR_DISPLAY = "'Noto Kufi Arabic'";
const AR_BODY = "'IBM Plex Sans Arabic', 'Noto Kufi Arabic'";

export function findFont(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return FONTS.find((f) => f.family.toLowerCase() === n) || null;
}

/** Google Fonts css2 URL for a curated family. */
export function fontUrl(font) {
  const f = typeof font === 'string' ? findFont(font) : font;
  if (!f) return null;
  const fam = f.family.replace(/ /g, '+');
  const w = f.weights.length > 1 ? `:wght@${f.weights.join(';')}` : '';
  return `https://fonts.googleapis.com/css2?family=${fam}${w}&display=swap`;
}

/** Inject the stylesheet for a curated font once (browser only). */
export function loadFont(name) {
  const f = findFont(name);
  if (!f || typeof document === 'undefined') return null;
  const id = 'b-font-' + f.family.replace(/\W+/g, '-').toLowerCase();
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = fontUrl(f);
    document.head.appendChild(link);
  }
  return f;
}

/* ---------- colour maths ---------- */

/** '#abc' | '#aabbcc' | 'aabbcc' → [r,g,b] (0–255), or null. */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, '$&$&');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Linear blend: t = 0 → a, t = 1 → b. */
export function mix(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}

export function rgba(hex, alpha) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** WCAG 2.x relative luminance. */
export function luminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white — whichever reads better on `hex` by WCAG contrast. */
export function readableOn(hex) {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#FFFFFF') ? '#000000' : '#FFFFFF';
}

/** Move `fg` toward `toward` until it reaches `target` contrast on `bg`. */
export function ensureContrast(fg, bg, target = 4.5, toward) {
  const dest = toward || (luminance(bg) > 0.4 ? '#000000' : '#FFFFFF');
  if (contrastRatio(fg, bg) >= target) return toHex(parseHex(fg));
  for (let t = 0.04; t <= 1; t += 0.04) {
    const c = mix(fg, dest, t);
    if (contrastRatio(c, bg) >= target) return c;
  }
  return toHex(parseHex(dest));
}

/* ---------- palettes ---------- */

const STATUS = {
  dark: { ok: '#5DD39E', warn: '#F2B544', err: '#FF6B5E', info: '#8AB4F8' },
  light: { ok: '#1E7A4C', warn: '#9A5B00', err: '#C2352B', info: '#2F5FB3' },
};

const SHADOWS = {
  dark: {
    '--b-shadow-1': '0 1px 0 rgba(255,255,255,.04) inset, 0 1px 2px rgba(0,0,0,.5)',
    '--b-shadow-2': '0 1px 0 rgba(255,255,255,.05) inset, 0 12px 32px -12px rgba(0,0,0,.7)',
    '--b-shadow-3': '0 -1px 0 rgba(255,255,255,.06) inset, 0 32px 80px -24px rgba(0,0,0,.85)',
  },
  light: {
    '--b-shadow-1': '0 1px 2px rgba(20,18,14,.06), 0 0 0 1px rgba(20,18,14,.02)',
    '--b-shadow-2': '0 2px 4px rgba(20,18,14,.04), 0 14px 32px -14px rgba(20,18,14,.18)',
    '--b-shadow-3': '0 4px 12px rgba(20,18,14,.06), 0 36px 80px -24px rgba(20,18,14,.28)',
  },
};

/**
 * Derive the full --b-* palette from a business theme.
 * @param {{mode?:'light'|'dark', accent?:string, bg?:string, ink?:string,
 *          font?:string, radius?:number, logo_url?:string}} theme
 * @returns {Record<string,string>} CSS custom properties
 */
export function themeVars(theme = {}) {
  const mode = theme.mode === 'light' ? 'light' : 'dark';
  const light = mode === 'light';
  const bg = toHexOr(theme.bg, light ? '#F6F3EE' : '#0A0B0D');
  const ink = toHexOr(theme.ink, light ? '#151412' : '#EEEAE3');
  const accent = toHexOr(theme.accent, '#FF4A2B');

  const surface = light ? mix(bg, '#FFFFFF', 0.6) : mix(bg, ink, 0.05);
  const surface2 = light ? mix(bg, ink, 0.045) : mix(bg, ink, 0.09);
  const status = STATUS[mode];

  const vars = {
    '--b-bg': bg,
    '--b-surface': surface,
    '--b-surface-2': surface2,
    '--b-raise': light ? mix(bg, '#FFFFFF', 0.92) : mix(bg, ink, 0.15),
    '--b-ink': ink,
    '--b-ink-2': ensureContrast(mix(ink, bg, 0.24), bg, 7, ink),
    '--b-mut': ensureContrast(mix(ink, bg, 0.46), bg, 4.5, ink),
    '--b-line': rgba(ink, light ? 0.12 : 0.11),
    '--b-line-2': rgba(ink, light ? 0.22 : 0.2),
    '--b-accent': accent,
    '--b-accent-2': mix(accent, '#000000', 0.15),
    '--b-accent-ink': readableOn(accent),
    '--b-accent-text': ensureContrast(accent, bg, 4.5, ink),
    '--b-ok': ensureContrast(status.ok, bg, 4.5),
    '--b-warn': ensureContrast(status.warn, bg, 4.5),
    '--b-err': ensureContrast(status.err, bg, 4.5),
    '--b-info': ensureContrast(status.info, bg, 4.5),
    '--b-scrim': light ? 'rgba(20,18,14,.36)' : 'rgba(0,0,0,.62)',
    '--b-glass': rgba(bg, light ? 0.8 : 0.72),
    '--b-grain-opacity': light ? '.045' : '.032',
    ...SHADOWS[mode],
  };

  if (Number.isFinite(Number(theme.radius)) && theme.radius !== '' && theme.radius != null) {
    const r = Math.max(0, Math.min(28, Number(theme.radius)));
    vars['--b-radius-sm'] = `${Math.round(r * 0.66)}px`;
    vars['--b-radius'] = `${r}px`;
    vars['--b-radius-lg'] = `${Math.round(r * 1.5)}px`;
  }

  const f = findFont(theme.font);
  if (f) {
    const fam = `'${f.family}'`;
    const generic = f.kind === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif';
    vars['--b-font-d'] = `${fam}, ${AR_DISPLAY}, ${generic}`;
    if (f.role === 'both') vars['--b-font-b'] = `${fam}, ${AR_BODY}, system-ui, sans-serif`;
    // Display serifs carry their own optical rhythm; sans brands sit a touch heavier.
    vars['--b-display-weight'] = f.kind === 'serif' ? '500' : '600';
    vars['--b-display-track'] = f.kind === 'serif' ? '-0.01em' : '-0.025em';
  }

  const logo = safeUrl(theme.logo_url);
  if (logo) vars['--b-logo'] = `url("${logo}")`;
  return vars;
}

function toHexOr(v, fallback) {
  const c = parseHex(v);
  return c ? toHex(c) : fallback;
}

/** Only https: or same-origin paths, with no characters that could escape url("…"). */
function safeUrl(u) {
  if (typeof u !== 'string' || !u) return null;
  const s = u.trim();
  if (!/^(https:\/\/|\/(?!\/))/i.test(s)) return null;
  if (/["'()\\\s<>]/.test(s)) return null;
  return s;
}

/* Every property applyTheme may write, so switching themes cleans up after itself. */
const MANAGED = [
  '--b-bg', '--b-surface', '--b-surface-2', '--b-raise', '--b-accent-2', '--b-grain-opacity', '--b-ink', '--b-ink-2', '--b-mut', '--b-line', '--b-line-2',
  '--b-accent', '--b-accent-ink', '--b-accent-text', '--b-ok', '--b-warn', '--b-err', '--b-info',
  '--b-scrim', '--b-glass', '--b-shadow-1', '--b-shadow-2', '--b-shadow-3',
  '--b-radius-sm', '--b-radius', '--b-radius-lg', '--b-font-d', '--b-font-b',
  '--b-display-weight', '--b-display-track', '--b-logo',
];

/**
 * Apply a look to an element (usually <html>).
 * @param {HTMLElement} el
 * @param {{look?:'standard'|'custom', theme?:object}} opts
 * @returns {{name:string, mode:'light'|'dark', vars:Record<string,string>, font:object|null}}
 */
export function applyTheme(el, { look = 'standard', theme = {} } = {}) {
  const custom = look === 'custom';
  const mode = theme?.mode === 'light' ? 'light' : 'dark';
  const name = custom ? 'custom' : mode === 'light' ? 'signature-light' : 'signature';
  const vars = custom ? themeVars(theme || {}) : {};
  const font = custom ? findFont(theme?.font) : null;

  const target = el || (typeof document !== 'undefined' ? document.documentElement : null);
  if (target && target.style) {
    for (const k of MANAGED) target.style.removeProperty(k);
    for (const [k, v] of Object.entries(vars)) target.style.setProperty(k, v);
    target.setAttribute('data-theme', name);
    target.setAttribute('data-mode', mode);
    target.classList.add('b-scope');
    target.style.colorScheme = mode;
    if (font) loadFont(font.family);
    if (typeof document !== 'undefined' && target === document.documentElement) {
      const meta = document.querySelector('meta[name="theme-color"]');
      const bg = vars['--b-bg'] || (mode === 'light' ? '#F4F0EA' : '#08090B');
      if (meta) meta.setAttribute('content', bg);
    }
  }
  return { name, mode, vars, font };
}
