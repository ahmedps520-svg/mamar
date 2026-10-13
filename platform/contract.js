// Mamar Booking — the frozen contract between the server and the four surfaces.
// Surfaces: /start/ (setup configurator), /book/ + embed.js (customers), /manage/ (owners), /admin/ (Ahmed).
//
// RULES
//  • All server access: `import { rpc } from '/platform/api.js'` → rpc(name, args) → Promise<json>.
//    Errors are ApiError {code}; show t(errorKey(e)) from i18n (keys in platform/i18n/errors.js).
//  • Money is integer halalas (8000 = 80 SAR). Format with fmt.money(). Never do float math on SAR.
//  • Instants are ISO strings (UTC from the server); show them in Asia/Riyadh with fmt.*.
//    A "day" is 'YYYY-MM-DD' in Riyadh. Opening hours are minutes after local midnight (>1440 = past midnight).
//  • Bilingual rows carry *_ar / *_en; pick with pick(row, 'name') below.
//  • Live updates: live(business_id, ({catalog, slots}) => refetch) from /platform/live.js.
//  • User-entered text → textContent only. Never innerHTML with data.

export const pick = (row, field, lang) => {
  const l = lang || (globalThis.document?.documentElement.lang === 'en' ? 'en' : 'ar');
  const other = l === 'en' ? 'ar' : 'en';
  return (row && (row[`${field}_${l}`] || row[`${field}_${other}`])) || '';
};

// ───────────── RPCs ─────────────
// Shapes are abbreviated; every function takes ONE object and returns ONE object.
export const RPC = {
  // ── public (no login) ──
  pub_business: '{slug | business_id} → {business{id,slug,status,is_demo,kind,name_*,tagline_*,phone,address_*,maps_url,site_url,instagram,lat,lng,langs[],look,theme{mode,accent,bg,ink,font,radius,logo_url},moyasar_pk}, flow{notice_min,horizon_days,staff_choice,sections,hijri,home{on,fee_halalas,travel_min},prayer{on,…},payment{mode:"shop"|"deposit"|"full",deposit_kind,deposit_value,ready},customer{email:"off"|"optional"|"required"},self_manage{on,cutoff_hours},waitlist,hold_min}, sections[{id,name_*,audience}], categories[{id,section_id,name_*}], services[{id,section_id,category_id,name_*,desc_*,duration_min,mode,max_qty,per_person,price_from,location:"shop"|"mobile"|"both",price{price,discount,fee,total,offer_id,offer_ar,offer_en}}], staff[{id,section_id,label_*,services}] (only when staff_choice), offers[{id,kind,value,title_*,service_ids,weekdays,starts_at,ends_at}], hours[{section_id,weekday,open_min,close_min}], live{catalog,slots}}',
  pub_days: '{service_id, section_id?, staff_id?, qty?, location?} → {days:[{day:"YYYY-MM-DD", n}]}  (n = bookable starts that day; may include yesterday if its late-night slots are still open)',
  pub_slots: '{service_id, day, section_id?, staff_id?, qty?, location?} → {day, slots:[{t, end, n}], price{price,discount,fee,total,offer_*}}  (n = free staff or places left)',
  pub_book: '{service_id, start(ISO), name, phone, email?, note?, section_id?, staff_id?, qty?, location?:"shop"|"mobile", lat?, lng?, address?, lang, source:"web"|"embed"|"link", website(honeypot: always "")} → {booking_id, ref, token, status:"confirmed"|"pending_payment", starts_at, ends_at, hold_until, qty, location, service_name_*, staff_label_*, price_halalas, discount_halalas, fee_halalas, total_halalas, due_now_halalas}',
  pub_booking: '{token} → {booking{…}, business{id,slug,name_*,phone,address_*,maps_url,langs,look,theme,is_demo,moyasar_pk}, can_cancel, can_reschedule, cutoff_hours}',
  pub_cancel: '{token, reason?} → same as pub_booking',
  pub_reschedule: '{token, start} → same as pub_booking',
  pub_waitlist_join: '{service_id, day, part:"any"|"morning"|"afternoon"|"evening", qty?, name, phone} → {ok}',
  pub_attach_payment: '{booking_id, token, moyasar_id} → {ok}',
  pub_payment_status: '{booking_id, token} → {status, paid_halalas, due_now_halalas, hold_until, pay_flag, moyasar_id}',
  pub_price_sheet: '{} → {items:[{key,grp,label_*,desc_*,amount_halalas|null(quote),per_unit,sort}], plans:[{code,name_*,desc_*,monthly_halalas,yearly_halalas,yearly_saving_halalas}]}',
  pub_submit_setup: '{answers: SETUP_ANSWERS, contact:{name, phone, email?}, lang, website(honeypot)} → {id, ref, estimate}',
  pub_live: '{business_id} → {catalog, slots, admin}',

  // ── owners (signed in; business_id must be theirs) ──
  own_me: '{} → {user_id, email, is_admin, businesses:[{id,slug,name_*,status,kind,look,is_demo,langs}]}',
  own_overview: '{business_id} → {business{…, entitlements, settings, moyasar_ready, setup_halalas}, cfg (=flow), sections, categories, services (raw rows + price), staff, resources, offers, hours, special_hours, subscription, counts{today,upcoming,waitlist}, live}',
  own_bookings: '{business_id, from:"YYYY-MM-DD", to:"YYYY-MM-DD", all?} → {bookings:[BookingRow], blocks:[{id,section_id,staff_id,resource_id,starts_at,ends_at,reason}]}',
  own_slots: '{business_id, service_id, day, section_id?, staff_id?, qty?, location?, ignore?(booking_id)} → {slots:[{t,end,n,staff_ids}]}  (owner view: no notice/horizon/prayer limits)',
  own_booking_create: '{business_id, service_id, start, staff_id?, qty?, name?, phone?, note?, walkin?, force?} → booking (like pub_book)',
  own_booking_status: '{business_id, booking_id, status:"confirmed"|"completed"|"no_show"|"cancelled", reason?} → BookingRow',
  own_booking_move: '{business_id, booking_id, start, staff_id?, force?} → BookingRow',
  own_booking_bulk_cancel: '{business_id, booking_ids:[]} → {cancelled}',
  own_booking_edit: '{business_id, booking_id, name?, phone?, email?, note?} → BookingRow',
  own_block_upsert: '{business_id, block:{id?, starts_at, ends_at, section_id?, staff_id?, resource_id?, reason}} → {id}',
  own_block_delete: '{business_id, id} → {ok}',
  own_service_upsert: '{business_id, service:{id?, name_ar, name_en, desc_ar, desc_en, duration_min, buffer_min, step_min, mode, resource_id, max_qty, per_person, price_halalas, price_from, location, active, sort, section_id, category_id}} → {id}   (errors: LIMIT_SERVICES, FEATURE_OFF)',
  own_service_delete: '{business_id, id} → {ok, archived?}',
  own_category_upsert: '{business_id, category:{id?, name_ar, name_en, section_id?, sort}} → {id}',
  own_category_delete: '{business_id, id} → {ok}',
  own_offer_upsert: '{business_id, offer:{id?, kind:"percent"|"amount"|"banner", value, title_ar, title_en, service_ids[]|null, weekdays[0-6]|null, starts_at?, ends_at?, active}} → {id}',
  own_offer_delete: '{business_id, id} → {ok}',
  own_hours_set: '{business_id, section_id, hours:[{weekday, open_min, close_min}]} → {ok}',
  own_special_hours_upsert: '{business_id, item:{id?, section_id?, from_date, to_date, ranges:[[open,close]] ([] = closed), label_ar, label_en}} → {id}',
  own_special_hours_delete: '{business_id, id} → {ok}',
  own_staff_upsert: '{business_id, item:{id?, label_ar, label_en, section_id?, services:[ids]|null, active, sort}} → {id}',
  own_staff_delete: '{business_id, id} → {ok, archived?}',
  own_resource_upsert: '{business_id, item:{id?, label_ar, label_en, capacity, section_id?, active, sort}} → {id}',
  own_resource_delete: '{business_id, id} → {ok, archived?}',
  own_settings_update: '{business_id, settings:{notice_min?, horizon_days?, hijri?, max_per_phone?, customer?{email}, staff_choice?, prayer?{on,fajr,before_min,after_min,jumuah_min}, payment?{mode,deposit_kind,deposit_value}, self_manage?{cutoff_hours}, home?{fee_halalas,travel_min}}} → {settings, cfg}  (only entitled keys stick)',
  own_profile_update: '{business_id, profile:{name_ar?, name_en?, tagline_*, phone?, address_*, maps_url?, site_url?, instagram?, lat?, lng?}} → {ok}',
  own_waitlist: '{business_id} → {items:[{id,service_id,service_name_*,day,part,qty,name,phone,status,created_at}]}',
  own_waitlist_update: '{business_id, id, status:"waiting"|"contacted"|"booked"|"removed"} → {ok}',
  own_billing: '{business_id} → {subscription{plan_code,interval,status,requested_code,requested_interval,period_end}, plans[…,yearly_saving_halalas], setup_halalas}',
  own_plan_request: '{business_id, plan_code:"care"|"live"|"none", interval:"monthly"|"yearly"} → own_billing  (notifies Ahmed)',
  own_push_subscribe: '{endpoint, keys{p256dh,auth}, lang, ua} → {ok}',
  own_push_unsubscribe: '{endpoint} → {ok}',

  // ── Ahmed (admin) ──
  adm_overview: '{} → {requests{new,open,drafts}, businesses{active,awaiting_payment,draft,demo}, plans{active,requested,mrr_halalas}, bookings_today, unread, notifications[12]}',
  adm_requests: '{status?} → {items:[{id,ref,status,source,business_name,kind,contact_name,phone,email,setup_halalas,plan_code,plan_interval,plan_halalas,business_id,created_at}]}  (no status = everything except drafts; status:"draft" = assisted drafts)',
  adm_request: '{id} → full setup_requests row {…, answers, estimate{lines,setup_halalas,plan}, note}',
  adm_request_update: '{id, status?:"new"|"reviewing"|"quoted"|"converted"|"declined", note?} → row',
  adm_request_delete: '{id} → {ok}',
  adm_draft_save: '{id?, answers, contact, lang} → {id, ref, estimate}   (assisted mode autosave)',
  adm_submit_assisted: '{id?, answers, contact, lang, create:boolean, slug?} → {request_id, ref, business_id|null, slug|null, estimate}',
  adm_business_create: '{request_id, slug?} → {business_id, slug}',
  adm_businesses: '{} → {items:[{id,slug,status,is_demo,kind,name_*,look,langs,setup_halalas,plan_code,plan_interval,plan_status,plan_requested,plan_requested_interval,owners,upcoming,created_at}]}',
  adm_business: '{business_id} → own_overview + {members:[{user_id,email,role}], request, secrets{moyasar_pk,has_sk}, pay_flags:[BookingRow]}',
  adm_business_update: '{business_id, patch:{status?, slug?, kind?, name_ar?, name_en?, look?, langs?[], theme?{}, entitlements?{}, settings?{}, is_demo?, city?, setup_halalas?, phone?}} → {id, slug, status}  (errors: SLUG_TAKEN)',
  adm_attach_owner: '{business_id, email} → {ok, user_id}  (error USER_NOT_FOUND)',
  adm_detach_owner: '{business_id, user_id} → {ok}',
  adm_set_moyasar_keys: '{business_id, pk:"pk_test_…|pk_live_…", sk?:"sk_…"} → {ok}',
  adm_price_items_update: '{items:[{key, amount_halalas|null, label_*?, desc_*?, active?}]} → {updated, items, plans}',
  adm_plans_update: '{plans:[{code, monthly_halalas?, yearly_halalas?, name_*?, desc_*?}]} → {items, plans}',
  adm_plan_set: '{business_id, plan_code:"care"|"live"|"none", interval, status?:"active"|"pending"|"past_due"|"cancelled", period_end?} → subscription',
  adm_prayer_upsert: '{city:"jeddah", rows:[{day,fajr,dhuhr,asr,maghrib,isha}]} → {upserted, last_day, days_left}  (rows from prayer.prayerYear())',
  adm_prayer_status: '{city?} → {first_day, last_day, days, days_left}',
  adm_notifications: '{limit?} → {items:[{id,kind,title_*,body_*,url,ref_id,read_at,created_at}], unread}',
  adm_notifications_read: '{ids?:[] | all:true} → {unread}',
  adm_notify_test: '{} → {ok}   (sends a test push + email)',
};

// BookingRow (owner/admin): {id, ref, status, starts_at, ends_at, busy_until, hold_until, section_id, service_id,
//   staff_id, resource_id, qty, service_name_*, staff_label_*, name, phone, email, note, location, address, lat, lng,
//   price_halalas, discount_halalas, fee_halalas, total_halalas, due_now_halalas, paid_halalas, pay_flag, source, lang,
//   created_at, cancel_reason}
// Statuses: pending_payment · confirmed · completed · no_show · cancelled · expired

// Helpers in api.js (not RPCs): signIn(identifier, password) · signOut() · currentUser() · onAuthChange(cb)
//   adminCreateUser(email, pw) (local only; cloud → 'USE_DASHBOARD') · uploadLogo(file, businessId)
//   publishLinkPage(slug, html) · githubToken.get/set · demoPay(booking_id, token, 'paid'|'failed') (local)
//   verifyPayment(booking_id, token, moyasar_id) (cloud) · vapidPublicKey() · mode() → 'local'|'cloud'

export const ERRORS = [
  'NOT_FOUND', 'NOT_ALLOWED', 'BAD_INPUT', 'BAD_NAME', 'BAD_PHONE', 'BAD_EMAIL', 'NEED_LOCATION', 'SLOT_TAKEN',
  'TOO_SOON', 'TOO_LATE', 'RATE_LIMITED', 'FEATURE_OFF', 'LIMIT_SERVICES', 'SLUG_TAKEN', 'USER_NOT_FOUND',
  'USER_EXISTS', 'BAD_LOGIN', 'USE_DASHBOARD', 'NO_GITHUB_TOKEN', 'PUBLISH_FAILED', 'UPLOAD_FAILED',
  'NOT_CONFIGURED', 'NETWORK', 'SERVER_ERROR', 'TOO_LARGE',
];

// ───────────── the setup configurator's answers (stored as setup_requests.answers) ─────────────
export const SETUP_ANSWERS = {
  business: { name_ar: '', name_en: '', kind: 'salon|carwash|activity|other', site_url: '', instagram: '' },
  services: [{ name: '', name_ar: '', name_en: '', duration_min: 30, price_sar: 0, max_qty: 1 }],
  services_later: false,          // true → "I'll send my price list"; then service_count is an estimate
  service_count: 0,
  hours: { 0: [[600, 1320]] },    // weekday (0 = Sunday) → [[open_min, close_min], …]; omit a day = closed
  slots: { mode: 'staff|capacity', staff_count: 1, capacity: 2 },
  staff_choice: false,
  sections: false,
  home_service: false,
  prayer: false,
  hijri: true,
  look: 'standard|custom',
  brand: { mode: 'light|dark', accent: '#RRGGBB', logo_note: '', fonts_note: '' },
  langs: 'ar|en|both',
  customer: 'name_phone|name_phone_email|sms|accounts',   // sms/accounts are "custom quote" lines
  payment: 'shop|deposit|full',
  extras: { self_manage: false, waitlist: false },
  branches: 1,
  plan: { code: 'none|care|live', interval: 'monthly|yearly' },
};
// Option deltas: estimate.deltaFor(sheet, {...answers, look:'standard'}, {look:'custom'}) → +250000.

// ───────────── booking URLs ─────────────
export const URLS = {
  link: (slug) => `/b/${slug}`,                                     // own link (404.html or published page)
  app: (slug, q = {}) => `/book/?${new URLSearchParams({ b: slug, ...q })}`, // q: service, embed=1, lang
  pay: (bookingId, token) => `/book/pay/?${new URLSearchParams({ bk: bookingId, t: token })}`,
  done: (bookingId, token) => `/book/done/?${new URLSearchParams({ bk: bookingId, t: token })}`,
  manage: (token) => `/book/m/?${new URLSearchParams({ t: token })}`,
  start: () => '/start/',
  assisted: (draftId) => `/start/?assist=1${draftId ? `&draft=${draftId}` : ''}`,
};

// Bookings a visitor made on this device (so the confirmation and "your bookings" survive a reload):
// localStorage 'mamar-bookings' = [{ref, token, booking_id, slug, starts_at, service_name_ar, service_name_en}]

// ───────────── embed.js ⇄ /book/?embed=1 (postMessage, both directions check origin) ─────────────
export const EMBED = {
  // iframe → host page
  READY: 'mamar:ready',            // {type}
  HEIGHT: 'mamar:height',          // {type, h}   (sheet height on desktop)
  CLOSE: 'mamar:close',            // {type}
  BOOKED: 'mamar:booked',          // {type, ref, starts_at, service_id}
  PAY: 'mamar:pay',                // {type, url}  host navigates window.top to url (3-D Secure / Apple Pay need top level)
  // host page → iframe
  OPEN: 'mamar:open',              // {type, service_id?, lang?}
};
// Host page markup:
//   <script src="https://mamar.site/book/embed.js" data-business="ward-barber" defer></script>
//   <button data-mamar-book>Book</button>  ·  <button data-mamar-book="<service_id>">Book a haircut</button>
//   <div data-mamar-prices></div> (live price list)  ·  <div data-mamar-offer></div> (live offer banner)
//   optional: data-lang="ar|en" on the script tag.
