// Real-concurrency check against Supabase (run once after going live):
//   node scripts/race.mjs https://<project>.supabase.co <anon-key> [service_id] [start ISO]
// Fires 30 bookings at the same slot in parallel. With the demo karting service (10 karts, party of 1)
// exactly 10 must succeed and 20 must get SLOT_TAKEN — proof the database refuses double booking
// under real parallel load (PGlite locally runs one transaction at a time, so it can't prove this).
const [url, key, service = '5d000000-0000-4000-8000-000000000021', startArg] = process.argv.slice(2);
if (!url || !key) { console.log('usage: node scripts/race.mjs <supabase-url> <anon-key> [service_id] [start]'); process.exit(1); }

const call = (name, p) => fetch(`${url}/rest/v1/rpc/${name}`, {
  method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ p }),
}).then(async (r) => ({ ok: r.ok, body: await r.json() }));

let start = startArg;
if (!start) {
  const days = (await call('pub_days', { service_id: service })).body.days.filter((d) => d.n > 0);
  const slots = (await call('pub_slots', { service_id: service, day: days[days.length - 1].day })).body.slots;
  start = slots[0].t;
}
console.log('slot', start);
const results = await Promise.all(Array.from({ length: 30 }, (_, i) => call('pub_book', {
  service_id: service, start, name: `Race ${i}`, phone: `+9665${String(10000000 + i).padStart(8, '0')}`, source: 'web',
})));
const ok = results.filter((r) => r.ok).length;
const taken = results.filter((r) => !r.ok && r.body?.message === 'SLOT_TAKEN').length;
console.log(`succeeded ${ok} · SLOT_TAKEN ${taken} · other ${30 - ok - taken}`);
console.log('Cancel these test bookings from the owner dashboard (filter by name "Race").');
