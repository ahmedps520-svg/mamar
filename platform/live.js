// Mamar Booking — the live doorbell. The database bumps a version counter whenever a business's
// catalogue (prices, offers, services) or slots (bookings, blocks) change; listeners re-fetch.
//   const stop = live(businessId, ({catalog, slots, admin}) => refresh())
//   live('admin', …) listens to Ahmed's channel (new setup requests, notifications).
// Local: one shared EventSource to the dev server. Cloud: Supabase Realtime on live_pings,
// with a 30 s polling fallback and a refresh whenever the tab becomes visible again.
import { backend, cloudReady, PLATFORM_ORIGIN, SUPABASE_URL, SUPABASE_ANON_KEY, VENDOR } from './config.js';
import { rpc } from './api.js';

export const ADMIN_CHANNEL = '00000000-0000-0000-0000-000000000000';
const topics = new Map();          // id → Set<callback>
let es = null;
let sb = null;

function dispatch(id, kinds) {
  const set = topics.get(id);
  if (!set) return;
  for (const cb of set) {
    clearTimeout(cb._t);
    cb._kinds = { ...(cb._kinds || {}), ...kinds };
    cb._t = setTimeout(() => { const k = cb._kinds; cb._kinds = null; try { cb(k); } catch (e) { console.error(e); } }, 200);
  }
}

function ensureLocal() {
  if (es) return;
  es = new EventSource(`${PLATFORM_ORIGIN}/api/live`);
  es.addEventListener('ping', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    const kinds = m.k === 'both' ? { catalog: true, slots: true } : { [m.k]: true };
    dispatch(m.b, kinds);
  });
}

async function ensureCloud(id) {
  if (!cloudReady()) return;
  if (!sb) {
    const { createClient } = await import(VENDOR.supabase);
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  }
  const last = { catalog: null, slots: null, admin: null };
  const ch = sb.channel(`live-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_pings', filter: `business_id=eq.${id}` }, (payload) => {
      const row = payload.new || {};
      const kinds = {
        catalog: last.catalog !== null && row.catalog_v !== last.catalog,
        slots: last.slots !== null && row.slots_v !== last.slots,
        admin: last.admin !== null && row.admin_v !== last.admin,
      };
      if (last.catalog === null) Object.assign(kinds, { catalog: true, slots: true, admin: true });
      last.catalog = row.catalog_v; last.slots = row.slots_v; last.admin = row.admin_v;
      dispatch(id, kinds);
    })
    .subscribe();
  return () => sb.removeChannel(ch);
}

function poller(id) {
  let prev = null;
  const tick = async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const v = await rpc('pub_live', { business_id: id });
      if (prev) {
        const kinds = { catalog: v.catalog !== prev.catalog, slots: v.slots !== prev.slots, admin: v.admin !== prev.admin };
        if (kinds.catalog || kinds.slots || kinds.admin) dispatch(id, kinds);
      }
      prev = v;
    } catch { /* offline: try again next tick */ }
  };
  tick();
  const iv = setInterval(tick, backend() === 'local' ? 60000 : 30000);
  // Re-check when the tab comes back — but only after a real absence (some browsers flicker visibility).
  let hiddenAt = 0;
  const vis = () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt > 3000) tick();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', vis);
  return () => { clearInterval(iv); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', vis); };
}

/** Listen for changes to one business (or 'admin'). Returns a stop() function. */
export function live(businessId, cb) {
  const id = businessId === 'admin' ? ADMIN_CHANNEL : businessId;
  if (!id) return () => {};
  if (!topics.has(id)) topics.set(id, new Set());
  topics.get(id).add(cb);
  const stops = [poller(id)];
  if (backend() === 'local') ensureLocal();
  else ensureCloud(id).then((s) => s && stops.push(s)).catch(() => {});
  return () => {
    topics.get(id)?.delete(cb);
    for (const s of stops) s();
  };
}
