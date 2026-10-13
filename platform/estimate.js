// Mamar Booking — the configurator's live total. Mirrors SQL public._estimate() exactly
// (dev/test/estimate.test.mjs checks them against each other). The server always recomputes;
// this is only for the running "Your system · 5,799 SAR" bar.
//
// sheet = rpc('pub_price_sheet') → { items: [{key, amount_halalas, …}], plans: [{code, …}] }
// answers = SETUP_ANSWERS (see contract.js)

export function serviceCount(a) {
  if (a.services_later || !Array.isArray(a.services)) return Math.max(0, parseInt(a.service_count, 10) || 0);
  return a.services.length;
}

/** The price-sheet keys an answer set selects, with quantities. Same order of rules as the SQL. */
export function chosenKeys(a = {}) {
  const n = serviceCount(a);
  const br = Math.min(20, Math.max(1, parseInt(a.branches, 10) || 1));
  const out = [['base_standard', 1]];
  if (a.look === 'custom') out.push(['look_custom', 1]);
  if (a.langs === 'both') out.push(['langs_both', 1]);
  if (a.staff_choice) out.push(['staff_choice', 1]);
  if (a.sections) out.push(['sections', 1]);
  if (a.home_service) out.push(['home_service', 1]);
  if (a.prayer) out.push(['prayer', 1]);
  if (a.hijri) out.push(['hijri', 1]);
  if (a.payment === 'deposit' || a.payment === 'full') out.push(['payments', 1]);
  if (a.customer === 'name_phone_email') out.push(['customer_email', 1]);
  if (a.customer === 'sms') out.push(['customer_sms', 1]);
  if (a.customer === 'accounts') out.push(['customer_accounts', 1]);
  if (a.extras?.self_manage) out.push(['self_manage', 1]);
  if (a.extras?.waitlist) out.push(['waitlist', 1]);
  if (n >= 16 && n <= 40) out.push(['services_16_40', 1]);
  if (n > 40) out.push(['services_40_plus', 1]);
  if (br > 1) out.push(['branch_extra', br - 1]);
  return out;
}

/** → { lines, setup_halalas, has_quote, service_count, plan } (same shape as the SQL). */
export function estimate(sheet, a = {}) {
  const items = new Map((sheet?.items || []).map((i) => [i.key, i]));
  const lines = [];
  let total = 0;
  for (const [key, qty] of chosenKeys(a)) {
    const it = items.get(key);
    if (!it) continue;
    const quote = it.amount_halalas == null;
    const amount = quote ? null : it.amount_halalas * qty;
    if (!quote) total += amount;
    lines.push({ key, grp: it.grp, label_ar: it.label_ar, label_en: it.label_en, qty,
      unit_halalas: it.amount_halalas ?? null, amount_halalas: amount, quote, sort: it.sort ?? 0 });
  }
  lines.sort((x, y) => (x.sort - y.sort) || x.key.localeCompare(y.key));
  lines.forEach((l) => delete l.sort);

  const code = a.plan?.code && a.plan.code !== 'none' ? a.plan.code : null;
  const interval = a.plan?.interval === 'yearly' ? 'yearly' : 'monthly';
  const pl = code ? (sheet?.plans || []).find((p) => p.code === code) : null;
  const plan = pl
    ? { code: pl.code, interval, name_ar: pl.name_ar, name_en: pl.name_en,
        amount_halalas: interval === 'yearly' ? pl.yearly_halalas : pl.monthly_halalas,
        saving_halalas: interval === 'yearly' ? pl.monthly_halalas * 12 - pl.yearly_halalas : 0 }
    : { code: 'none', amount_halalas: 0 };

  return { lines, setup_halalas: total, has_quote: lines.some((l) => l.quote), service_count: serviceCount(a), plan };
}

/** "+ 1,200" deltas for an option card: what the total would be if `patch` were applied. */
export function deltaFor(sheet, answers, patch) {
  const before = estimate(sheet, answers).setup_halalas;
  const after = estimate(sheet, { ...answers, ...patch, extras: { ...(answers.extras || {}), ...(patch.extras || {}) } }).setup_halalas;
  return after - before;
}
