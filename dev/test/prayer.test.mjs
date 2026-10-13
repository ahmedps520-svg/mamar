import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prayerTimes, prayerYear, isRamadan, sunrise, JEDDAH, PRAYERS } from '../../platform/prayer.js';

/*
 * Reference: the official Umm al-Qura calendar (King Abdulaziz City for Science and
 * Technology), i.e. the service behind https://www.ummulqura.org.sa — fetched from
 *   https://umqserv.kacst.gov.sa/api/v1/Prayer/GetPrayerByYear?lang=en&format=24&yg=2026&lon=39.17&lat=21.5&zone=3
 *   https://umqserv.kacst.gov.sa/api/v1/Prayer/GetPrayers?lang=en&format=24&yg=2027&mg=2&dg=8&lon=39.17&lat=21.5&zone=3
 * Jeddah = lat 21.5, lon 39.17, UTC+3 in that service's own city list.
 * Cross-checked against aladhan.com method 4 (Umm al-Qura) at 21.4858, 39.1925: the two
 * agree within 0–1 min; the official tables round up to the next minute.
 * Over all 365 days of 2026 our computation stays within 1 minute of the official table.
 *
 *  date          fajr     dhuhr    asr      maghrib  isha       Hijri (Umm al-Qura)
 */
const REF = [
  ['2026-01-01', '05:40', '12:27', '15:32', '17:53', '19:23'], // 12 Rajab 1447
  ['2026-01-15', '05:44', '12:33', '15:41', '18:02', '19:32'], // 26 Rajab 1447
  ['2026-02-01', '05:43', '12:37', '15:50', '18:14', '19:44'], // 13 Shaʻban 1447
  ['2026-02-15', '05:37', '12:38', '15:55', '18:21', '19:51'], // 27 Shaʻban 1447
  ['2026-02-17', '05:36', '12:38', '15:56', '18:23', '19:53'], // 29 Shaʻban 1447
  ['2026-02-18', '05:35', '12:38', '15:56', '18:23', '20:23'], //  1 Ramadan 1447 (Isha +120)
  ['2026-03-01', '05:28', '12:36', '15:58', '18:28', '20:28'], // 12 Ramadan 1447
  ['2026-03-15', '05:16', '12:33', '15:57', '18:33', '20:33'], // 26 Ramadan 1447
  ['2026-03-19', '05:12', '12:32', '15:56', '18:35', '20:35'], // 30 Ramadan 1447
  ['2026-03-20', '05:11', '12:31', '15:56', '18:35', '20:05'], //  1 Shawwal 1447 (back to +90)
  ['2026-04-01', '05:00', '12:28', '15:53', '18:39', '20:09'], // 13 Shawwal 1447
  ['2026-04-15', '04:46', '12:24', '15:48', '18:43', '20:13'], // 27 Shawwal 1447
  ['2026-05-01', '04:31', '12:21', '15:42', '18:49', '20:19'], // 14 Dhuʻl-Qiʻdah 1447
  ['2026-05-15', '04:21', '12:20', '15:38', '18:55', '20:25'], // 28 Dhuʻl-Qiʻdah 1447
  ['2026-06-01', '04:14', '12:22', '15:38', '19:02', '20:32'], // 15 Dhuʻl-Hijjah 1447
  ['2026-06-15', '04:13', '12:24', '15:44', '19:07', '20:37'], // 29 Dhuʻl-Hijjah 1447
  ['2026-07-01', '04:17', '12:28', '15:46', '19:10', '20:40'], // 16 Muharram 1448
  ['2026-07-15', '04:24', '12:30', '15:44', '19:09', '20:39'], //  1 Safar 1448
  ['2026-08-01', '04:34', '12:30', '15:49', '19:03', '20:33'], // 18 Safar 1448
  ['2026-08-15', '04:42', '12:28', '15:51', '18:54', '20:24'], //  2 Rabiʻ I 1448
  ['2026-09-01', '04:50', '12:24', '15:49', '18:40', '20:10'], // 19 Rabiʻ I 1448
  ['2026-09-15', '04:54', '12:19', '15:45', '18:28', '19:58'], //  4 Rabiʻ II 1448
  ['2026-10-01', '04:59', '12:14', '15:37', '18:12', '19:42'], // 20 Rabiʻ II 1448
  ['2026-10-15', '05:03', '12:10', '15:31', '18:00', '19:30'], //  4 Jumada I 1448
  ['2026-11-01', '05:10', '12:07', '15:23', '17:48', '19:18'], // 21 Jumada I 1448
  ['2026-11-15', '05:16', '12:08', '15:19', '17:42', '19:12'], //  5 Jumada II 1448
  ['2026-12-01', '05:24', '12:13', '15:19', '17:40', '19:10'], // 21 Jumada II 1448
  ['2026-12-15', '05:32', '12:19', '15:23', '17:44', '19:14'], //  6 Rajab 1448
  ['2027-02-07', '05:41', '12:38', '15:53', '18:17', '19:47'], // 30 Shaʻban 1448
  ['2027-02-08', '05:40', '12:38', '15:53', '18:18', '20:18'], //  1 Ramadan 1448 (Isha +120)
];

const TOLERANCE = 2; // minutes
const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

for (const [label, coords] of [
  ['default Jeddah coordinates (21.4858, 39.1925)', {}],
  ['official city coordinates (21.5, 39.17)', { lat: 21.5, lng: 39.17 }],
]) {
  test(`matches the official Umm al-Qura table within ±${TOLERANCE} min — ${label}`, (t) => {
    const worst = Object.fromEntries(PRAYERS.map((p) => [p, 0]));
    for (const [day, ...ref] of REF) {
      const got = prayerTimes(day, coords);
      PRAYERS.forEach((p, i) => {
        const diff = toMin(got[p]) - toMin(ref[i]);
        worst[p] = Math.max(worst[p], Math.abs(diff));
        assert.ok(Math.abs(diff) <= TOLERANCE, `${day} ${p}: got ${got[p]}, official ${ref[i]} (${diff > 0 ? '+' : ''}${diff} min)`);
      });
    }
    t.diagnostic(`max deviation (min): ${JSON.stringify(worst)}`);
  });
}

test('output shape', () => {
  const p = prayerTimes('2026-10-13');
  assert.deepEqual(Object.keys(p), PRAYERS);
  for (const v of Object.values(p)) assert.match(v, /^([01]\d|2[0-3]):[0-5]\d$/);
  assert.deepEqual(JEDDAH, { lat: 21.4858, lng: 39.1925, tz: 3 });
});

test('Ramadan detection and the Isha rule', () => {
  assert.equal(isRamadan('2026-02-17'), false);
  assert.equal(isRamadan('2026-02-18'), true);
  assert.equal(isRamadan('2026-03-19'), true);
  assert.equal(isRamadan('2026-03-20'), false);
  assert.equal(isRamadan('2027-02-08'), true);
  const gap = (d, o) => { const p = prayerTimes(d, o); return toMin(p.isha) - toMin(p.maghrib); };
  assert.equal(gap('2026-02-17'), 90);
  assert.equal(gap('2026-03-01'), 120);
  assert.equal(gap('2026-03-20'), 90);
  assert.equal(gap('2026-06-01', { ramadan: true }), 120);   // explicit override
});

test('adjustments and minutes output', () => {
  const base = prayerTimes('2026-10-15', { minutes: true });
  const adj = prayerTimes('2026-10-15', { minutes: true, adjust: { dhuhr: 2, maghrib: 1 } });
  assert.equal(adj.dhuhr - base.dhuhr, 2);
  assert.equal(adj.maghrib - base.maghrib, 1);
  assert.equal(adj.isha - base.isha, 1);               // Isha follows Maghrib
  assert.equal(sunrise('2026-06-15'), '05:40');        // official: 05:40
});

test('prayerYear: consecutive days for bulk upload', () => {
  const year = prayerYear('2026-12-30', 400);
  assert.equal(year.length, 400);
  assert.equal(year[0].day, '2026-12-30');
  assert.equal(year[2].day, '2027-01-01');
  assert.equal(year[399].day, '2028-02-02');
  for (const row of year) {
    const m = PRAYERS.map((p) => toMin(row[p]));
    assert.ok(m.every((v, i) => i === 0 || v > m[i - 1]), `order on ${row.day}`);
  }
  assert.deepEqual(year[1], { day: '2026-12-31', ...prayerTimes('2026-12-31') });
});

test('other cities via opts (Riyadh is ~30 min ahead of Jeddah)', () => {
  const jed = prayerTimes('2026-10-15', { minutes: true });
  const ruh = prayerTimes('2026-10-15', { lat: 24.7136, lng: 46.6753, tz: 3, minutes: true });
  const d = jed.dhuhr - ruh.dhuhr;
  assert.ok(d >= 28 && d <= 31, `dhuhr difference ${d}`);
});
