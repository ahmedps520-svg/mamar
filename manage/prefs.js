/* ==========================================================
   Device preferences: theme (auto / light / dark), the soft
   new-booking chime (WebAudio, off by default), install prompt.
   ========================================================== */

import { applyTheme } from '../platform/theme.js';
import { pref } from './core.js';

const THEME_KEY = 'mamar-manage-theme';
const CHIME_KEY = 'mamar-manage-chime';
const mq = window.matchMedia('(prefers-color-scheme: dark)');

export const themePref = () => {
  const v = pref.get(THEME_KEY, 'auto');
  return ['auto', 'light', 'dark'].includes(v) ? v : 'auto';
};

/** Signature light by day, Signature dark at night (following the device), unless overridden. */
export function applyMode() {
  const p = themePref();
  const mode = p === 'auto' ? (mq.matches ? 'dark' : 'light') : p;
  applyTheme(document.documentElement, { look: 'standard', theme: { mode } });
  return mode;
}
export function setThemePref(v) {
  pref.set(THEME_KEY, v === 'auto' ? null : v);
  applyMode();
}
mq.addEventListener('change', () => { if (themePref() === 'auto') applyMode(); });

/* ---------- chime ---------- */

let ac = null;
export const chimeOn = () => pref.get(CHIME_KEY) === '1';

function audio() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  } catch { return null; }
}

function play() {
  const c = audio();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime + 0.02;
  // Two soft sine notes (A5 → E6) with a slow release: calm, not an alarm.
  for (const [f, d] of [[880, 0], [1318.51, 0.14]]) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + d);
    g.gain.exponentialRampToValueAtTime(0.07, now + d + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, now + d + 1.1);
    o.connect(g).connect(c.destination);
    o.start(now + d);
    o.stop(now + d + 1.2);
  }
}

export function setChime(on) {
  pref.set(CHIME_KEY, on ? '1' : null);
  if (on) { audio(); setTimeout(play, 60); }
}
export function chime() { if (chimeOn()) play(); }
export const testChime = () => { audio(); setTimeout(play, 60); };

// Browsers only start audio after a gesture: wake the context on the first tap when the chime is on.
document.addEventListener('pointerdown', function wake() {
  if (chimeOn()) audio();
}, { passive: true });

/* ---------- install ---------- */

export const install = { evt: null };
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); install.evt = e; });
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
