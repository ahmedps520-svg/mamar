/* ==========================================================
   Mamar Booking — prayer times (Umm al-Qura method)
   Pure module: no DOM, works in Node and the browser.

   Method (the official Saudi calendar):
     Fajr     sun altitude −18.5°
     Dhuhr    solar noon (rounding up gives the 0–1 min safety margin)
     Asr      shadow length = object + noon shadow (factor 1)
     Maghrib  sunset, altitude −0.833° (refraction + solar radius)
     Isha     Maghrib + 90 min, or + 120 min during Ramadan

   The astronomy is written from the standard published formulas
   (Meeus, "Astronomical Algorithms": Julian day ch. 7, low-accuracy
   solar coordinates ch. 25, equation of time ch. 28).
   Times are rounded UP to the next minute, which is what the
   official Umm al-Qura tables do (checked against the KACST
   service behind ummulqura.org.sa — see dev/test/prayer.test.mjs).
   ========================================================== */

export const JEDDAH = Object.freeze({ lat: 21.4858, lng: 39.1925, tz: 3 });
export const PRAYERS = Object.freeze(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const tan = (d) => Math.tan(d * RAD);
const asin = (x) => Math.asin(x) * DEG;
const acos = (x) => Math.acos(Math.max(-1, Math.min(1, x))) * DEG;
const atan = (x) => Math.atan(x) * DEG;
const fix = (a, b) => ((a % b) + b) % b;

/** Julian day at 0h UT of a Gregorian calendar date (Meeus 7.1). */
export function julianDay(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

/**
 * Sun declination (degrees) and equation of time (minutes) at a Julian day.
 * Low-accuracy solar coordinates: ~0.01°, far below one minute of time.
 */
export function sunPosition(jd) {
  const T = (jd - 2451545.0) / 36525;                                 // centuries from J2000
  const L0 = fix(280.46646 + T * (36000.76983 + 0.0003032 * T), 360);  // mean longitude
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);             // mean anomaly
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);        // eccentricity
  const C = sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T))        // equation of centre
          + sin(2 * M) * (0.019993 - 0.000101 * T)
          + sin(3 * M) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * sin(omega);              // apparent longitude
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cos(omega);                             // true obliquity
  const decl = asin(sin(eps) * sin(lambda));
  const y = tan(eps / 2) ** 2;
  const eqt = 4 * DEG * (                                              // minutes of time
      y * sin(2 * L0)
    - 2 * e * sin(M)
    + 4 * e * y * sin(M) * cos(2 * L0)
    - 0.5 * y * y * sin(4 * L0)
    - 1.25 * e * e * sin(2 * M));
  return { decl, eqt };
}

/* ---------- solver ---------- */

/** Local clock time (fractional hours) of solar noon, iterated at the event. */
function solarNoon(jd0, lng, tz) {
  let t = 12;
  for (let i = 0; i < 2; i++) {
    const { eqt } = sunPosition(jd0 + (t - tz) / 24);
    t = 12 + tz - lng / 15 - eqt / 60;
  }
  return t;
}

/**
 * Local time (hours) at which the sun's centre reaches `alt` degrees,
 * before (side −1) or after (side +1) solar noon. Iterated so declination
 * and equation of time are taken at the moment of the event itself.
 */
function timeAtAltitude(jd0, lat, lng, tz, alt, side, guess) {
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const { decl, eqt } = sunPosition(jd0 + (t - tz) / 24);
    const noon = 12 + tz - lng / 15 - eqt / 60;
    const cosH = (sin(alt) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
    if (cosH < -1 || cosH > 1) return NaN; // the sun never reaches this altitude today
    t = noon + side * acos(cosH) / 15;
  }
  return t;
}

/** Asr: the altitude where shadow = factor × object + noon shadow. */
function asrTime(jd0, lat, lng, tz, factor) {
  let t = 15.5;
  for (let i = 0; i < 3; i++) {
    const { decl } = sunPosition(jd0 + (t - tz) / 24);
    const alt = atan(1 / (factor + tan(Math.abs(lat - decl))));
    t = timeAtAltitude(jd0, lat, lng, tz, alt, +1, t);
  }
  return t;
}

/* ---------- Ramadan ---------- */

const HIJRI_MONTH = (() => {
  try {
    return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', timeZone: 'UTC' });
  } catch { return null; }
})();

/** True when a Gregorian date ('YYYY-MM-DD') falls in Ramadan on the Umm al-Qura calendar. */
export function isRamadan(dateISO) {
  if (!HIJRI_MONTH) return false;
  const [y, m, d] = parseISO(dateISO);
  const part = HIJRI_MONTH.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)))
    .find((p) => p.type === 'month');
  return !!part && Number(String(part.value).replace(/\D/g, '')) === 9;
}

/* ---------- helpers ---------- */

function parseISO(dateISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateISO));
  if (!m) throw new TypeError(`prayer: expected YYYY-MM-DD, got "${dateISO}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/* Fractional hours → minutes past midnight, rounded up (as the official tables). */
const ceilMin = (h) => Math.ceil(Math.round(h * 60 * 1e4) / 1e4);

const hhmm = (min) => {
  const v = fix(min, 1440);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

function addDays(dateISO, n) {
  const [y, m, d] = parseISO(dateISO);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* ---------- public API ---------- */

/**
 * Prayer times for one day.
 * @param {string} dateISO 'YYYY-MM-DD' (local calendar date)
 * @param {{lat?:number, lng?:number, tz?:number, ramadan?:boolean,
 *          adjust?:{fajr?:number, dhuhr?:number, asr?:number, maghrib?:number, isha?:number},
 *          minutes?:boolean}} [opts]  adjust = extra minutes; minutes:true returns minutes past midnight
 * @returns {{fajr:string, dhuhr:string, asr:string, maghrib:string, isha:string}} 'HH:MM' local
 */
export function prayerTimes(dateISO, opts = {}) {
  const lat = opts.lat ?? JEDDAH.lat;
  const lng = opts.lng ?? JEDDAH.lng;
  const tz = opts.tz ?? JEDDAH.tz;
  const adj = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0, ...(opts.adjust || {}) };
  const [y, m, d] = parseISO(dateISO);
  const jd0 = julianDay(y, m, d);

  const ramadan = typeof opts.ramadan === 'boolean' ? opts.ramadan : isRamadan(dateISO);
  const min = {
    fajr: ceilMin(timeAtAltitude(jd0, lat, lng, tz, -18.5, -1, 5)) + adj.fajr,
    dhuhr: ceilMin(solarNoon(jd0, lng, tz)) + adj.dhuhr,
    asr: ceilMin(asrTime(jd0, lat, lng, tz, 1)) + adj.asr,
    maghrib: ceilMin(timeAtAltitude(jd0, lat, lng, tz, -0.833, +1, 18.5)) + adj.maghrib,
  };
  min.isha = min.maghrib + (ramadan ? 120 : 90) + adj.isha;

  if (opts.minutes) return min;
  return {
    fajr: hhmm(min.fajr),
    dhuhr: hhmm(min.dhuhr),
    asr: hhmm(min.asr),
    maghrib: hhmm(min.maghrib),
    isha: hhmm(min.isha),
  };
}

/** Sunrise (altitude −0.833°) as 'HH:MM', rounded down like the official tables. */
export function sunrise(dateISO, opts = {}) {
  const [y, m, d] = parseISO(dateISO);
  const t = timeAtAltitude(julianDay(y, m, d), opts.lat ?? JEDDAH.lat, opts.lng ?? JEDDAH.lng,
    opts.tz ?? JEDDAH.tz, -0.833, -1, 6);
  return hhmm(Math.floor(t * 60 + 1e-6));
}

/**
 * Prayer times for consecutive days, for bulk upload.
 * @returns {Array<{day:string, fajr:string, dhuhr:string, asr:string, maghrib:string, isha:string}>}
 */
export function prayerYear(fromISO, days = 365, opts = {}) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(fromISO, i);
    out.push({ day, ...prayerTimes(day, opts) });
  }
  return out;
}
