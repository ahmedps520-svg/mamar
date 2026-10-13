// Mamar admin — things that belong to this device: the chime, Web Push, the app badge.
import { rpc, vapidPublicKey, ApiError } from '../platform/api.js';

/* ---------- chime (WebAudio, a soft two-note bell) ---------- */

const CHIME_KEY = 'mamar-admin-chime';
let ctx = null;

export function chimeOn() {
  try { return localStorage.getItem(CHIME_KEY) !== 'off'; } catch { return true; }
}
export function setChime(on) {
  try { localStorage.setItem(CHIME_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

/** Browsers only allow audio after a tap: create the context on the first one. */
export function primeAudio() {
  const unlock = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch { /* no audio on this device */ }
  };
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, unlock, { capture: true, passive: true });
}

/** Play the chime (silently does nothing before the first tap or when turned off). */
export function chime({ force = false } = {}) {
  if (!force && !chimeOn()) return;
  if (!ctx || ctx.state === 'closed') return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.value = 0.22;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    out.connect(lp).connect(ctx.destination);
    // E6 then B5: a small, warm "ding-dong" with a soft octave partial.
    [[1318.5, 0], [987.8, 0.16]].forEach(([f, dt]) => {
      for (const [mult, amp, len] of [[1, 1, 1.4], [2, 0.18, 0.6], [3.01, 0.06, 0.3]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0.0001, t0 + dt);
        g.gain.exponentialRampToValueAtTime(amp, t0 + dt + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + len);
        o.connect(g).connect(out);
        o.start(t0 + dt);
        o.stop(t0 + dt + len + 0.05);
      }
    });
  } catch { /* audio unavailable */ }
}

/* ---------- service worker + Web Push ---------- */

export const swSupported = () => 'serviceWorker' in navigator;
export const pushSupported = () => swSupported() && 'PushManager' in window && 'Notification' in window;
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function registerSW() {
  if (!swSupported()) return Promise.resolve(null);
  return navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => null);
}

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/admin/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** 'unsupported' | 'denied' | 'on' | 'off' */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await currentSubscription().catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function save(sub, lang) {
  const j = sub.toJSON();
  await rpc('own_push_subscribe', { endpoint: j.endpoint, keys: j.keys, lang, ua: navigator.userAgent.slice(0, 200) });
}

/** Ask permission, subscribe with the server's VAPID key and register the endpoint. */
export async function subscribePush(lang) {
  if (!pushSupported()) throw new ApiError('PUSH_UNSUPPORTED');
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw new ApiError('PUSH_DENIED');
  await registerSW();
  const reg = await navigator.serviceWorker.ready;
  const key = await vapidPublicKey();
  if (!key) throw new ApiError('NOT_CONFIGURED');
  const appKey = urlBase64ToUint8Array(key);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older key can't be reused.
  if (sub && sub.options?.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    if (old.length !== appKey.length || old.some((v, i) => v !== appKey[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    } catch (e) {
      throw new ApiError('PUSH_FAILED', e?.message || String(e));
    }
  }
  await save(sub, lang);
  return sub;
}

/** Keep the server's copy in the current language (pushes arrive in it). */
export async function refreshPushLang(lang) {
  const sub = await currentSubscription().catch(() => null);
  if (sub && Notification.permission === 'granted') await save(sub, lang).catch(() => {});
}

export async function unsubscribePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await rpc('own_push_unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/* ---------- app icon badge ---------- */

export function setAppBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* unsupported */ }
}
