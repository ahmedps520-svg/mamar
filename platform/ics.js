/* ==========================================================
   Mamar Booking — calendar files (RFC 5545) and Google links
   Pure except downloadIcs(), which is browser-only and guarded.
   ========================================================== */

const CRLF = '\r\n';
const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
const octets = (s) => (enc ? enc.encode(s).length : unescape(encodeURIComponent(s)).length);

const toDate = (d) => (d instanceof Date ? d : new Date(d));

/** '20261013T063000Z' — UTC basic format. */
export function icsDate(d) {
  const x = toDate(d);
  if (Number.isNaN(x.getTime())) throw new TypeError(`ics: invalid date "${d}"`);
  return x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escape a TEXT value: backslash, semicolon, comma, newlines. */
export function icsEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line at 75 octets (RFC 5545 §3.1). Continuation lines start
 * with one space, which counts toward their 75. Never splits a UTF-8 character.
 */
export function foldLine(line) {
  if (octets(line) <= 75) return line;
  const out = [];
  let cur = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {                 // iterates code points, so surrogate pairs stay whole
    const n = octets(ch);
    if (size + n > limit) {
      out.push(cur);
      cur = ' ';
      size = 1;
      limit = 75;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join(CRLF);
}

/**
 * Build a single-event calendar.
 * @param {{uid?:string, start:Date|string|number, end?:Date|string|number, durationMin?:number,
 *          title:string, description?:string, location?:string, url?:string,
 *          alarmMin?:number, stamp?:Date|string|number}} ev
 * @returns {string} .ics text with CRLF line endings
 */
export function icsEvent({ uid, start, end, durationMin, title, description, location, url, alarmMin, stamp } = {}) {
  const s = toDate(start);
  const e = end != null ? toDate(end) : new Date(s.getTime() + (durationMin ?? 60) * 60000);
  const id = uid || `${icsDate(s)}-${Math.random().toString(36).slice(2, 10)}@mamar.site`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mamar//Mamar Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscape(id)}`,
    `DTSTAMP:${icsDate(stamp ?? new Date())}`,
    `DTSTART:${icsDate(s)}`,
    `DTEND:${icsDate(e)}`,
    `SUMMARY:${icsEscape(title || '')}`,
  ];
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (url) lines.push(`URL:${String(url).replace(/[\r\n]/g, '')}`);
  if (alarmMin != null && alarmMin >= 0) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title || 'Reminder')}`,
      `TRIGGER:-PT${Math.round(alarmMin)}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Google Calendar "add event" link. Same fields as icsEvent. */
export function googleCalUrl({ start, end, durationMin, title, description, location, url } = {}) {
  const s = toDate(start);
  const e = end != null ? toDate(end) : new Date(s.getTime() + (durationMin ?? 60) * 60000);
  const details = [description, url].filter(Boolean).join('\n\n');
  const q = [
    ['action', 'TEMPLATE'],
    ['text', title || ''],
    ['dates', `${icsDate(s)}/${icsDate(e)}`],
    ['details', details],
    ['location', location || ''],
    ['ctz', 'Asia/Riyadh'],
  ].filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2F/g, '/')}`)
    .join('&');
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** Save an .ics file (browser only; a no-op returning false elsewhere). */
export function downloadIcs(filename, ics) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return false;
  const name = String(filename || 'booking').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.ics$/i, '') + '.ics';
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
  return true;
}
