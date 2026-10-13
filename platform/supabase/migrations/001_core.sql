-- Mamar Booking · 001 core schema
-- The same file runs on Supabase (SQL editor) and locally in PGlite (mamar/dev/server.js).
-- Every statement is re-runnable.
--
-- Ground rules
--   · All money is integer halalas (1 SAR = 100).
--   · All instants are timestamptz; business-day clock times are minutes after local midnight in Asia/Riyadh.
--     Never write '+03' in SQL — always `at time zone 'Asia/Riyadh'`.
--   · Clients never touch tables. They call RPCs fn(p jsonb) returns jsonb:
--       pub_  anyone          own_  business members (and admins)
--       adm_  admins only     svc_  service role only (Edge Functions)
--     `_`-prefixed functions are internal and granted to nobody (see 999_grants.sql).

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ───────────────────────── helpers ─────────────────────────

-- Raise a stable error code the clients translate (message = code, detail = optional json).
create or replace function public._err(code text, detail jsonb default null) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = code, detail = coalesce(detail::text, '');
end $$;

-- Recursive jsonb merge: objects merge key by key, everything else is replaced by b.
create or replace function public._jmerge(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then
      coalesce((select jsonb_object_agg(k,
                  case when a ? k and b ? k then public._jmerge(a -> k, b -> k)
                       when b ? k then b -> k else a -> k end)
                from (select jsonb_object_keys(a) k union select jsonb_object_keys(b)) keys), '{}'::jsonb)
    when b is null then a
    else b end
$$;

-- Short human-readable reference, e.g. MB-7K3QXR (no 0/O/1/I/L).
create or replace function public._ref(prefix text) returns text
language plpgsql volatile as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  r text := '';
begin
  for i in 0..5 loop
    r := r || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return prefix || '-' || r;
end $$;

-- 64 hex chars from two v4 uuids (244 random bits). Only its sha256 is stored.
create or replace function public._token() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

create or replace function public._hash(t text) returns bytea
language sql immutable as $$ select sha256(convert_to(coalesce(t, ''), 'UTF8')) $$;

-- Phone → E.164. Saudi mobiles in any common spelling (Arabic-Indic digits too) → +9665XXXXXXXX.
-- Other international numbers must start with + or 00. Returns null when invalid.
create or replace function public._phone(raw text) returns text
language plpgsql immutable as $$
declare
  s text := translate(coalesce(raw, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  intl boolean := btrim(s) like '+%' or btrim(s) like '00%';
  d text := regexp_replace(s, '[^0-9]', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if d ~ '^9665[0-9]{8}$' then return '+' || d; end if;
  if d ~ '^05[0-9]{8}$' then return '+966' || substr(d, 2); end if;
  if d ~ '^5[0-9]{8}$' and not intl then return '+966' || d; end if;
  if intl and d ~ '^[1-9][0-9]{7,14}$' then return '+' || d; end if;
  return null;
end $$;

-- Riyadh wall clock → instant.
create or replace function public._at(d date, minutes integer) returns timestamptz
language sql immutable as $$
  select (d::timestamp + make_interval(mins => minutes)) at time zone 'Asia/Riyadh'
$$;

create or replace function public._today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- ───────────────────────── people ─────────────────────────

create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ───────────────────────── businesses ─────────────────────────

create table if not exists public.businesses (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  status        text not null default 'draft' check (status in ('draft','awaiting_payment','active','paused')),
  is_demo       boolean not null default false,
  kind          text not null default 'salon' check (kind in ('salon','carwash','activity','other')),
  name_ar       text not null default '',
  name_en       text not null default '',
  tagline_ar    text not null default '',
  tagline_en    text not null default '',
  phone         text,                       -- the shop's WhatsApp line, E.164
  address_ar    text not null default '',
  address_en    text not null default '',
  maps_url      text,
  site_url      text,
  instagram     text,
  lat           double precision,
  lng           double precision,
  city          text not null default 'jeddah',
  langs         text[] not null default '{ar}'
                check (langs <@ array['ar','en']::text[] and cardinality(langs) between 1 and 2),
  look          text not null default 'standard' check (look in ('standard','custom')),
  theme         jsonb not null default '{}',   -- {mode, accent, bg, ink, font, radius, logo_url}
  entitlements  jsonb not null default '{}',   -- what Ahmed sold; admin-only
  settings      jsonb not null default '{}',   -- what the owner may tune, within entitlements
  moyasar_pk    text,                          -- publishable key (public by design)
  request_id    uuid,
  setup_halalas integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Secret keys never leave the server: no grants, no policies, read only by svc_ functions.
create table if not exists public.business_secrets (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  moyasar_sk  text,
  updated_at  timestamptz not null default now()
);

-- An extra branch is simply another business row with the same member.
create table if not exists public.members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner','staff')),
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index if not exists members_user_idx on public.members(user_id);

create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name_ar     text not null default '',
  name_en     text not null default '',
  audience    text not null default 'all' check (audience in ('all','men','women')),
  sort        integer not null default 0
);
create index if not exists sections_business_idx on public.sections(business_id);

-- Weekly hours per section. A split shift is two rows; close_min > 1440 runs past midnight
-- (e.g. 16:00–02:00 = 960..1560) and belongs to the day it opened.
create table if not exists public.hours (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  section_id  uuid not null references public.sections(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),   -- 0 = Sunday (Postgres dow)
  open_min    integer not null check (open_min between 0 and 1439),
  close_min   integer not null check (close_min <= 2880),
  check (close_min > open_min)
);
create index if not exists hours_section_idx on public.hours(section_id, weekday);

-- Ramadan, Eid, holidays: replaces the weekly hours for every day in the range.
-- ranges = [[open_min, close_min], …]; [] = closed.
create table if not exists public.special_hours (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  section_id  uuid references public.sections(id) on delete cascade,   -- null = every section
  from_date   date not null,
  to_date     date not null,
  ranges      jsonb not null default '[]',
  label_ar    text not null default '',
  label_en    text not null default '',
  check (to_date >= from_date)
);
create index if not exists special_hours_business_idx on public.special_hours(business_id, from_date);

-- Staff are labels the business chooses ("Chair 1"), never required to be names.
create table if not exists public.staff (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  section_id  uuid references public.sections(id) on delete set null,  -- null = every section
  label_ar    text not null default '',
  label_en    text not null default '',
  services    uuid[],                                                  -- null = every staff-mode service
  active      boolean not null default true,
  sort        integer not null default 0
);
create index if not exists staff_business_idx on public.staff(business_id);

-- Parallel capacity: wash bays, karting seats. Shared by every service that points at it.
create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  section_id  uuid references public.sections(id) on delete set null,
  label_ar    text not null default '',
  label_en    text not null default '',
  capacity    integer not null default 1 check (capacity between 1 and 500),
  active      boolean not null default true,
  sort        integer not null default 0
);
create index if not exists resources_business_idx on public.resources(business_id);

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  section_id  uuid references public.sections(id) on delete set null,
  name_ar     text not null default '',
  name_en     text not null default '',
  sort        integer not null default 0
);
create index if not exists categories_business_idx on public.categories(business_id);

create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  section_id    uuid references public.sections(id) on delete set null,   -- null = every section
  category_id   uuid references public.categories(id) on delete set null,
  name_ar       text not null default '',
  name_en       text not null default '',
  desc_ar       text not null default '',
  desc_en       text not null default '',
  duration_min  integer not null default 30 check (duration_min between 5 and 720),
  buffer_min    integer not null default 0 check (buffer_min between 0 and 240),
  step_min      integer not null default 15 check (step_min between 5 and 240),
  mode          text not null default 'staff' check (mode in ('staff','capacity')),
  resource_id   uuid references public.resources(id) on delete set null,
  max_qty       integer not null default 1 check (max_qty between 1 and 50),
  per_person    boolean not null default false,       -- price × party size (karting heats)
  price_halalas integer not null default 0 check (price_halalas >= 0),
  price_from    boolean not null default false,       -- shown as "from 80 SAR"
  location      text not null default 'shop' check (location in ('shop','mobile','both')),
  active        boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  check (mode = 'staff' or resource_id is not null)
);
create index if not exists services_business_idx on public.services(business_id, sort);

-- Offers apply to bookings made while the offer is live; weekdays (optional) restrict the
-- appointment day ("Sunday special"). kind 'banner' is a message only, no discount.
create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_ids uuid[],                                  -- null = every service
  kind        text not null default 'percent' check (kind in ('percent','amount','banner')),
  value       integer not null default 0 check (value >= 0),   -- percent 1..90 or halalas
  title_ar    text not null default '',
  title_en    text not null default '',
  starts_at   timestamptz,
  ends_at     timestamptz,
  weekdays    smallint[],
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (kind <> 'percent' or value between 0 and 90)
);
create index if not exists offers_business_idx on public.offers(business_id);

-- Closed time. All target columns null = the whole business (or section).
create table if not exists public.blocks (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  section_id  uuid references public.sections(id) on delete cascade,
  staff_id    uuid references public.staff(id) on delete cascade,
  resource_id uuid references public.resources(id) on delete cascade,
  during      tstzrange not null,
  reason      text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists blocks_business_idx on public.blocks using gist (business_id, during);

-- ───────────────────────── bookings ─────────────────────────

create table if not exists public.bookings (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique,
  business_id      uuid not null references public.businesses(id) on delete cascade,
  section_id       uuid references public.sections(id) on delete set null,
  service_id       uuid references public.services(id) on delete set null,
  staff_id         uuid references public.staff(id) on delete set null,
  resource_id      uuid references public.resources(id) on delete set null,
  qty              integer not null default 1 check (qty between 1 and 100),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  busy             tstzrange not null,         -- [start, end + buffer + travel)
  status           text not null default 'confirmed'
                   check (status in ('pending_payment','confirmed','completed','no_show','cancelled','expired')),
  hold_until       timestamptz,
  name             text not null default '',
  phone            text,
  email            text,
  note             text,
  location         text not null default 'shop' check (location in ('shop','mobile')),
  lat              double precision,
  lng              double precision,
  address          text,
  price_halalas    integer not null default 0,
  discount_halalas integer not null default 0,
  fee_halalas      integer not null default 0,
  total_halalas    integer not null default 0,
  due_now_halalas  integer not null default 0,
  paid_halalas     integer not null default 0,
  offer_id         uuid,
  moyasar_id       text unique,
  pay_flag         text,                       -- 'amount_mismatch' | 'needs_refund'
  token_hash       bytea,
  lang             text not null default 'ar',
  source           text not null default 'web' check (source in ('web','embed','link','owner','walkin','admin')),
  service_name_ar  text,
  service_name_en  text,
  staff_label_ar   text,
  staff_label_en   text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint bookings_time check (ends_at > starts_at),
  -- The heart of it: one staff member can never hold two overlapping live bookings.
  constraint bookings_staff_excl exclude using gist (staff_id with =, busy with &&)
    where (staff_id is not null and status in ('pending_payment','confirmed'))
);
create index if not exists bookings_business_time_idx on public.bookings(business_id, starts_at);
create index if not exists bookings_resource_busy_idx on public.bookings using gist (resource_id, busy)
  where (status in ('pending_payment','confirmed'));
create index if not exists bookings_phone_idx on public.bookings(business_id, phone);
create index if not exists bookings_token_idx on public.bookings(token_hash);

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,
  day         date not null,
  part        text not null default 'any' check (part in ('any','morning','afternoon','evening')),
  qty         integer not null default 1,
  name        text not null default '',
  phone       text not null,
  status      text not null default 'waiting' check (status in ('waiting','contacted','booked','removed')),
  created_at  timestamptz not null default now()
);
create index if not exists waitlist_business_idx on public.waitlist(business_id, day);

-- Local adhan times per city and day, filled a year at a time from platform/prayer.js (Umm al-Qura).
create table if not exists public.prayer_times (
  city    text not null,
  day     date not null,
  fajr    time not null,
  dhuhr   time not null,
  asr     time not null,
  maghrib time not null,
  isha    time not null,
  primary key (city, day)
);

-- The doorbell. Clients listen to version bumps, then re-fetch through RPCs.
-- business_id = nil uuid is Ahmed's admin channel. No personal data ever lives here.
create table if not exists public.live_pings (
  business_id uuid primary key,
  catalog_v   bigint not null default 0,
  slots_v     bigint not null default 0,
  admin_v     bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- ───────────────────────── selling Mamar ─────────────────────────

create table if not exists public.price_items (
  key            text primary key,
  grp            text not null,
  label_ar       text not null,
  label_en       text not null,
  desc_ar        text not null default '',
  desc_en        text not null default '',
  amount_halalas integer,               -- null = custom quote
  per_unit       boolean not null default false,
  sort           integer not null default 0,
  active         boolean not null default true
);

create table if not exists public.plans (
  code            text primary key check (code in ('care','live')),
  name_ar         text not null,
  name_en         text not null,
  desc_ar         text not null default '',
  desc_en         text not null default '',
  monthly_halalas integer not null,
  yearly_halalas  integer not null,
  sort            integer not null default 0
);

create table if not exists public.setup_requests (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique,
  status        text not null default 'new'
                check (status in ('draft','new','reviewing','quoted','converted','declined')),
  source        text not null default 'web' check (source in ('web','assisted')),
  business_name text not null default '',
  contact_name  text not null default '',
  phone         text,
  email         text,
  lang          text not null default 'ar',
  answers       jsonb not null default '{}',
  estimate      jsonb not null default '{}',   -- recomputed on the server; the client's total is ignored
  setup_halalas integer not null default 0,
  plan_code     text,
  plan_interval text,
  plan_halalas  integer not null default 0,
  business_id   uuid references public.businesses(id) on delete set null,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists setup_requests_status_idx on public.setup_requests(status, created_at desc);

create table if not exists public.subscriptions (
  business_id        uuid primary key references public.businesses(id) on delete cascade,
  plan_code          text references public.plans(code),
  interval           text check (interval in ('monthly','yearly')),
  status             text not null default 'none' check (status in ('none','pending','active','past_due','cancelled')),
  requested_code     text,
  requested_interval text,
  requested_at       timestamptz,
  period_end         date,
  updated_at         timestamptz not null default now()
);

-- Web Push endpoints (Ahmed's admin today; owners later).
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,
  lang       text not null default 'ar',
  ua         text not null default '',
  created_at timestamptz not null default now()
);

-- Everything Ahmed should hear about. An insert fires the notify webhook (Supabase) / pg_notify (local).
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,                 -- 'setup_request' | 'plan_request' | 'payment_flag'
  title_ar   text not null,
  title_en   text not null,
  body_ar    text not null default '',
  body_en    text not null default '',
  url        text not null default '/admin/',
  ref_id     uuid,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_created_idx on public.notifications(created_at desc);

-- ───────────────────────── row level security ─────────────────────────
-- On for every table, with no policies: nobody reads tables directly. RPCs are security definer.
-- The single exception is live_pings (version counters only), readable for Realtime.

do $$
declare t text;
begin
  foreach t in array array['admins','businesses','business_secrets','members','sections','hours','special_hours',
    'staff','resources','categories','services','offers','blocks','bookings','waitlist','prayer_times',
    'live_pings','price_items','plans','setup_requests','subscriptions','push_subscriptions','notifications'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists live_pings_read on public.live_pings;
create policy live_pings_read on public.live_pings for select to anon, authenticated using (true);

-- ───────────────────────── who is calling ─────────────────────────

create or replace function public._is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.admins where user_id = auth.uid())
$$;

create or replace function public._is_member(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.members where business_id = bid and user_id = auth.uid())
    or exists (select 1 from public.admins where user_id = auth.uid()))
$$;

create or replace function public._need_member(bid uuid) returns void
language plpgsql stable as $$
begin
  if bid is null or not public._is_member(bid) then perform public._err('NOT_ALLOWED'); end if;
end $$;

create or replace function public._need_admin() returns void
language plpgsql stable as $$
begin
  if not public._is_admin() then perform public._err('NOT_ALLOWED'); end if;
end $$;

-- ───────────────────────── effective configuration ─────────────────────────
-- One place resolves entitlements × settings × defaults. Both the booking flow and every check use it.

create or replace function public._cfg(b public.businesses) returns jsonb
language plpgsql stable as $$
declare
  e jsonb := coalesce(b.entitlements, '{}');
  s jsonb := coalesce(b.settings, '{}');
  pay_mode text := coalesce(s #>> '{payment,mode}', 'shop');
begin
  if not coalesce((e ->> 'payments')::boolean, false) or pay_mode not in ('deposit','full') then
    pay_mode := 'shop';
  end if;
  -- No Moyasar keys yet → never ask a customer to pay (they would be stuck). Locally (mamar.local = on)
  -- demo businesses keep their payment step so the demo payment sheet can be shown.
  if pay_mode <> 'shop' and b.moyasar_pk is null
     and not (b.is_demo and coalesce(current_setting('mamar.local', true), '') = 'on') then
    pay_mode := 'shop';
  end if;
  return jsonb_build_object(
    'notice_min',    greatest(0, coalesce((s ->> 'notice_min')::int, 60)),
    'horizon_days',  least(90, greatest(1, coalesce((s ->> 'horizon_days')::int, 30))),
    'staff_choice',  coalesce((e ->> 'staff_choice')::boolean, false) and coalesce((s ->> 'staff_choice')::boolean, true),
    'sections',      coalesce((e ->> 'sections')::boolean, false),
    'hijri',         coalesce((s ->> 'hijri')::boolean, true),
    'home', case when coalesce((e ->> 'home_service')::boolean, false) then jsonb_build_object(
        'on', true,
        'fee_halalas', greatest(0, coalesce((s #>> '{home,fee_halalas}')::int, 0)),
        'travel_min',  greatest(0, coalesce((s #>> '{home,travel_min}')::int, 30)))
      else jsonb_build_object('on', false, 'fee_halalas', 0, 'travel_min', 0) end,
    'prayer', case when coalesce((e ->> 'prayer')::boolean, false) and coalesce((s #>> '{prayer,on}')::boolean, true)
      then jsonb_build_object(
        'on', true,
        'before_min', greatest(0, coalesce((s #>> '{prayer,before_min}')::int, 0)),
        'after_min',  greatest(5, coalesce((s #>> '{prayer,after_min}')::int, 25)),
        'jumuah_min', greatest(15, coalesce((s #>> '{prayer,jumuah_min}')::int, 60)),
        'fajr',       coalesce((s #>> '{prayer,fajr}')::boolean, false))
      else jsonb_build_object('on', false) end,
    'payment', jsonb_build_object(
        'mode', pay_mode,
        'deposit_kind',  coalesce(s #>> '{payment,deposit_kind}', 'percent'),
        'deposit_value', greatest(0, coalesce((s #>> '{payment,deposit_value}')::int, 20)),
        'ready', b.moyasar_pk is not null),
    'customer', jsonb_build_object('email', coalesce(s #>> '{customer,email}', 'off')),
    'self_manage', case when coalesce((e ->> 'self_manage')::boolean, false)
      then jsonb_build_object('on', true, 'cutoff_hours', greatest(0, coalesce((s #>> '{self_manage,cutoff_hours}')::int, 3)))
      else jsonb_build_object('on', false) end,
    'waitlist',      coalesce((e ->> 'waitlist')::boolean, false),
    'max_per_phone', greatest(1, coalesce((s ->> 'max_per_phone')::int, 3)),
    'hold_min',      15
  );
end $$;

-- ───────────────────────── live doorbell ─────────────────────────

create or replace function public._ping(bid uuid, kind text) returns void
language plpgsql as $$
begin
  if bid is null then return; end if;
  insert into public.live_pings as lp (business_id, catalog_v, slots_v, admin_v)
  values (bid, (kind in ('catalog','both'))::int, (kind in ('slots','both'))::int, (kind = 'admin')::int)
  on conflict (business_id) do update set
    catalog_v  = lp.catalog_v + (kind in ('catalog','both'))::int,
    slots_v    = lp.slots_v   + (kind in ('slots','both'))::int,
    admin_v    = lp.admin_v   + (kind = 'admin')::int,
    updated_at = now();
  perform pg_notify('mamar_live', json_build_object('b', bid, 'k', kind)::text);
end $$;

create or replace function public._admin_bid() returns uuid
language sql immutable as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

create or replace function public._live_trg() returns trigger
language plpgsql as $$
declare
  kind text := tg_argv[0];
  bid uuid;
begin
  if tg_op = 'DELETE' then bid := old.business_id; else bid := new.business_id; end if;
  perform public._ping(bid, kind);
  if tg_op = 'UPDATE' and old.business_id is distinct from new.business_id then
    perform public._ping(old.business_id, kind);
  end if;
  return null;
end $$;

create or replace function public._business_live_trg() returns trigger
language plpgsql as $$
begin
  perform public._ping(coalesce(new.id, old.id), 'both');
  return null;
end $$;

do $$
declare t text; k text;
begin
  for t, k in select * from (values
      ('services','both'), ('offers','catalog'), ('categories','catalog'), ('sections','both'),
      ('staff','both'), ('resources','both'), ('hours','both'), ('special_hours','both'),
      ('blocks','slots'), ('bookings','slots'), ('waitlist','slots')) v(t, k) loop
    execute format('drop trigger if exists %I on public.%I', t || '_live', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._live_trg(%L)',
                   t || '_live', t, k);
  end loop;
end $$;

drop trigger if exists businesses_live on public.businesses;
create trigger businesses_live after insert or update on public.businesses
  for each row execute function public._business_live_trg();

-- Notifications: wake the admin channel; locally dev/server.js also listens on mamar_notify.
create or replace function public._notify_trg() returns trigger
language plpgsql as $$
begin
  perform public._ping(public._admin_bid(), 'admin');
  perform pg_notify('mamar_notify', new.id::text);
  return null;
end $$;

drop trigger if exists notifications_notify on public.notifications;
create trigger notifications_notify after insert on public.notifications
  for each row execute function public._notify_trg();

create or replace function public._requests_live_trg() returns trigger
language plpgsql as $$
begin
  perform public._ping(public._admin_bid(), 'admin');
  return null;
end $$;

drop trigger if exists setup_requests_live on public.setup_requests;
create trigger setup_requests_live after insert or update or delete on public.setup_requests
  for each row execute function public._requests_live_trg();

create or replace function public._touch_trg() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['businesses','bookings','setup_requests','subscriptions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public._touch_trg()', t || '_touch', t);
  end loop;
end $$;
