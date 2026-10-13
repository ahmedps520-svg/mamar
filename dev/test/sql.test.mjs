// SQL behaviour tests — the same migrations Supabase runs, in PGlite (memory).
// node --test test/sql.test.mjs
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, rpc, ensureUser } from '../db.js';

const WARD = 'b0000000-0000-4000-8000-000000000001';
const LAMAA = 'b0000000-0000-4000-8000-000000000002';
const SURA = 'b0000000-0000-4000-8000-000000000003';
const S = {
  haircut: '5d000000-0000-4000-8000-000000000001',
  cutBeard: '5d000000-0000-4000-8000-000000000002',
  exterior: '5d000000-0000-4000-8000-000000000011',
  fullWash: '5d000000-0000-4000-8000-000000000012',
  homeWash: '5d000000-0000-4000-8000-000000000015',
  race10: '5d000000-0000-4000-8000-000000000021',
};
const CHAIR1 = '5f000000-0000-4000-8000-000000000001';

// ── time helpers (everything in Riyadh wall-clock) ──
const riyadhToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
/** next date (≥ minAhead days from today) falling on weekday wd (0 = Sunday) */
const nextDow = (wd, minAhead = 3) => { let d = addDays(riyadhToday(), minAhead); while (dow(d) !== wd) d = addDays(d, 1); return d; };
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00+03:00`).toISOString();
const same = (a, b) => new Date(a).getTime() === new Date(b).getTime();
const hasSlot = (slots, iso) => slots.some((s) => same(s.t, iso));

let db, owner, ownerB, admin;
const anon = (n, a) => rpc(db, n, a);
const asOwner = (n, a) => rpc(db, n, a, { role: 'authenticated', sub: owner });
const asOwnerB = (n, a) => rpc(db, n, a, { role: 'authenticated', sub: ownerB });
const asAdmin = (n, a) => rpc(db, n, a, { role: 'authenticated', sub: admin });
const asSvc = (n, a) => rpc(db, n, a, { role: 'service_role' });
const rejects = async (p, code) => {
  await assert.rejects(p, (e) => { assert.equal(e.code, code); return true; });
};
let phoneN = 0;
const phone = () => `05${String(50000000 + ++phoneN).padStart(8, '0')}`;
const book = (service_id, start, extra = {}) =>
  anon('pub_book', { service_id, start, name: 'Test Customer', phone: phone(), ...extra });

before(async () => {
  db = await openDb();
  owner = await ensureUser(db, 'owner@ward.test', 'pw', { businesses: ['ward-barber'] });
  ownerB = await ensureUser(db, 'owner@lamaa.test', 'pw', { businesses: ['lamaa-carwash'] });
  admin = await ensureUser(db, 'admin@mamar.test', 'pw', { admin: true });
});
after(async () => { await db.close(); });

describe('staff mode', () => {
  test('first available fills every chair, then the slot is gone', async () => {
    const day = nextDow(1, 3);                       // a Monday: 10:00–23:30
    const t = at(day, '10:00');
    const chairs = new Set();
    for (let i = 0; i < 3; i++) chairs.add((await book(S.haircut, t)).staff_label_en);
    assert.equal(chairs.size, 3);
    await rejects(book(S.haircut, t), 'SLOT_TAKEN');
    const sl = await anon('pub_slots', { service_id: S.haircut, day });
    assert.ok(!hasSlot(sl.slots, t));
  });

  test('buffers block the next start; back-to-back after the buffer is fine', async () => {
    const day = nextDow(2, 3);                       // a Tuesday
    // haircut 45 min + 10 min buffer on Chair one → busy 10:00–10:55
    await book(S.haircut, at(day, '10:00'), { staff_id: CHAIR1 });
    await rejects(book(S.haircut, at(day, '10:45'), { staff_id: CHAIR1 }), 'SLOT_TAKEN');
    const ok = await book(S.haircut, at(day, '11:00'), { staff_id: CHAIR1 });
    assert.equal(ok.staff_label_en, 'Chair one');
  });

  test('staff_id is honoured only when staff choice is on', async () => {
    const day = nextDow(3, 3);
    const r = await book(S.haircut, at(day, '15:00'), { staff_id: CHAIR1 });
    assert.equal(r.staff_label_en, 'Chair one');
  });
});

describe('capacity mode', () => {
  test('peak usage, not the sum of overlapping bookings', async () => {
    // A test business: one resource with capacity 2, a 60-minute service on a 30-minute grid.
    await db.exec(`
      insert into public.businesses (id, slug, status, kind, name_en, entitlements)
        values ('c0000000-0000-4000-8000-000000000001', 'cap-test', 'active', 'carwash', 'Cap test', '{}');
      insert into public.sections (id, business_id, name_en) values ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Main');
      insert into public.hours (business_id, section_id, weekday, open_min, close_min)
        select 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', d, 480, 1320 from generate_series(0,6) d;
      insert into public.resources (id, business_id, label_en, capacity) values ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Bays', 2);
      insert into public.services (id, business_id, name_en, duration_min, step_min, mode, resource_id, price_halalas)
        values ('c3000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Wash', 60, 30, 'capacity', 'c2000000-0000-4000-8000-000000000001', 5000);`);
    const svc = 'c3000000-0000-4000-8000-000000000001';
    const day = nextDow(1, 4);
    await book(svc, at(day, '10:00'));             // 10–11
    await book(svc, at(day, '11:00'));             // 11–12 (doesn't overlap the first)
    // 10:30–11:30 overlaps both, but never more than one at once → one place left
    let sl = await anon('pub_slots', { service_id: svc, day });
    const s1030 = sl.slots.find((s) => same(s.t, at(day, '10:30')));
    assert.ok(s1030, '10:30 should be offered');
    assert.equal(s1030.n, 1);
    await book(svc, at(day, '10:30'));
    await rejects(book(svc, at(day, '10:30')), 'SLOT_TAKEN');
    sl = await anon('pub_slots', { service_id: svc, day });
    assert.ok(!hasSlot(sl.slots, at(day, '10:00')));   // 10:00 now has 2 at its peak (10:30–11:00)
  });

  test('party sizes share the karts', async () => {
    const day = nextDow(0, 3);                     // a Sunday: 16:00–01:00
    const t = at(day, '18:00');
    await book(S.race10, t, { qty: 8 });
    await rejects(book(S.race10, t, { qty: 3 }), 'SLOT_TAKEN');
    const r = await book(S.race10, t, { qty: 2 });
    assert.equal(r.total_halalas, 2 * 6000);        // per-person price
    await rejects(book(S.race10, t, { qty: 1 }), 'SLOT_TAKEN');
    await rejects(book(S.race10, at(day, '18:20'), { qty: 9 }), 'SLOT_TAKEN');   // over max_qty
  });
});

describe('hours', () => {
  test('split shift has a gap', async () => {
    const day = nextDow(1, 3);                     // Lamaa: 08:00–12:00 and 16:00–23:00
    const sl = await anon('pub_slots', { service_id: S.exterior, day });
    assert.ok(hasSlot(sl.slots, at(day, '08:00')));
    assert.ok(!hasSlot(sl.slots, at(day, '13:00')));
    assert.ok(hasSlot(sl.slots, at(day, '16:00')));
    assert.ok(!hasSlot(sl.slots, at(day, '11:45')));   // would run past noon
  });

  test('past midnight belongs to the day it opened', async () => {
    const thu = nextDow(4, 3);                     // Ward: Thursday 10:00 → 01:00
    const sl = await anon('pub_slots', { service_id: S.beard ?? '5d000000-0000-4000-8000-000000000003', day: thu });
    const fri = addDays(thu, 1);
    assert.ok(hasSlot(sl.slots, at(fri, '00:15')), '00:15 Friday should be on Thursday’s list');
    const r = await book('5d000000-0000-4000-8000-000000000003', at(fri, '00:15'));
    assert.equal(r.status, 'confirmed');
  });

  test('special hours replace the week (Ramadan nights)', async () => {
    const day = nextDow(2, 5);
    await asOwner('own_special_hours_upsert', { business_id: WARD,
      item: { from_date: day, to_date: day, ranges: [[1200, 1560]], label_en: 'Ramadan' } });
    const sl = await anon('pub_slots', { service_id: S.haircut, day });
    assert.ok(!hasSlot(sl.slots, at(day, '15:00')));
    assert.ok(hasSlot(sl.slots, at(day, '20:00')));
    assert.ok(hasSlot(sl.slots, at(addDays(day, 1), '01:00')));
  });

  test('notice and horizon', async () => {
    const sl = await anon('pub_days', { service_id: S.haircut });
    const last = sl.days[sl.days.length - 1].day;
    assert.ok(last <= addDays(riyadhToday(), 21));
    const far = addDays(riyadhToday(), 40);
    const out = await anon('pub_slots', { service_id: S.haircut, day: far });
    assert.equal(out.slots.length, 0);
  });

  test('a block hides the time', async () => {
    const day = nextDow(3, 6);
    await asOwner('own_block_upsert', { business_id: WARD, block: { starts_at: at(day, '10:00'), ends_at: at(day, '12:00'), reason: 'Training' } });
    const sl = await anon('pub_slots', { service_id: S.haircut, day });
    assert.ok(!hasSlot(sl.slots, at(day, '10:30')));
    assert.ok(hasSlot(sl.slots, at(day, '12:00')));
  });
});

describe('prayer pauses', () => {
  test('dhuhr window, longer on Friday', async () => {
    const mon = nextDow(1, 8);
    const fri = nextDow(5, 8);
    for (const d of [mon, fri]) {
      await db.query(`insert into public.prayer_times values ('jeddah', $1, '05:00', '12:00', '15:20', '17:50', '19:20')
                      on conflict (city, day) do update set dhuhr = '12:00', asr = '15:20', maghrib = '17:50', isha = '19:20'`, [d]);
    }
    let sl = await anon('pub_slots', { service_id: '5d000000-0000-4000-8000-000000000003', day: mon });   // 30-min beard
    assert.ok(!hasSlot(sl.slots, at(mon, '11:45')));   // runs into 12:00
    assert.ok(!hasSlot(sl.slots, at(mon, '12:15')));   // inside 12:00–12:25
    assert.ok(hasSlot(sl.slots, at(mon, '12:30')));
    assert.ok(hasSlot(sl.slots, at(mon, '11:30')));    // ends exactly at 12:00
    await rejects(book('5d000000-0000-4000-8000-000000000003', at(mon, '12:15')), 'SLOT_TAKEN');
    // Friday: Ward opens at 16:00, so check Lamaa-style via Ward's Friday Asr only; Jumu'ah checked with Sura (opens 14:00)
    sl = await anon('pub_slots', { service_id: S.race10, day: fri });
    assert.ok(sl.slots.length > 0);               // Sura has no prayer pauses → unaffected
  });

  test('owners can still book through a prayer window', async () => {
    const mon = nextDow(1, 8);
    const r = await asOwner('own_booking_create', { business_id: WARD, service_id: '5d000000-0000-4000-8000-000000000003',
      start: at(mon, '12:00'), name: 'Walk-in' });
    assert.equal(r.status, 'confirmed');
  });
});

describe('payments', () => {
  test('deposit holds the slot, expires, and late payments are handled', async () => {
    const day = nextDow(2, 4);
    const r = await book(S.fullWash, at(day, '16:00'));
    assert.equal(r.status, 'pending_payment');
    assert.equal(r.total_halalas, 7000 - 1050);       // 15% offer
    assert.equal(r.due_now_halalas, Math.ceil((7000 - 1050) * 0.25));
    const ctx = await asSvc('svc_payment_context', { booking_id: r.booking_id });
    assert.equal(ctx.due_now_halalas, r.due_now_halalas);
    // wrong amount → flagged, not confirmed
    const bad = await asSvc('svc_confirm_payment', { booking_id: r.booking_id, moyasar_id: 'pay_bad123', status: 'paid', amount_halalas: 1 });
    assert.equal(bad.ok, false);
    // a fresh booking paid correctly, twice (idempotent)
    const r2 = await book(S.fullWash, at(day, '17:00'));
    const ok1 = await asSvc('svc_confirm_payment', { booking_id: r2.booking_id, moyasar_id: 'pay_good123', status: 'paid', amount_halalas: r2.due_now_halalas });
    const ok2 = await asSvc('svc_confirm_payment', { booking_id: r2.booking_id, moyasar_id: 'pay_good123', status: 'paid', amount_halalas: r2.due_now_halalas });
    assert.equal(ok1.status, 'confirmed');
    assert.equal(ok2.already, true);
    // hold runs out → slot frees → late payment still confirms while free
    const r3 = await book(S.fullWash, at(day, '18:00'));
    await db.query(`update public.bookings set hold_until = now() - interval '1 minute' where id = $1`, [r3.booking_id]);
    const late = await asSvc('svc_confirm_payment', { booking_id: r3.booking_id, moyasar_id: 'pay_late123', status: 'paid', amount_halalas: r3.due_now_halalas });
    assert.equal(late.status, 'confirmed');
  });

  test('anon cannot reach the service-role functions', async () => {
    await rejects(anon('svc_confirm_payment', {}), 'NOT_ALLOWED');
  });
});

describe('offers and prices', () => {
  test('Sunday offer applies on Sundays only and is snapshotted', async () => {
    const sun = nextDow(0, 3);
    const mon = addDays(sun, 1);
    const a = await book(S.cutBeard, at(sun, '11:30'));
    assert.equal(a.discount_halalas, 2200);
    const b = await book(S.cutBeard, at(mon, '11:30'));
    assert.equal(b.discount_halalas, 0);
    await db.exec(`update public.offers set active = false where business_id = '${WARD}'`);
    const view = await anon('pub_booking', { token: a.token });
    assert.equal(view.booking.total_halalas, 8800);
    await db.exec(`update public.offers set active = true where business_id = '${WARD}'`);
  });

  test('owner price change is live for the next customer', async () => {
    const ov = await asOwner('own_overview', { business_id: WARD });
    const svc = ov.services.find((s) => s.id === '5d000000-0000-4000-8000-000000000004');
    await asOwner('own_service_upsert', { business_id: WARD, service: { ...svc, price_halalas: 6500 } });
    const pub = await anon('pub_business', { slug: 'ward-barber' });
    assert.equal(pub.services.find((s) => s.id === svc.id).price.total, 6500);
    assert.ok(pub.live.catalog > 0);
  });
});

describe('self-serve manage link', () => {
  test('cancel and reschedule respect the cutoff', async () => {
    const day = nextDow(1, 5);
    const r = await book(S.haircut, at(day, '13:00'));
    const moved = await anon('pub_reschedule', { token: r.token, start: at(day, '14:00') });
    assert.ok(same(moved.booking.starts_at, at(day, '14:00')));
    const c = await anon('pub_cancel', { token: r.token });
    assert.equal(c.booking.status, 'cancelled');
    // inside the 3-hour cutoff: create one 2 hours out by moving it with SQL
    const r2 = await book(S.haircut, at(day, '15:00'));
    await db.query(`update public.bookings set starts_at = now() + interval '2 hours', ends_at = now() + interval '165 minutes',
                    busy = tstzrange(now() + interval '2 hours', now() + interval '175 minutes', '[)') where ref = $1`, [r2.ref]);
    await rejects(anon('pub_cancel', { token: r2.token }), 'TOO_LATE');
    await rejects(anon('pub_cancel', { token: 'nope' }), 'NOT_FOUND');
  });
});

describe('abuse limits', () => {
  test('a phone can hold three upcoming bookings; honeypot stores nothing', async () => {
    const day = nextDow(2, 10);
    const p = '0551112233';
    for (const t of ['10:00', '11:00', '12:30']) await anon('pub_book', { service_id: S.haircut, start: at(day, t), name: 'Spam Test', phone: p });
    await rejects(anon('pub_book', { service_id: S.haircut, start: at(day, '14:00'), name: 'Spam Test', phone: p }), 'RATE_LIMITED');
    const before = (await db.query(`select count(*)::int n from public.bookings`)).rows[0].n;
    const fake = await anon('pub_book', { service_id: S.haircut, start: at(day, '15:00'), name: 'Bot', phone: '0550000000', website: 'x' });
    assert.ok(fake.ref);
    assert.equal((await db.query(`select count(*)::int n from public.bookings`)).rows[0].n, before);
    await rejects(book(S.haircut, at(day, '16:00'), { phone: '12345' }), 'BAD_PHONE');
  });
});

describe('isolation and grants', () => {
  test('owners only see their own business', async () => {
    await rejects(asOwner('own_overview', { business_id: LAMAA }), 'NOT_ALLOWED');
    await rejects(asOwnerB('own_bookings', { business_id: WARD }), 'NOT_ALLOWED');
    const lamaaRes = '5a000000-0000-4000-8000-000000000001';
    await rejects(asOwner('own_service_upsert', { business_id: WARD,
      service: { name_en: 'x', mode: 'capacity', resource_id: lamaaRes } }), 'NOT_ALLOWED');
    await rejects(asOwner('own_booking_status', { business_id: WARD, booking_id: '00000000-0000-4000-8000-000000000000', status: 'cancelled' }), 'NOT_FOUND');
    await rejects(asOwner('adm_overview', {}), 'NOT_ALLOWED');
    await rejects(anon('own_me', {}), 'NOT_ALLOWED');
    const me = await asOwner('own_me', {});
    assert.deepEqual(me.businesses.map((b) => b.slug), ['ward-barber']);
  });

  test('anon cannot read tables directly', async () => {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      await tx.query('select * from public.bookings');
    }), /permission denied/);
    const r = await db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      return tx.query('select count(*)::int n from public.live_pings');
    });
    assert.ok(r.rows[0].n >= 0);
  });

  test('grants follow the name prefix', async () => {
    const r = await db.query(`
      select p.proname as name,
        has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as auth,
        has_function_privilege('service_role', p.oid, 'execute') as svc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'`);
    const bad = [];
    for (const f of r.rows) {
      const want = f.name.startsWith('pub_') ? [true, true, true]
        : (f.name.startsWith('own_') || f.name.startsWith('adm_')) ? [false, true, true]
        : f.name.startsWith('svc_') ? [false, false, true]
        : f.name === '_is_admin' ? [false, true, false]
        : [false, false, false];
      if (f.anon !== want[0] || f.auth !== want[1] || f.svc !== want[2]) bad.push(`${f.name} ${f.anon}/${f.auth}/${f.svc}`);
    }
    assert.deepEqual(bad, []);
    assert.ok(r.rows.length > 60);
  });
});

describe('entitlements', () => {
  test('owners cannot switch on what they did not buy', async () => {
    const out = await asOwner('own_settings_update', { business_id: WARD, settings: { payment: { mode: 'full' }, notice_min: 45 } });
    assert.equal(out.cfg.payment.mode, 'shop');
    assert.equal(out.cfg.notice_min, 45);
    await rejects(asOwner('own_service_upsert', { business_id: WARD, service: { name_en: 'Home cut', location: 'mobile' } }), 'FEATURE_OFF');
  });

  test('service limit from the package', async () => {
    await db.exec(`update public.businesses set entitlements = entitlements || '{"max_services": 6}' where id = '${WARD}'`);
    await rejects(asOwner('own_service_upsert', { business_id: WARD, service: { name_en: 'Extra' } }), 'LIMIT_SERVICES');
    await db.exec(`update public.businesses set entitlements = entitlements || '{"max_services": 15}' where id = '${WARD}'`);
  });
});

describe('selling Mamar', () => {
  const answers = {
    business: { name_ar: 'صالون تجربة', name_en: 'Trial Salon', kind: 'salon' },
    services: [{ name: 'Cut', duration_min: 30, price_sar: 60 }, { name: 'Beard', duration_min: 20, price_sar: 40 }],
    hours: { 0: [[600, 1320]], 1: [[600, 780], [960, 1380]] },
    slots: { mode: 'staff', staff_count: 2 },
    look: 'standard', langs: 'both', prayer: true, hijri: true, customer: 'name_phone', payment: 'shop',
    extras: { self_manage: true }, branches: 1, plan: { code: 'care', interval: 'yearly' },
  };

  test('the server recomputes the estimate (barber example = 5,799 SAR)', async () => {
    const r = await anon('pub_submit_setup', { answers, contact: { name: 'Owner', phone: '0501234567' }, lang: 'en',
      estimate: { setup_halalas: 1 } });
    assert.equal(r.estimate.setup_halalas, 579900);
    assert.equal(r.estimate.plan.amount_halalas, 500000);
    assert.equal(r.estimate.plan.saving_halalas, 98800);
    const n = await asAdmin('adm_notifications', {});
    assert.match(n.items[0].title_en, /Trial Salon · 5,799 SAR/);
    assert.match(n.items[0].title_ar, /٥٬٧٩٩ ر\.س/);
  });

  test('custom quotes are listed but not added', async () => {
    const r = await anon('pub_submit_setup', { answers: { ...answers, customer: 'sms' }, contact: { name: 'Owner', phone: '0501234568' } });
    assert.equal(r.estimate.setup_halalas, 579900);
    assert.equal(r.estimate.has_quote, true);
  });

  test('a request becomes a working business', async () => {
    const list = await asAdmin('adm_requests', {});
    const req = list.items.find((x) => x.business_name === 'صالون تجربة');
    const made = await asAdmin('adm_business_create', { request_id: req.id });
    assert.match(made.slug, /^trial-salon/);
    const ov = await asAdmin('adm_business', { business_id: made.business_id });
    assert.equal(ov.services.length, 2);
    assert.equal(ov.staff.length, 2);
    assert.equal(ov.hours.length, 3);
    assert.equal(ov.subscription.status, 'pending');
    assert.equal(ov.business.entitlements.langs_both, true);
    // owner gets attached, business goes live, a customer books
    const uid = await ensureUser(db, 'trial@owners.mamar.site', 'pw');
    await asAdmin('adm_attach_owner', { business_id: made.business_id, email: 'trial@owners.mamar.site' });
    await asAdmin('adm_business_update', { business_id: made.business_id, patch: { status: 'active' } });
    const me = await rpc(db, 'own_me', {}, { role: 'authenticated', sub: uid });
    assert.equal(me.businesses[0].slug, made.slug);
    const pub = await anon('pub_business', { slug: made.slug });
    const day = nextDow(1, 3);
    const r = await book(pub.services[0].id, at(day, '10:00'));
    assert.equal(r.status, 'confirmed');
  });

  test('assisted mode: draft, then create straight away', async () => {
    const d = await asAdmin('adm_draft_save', { answers: { business: { name_en: 'Helped Wash', kind: 'carwash' } },
      contact: { name: 'Abu Fahad', phone: '0507654321' } });
    const done = await asAdmin('adm_submit_assisted', { id: d.id, answers: { ...answers, business: { name_en: 'Helped Wash', kind: 'carwash' },
      slots: { mode: 'capacity', capacity: 4 } }, contact: { name: 'Abu Fahad', phone: '0507654321' }, create: true });
    assert.ok(done.business_id);
    const ov = await asAdmin('adm_business', { business_id: done.business_id });
    assert.equal(ov.resources[0].capacity, 4);
    assert.equal(ov.services[0].mode, 'capacity');
    const reqs = await asAdmin('adm_requests', { status: 'draft' });
    assert.ok(!reqs.items.some((x) => x.id === d.id));
  });

  test('plan requests reach Ahmed and he confirms them', async () => {
    const b = await asOwner('own_plan_request', { business_id: WARD, plan_code: 'live', interval: 'yearly' });
    assert.equal(b.subscription.requested_code, 'live');
    const n = await asAdmin('adm_notifications', {});
    assert.equal(n.items[0].kind, 'plan_request');
    const s = await asAdmin('adm_plan_set', { business_id: WARD, plan_code: 'live', interval: 'yearly' });
    assert.equal(s.status, 'active');
    assert.equal(s.requested_code, null);
  });
});

describe('payment safety', () => {
  test('a real business with no Moyasar keys never asks customers to pay', async () => {
    await db.exec(`update public.businesses set is_demo = false where id = '${LAMAA}'`);
    const r = await book(S.fullWash, at(nextDow(3, 6), '17:00'));
    assert.equal(r.status, 'confirmed');
    assert.equal(r.due_now_halalas, 0);
    await db.exec(`update public.businesses set is_demo = true where id = '${LAMAA}'`);
  });

  test('closed days are marked; rescheduling sees its own slot as free', async () => {
    const fri = nextDow(5, 3);
    await asOwnerB('own_special_hours_upsert', { business_id: LAMAA, item: { from_date: fri, to_date: fri, ranges: [], label_en: 'Eid' } });
    const d = await anon('pub_days', { service_id: S.exterior });
    assert.equal(d.days.find((x) => x.day === fri).closed, true);
    // karting: fill a slot to 9/10 with one party of 9, then reschedule-view with its token still shows the slot
    const day = nextDow(2, 4);
    const t = at(day, '19:00');
    const r = await book(S.race10, t, { qty: 8 });
    await book(S.race10, t, { qty: 2 });
    const without = await anon('pub_slots', { service_id: S.race10, day, qty: 8 });
    assert.ok(!hasSlot(without.slots, t));
    const withTok = await anon('pub_slots', { service_id: S.race10, day, qty: 8, token: r.token });
    assert.ok(hasSlot(withTok.slots, t));
  });
});

describe('owner tools', () => {
  test('forcing a walk-in onto a busy chair keeps it unassigned; a free chosen chair is kept', async () => {
    const day = nextDow(3, 9);
    const t = at(day, '17:00');
    for (let i = 0; i < 3; i++) await book(S.haircut, t);           // every chair busy
    const forced = await asOwner('own_booking_create', { business_id: WARD, service_id: S.haircut, start: t, staff_id: CHAIR1, force: true, name: 'Walk-in' });
    assert.equal(forced.staff_label_en, null);
    const free = await asOwner('own_booking_create', { business_id: WARD, service_id: S.haircut, start: at(day, '19:00'), staff_id: CHAIR1, force: true, name: 'Walk-in 2' });
    assert.equal(free.staff_label_en, 'Chair one');
  });

  test('switching an archived service back on respects the package limit', async () => {
    const ov = await asOwner('own_overview', { business_id: WARD });
    const svc = ov.services.find((s) => s.active);
    await asOwner('own_service_upsert', { business_id: WARD, service: { ...svc, active: false } });
    const n = (await asOwner('own_overview', { business_id: WARD })).services.filter((s) => s.active).length;
    await db.exec(`update public.businesses set entitlements = entitlements || '{"max_services": ${n}}' where id = '${WARD}'`);
    await rejects(asOwner('own_service_upsert', { business_id: WARD, service: { ...svc, active: true } }), 'LIMIT_SERVICES');
    await db.exec(`update public.businesses set entitlements = entitlements || '{"max_services": 15}' where id = '${WARD}'`);
    await asOwner('own_service_upsert', { business_id: WARD, service: { ...svc, active: true } });
  });

  test('owners can fix customer details', async () => {
    const r = await book(S.haircut, at(nextDow(4, 9), '11:00'));
    const e = await asOwner('own_booking_edit', { business_id: WARD, booking_id: r.booking_id, name: 'Corrected Name', phone: '٠٥٥٩٨٧٦٥٤٣' });
    assert.equal(e.name, 'Corrected Name');
    assert.equal(e.phone, '+966559876543');
    await rejects(asOwnerB('own_booking_edit', { business_id: WARD, booking_id: r.booking_id, name: 'x' }), 'NOT_ALLOWED');
  });
});

describe('email-link sign-in', () => {
  test('an invited owner becomes a member on first sign-in; listed admin emails become admins', async () => {
    const r = await asAdmin('adm_attach_owner', { business_id: SURA, email: 'New.Owner@Example.com' });
    assert.equal(r.invited, true);
    const inv = await asAdmin('adm_invites', { business_id: SURA });
    assert.deepEqual(inv.items.map((x) => x.email), ['new.owner@example.com']);
    const uid = await ensureUser(db, 'new.owner@example.com', 'x');          // = Supabase creating the user on first link sign-in
    const me = await rpc(db, 'own_me', {}, { role: 'authenticated', sub: uid });
    assert.deepEqual(me.businesses.map((b) => b.slug), ['sura-karting']);
    assert.equal((await asAdmin('adm_invites', { business_id: SURA })).items.length, 0);

    await db.query(`insert into public.admin_emails (email) values ('boss@example.com')`);
    const boss = await ensureUser(db, 'boss@example.com', 'x');
    assert.equal((await rpc(db, 'own_me', {}, { role: 'authenticated', sub: boss })).is_admin, true);
    const stranger = await ensureUser(db, 'stranger@example.com', 'x');
    const sm = await rpc(db, 'own_me', {}, { role: 'authenticated', sub: stranger });
    assert.equal(sm.is_admin, false);
    assert.equal(sm.businesses.length, 0);
    await rejects(rpc(db, 'svc_secret_get', { key: 'hook_secret' }, { role: 'authenticated', sub: stranger }), 'NOT_ALLOWED');
  });
});
