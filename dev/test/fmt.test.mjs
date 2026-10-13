import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  digits, toLatin, num, money, plusMoney, included, dateLong, dateShort, hijri, hijriParts, hijriShort,
  monthYear, weekday, time, durationMin, dayLabel, riyadhDateISO, riyadhParts, riyadhInstant, addDaysISO,
  normalizePhone, formatPhone, whatsappUrl,
} from '../../platform/fmt.js';

test('digits: Arabic-Indic with Arabic separators, and back', () => {
  assert.equal(digits('1234567890', 'ar'), '١٢٣٤٥٦٧٨٩٠');
  assert.equal(digits('5,799.50', 'ar'), '٥٬٧٩٩٫٥٠');
  assert.equal(digits('Step 2, then 3.', 'ar'), 'Step ٢, then ٣.');       // prose punctuation untouched
  assert.equal(digits('٥٬٧٩٩٫٥٠', 'en'), '5,799.50');
  assert.equal(toLatin('۰۵۵'), '055');                                      // Persian digits too
  assert.equal(num(1234567, 'ar'), '١٬٢٣٤٬٥٦٧');
  assert.equal(num(-12.5, 'en'), '-12.5');
});

test('money: halalas, grouping, decimals only when needed', () => {
  assert.equal(money(579900, 'ar'), '٥٬٧٩٩ ر.س');
  assert.equal(money(579900, 'en'), '5,799 SAR');
  assert.equal(money(579950, 'en'), '5,799.50 SAR');
  assert.equal(money(579905, 'ar'), '٥٬٧٩٩٫٠٥ ر.س');
  assert.equal(money(1234567800, 'en'), '12,345,678 SAR');
  assert.equal(money(0, 'en'), '0 SAR');
  assert.equal(money(0, 'en', { free: true }), 'Free');
  assert.equal(money(0, 'ar', { free: true }), 'مجاناً');
  assert.equal(money(0, 'ar', { free: 'هدية' }), 'هدية');
  assert.equal(money(-5000, 'en'), '-50 SAR');
  assert.equal(plusMoney(120000, 'ar'), '+ ١٬٢٠٠ ر.س');
  assert.equal(plusMoney(120000, 'en'), '+ 1,200 SAR');
  assert.equal(included('ar'), 'مشمول');
  assert.equal(included('en'), 'Included');
});

test('dates are Gregorian even for Arabic (no ar-SA Hijri default)', () => {
  const d = new Date('2026-10-13T09:00:00Z');
  assert.equal(dateLong(d, 'ar'), 'الثلاثاء، ١٣ أكتوبر ٢٠٢٦');
  assert.equal(dateLong(d, 'en'), 'Tuesday, 13 October 2026');
  assert.equal(dateLong(d, 'en', { weekday: false }), '13 October 2026');
  assert.equal(dateShort(d, 'ar'), '١٣ أكتوبر');
  assert.equal(dateShort(d, 'en'), '13 Oct');
  assert.equal(dateShort(d, 'en', { weekday: true }), 'Tue 13 Oct');
  assert.equal(monthYear(d, 'en'), 'October 2026');
  assert.equal(weekday(d, 'ar'), 'الثلاثاء');
  assert.equal(weekday(d, 'ar', true), 'ثلاثاء');
  assert.equal(weekday(d, 'en', true), 'Tue');
  // a bare YYYY-MM-DD is that calendar day in Riyadh, never the day before
  assert.equal(dateLong('2026-01-01', 'en'), 'Thursday, 1 January 2026');
});

test('Hijri uses the Umm al-Qura calendar', () => {
  // Official Umm al-Qura calendar: 2026-02-18 = 1 Ramadan 1447, 2026-10-15 = 4 Jumada I 1448
  assert.deepEqual(hijriParts('2026-02-18'), { day: 1, month: 9, year: 1447 });
  assert.equal(hijri('2026-02-18', 'ar'), '١ رمضان ١٤٤٧');
  assert.equal(hijri('2026-10-15', 'en'), '4 Jumada I 1448 AH');
  assert.equal(hijri('2026-10-15', 'ar'), '٤ جمادى الأولى ١٤٤٨');
  // 2026-10-01 = 20 Rabiʻ II 1448
  assert.equal(hijri('2026-10-01', 'en'), '20 Rabiʻ II 1448 AH');
  assert.equal(hijri('2026-10-01', 'ar'), '٢٠ ربيع الآخر ١٤٤٨');
  assert.equal(hijriShort('2026-10-01', 'ar'), '٢٠ ربيع ٢');
});

test('Riyadh time zone regardless of the machine zone', () => {
  // 22:30 UTC is already the next day (01:30) in Riyadh
  const late = new Date('2026-10-13T22:30:00Z');
  assert.equal(riyadhDateISO(late), '2026-10-14');
  const p = riyadhParts(late);
  assert.equal(p.hour, 1);
  assert.equal(p.minute, 30);
  assert.equal(p.weekday, 3); // Wednesday
  assert.equal(time(late, 'en'), '1:30 AM');
  assert.equal(time(late, 'ar'), '١:٣٠ ص');
  assert.equal(time(new Date('2026-10-13T18:05:00Z'), 'en'), '9:05 PM');
  assert.equal(time('00:15', 'en'), '12:15 AM');
  assert.equal(time('12:00', 'en'), '12:00 PM');
  assert.equal(time('14:30', 'ar'), '٢:٣٠ م');
  assert.equal(riyadhInstant('2026-10-14', '09:30').toISOString(), '2026-10-14T06:30:00.000Z');
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
  // the result does not depend on process.env.TZ: compare with Intl in Asia/Riyadh
  const viaIntl = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(late);
  assert.equal(riyadhDateISO(late), viaIntl);
});

test('durations', () => {
  assert.equal(durationMin(45, 'ar'), '٤٥ دقيقة');
  assert.equal(durationMin(45, 'en'), '45 min');
  assert.equal(durationMin(75, 'en'), '1 h 15 min');
  assert.equal(durationMin(120, 'en'), '2 h');
  assert.equal(durationMin(60, 'ar'), 'ساعة');
  assert.equal(durationMin(120, 'ar'), 'ساعتان');
  assert.equal(durationMin(180, 'ar'), '٣ ساعات');
  assert.equal(durationMin(75, 'ar'), 'ساعة و١٥ دقيقة');
  assert.equal(durationMin(5, 'ar'), '٥ دقائق');
  assert.equal(durationMin(2, 'ar'), 'دقيقتان');
});

test('day labels', () => {
  const now = new Date('2026-10-13T21:30:00Z'); // 00:30 on the 14th in Riyadh
  assert.equal(dayLabel('2026-10-14', 'ar', now), 'اليوم');
  assert.equal(dayLabel('2026-10-15', 'en', now), 'Tomorrow');
  assert.equal(dayLabel('2026-10-15', 'ar', now), 'غداً');
  assert.equal(dayLabel('2026-10-16', 'en', now), 'Friday');
});

test('phone normalising', () => {
  const ok = '+966559797724';
  for (const input of [
    '٠٥٥٩٧٩٧٧٢٤', '0559797724', '055 979 7724', '055-979-7724', '559797724', '966559797724',
    '+966559797724', '+966 55 979 7724', '00966559797724', '00966 55 979 7724', '+966 0559797724',
    ' ٠٥٥ ٩٧٩ ٧٧٢٤ ', '(055) 979-7724',
  ]) {
    assert.equal(normalizePhone(input), ok, `input: ${input}`);
  }
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('0044 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('+966126543210'), '+966126543210');  // landline with country code
  for (const bad of [null, undefined, '', 'abc', '12345', '05597977', '055979772412', '+96655979772',
    '0126543210', '+123', '+1234567890123456', '05x9797724', '4559797724']) {
    assert.equal(normalizePhone(bad), null, `input: ${bad}`);
  }
});

test('phone display', () => {
  assert.equal(formatPhone('+966559797724', 'ar'), '⁦‭٠٥٥ ٩٧٩ ٧٧٢٤‬⁩');
  assert.equal(formatPhone('+966559797724', 'en'), '055 979 7724');
  assert.equal(formatPhone('+442079460958', 'en'), '+442079460958');
  assert.equal(whatsappUrl('0559797724', 'مرحبا'), 'https://wa.me/966559797724?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7');
});
