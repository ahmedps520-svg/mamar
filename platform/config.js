// Mamar Booking — the only file to edit when going live (see platform/README.md).
// Everything here is public by design: the Supabase anon key and the VAPID public key are meant
// to ship to browsers. Secret keys (service role, Moyasar sk_, VAPID private) never go in this repo.

export const SUPABASE_URL = 'https://yhtcciquttbasylejhre.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_hMU-atpeUTNXpGos22q6Uw_iURR26sm';   // publishable key: public by design
export const VAPID_PUBLIC_KEY = '';      // not needed: the notify function generates its keys and serves the public one

export const SITE = 'https://mamar.site';
export const GITHUB_REPO = 'ahmedps520-svg/mamar';        // where /b/<name>/ pages are published
export const STUDIO = {
  whatsapp: '966559797724',
  email: 'contact@mamar.site',
};

// Pinned third-party scripts (exact versions, loaded only when needed).
export const VENDOR = {
  supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm',
  moyasarJs: 'https://cdn.moyasar.com/mpf/1.15.0/moyasar.js',
  moyasarCss: 'https://cdn.moyasar.com/mpf/1.15.0/moyasar.css',
  leafletJs: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  leafletCss: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
};

/** Where the platform itself is served from (works inside the embed iframe and on mamar.site). */
export const PLATFORM_ORIGIN = new URL(import.meta.url).origin;

/**
 * 'local' → the dev server (mamar/dev/server.js): PGlite + SSE, no accounts needed.
 * 'cloud' → Supabase. Local mode is automatic on localhost; ?api=cloud forces cloud for testing.
 */
export function backend() {
  const host = new URL(import.meta.url).hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  let force = null;
  try { force = new URLSearchParams(globalThis.location?.search || '').get('api'); } catch { /* not a browser */ }
  if (force === 'cloud' || force === 'local') return force;
  return isLocal ? 'local' : 'cloud';
}

export const cloudReady = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
