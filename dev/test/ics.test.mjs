import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icsEvent, icsDate, icsEscape, foldLine, googleCalUrl, downloadIcs } from '../../platform/ics.js';

const octets = (s) => Buffer.byteLength(s, 'utf8');

const ev = {
  uid: 'bk-1042@mamar.site',
  start: '2026-10-14T09:30:00+03:00',
  end: '2026-10-14T10:15:00+03:00',
  title: 'غسيل يدوي فاخر — مرسى للعناية بالسيارات',
  description: 'Signature hand wash; 45 min, inside & out.\nBring the car to bay 3, please.',
  location: 'Al Shati, Jeddah',
  url: 'https://mamar.site/b/marsa/1042',
  stamp: '2026-10-13T12:00:00Z',
};

test('dates are UTC basic format', () => {
  assert.equal(icsDate('2026-10-14T09:30:00+03:00'), '20261014T063000Z');
  assert.equal(icsDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '20260102T030405Z');
  assert.throws(() => icsDate('not a date'));
});

test('text escaping', () => {
  assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  assert.equal(icsEscape('line1\r\nline2'), 'line1\\nline2');
});

test('valid calendar: CRLF, required fields, UTC times', () => {
  const ics = icsEvent(ev);
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every newline is CRLF');
  const lines = ics.split('\r\n').slice(0, -1);
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-1), 'END:VCALENDAR');
  const unfolded = ics.replace(/\r\n /g, '');
  for (const re of [/^VERSION:2\.0$/m, /^PRODID:/m, /^BEGIN:VEVENT$/m, /^END:VEVENT$/m,
    /^UID:bk-1042@mamar\.site$/m, /^DTSTAMP:20261013T120000Z$/m,
    /^DTSTART:20261014T063000Z$/m, /^DTEND:20261014T071500Z$/m]) {
    assert.match(unfolded, re);
  }
  assert.match(unfolded, /^DESCRIPTION:Signature hand wash\\; 45 min\\, inside & out\.\\nBring the car to bay 3\\, please\.$/m);
  assert.match(unfolded, /^LOCATION:Al Shati\\, Jeddah$/m);
  assert.match(unfolded, /^SUMMARY:غسيل يدوي فاخر — مرسى للعناية بالسيارات$/m);
  assert.match(unfolded, /^URL:https:\/\/mamar\.site\/b\/marsa\/1042$/m);
});

test('lines fold at 75 octets without splitting UTF-8 characters', () => {
  const ics = icsEvent({ ...ev, description: 'وصف طويل جداً '.repeat(30) + '🚗'.repeat(10) });
  for (const line of ics.split('\r\n')) assert.ok(octets(line) <= 75, `${octets(line)} octets: ${line}`);
  // unfolding restores the exact text (no replacement characters)
  assert.ok(ics.replace(/\r\n /g, '').includes('🚗'.repeat(10)));
  assert.ok(!ics.includes('�'));
  const folded = foldLine('X'.repeat(200));
  assert.deepEqual(folded.split('\r\n').map((l) => l.length), [75, 75, 52]);
  assert.equal(folded.replace(/\r\n /g, ''), 'X'.repeat(200));
});

test('duration fallback and alarm', () => {
  const ics = icsEvent({ start: '2026-10-14T06:30:00Z', durationMin: 90, title: 'x', alarmMin: 60 });
  assert.match(ics, /DTEND:20261014T080000Z/);
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:x\r\nTRIGGER:-PT60M\r\nEND:VALARM/);
  assert.match(ics, /UID:20261014T063000Z-[a-z0-9]+@mamar\.site/);
});

test('Google Calendar link', () => {
  const url = new URL(googleCalUrl(ev));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), ev.title);
  assert.equal(url.searchParams.get('dates'), '20261014T063000Z/20261014T071500Z');
  assert.equal(url.searchParams.get('location'), ev.location);
  assert.ok(url.searchParams.get('details').includes(ev.url));
});

test('downloadIcs is a guarded no-op outside the browser', () => {
  assert.equal(downloadIcs('booking', 'x'), false);
});
