// Mamar Booking — one client for both backends. Every surface talks to the server only through
// rpc(name, args); the same Postgres functions answer locally (dev server) and on Supabase.
import { backend, cloudReady, PLATFORM_ORIGIN, SUPABASE_URL, SUPABASE_ANON_KEY, GITHUB_REPO } from './config.js';

export class ApiError extends Error {
  constructor(code, detail = null, status = 0) {
    super(code);
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

const SESSION_KEY = 'mamar-session';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(SESSION_KEY, JSON.stringify(v)) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ } },
};
const listeners = new Set();
const emit = () => { for (const f of listeners) { try { f(currentUser()); } catch { /* listener bug */ } } };

export const mode = () => backend();

// ───────────── RPC ─────────────

/** Call a server function: rpc('pub_slots', {service_id, day}). Throws ApiError(code). */
export async function rpc(name, args = {}, { retried = false } = {}) {
  const s = store.get();
  let res;
  try {
    if (backend() === 'local') {
      res = await fetch(`${PLATFORM_ORIGIN}/api/rpc/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(s?.access_token ? { authorization: `Bearer ${s.access_token}` } : {}) },
        body: JSON.stringify(args ?? {}),
      });
    } else {
      if (!cloudReady()) throw new ApiError('NOT_CONFIGURED');
      if (s?.refresh_token && s.expires_at && s.expires_at - 60 < Date.now() / 1000 && !retried) await refresh();
      const tok = store.get()?.access_token;
      res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        // A publishable key is not a JWT: send it as apikey only, and Authorization only for a signed-in user.
        headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ p: args ?? {} }),
      });
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('NETWORK', e?.message);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.ok) return data;

  // Expired session on Supabase → refresh once and retry.
  if (backend() === 'cloud' && res.status === 401 && !retried && store.get()?.refresh_token) {
    if (await refresh()) return rpc(name, args, { retried: true });
  }
  throw toError(res.status, data);
}

function toError(status, data) {
  if (data && typeof data === 'object') {
    if (data.code === 'P0001') {                     // our _err(): message is the stable code
      let detail = data.details || null;
      try { detail = detail ? JSON.parse(detail) : null; } catch { /* plain text */ }
      return new ApiError(data.message, detail, status);
    }
    if (data.code === '42501' || status === 401 || status === 403) return new ApiError('NOT_ALLOWED', null, status);
    if (data.code === 'PGRST202' || data.code === '42883') return new ApiError('NOT_FOUND', null, status);
    if (typeof data.code === 'string' && /^[A-Z_]+$/.test(data.code)) return new ApiError(data.code, data.detail ?? null, status);
  }
  return new ApiError(status >= 500 ? 'SERVER_ERROR' : 'BAD_INPUT', data, status);
}

/** i18n key for an error: t(errorKey(e)) → "That time was just taken…" */
export const errorKey = (e) => `err.${(e && e.code) || 'SERVER_ERROR'}`;

// ───────────── auth (owners and Ahmed) ─────────────

/** Owners can type a short username; it maps to <username>@owners.mamar.site. */
export const toEmail = (id) => {
  const v = String(id || '').trim().toLowerCase();
  return v.includes('@') ? v : `${v}@owners.mamar.site`;
};

export async function signIn(identifier, password) {
  let s;
  if (backend() === 'local') {
    const r = await fetch(`${PLATFORM_ORIGIN}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: toEmail(identifier), password }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(d.code || 'BAD_LOGIN', null, r.status);
    s = { access_token: d.access_token, expires_at: d.expires_at, user: d.user };
  } else {
    if (!cloudReady()) throw new ApiError('NOT_CONFIGURED');
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: toEmail(identifier), password }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError('BAD_LOGIN', null, r.status);
    s = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at
      || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: { id: d.user?.id, email: d.user?.email } };
  }
  store.set(s);
  emit();
  return s.user;
}

async function refresh() {
  const s = store.get();
  if (!s?.refresh_token) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) { store.set(null); emit(); return false; }
    const d = await r.json();
    store.set({ ...s, access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
    return true;
  } catch { return false; }
}

// ───────────── sign in with an emailed link (cloud) ─────────────

/** Email a one-time sign-in link. The first sign-in creates the login; nobody sets a password. */
export async function sendMagicLink(email, returnPath) {
  const addr = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new ApiError('BAD_EMAIL');
  if (backend() === 'local') throw new ApiError('LOCAL_PASSWORD');
  if (!cloudReady()) throw new ApiError('NOT_CONFIGURED');
  const back = new URL(returnPath || location.pathname, location.origin).href;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(back)}`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: addr, create_user: true }),
  });
  if (r.status === 429) throw new ApiError('RATE_LIMITED', null, 429);
  if (!r.ok) throw new ApiError('SERVER_ERROR', await r.text().catch(() => null), r.status);
  return true;
}

/** Set when the emailed link came back with an error (expired / already used). */
export let authRedirectError = null;

// The emailed link returns here as #access_token=…&refresh_token=…; store the session and clean the URL
// before any router reads the hash. Runs once, synchronously, when api.js is first imported.
(function consumeAuthRedirect() {
  try {
    const hash = globalThis.location?.hash || '';
    if (!/(^#|&)(access_token|error_code)=/.test(hash)) return;
    const q = new URLSearchParams(hash.slice(1));
    if (q.get('error_code') || q.get('error')) {
      authRedirectError = q.get('error_code') || q.get('error');
    } else {
      const at = q.get('access_token');
      const claims = JSON.parse(atob(at.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      store.set({ access_token: at, refresh_token: q.get('refresh_token'),
        expires_at: +q.get('expires_at') || Math.floor(Date.now() / 1000) + (+q.get('expires_in') || 3600),
        user: { id: claims.sub, email: claims.email } });
    }
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* not a browser, or a malformed link */ }
})();

export function signOut() {
  const s = store.get();
  if (backend() === 'cloud' && s?.access_token && cloudReady()) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  }
  store.set(null);
  emit();
}

export function currentUser() {
  const s = store.get();
  if (!s?.access_token) return null;
  if (backend() === 'local' && s.expires_at && s.expires_at < Date.now() / 1000) { store.set(null); return null; }
  return s.user || null;
}
export const accessToken = () => store.get()?.access_token || null;
export function onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

// ───────────── admin helpers ─────────────

/**
 * Create a login for an owner. Locally the dev server does it. On Supabase this must happen in
 * Dashboard → Authentication → Add user (needs the service key, which never reaches a browser);
 * the admin then calls rpc('adm_attach_owner', {business_id, email}).
 */
export async function adminCreateUser(email, password) {
  if (backend() !== 'local') throw new ApiError('USE_DASHBOARD');
  const r = await fetch(`${PLATFORM_ORIGIN}/api/admin/users`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken()}` },
    body: JSON.stringify({ email: toEmail(email), password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(d.code || 'SERVER_ERROR', d.detail, r.status);
  return d;
}

/** Upload a logo; returns its public URL. */
export async function uploadLogo(file, businessId) {
  if (backend() === 'local') {
    const r = await fetch(`${PLATFORM_ORIGIN}/api/upload`, {
      method: 'POST', headers: { 'content-type': file.type, authorization: `Bearer ${accessToken()}` }, body: file,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(d.code || 'SERVER_ERROR', null, r.status);
    return new URL(d.url, PLATFORM_ORIGIN).href;
  }
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' })[file.type];
  if (!ext) throw new ApiError('BAD_INPUT');
  const key = `${businessId}/${Date.now()}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/logos/${key}`, {
    method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken()}`, 'content-type': file.type, 'x-upsert': 'true' },
    body: file,
  });
  if (!r.ok) throw new ApiError('UPLOAD_FAILED', null, r.status);
  return `${SUPABASE_URL}/storage/v1/object/public/logos/${key}`;
}

const GH_KEY = 'mamar-gh-token';
export const githubToken = {
  get() { try { return localStorage.getItem(GH_KEY) || ''; } catch { return ''; } },
  set(v) { try { v ? localStorage.setItem(GH_KEY, v) : localStorage.removeItem(GH_KEY); } catch { /* private mode */ } },
};

/** Publish mamar.site/b/<slug>/index.html (link previews). Local: the dev server writes it. */
export async function publishLinkPage(slug, html) {
  if (backend() === 'local') {
    const r = await fetch(`${PLATFORM_ORIGIN}/api/admin/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken()}` },
      body: JSON.stringify({ slug, html }),
    });
    if (!r.ok) throw new ApiError('PUBLISH_FAILED', null, r.status);
    return { ok: true };
  }
  const token = githubToken.get();
  if (!token) throw new ApiError('NO_GITHUB_TOKEN');
  const path = `b/${slug}/index.html`;
  const base = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const cur = await fetch(base, { headers });
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const content = btoa(String.fromCharCode(...new TextEncoder().encode(html)));
  const r = await fetch(base, {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ message: `Booking link page for ${slug}`, content, ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw new ApiError('PUBLISH_FAILED', await r.text(), r.status);
  return { ok: true };
}

// ───────────── local-only demo payment ─────────────

/** Stands in for Moyasar on the dev server. outcome: 'paid' | 'failed'. */
export async function demoPay(booking_id, token, outcome = 'paid') {
  if (backend() !== 'local') throw new ApiError('NOT_ALLOWED');
  const r = await fetch(`${PLATFORM_ORIGIN}/api/dev/pay`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ booking_id, token, outcome }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(d.code || 'SERVER_ERROR', null, r.status);
  return d;
}

/** Verify a real Moyasar payment through the `moyasar` Edge Function (cloud only). */
export async function verifyPayment(booking_id, token, moyasar_id) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/moyasar`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ booking_id, token, moyasar_id }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(d.code || 'SERVER_ERROR', null, r.status);
  return d;
}

/**
 * Admin only: send one test email right now to the NOTIFY_EMAIL address.
 * Resolves { ok, to, from, id } or rejects with ApiError('EMAIL_FAILED', resendMessage).
 */
export async function sendTestEmail() {
  let r;
  if (backend() === 'local') {
    r = await fetch(`${PLATFORM_ORIGIN}/api/admin/test-email`, {
      method: 'POST', headers: { authorization: `Bearer ${accessToken()}` },
    });
  } else {
    r = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken()}` },
      body: JSON.stringify({ action: 'test_email' }),
    });
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 403) throw new ApiError('NOT_ALLOWED', null, 403);
  if (!r.ok || !d.ok) throw new ApiError('EMAIL_FAILED', d.error || `HTTP ${r.status}`, r.status);
  return d;
}

/** Public VAPID key for Web Push (local server generates its own). */
export async function vapidPublicKey() {
  if (backend() === 'local') {
    const r = await fetch(`${PLATFORM_ORIGIN}/api/config`);
    return (await r.json()).vapid_public;
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/notify?vapid=1`, { headers: { apikey: SUPABASE_ANON_KEY } });
  if (!r.ok) throw new ApiError('NOT_CONFIGURED', null, r.status);
  return (await r.json()).vapid_public;
}
