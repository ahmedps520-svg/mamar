// The configurator's browser total (platform/estimate.js) must equal the server's (_estimate in SQL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, rpc } from '../db.js';
import { estimate, deltaFor } from '../../platform/estimate.js';

let db, sheet;
before(async () => { db = await openDb({ demo: false }); sheet = await rpc(db, 'pub_price_sheet', {}); });
after(async () => { await db.close(); });

// Deterministic pseudo-random answers (no Math.random so failures reproduce).
function* answerSets(n) {
  let s = 7;
  const r = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const one = (xs) => xs[Math.floor(r() * xs.length)];
  for (let i = 0; i < n; i++) {
    const later = r() < 0.3;
    yield {
      business: { name_en: `B${i}`, kind: one(['salon', 'carwash', 'activity', 'other']) },
      services: later ? [] : Array.from({ length: Math.floor(r() * 50) }, (_, k) => ({ name: `s${k}`, duration_min: 30, price_sar: 50 })),
      services_later: later, service_count: Math.floor(r() * 60),
      look: one(['standard', 'custom']), langs: one(['ar', 'en', 'both']),
      staff_choice: r() < 0.5, sections: r() < 0.5, home_service: r() < 0.5, prayer: r() < 0.5, hijri: r() < 0.5,
      customer: one(['name_phone', 'name_phone_email', 'sms', 'accounts']),
      payment: one(['shop', 'deposit', 'full']),
      extras: { self_manage: r() < 0.5, waitlist: r() < 0.5 },
      branches: 1 + Math.floor(r() * 4),
      plan: { code: one(['none', 'care', 'live']), interval: one(['monthly', 'yearly']) },
    };
  }
}

test('browser estimate == server estimate on 300 random configurations', async () => {
  for (const a of answerSets(300)) {
    const server = await db.query(`select public._estimate($1::jsonb) as e`, [JSON.stringify(a)]);
    const s = server.rows[0].e;
    const c = estimate(sheet, a);
    assert.equal(c.setup_halalas, s.setup_halalas, JSON.stringify(a));
    assert.equal(c.has_quote, s.has_quote);
    assert.deepEqual(c.lines.map((l) => [l.key, l.qty, l.amount_halalas]), s.lines.map((l) => [l.key, l.qty, l.amount_halalas]));
    assert.equal(c.plan.amount_halalas, s.plan.amount_halalas);
    assert.equal(c.plan.saving_halalas ?? 0, s.plan.saving_halalas ?? 0);
  }
});

test('the plan examples', () => {
  const barber = { look: 'standard', langs: 'both', prayer: true, extras: { self_manage: true }, services: [] };
  assert.equal(estimate(sheet, barber).setup_halalas, 579900);
  const everything = { look: 'custom', langs: 'both', staff_choice: true, sections: true, home_service: true, prayer: true,
    hijri: true, payment: 'deposit', extras: { self_manage: true, waitlist: true }, services: [] };
  assert.equal(estimate(sheet, everything).setup_halalas, 1289900);
  assert.equal(deltaFor(sheet, { look: 'standard' }, { look: 'custom' }), 250000);
  const care = estimate(sheet, { plan: { code: 'care', interval: 'yearly' } }).plan;
  assert.deepEqual([care.amount_halalas, care.saving_halalas], [500000, 98800]);
  const live = estimate(sheet, { plan: { code: 'live', interval: 'yearly' } }).plan;
  assert.deepEqual([live.amount_halalas, live.saving_halalas], [2499900, 498900]);
});
