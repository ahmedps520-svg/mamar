import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/* A fake localStorage so the persistence path runs in Node (installed before i18n reads it). */
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
});

const i18n = await import('../../platform/i18n.js');
const { default: common } = await import('../../platform/i18n/common.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SURFACES = ['start', 'book', 'manage', 'admin'];

/* ---------- dictionary checks ---------- */

const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

function checkDict(name, dict) {
  assert.ok(dict && typeof dict === 'object', `${name}: default export must be {ar, en}`);
  assert.ok(dict.ar && dict.en, `${name}: needs both ar and en`);
  const ar = Object.keys(dict.ar).sort();
  const en = Object.keys(dict.en).sort();
  const onlyAr = ar.filter((k) => !(k in dict.en));
  const onlyEn = en.filter((k) => !(k in dict.ar));
  assert.deepEqual({ onlyAr, onlyEn }, { onlyAr: [], onlyEn: [] }, `${name}: ar and en key sets differ`);
  for (const l of ['ar', 'en']) {
    for (const [k, v] of Object.entries(dict[l])) {
      assert.equal(typeof v, 'string', `${name} ${l}.${k} must be a string`);
      assert.ok(v.trim().length > 0, `${name} ${l}.${k} is empty`);
    }
  }
  for (const k of ar) {
    const a = placeholders(dict.ar[k]);
    const e = placeholders(dict.en[k]);
    assert.deepEqual([...a].sort(), [...e].sort(), `${name} "${k}": placeholders differ (ar {${[...a]}} / en {${[...e]}})`);
  }
}

async function findDictFiles(dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await findDictFiles(p));
    else if (e.name === 'i18n.js') out.push(p);
  }
  return out;
}

test('platform/i18n/common.js: identical keys, no empty strings, matching placeholders', () => {
  checkDict('common', common);
  assert.ok(Object.keys(common.ar).length > 60);
});

test('common.js carries the required shared strings', () => {
  for (const k of ['back', 'next', 'continue', 'done', 'cancel', 'save', 'close', 'loading', 'error.generic',
    'retry', 'today', 'tomorrow', 'sar', 'copied', 'made_by', 'lang.ar', 'lang.en', 'unit.min', 'unit.hour',
    'wd.0', 'wd.6', 'wds.0', 'wds.6']) {
    assert.ok(k in common.ar && k in common.en, `missing ${k}`);
  }
  assert.equal(common.ar.sar, 'ر.س');
  assert.equal(common.en.sar, 'SAR');
  assert.equal(common.ar.made_by, 'صُنع بواسطة ممر');
  assert.equal(common.en.made_by, 'Made by Mamar');
});

const found = (await Promise.all(SURFACES.map(async (s) => {
  const dir = path.join(ROOT, s);
  try { if (!(await stat(dir)).isDirectory()) return []; } catch { return []; }
  return findDictFiles(dir);
}))).flat();

if (!found.length) {
  test('surface dictionaries (start/, book/, manage/, admin/)', { skip: 'no surface i18n.js files yet' }, () => {});
}
for (const file of found) {
  test(`${path.relative(ROOT, file).replace(/\\/g, '/')}: identical keys, no empty strings, matching placeholders`, async () => {
    const mod = await import(pathToFileURL(file).href);
    checkDict(path.relative(ROOT, file), mod.default);
  });
}

/* ---------- runtime ---------- */

test('defaults to Arabic, RTL', () => {
  i18n._reset();
  mem.clear();
  assert.equal(i18n.lang(), 'ar');
  assert.equal(i18n.dir(), 'rtl');
  assert.equal(i18n.dir('en'), 'ltr');
});

test('setLang persists to mamar-lang and notifies', () => {
  i18n._reset();
  mem.clear();
  const seen = [];
  const off = i18n.onLang((l, d) => seen.push(`${l}/${d}`));
  i18n.setLang('en');
  assert.equal(i18n.lang(), 'en');
  assert.equal(mem.get('mamar-lang'), 'en');
  i18n.setLang('en');               // no change → no second event
  i18n.setLang('xx');               // invalid → ignored
  off();
  i18n.setLang('ar');
  assert.deepEqual(seen, ['en/ltr']);
  assert.equal(mem.get('mamar-lang'), 'ar');
  // a fresh page picks up the saved choice
  mem.set('mamar-lang', 'en');
  i18n._reset();
  assert.equal(i18n.lang(), 'en');
});

test('allowLangs restricts without overwriting the saved preference', () => {
  i18n._reset();
  mem.set('mamar-lang', 'en');
  assert.equal(i18n.lang(), 'en');
  i18n.allowLangs(['ar']);
  assert.equal(i18n.lang(), 'ar');
  assert.equal(mem.get('mamar-lang'), 'en');
  i18n.setLang('en');
  assert.equal(i18n.lang(), 'ar');
  assert.deepEqual(i18n.allowedLangs(), ['ar']);
  i18n._reset();
});

test('t(): interpolation, localised numbers, fallbacks', () => {
  i18n._reset();
  mem.clear();
  i18n.register(common);
  i18n.register({ ar: { 'x.only_ar': 'عربي فقط' }, en: { 'x.only_en': 'English only' } });
  assert.equal(i18n.t('back'), 'رجوع');
  assert.equal(i18n.t('step_of', { n: 2, total: 4 }), 'الخطوة ٢ من ٤');
  assert.equal(i18n.t('step_of', { n: 2, total: 4 }, 'en'), 'Step 2 of 4');
  assert.equal(i18n.t('save_amount', { amount: '٢٥٠ ر.س' }), 'وفّر ٢٥٠ ر.س');
  assert.equal(i18n.t('step_of', { n: 2 }, 'en'), 'Step 2 of {total}');   // unknown vars stay visible
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    assert.equal(i18n.t('x.only_en'), 'English only');                   // falls back to the other language
    assert.equal(i18n.t('x.only_en'), 'English only');
    assert.equal(i18n.t('x.nope'), 'x.nope');                            // then to the key
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 2, 'warns once per key');
});

test('tn(): Arabic plural categories via Intl.PluralRules', () => {
  i18n.register(common);
  const ar = (n) => i18n.tn('bookings', n, {}, 'ar');
  const en = (n) => i18n.tn('bookings', n, {}, 'en');
  assert.equal(ar(0), 'لا توجد حجوزات');
  assert.equal(ar(1), 'حجز واحد');
  assert.equal(ar(2), 'حجزان');
  assert.equal(ar(3), '٣ حجوزات');
  assert.equal(ar(10), '١٠ حجوزات');
  assert.equal(ar(11), '١١ حجزاً');
  assert.equal(ar(99), '٩٩ حجزاً');
  assert.equal(ar(100), '١٠٠ حجز');
  assert.equal(en(0), 'No bookings');
  assert.equal(en(1), '1 booking');
  assert.equal(en(2), '2 bookings');
  assert.equal(en(12), '12 bookings');
  assert.equal(i18n.tn('minutes', 5, {}, 'ar'), '٥ دقائق');
  assert.equal(i18n.tn('minutes', 1, {}, 'ar'), 'دقيقة واحدة');
});

test('DOM helpers are safe to call in Node', () => {
  assert.doesNotThrow(() => i18n.applyDom());
  assert.equal(typeof i18n.langToggle(null), 'function');
  assert.equal(i18n.boot(), i18n.lang());
});
