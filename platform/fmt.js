/* ==========================================================
   Mamar Booking — formatting
   Pure module: no DOM, works in Node and the browser.

   Everything is formatted in Asia/Riyadh (UTC+3, no DST since
   1947), whatever the machine's own time zone. Numbers are built
   by hand from Latin digits and then localised by digits(), so the
   output is identical in every JS engine and ICU version.
   ========================================================== */

const RIYADH_OFFSET_MIN = 180;
const DAY_MS = 86400000;

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const isAr = (lang) => lang !== 'en';

/* ---------- digits ---------- */

/**
 * Localise the digits of a string.
 * 'ar' → Arabic-Indic digits, ',' → '٬' and '.' → '٫' between digits.
 * 'en' → Latin digits (Arabic-Indic and Persian digits are converted back).
 */
export function digits(str, lang = 'ar') {
  const s = String(str ?? '');
  if (!isAr(lang)) return toLatin(s);
  return toLatin(s)
    .replace(/(\d),(?=\d)/g, '$1٬')
    .replace(/(\d)\.(?=\d)/g, '$1٫')
    .replace(/\d/g, (d) => AR_DIGITS[d]);
}

/** Arabic-Indic / Persian digits and separators → Latin. */
export function toLatin(str) {
  return String(str ?? '')
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/٬/g, ',')
    .replace(/٫/g, '.');
}

/** Group an integer string in threes with ','. */
const group = (intStr) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Plain number with grouping, localised. `num(5799.5,'ar')` → '٥٬٧٩٩٫٥'. */
export function num(n, lang = 'ar', { decimals } = {}) {
  const v = Number(n) || 0;
  const neg = v < 0;
  let s = decimals == null ? String(Math.abs(v)) : Math.abs(v).toFixed(decimals);
  if (/e/i.test(s)) s = Math.abs(v).toFixed(decimals ?? 0);
  const [i, f] = s.split('.');
  return (neg ? '-' : '') + digits(group(i) + (f ? '.' + f : ''), lang);
}

/* ---------- money (SAR, stored in halalas) ---------- */

export const SAR = Object.freeze({ ar: 'ر.س', en: 'SAR' });

/**
 * money(579900,'ar') → '٥٬٧٩٩ ر.س' · money(579900,'en') → '5,799 SAR'
 * Decimals are dropped when zero and shown as two digits otherwise.
 * @param {number} halalas
 * @param {'ar'|'en'} lang
 * @param {{free?: boolean|string}} [opts] when the amount is 0, show 'مجاناً' / 'Free' (or the given string)
 */
export function money(halalas, lang = 'ar', { free } = {}) {
  const h = Math.round(Number(halalas) || 0);
  if (h === 0 && free) return typeof free === 'string' ? free : (isAr(lang) ? 'مجاناً' : 'Free');
  const abs = Math.abs(h);
  const riyals = Math.floor(abs / 100);
  const cents = abs % 100;
  const body = group(String(riyals)) + (cents ? '.' + String(cents).padStart(2, '0') : '');
  return (h < 0 ? '-' : '') + digits(body, lang) + ' ' + SAR[isAr(lang) ? 'ar' : 'en'];
}

/** '+ ١٬٢٠٠ ر.س' / '+ 1,200 SAR' — for add-ons. */
export function plusMoney(halalas, lang = 'ar') {
  return '+ ' + money(Math.abs(Number(halalas) || 0), lang);
}

/** 'مشمول' / 'Included'. */
export function included(lang = 'ar') {
  return isAr(lang) ? 'مشمول' : 'Included';
}

/* ---------- Riyadh time ---------- */

/**
 * Accepts a Date, epoch ms, an ISO timestamp, or a bare 'YYYY-MM-DD'
 * (read as midday in Riyadh, so it never slips a day).
 */
export function toDate(d) {
  if (d instanceof Date) return new Date(d.getTime());
  if (typeof d === 'number') return new Date(d);
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12 - RIYADH_OFFSET_MIN / 60));
    return new Date(d);
  }
  return new Date(NaN);
}

/**
 * Wall-clock parts in Riyadh.
 * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number, weekday:number}}
 *          month 1–12, weekday 0 = Sunday
 */
export function riyadhParts(date = new Date()) {
  const t = toDate(date).getTime() + RIYADH_OFFSET_MIN * 60000;
  const r = new Date(t);
  return {
    year: r.getUTCFullYear(),
    month: r.getUTCMonth() + 1,
    day: r.getUTCDate(),
    hour: r.getUTCHours(),
    minute: r.getUTCMinutes(),
    second: r.getUTCSeconds(),
    weekday: r.getUTCDay(),
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of the instant, in Riyadh. */
export function riyadhDateISO(date = new Date()) {
  const p = riyadhParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The instant for a Riyadh calendar date + 'HH:MM'. `riyadhInstant('2026-10-13','09:30')`. */
export function riyadhInstant(dateISO, hhmm = '00:00') {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  const [hh, mm] = String(hhmm).split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0) - RIYADH_OFFSET_MIN * 60000);
}

/** Add whole days to a 'YYYY-MM-DD'. */
export function addDaysISO(dateISO, n) {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* ---------- names ---------- */

const WD = {
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const WD_SHORT = {
  ar: ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
const MONTHS = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTHS_SHORT = {
  ar: MONTHS.ar,
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const HIJRI_MONTHS = {
  ar: ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'],
  en: ['Muharram', 'Safar', 'Rabiʻ I', 'Rabiʻ II', 'Jumada I', 'Jumada II', 'Rajab', 'Shaʻban', 'Ramadan', 'Shawwal', 'Dhuʻl-Qiʻdah', 'Dhuʻl-Hijjah'],
};
const HIJRI_MONTHS_SHORT = {
  ar: ['محرم', 'صفر', 'ربيع ١', 'ربيع ٢', 'جمادى ١', 'جمادى ٢', 'رجب', 'شعبان', 'رمضان', 'شوال', 'القعدة', 'الحجة'],
  en: ['Muh', 'Saf', 'Rab I', 'Rab II', 'Jum I', 'Jum II', 'Raj', 'Shaʻ', 'Ram', 'Shaw', 'Qiʻd', 'Hijj'],
};

const L = (lang) => (isAr(lang) ? 'ar' : 'en');

/** 'الثلاثاء' / 'Tuesday' (short: 'ثلاثاء' / 'Tue'). */
export function weekday(d, lang = 'ar', short = false) {
  const p = riyadhParts(d);
  return (short ? WD_SHORT : WD)[L(lang)][p.weekday];
}

/* ---------- dates (always Gregorian) ---------- */

/*
 * We never hand 'ar-SA' a date to format: on its own it defaults to the
 * Hijri calendar in many engines. Gregorian output is assembled from
 * riyadhParts(); anything that does go through Intl uses '-u-ca-gregory'.
 */
export const GREGORIAN_LOCALE = Object.freeze({ ar: 'ar-SA-u-ca-gregory-nu-arab', en: 'en-GB-u-ca-gregory' });

/** 'الثلاثاء، ١٣ أكتوبر ٢٠٢٦' / 'Tuesday, 13 October 2026'. Pass {weekday:false} to drop the day name. */
export function dateLong(d, lang = 'ar', { weekday: withWd = true, year = true } = {}) {
  const p = riyadhParts(d);
  const l = L(lang);
  const core = `${p.day} ${MONTHS[l][p.month - 1]}${year ? ' ' + p.year : ''}`;
  const out = withWd ? `${WD[l][p.weekday]}${l === 'ar' ? '، ' : ', '}${core}` : core;
  return digits(out, l);
}

/** '١٣ أكتوبر' / '13 Oct'. Options: {weekday:true} → 'الثلاثاء ١٣ أكتوبر' / 'Tue 13 Oct', {year:true}. */
export function dateShort(d, lang = 'ar', { weekday: withWd = false, year = false } = {}) {
  const p = riyadhParts(d);
  const l = L(lang);
  let out = `${p.day} ${MONTHS_SHORT[l][p.month - 1]}${year ? ' ' + p.year : ''}`;
  if (withWd) out = `${(l === 'ar' ? WD : WD_SHORT)[l][p.weekday]} ${out}`;
  return digits(out, l);
}

/** 'أكتوبر ٢٠٢٦' / 'October 2026'. */
export function monthYear(d, lang = 'ar') {
  const p = riyadhParts(d);
  return digits(`${MONTHS[L(lang)][p.month - 1]} ${p.year}`, L(lang));
}

/* ---------- Hijri (Umm al-Qura) ---------- */

let hijriFmt;
function hijriFormatter() {
  if (hijriFmt !== undefined) return hijriFmt;
  for (const cal of ['islamic-umalqura', 'islamic']) {
    try {
      const f = new Intl.DateTimeFormat(`en-u-ca-${cal}-nu-latn`, {
        day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Riyadh',
      });
      if (f.resolvedOptions().calendar.startsWith('islamic')) return (hijriFmt = f);
    } catch { /* try next */ }
  }
  return (hijriFmt = null);
}

/** Umm al-Qura date parts: {day, month (1–12), year}, or null when the engine lacks the calendar. */
export function hijriParts(d) {
  const f = hijriFormatter();
  if (!f) return null;
  const parts = f.formatToParts(toDate(d));
  const get = (t) => Number(String(parts.find((p) => p.type === t)?.value ?? '').replace(/\D/g, ''));
  const year = get('year') || get('relatedYear');
  return { day: get('day'), month: get('month'), year };
}

/** '٢٢ ربيع الآخر ١٤٤٨' / '22 Rabiʻ II 1448 AH'. */
export function hijri(d, lang = 'ar') {
  const h = hijriParts(d);
  if (!h) return '';
  const l = L(lang);
  const out = `${h.day} ${HIJRI_MONTHS[l][h.month - 1]} ${h.year}${l === 'en' ? ' AH' : ''}`;
  return digits(out, l);
}

/** 'جمادى الأولى ١٤٤٨' / 'Jumada I 1448 AH'. */
export function hijriMonthYear(d, lang = 'ar') {
  const h = hijriParts(d);
  if (!h) return '';
  const l = L(lang);
  return digits(`${HIJRI_MONTHS[l][h.month - 1]} ${h.year}${l === 'en' ? ' AH' : ''}`, l);
}

/** Compact Hijri for tight spaces (date strip): '٢٢ ربيع ٢' / '22 Rab II'. */
export function hijriShort(d, lang = 'ar') {
  const h = hijriParts(d);
  if (!h) return '';
  const l = L(lang);
  return digits(`${h.day} ${HIJRI_MONTHS_SHORT[l][h.month - 1]}`, l);
}

/* ---------- times ---------- */

/**
 * 12-hour clock: '٩:٣٠ م' / '9:30 PM'.
 * Accepts an instant (formatted in Riyadh) or a plain 'HH:MM' wall-clock string.
 */
export function time(d, lang = 'ar') {
  let h, m;
  const hm = typeof d === 'string' && /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(d.trim());
  if (hm) { h = +hm[1]; m = +hm[2]; } else { const p = riyadhParts(d); h = p.hour; m = p.minute; }
  h %= 24;
  const ar = isAr(lang);
  const period = h < 12 ? (ar ? 'ص' : 'AM') : (ar ? 'م' : 'PM');
  const h12 = h % 12 || 12;
  return digits(`${h12}:${pad2(m)} ${period}`, ar ? 'ar' : 'en');
}

/** Arabic counted noun: 1 دقيقة · 2 دقيقتان · 3–10 دقائق · 11+ دقيقة. */
function arCount(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  const r = n % 100;
  if (r >= 3 && r <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** '٤٥ دقيقة' · 'ساعة و١٥ دقيقة' / '45 min' · '1 h 15 min'. */
export function durationMin(n, lang = 'ar') {
  const total = Math.max(0, Math.round(Number(n) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!isAr(lang)) {
    if (!h) return `${m} min`;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const hs = h ? arCount(h, 'ساعة', 'ساعتان', 'ساعات', 'ساعة') : '';
  const ms = m || !h ? arCount(m, 'دقيقة', 'دقيقتان', 'دقائق', 'دقيقة') : '';
  return digits(hs && ms ? `${hs} و${ms}` : hs || ms, 'ar');
}

/* ---------- day labels ---------- */

/** 'اليوم' / 'غداً' / 'الخميس' — relative to `now` in Riyadh. */
export function dayLabel(dateISO, lang = 'ar', now = new Date()) {
  const iso = typeof dateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : riyadhDateISO(dateISO);
  const today = riyadhDateISO(now);
  const ar = isAr(lang);
  if (iso === today) return ar ? 'اليوم' : 'Today';
  if (iso === addDaysISO(today, 1)) return ar ? 'غداً' : 'Tomorrow';
  return weekday(iso, lang);
}

/** Whole days from Riyadh-today to dateISO (negative in the past). */
export function daysFromToday(dateISO, now = new Date()) {
  const a = Date.parse(riyadhDateISO(now) + 'T00:00:00Z');
  const b = Date.parse(dateISO + 'T00:00:00Z');
  return Math.round((b - a) / DAY_MS);
}

/* ---------- phone ---------- */

/**
 * Normalise a phone number to E.164.
 * Saudi mobiles in any common shape (05…, 5…, 9665…, +9665…, 009665…,
 * Arabic-Indic digits, spaces, dashes) → '+9665XXXXXXXX'.
 * Other international numbers given with '+' or '00' and 8–15 digits → '+…'.
 * Anything else → null.
 */
export function normalizePhone(input) {
  if (input == null) return null;
  let s = toLatin(String(input)).trim();
  if (!s) return null;
  if (/[^\d\s+().\-‎‏‪-‮⁦-⁩]/.test(s)) return null;
  s = s.replace(/[\s().\-‎‏‪-‮⁦-⁩]/g, '');
  let intl = false;
  if (s.startsWith('+')) { intl = true; s = s.slice(1); }
  else if (s.startsWith('00')) { intl = true; s = s.slice(2); }
  if (!/^\d+$/.test(s)) return null;

  // Saudi Arabia
  if (s.startsWith('966')) {
    let rest = s.slice(3);
    if (rest.startsWith('0')) rest = rest.slice(1);              // +966 05… typed by habit
    if (rest.startsWith('5')) return /^5\d{8}$/.test(rest) ? `+966${rest}` : null;
    return /^\d{8,9}$/.test(rest) ? `+966${rest}` : null;        // landlines etc.
  }
  if (!intl) {
    if (/^05\d{8}$/.test(s)) return `+966${s.slice(1)}`;
    if (/^5\d{8}$/.test(s)) return `+966${s}`;
    return null;
  }
  return s.length >= 8 && s.length <= 15 && s[0] !== '0' ? `+${s}` : null;
}

/** '+966559797724' → '٠٥٥ ٩٧٩ ٧٧٢٤' / '055 979 7724'. Other numbers keep E.164. */
export function formatPhone(e164, lang = 'ar') {
  const n = normalizePhone(e164);
  if (!n) return String(e164 ?? '');
  const m = /^\+966(5\d)(\d{3})(\d{4})$/.exec(n);
  const out = m ? `0${m[1]} ${m[2]} ${m[3]}` : n;
  // In Arabic, force the number left-to-right (isolate U+2066 + override U+202D … U+202C U+2069),
  // or the digit groups flip order inside Arabic text.
  return lang === 'ar' ? `⁦‭${digits(out, lang)}‬⁩` : digits(out, lang);
}

/** wa.me link for a phone (digits only, no '+'). */
export function whatsappUrl(e164, text = '') {
  const n = normalizePhone(e164);
  if (!n) return null;
  return `https://wa.me/${n.slice(1)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
