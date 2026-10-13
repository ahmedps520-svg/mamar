-- Mamar Booking · 003 owner dashboard API (own_*)
-- Every function starts with _need_member(business_id): owners see only their own businesses,
-- admins see all. Business ids in nested objects are re-checked against the parent business.

create or replace function public._biz(p jsonb) returns public.businesses
language plpgsql stable as $$
declare
  b public.businesses;
begin
  perform public._need_member(public._uuid(p ->> 'business_id'));
  select * into b from public.businesses where id = public._uuid(p ->> 'business_id');
  if not found then perform public._err('NOT_FOUND'); end if;
  return b;
end $$;

-- Does this row id belong to the business? (null id passes: "none")
create or replace function public._owns(tbl text, rid uuid, bid uuid) returns boolean
language plpgsql stable as $$
declare
  ok boolean;
begin
  if rid is null then return true; end if;
  execute format('select exists (select 1 from public.%I where id = $1 and business_id = $2)', tbl)
    into ok using rid, bid;
  return ok;
end $$;

create or replace function public._need_owns(tbl text, rid uuid, bid uuid) returns void
language plpgsql stable as $$
begin
  if not public._owns(tbl, rid, bid) then perform public._err('NOT_ALLOWED'); end if;
end $$;

create or replace function public._booking_row(bk public.bookings) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', bk.id, 'ref', bk.ref, 'status', bk.status, 'starts_at', bk.starts_at, 'ends_at', bk.ends_at,
    'busy_until', upper(bk.busy), 'hold_until', bk.hold_until,
    'section_id', bk.section_id, 'service_id', bk.service_id, 'staff_id', bk.staff_id, 'resource_id', bk.resource_id,
    'qty', bk.qty, 'service_name_ar', bk.service_name_ar, 'service_name_en', bk.service_name_en,
    'staff_label_ar', bk.staff_label_ar, 'staff_label_en', bk.staff_label_en,
    'name', bk.name, 'phone', bk.phone, 'email', bk.email, 'note', bk.note,
    'location', bk.location, 'address', bk.address, 'lat', bk.lat, 'lng', bk.lng,
    'price_halalas', bk.price_halalas, 'discount_halalas', bk.discount_halalas, 'fee_halalas', bk.fee_halalas,
    'total_halalas', bk.total_halalas, 'due_now_halalas', bk.due_now_halalas, 'paid_halalas', bk.paid_halalas,
    'pay_flag', bk.pay_flag, 'source', bk.source, 'lang', bk.lang, 'created_at', bk.created_at,
    'cancel_reason', bk.cancel_reason)
$$;

-- ───────────────────────── who am I ─────────────────────────

create or replace function public.own_me(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  adm boolean := public._is_admin();
begin
  if auth.uid() is null then perform public._err('NOT_ALLOWED'); end if;
  return jsonb_build_object(
    'user_id', auth.uid(),
    'email', (select email from auth.users where id = auth.uid()),
    'is_admin', adm,
    'businesses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'name_ar', b.name_ar, 'name_en', b.name_en, 'status', b.status,
        'kind', b.kind, 'look', b.look, 'is_demo', b.is_demo, 'langs', to_jsonb(b.langs)) order by b.name_en)
      from public.businesses b
      where adm or exists (select 1 from public.members m where m.business_id = b.id and m.user_id = auth.uid())), '[]'));
end $$;

create or replace function public.own_overview(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  cfg jsonb := public._cfg(b);
begin
  return jsonb_build_object(
    'business', jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'status', b.status, 'is_demo', b.is_demo, 'kind', b.kind,
      'name_ar', b.name_ar, 'name_en', b.name_en, 'tagline_ar', b.tagline_ar, 'tagline_en', b.tagline_en,
      'phone', b.phone, 'address_ar', b.address_ar, 'address_en', b.address_en, 'maps_url', b.maps_url,
      'site_url', b.site_url, 'instagram', b.instagram, 'lat', b.lat, 'lng', b.lng, 'city', b.city,
      'langs', to_jsonb(b.langs), 'look', b.look, 'theme', b.theme,
      'entitlements', b.entitlements, 'settings', b.settings, 'moyasar_ready', b.moyasar_pk is not null,
      'setup_halalas', b.setup_halalas, 'created_at', b.created_at),
    'cfg', cfg,
    'sections', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort, x.id) from public.sections x where x.business_id = b.id), '[]'),
    'categories', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort, x.id) from public.categories x where x.business_id = b.id), '[]'),
    'services', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('price', public._price(x, null, 1, 'shop', cfg))
                                             order by x.sort, x.created_at)
                          from public.services x where x.business_id = b.id), '[]'),
    'staff', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort, x.id) from public.staff x where x.business_id = b.id), '[]'),
    'resources', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort, x.id) from public.resources x where x.business_id = b.id), '[]'),
    'offers', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.offers x where x.business_id = b.id), '[]'),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('section_id', x.section_id, 'weekday', x.weekday,
                                         'open_min', x.open_min, 'close_min', x.close_min) order by x.weekday, x.open_min)
                       from public.hours x where x.business_id = b.id), '[]'),
    'special_hours', coalesce((select jsonb_agg(to_jsonb(x) order by x.from_date)
                               from public.special_hours x where x.business_id = b.id and x.to_date >= public._today() - 1), '[]'),
    'subscription', (select to_jsonb(x) from public.subscriptions x where x.business_id = b.id),
    'counts', jsonb_build_object(
      'today', (select count(*) from public.bookings x where x.business_id = b.id
                  and x.status in ('pending_payment','confirmed','completed')
                  and x.starts_at >= public._at(public._today(), 0) and x.starts_at < public._at(public._today() + 1, 0)),
      'upcoming', (select count(*) from public.bookings x where x.business_id = b.id
                  and x.status in ('pending_payment','confirmed') and x.starts_at >= now()),
      'waitlist', (select count(*) from public.waitlist x where x.business_id = b.id and x.status = 'waiting'
                  and x.day >= public._today())),
    'live', coalesce((select jsonb_build_object('catalog', lp.catalog_v, 'slots', lp.slots_v)
                      from public.live_pings lp where lp.business_id = b.id), jsonb_build_object('catalog', 0, 'slots', 0)));
end $$;

-- ───────────────────────── bookings ─────────────────────────

-- p: {business_id, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD'} (Riyadh days, inclusive)
create or replace function public.own_bookings(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  d1 date := coalesce((p ->> 'from')::date, public._today());
  d2 date := coalesce((p ->> 'to')::date, d1);
begin
  if d2 < d1 or d2 - d1 > 92 then perform public._err('BAD_INPUT'); end if;
  return jsonb_build_object(
    'from', d1, 'to', d2,
    'bookings', coalesce((select jsonb_agg(public._booking_row(x) order by x.starts_at)
      from public.bookings x where x.business_id = b.id
        and x.starts_at >= public._at(d1, 0) and x.starts_at < public._at(d2 + 1, 0)
        and (coalesce((p ->> 'all')::boolean, false) or x.status <> 'expired')), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'section_id', x.section_id, 'staff_id', x.staff_id, 'resource_id', x.resource_id,
        'starts_at', lower(x.during), 'ends_at', upper(x.during), 'reason', x.reason) order by lower(x.during))
      from public.blocks x where x.business_id = b.id
        and x.during && tstzrange(public._at(d1, 0), public._at(d2 + 1, 0), '[)')), '[]'));
end $$;

-- Free times as the owner sees them (no notice/horizon/prayer limits), with the free staff labels.
create or replace function public.own_slots(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  sid uuid := public._uuid(p ->> 'service_id');
begin
  perform public._need_owns('services', sid, b.id);
  return jsonb_build_object('slots', coalesce((select jsonb_agg(jsonb_build_object(
      't', x.start_at, 'end', x.end_at, 'n', x.left_qty, 'staff_ids', to_jsonb(x.staff_ids)) order by x.start_at)
    from public._slots(sid, (p ->> 'day')::date, public._uuid(p ->> 'section_id'), public._uuid(p ->> 'staff_id'),
                       public._int(p ->> 'qty', 1), coalesce(p ->> 'location', 'shop'),
                       public._uuid(p ->> 'ignore'), true) x), '[]'));
end $$;

-- Walk-ins and phone bookings. force = take it even if nothing is free (staff stays unassigned).
create or replace function public.own_booking_create(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  s public.services;
  v_phone text := public._phone(p ->> 'phone');
begin
  select * into s from public.services where id = public._uuid(p ->> 'service_id') and business_id = b.id;
  if not found then perform public._err('NOT_FOUND'); end if;
  perform public._need_owns('staff', public._uuid(p ->> 'staff_id'), b.id);
  if coalesce(p ->> 'phone', '') <> '' and v_phone is null then perform public._err('BAD_PHONE'); end if;
  return public._book_core(s, b, public._cfg(b), (p ->> 'start')::timestamptz, public._uuid(p ->> 'section_id'),
    public._uuid(p ->> 'staff_id'), public._int(p ->> 'qty', 1), coalesce(p ->> 'location', 'shop'),
    jsonb_build_object('name', left(btrim(coalesce(p ->> 'name', '')), 80), 'phone', v_phone,
                       'note', left(nullif(btrim(coalesce(p ->> 'note', '')), ''), 500),
                       'address', p ->> 'address', 'lang', coalesce(p ->> 'lang', 'ar')),
    case when coalesce((p ->> 'walkin')::boolean, false) then 'walkin' else 'owner' end,
    true, coalesce((p ->> 'force')::boolean, false));
end $$;

create or replace function public.own_booking_status(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  bk public.bookings;
  v_status text := p ->> 'status';
begin
  if v_status not in ('confirmed','completed','no_show','cancelled') then perform public._err('BAD_INPUT'); end if;
  update public.bookings set
      status = v_status,
      cancelled_at = case when v_status = 'cancelled' then now() else cancelled_at end,
      cancel_reason = case when v_status = 'cancelled' then coalesce(left(p ->> 'reason', 200), 'owner') else cancel_reason end,
      hold_until = case when v_status = 'confirmed' then null else hold_until end
    where id = public._uuid(p ->> 'booking_id') and business_id = b.id
    returning * into bk;
  if not found then perform public._err('NOT_FOUND'); end if;
  return public._booking_row(bk);
exception when exclusion_violation then
  perform public._err('SLOT_TAKEN');
end $$;

-- Bulk cancel (spam waves): p: {business_id, booking_ids: [...]}
create or replace function public.own_booking_bulk_cancel(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  n integer;
begin
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'owner_bulk'
   where business_id = b.id and status in ('pending_payment','confirmed')
     and id in (select public._uuid(x) from jsonb_array_elements_text(coalesce(p -> 'booking_ids', '[]')) x);
  get diagnostics n = row_count;
  return jsonb_build_object('cancelled', n);
end $$;

create or replace function public.own_booking_move(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  bk public.bookings;
  v_start timestamptz := (p ->> 'start')::timestamptz;
  v_want uuid := public._uuid(p ->> 'staff_id');
  v_force boolean := coalesce((p ->> 'force')::boolean, false);
  v_day date := (v_start at time zone 'Asia/Riyadh')::date;
  cand record;
  v_sid uuid;
  st public.staff;
  v_len interval;
  v_tail interval;
begin
  select * into bk from public.bookings where id = public._uuid(p ->> 'booking_id') and business_id = b.id for update;
  if not found then perform public._err('NOT_FOUND'); end if;
  perform public._need_owns('staff', v_want, b.id);
  select * into cand from (
    select * from public._slots(bk.service_id, v_day,     bk.section_id, v_want, bk.qty, bk.location, bk.id, true)
    union all
    select * from public._slots(bk.service_id, v_day - 1, bk.section_id, v_want, bk.qty, bk.location, bk.id, true)
  ) x where x.start_at = v_start limit 1;
  if not found and not v_force then perform public._err('SLOT_TAKEN'); end if;

  v_sid := case
    when bk.staff_id is null and bk.resource_id is not null then null
    when cand.staff_ids is null then case when v_force then null else bk.staff_id end
    when v_want is not null and v_want = any(cand.staff_ids) then v_want
    when bk.staff_id = any(cand.staff_ids) then bk.staff_id
    else cand.staff_ids[1] end;
  select * into st from public.staff where id = v_sid;
  v_len := bk.ends_at - bk.starts_at;
  v_tail := upper(bk.busy) - bk.ends_at;
  update public.bookings set
      starts_at = v_start, ends_at = v_start + v_len, busy = tstzrange(v_start, v_start + v_len + v_tail, '[)'),
      staff_id = v_sid, staff_label_ar = st.label_ar, staff_label_en = st.label_en
    where id = bk.id
    returning * into bk;
  return public._booking_row(bk);
exception when exclusion_violation then
  perform public._err('SLOT_TAKEN');
end $$;

-- ───────────────────────── blocks ─────────────────────────

create or replace function public.own_block_upsert(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  x jsonb := coalesce(p -> 'block', '{}');
  v_id uuid := public._uuid(x ->> 'id');
  v_from timestamptz := (x ->> 'starts_at')::timestamptz;
  v_to timestamptz := (x ->> 'ends_at')::timestamptz;
begin
  if v_from is null or v_to is null or v_to <= v_from or v_to - v_from > interval '120 days' then
    perform public._err('BAD_INPUT');
  end if;
  perform public._need_owns('sections', public._uuid(x ->> 'section_id'), b.id);
  perform public._need_owns('staff', public._uuid(x ->> 'staff_id'), b.id);
  perform public._need_owns('resources', public._uuid(x ->> 'resource_id'), b.id);
  if v_id is null then
    insert into public.blocks (business_id, section_id, staff_id, resource_id, during, reason)
    values (b.id, public._uuid(x ->> 'section_id'), public._uuid(x ->> 'staff_id'), public._uuid(x ->> 'resource_id'),
            tstzrange(v_from, v_to, '[)'), left(coalesce(x ->> 'reason', ''), 120))
    returning id into v_id;
  else
    update public.blocks set section_id = public._uuid(x ->> 'section_id'), staff_id = public._uuid(x ->> 'staff_id'),
        resource_id = public._uuid(x ->> 'resource_id'), during = tstzrange(v_from, v_to, '[)'),
        reason = left(coalesce(x ->> 'reason', ''), 120)
      where id = v_id and business_id = b.id;
    if not found then perform public._err('NOT_FOUND'); end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.own_block_delete(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
begin
  delete from public.blocks where id = public._uuid(p ->> 'id') and business_id = b.id;
  return jsonb_build_object('ok', found);
end $$;

-- ───────────────────────── catalogue: live prices ─────────────────────────

create or replace function public.own_service_upsert(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  x jsonb := coalesce(p -> 'service', '{}');
  v_id uuid := public._uuid(x ->> 'id');
  v_mode text := coalesce(x ->> 'mode', 'staff');
  v_res uuid := public._uuid(x ->> 'resource_id');
  v_loc text := coalesce(x ->> 'location', 'shop');
  v_limit integer := coalesce((b.entitlements ->> 'max_services')::int, 15);
begin
  if btrim(coalesce(x ->> 'name_ar', '') || coalesce(x ->> 'name_en', '')) = '' then perform public._err('BAD_NAME'); end if;
  if v_mode not in ('staff','capacity') or (v_mode = 'capacity' and v_res is null) then perform public._err('BAD_INPUT'); end if;
  if v_loc not in ('shop','mobile','both') then perform public._err('BAD_INPUT'); end if;
  if v_loc <> 'shop' and not coalesce((b.entitlements ->> 'home_service')::boolean, false) then
    perform public._err('FEATURE_OFF');
  end if;
  perform public._need_owns('resources', v_res, b.id);
  perform public._need_owns('sections', public._uuid(x ->> 'section_id'), b.id);
  perform public._need_owns('categories', public._uuid(x ->> 'category_id'), b.id);

  if v_id is null then
    if (select count(*) from public.services where business_id = b.id and active) >= v_limit then
      perform public._err('LIMIT_SERVICES', jsonb_build_object('limit', v_limit));
    end if;
    insert into public.services (business_id, name_ar, name_en) values (b.id, '', '') returning id into v_id;
  elsif not public._owns('services', v_id, b.id) then
    perform public._err('NOT_FOUND');
  elsif coalesce((x ->> 'active')::boolean, true)
        and not (select active from public.services where id = v_id)
        and (select count(*) from public.services where business_id = b.id and active) >= v_limit then
    -- switching an archived service back on counts against the package too
    perform public._err('LIMIT_SERVICES', jsonb_build_object('limit', v_limit));
  end if;

  update public.services set
    section_id    = public._uuid(x ->> 'section_id'),
    category_id   = public._uuid(x ->> 'category_id'),
    name_ar       = left(btrim(coalesce(x ->> 'name_ar', '')), 80),
    name_en       = left(btrim(coalesce(x ->> 'name_en', '')), 80),
    desc_ar       = left(btrim(coalesce(x ->> 'desc_ar', '')), 300),
    desc_en       = left(btrim(coalesce(x ->> 'desc_en', '')), 300),
    duration_min  = least(720, greatest(5, public._int(x ->> 'duration_min', 30))),
    buffer_min    = least(240, greatest(0, public._int(x ->> 'buffer_min', 0))),
    step_min      = least(240, greatest(5, public._int(x ->> 'step_min', 15))),
    mode          = v_mode,
    resource_id   = case when v_mode = 'capacity' then v_res end,
    max_qty       = case when v_mode = 'capacity' then least(50, greatest(1, public._int(x ->> 'max_qty', 1))) else 1 end,
    per_person    = v_mode = 'capacity' and coalesce((x ->> 'per_person')::boolean, false),
    price_halalas = greatest(0, public._int(x ->> 'price_halalas', 0)),
    price_from    = coalesce((x ->> 'price_from')::boolean, false),
    location      = v_loc,
    active        = coalesce((x ->> 'active')::boolean, true),
    sort          = public._int(x ->> 'sort', 0)
  where id = v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.own_service_delete(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  v_id uuid := public._uuid(p ->> 'id');
begin
  if exists (select 1 from public.bookings where service_id = v_id and business_id = b.id) then
    update public.services set active = false where id = v_id and business_id = b.id;
    return jsonb_build_object('ok', true, 'archived', true);
  end if;
  delete from public.services where id = v_id and business_id = b.id;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.own_category_upsert(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  x jsonb := coalesce(p -> 'category', '{}');
  v_id uuid := public._uuid(x ->> 'id');
begin
  perform public._need_owns('sections', public._uuid(x ->> 'section_id'), b.id);
  if v_id is null then
    insert into public.categories (business_id, section_id, name_ar, name_en, sort)
    values (b.id, public._uuid(x ->> 'section_id'), left(coalesce(x ->> 'name_ar', ''), 60),
            left(coalesce(x ->> 'name_en', ''), 60), public._int(x ->> 'sort', 0))
    returning id into v_id;
  else
    update public.categories set section_id = public._uuid(x ->> 'section_id'),
        name_ar = left(coalesce(x ->> 'name_ar', ''), 60), name_en = left(coalesce(x ->> 'name_en', ''), 60),
        sort = public._int(x ->> 'sort', 0)
      where id = v_id and business_id = b.id;
    if not found then perform public._err('NOT_FOUND'); end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.own_category_delete(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
begin
  delete from public.categories where id = public._uuid(p ->> 'id') and business_id = b.id;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.own_offer_upsert(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  x jsonb := coalesce(p -> 'offer', '{}');
  v_id uuid := public._uuid(x ->> 'id');
  v_kind text := coalesce(x ->> 'kind', 'percent');
  v_value integer := greatest(0, public._int(x ->> 'value', 0));
  v_svcs uuid[];
  v_days smallint[];
begin
  if v_kind not in ('percent','amount','banner') then perform public._err('BAD_INPUT'); end if;
  if v_kind = 'percent' and (v_value < 1 or v_value > 90) then perform public._err('BAD_INPUT'); end if;
  if btrim(coalesce(x ->> 'title_ar', '') || coalesce(x ->> 'title_en', '')) = '' then perform public._err('BAD_NAME'); end if;
  if jsonb_typeof(x -> 'service_ids') = 'array' and jsonb_array_length(x -> 'service_ids') > 0 then
    select array_agg(public._uuid(e)) into v_svcs from jsonb_array_elements_text(x -> 'service_ids') e;
    if exists (select 1 from unnest(v_svcs) u where not public._owns('services', u, b.id) or u is null) then
      perform public._err('NOT_ALLOWED');
    end if;
  end if;
  if jsonb_typeof(x -> 'weekdays') = 'array' and jsonb_array_length(x -> 'weekdays') > 0 then
    select array_agg(distinct e::smallint) into v_days from jsonb_array_elements_text(x -> 'weekdays') e
     where e ~ '^[0-6]$';
  end if;
  if v_id is null then
    insert into public.offers (business_id, kind) values (b.id, v_kind) returning id into v_id;
  elsif not public._owns('offers', v_id, b.id) then
    perform public._err('NOT_FOUND');
  end if;
  update public.offers set
    kind = v_kind, value = case when v_kind = 'banner' then 0 else v_value end, service_ids = v_svcs,
    title_ar = left(coalesce(x ->> 'title_ar', ''), 80), title_en = left(coalesce(x ->> 'title_en', ''), 80),
    starts_at = nullif(x ->> 'starts_at', '')::timestamptz, ends_at = nullif(x ->> 'ends_at', '')::timestamptz,
    weekdays = v_days, active = coalesce((x ->> 'active')::boolean, true)
  where id = v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.own_offer_delete(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
begin
  delete from public.offers where id = public._uuid(p ->> 'id') and business_id = b.id;
  return jsonb_build_object('ok', found);
end $$;

-- ───────────────────────── hours ─────────────────────────

-- p: {business_id, section_id, hours: [{weekday, open_min, close_min}, …]} replaces that section's week.
create or replace function public.own_hours_set(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  sec uuid := public._uuid(p ->> 'section_id');
  h jsonb;
begin
  if sec is null or not public._owns('sections', sec, b.id) then perform public._err('NOT_ALLOWED'); end if;
  delete from public.hours where section_id = sec;
  for h in select * from jsonb_array_elements(coalesce(p -> 'hours', '[]')) loop
    insert into public.hours (business_id, section_id, weekday, open_min, close_min)
    values (b.id, sec, (h ->> 'weekday')::smallint, (h ->> 'open_min')::int, (h ->> 'close_min')::int);
  end loop;
  return jsonb_build_object('ok', true);
exception when check_violation or invalid_text_representation or null_value_not_allowed then
  perform public._err('BAD_INPUT');
end $$;

create or replace function public.own_special_hours_upsert(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  x jsonb := coalesce(p -> 'item', '{}');
  v_id uuid := public._uuid(x ->> 'id');
  r jsonb;
begin
  perform public._need_owns('sections', public._uuid(x ->> 'section_id'), b.id);
  if jsonb_typeof(coalesce(x -> 'ranges', '[]')) <> 'array' then perform public._err('BAD_INPUT'); end if;
  for r in select * from jsonb_array_elements(coalesce(x -> 'ranges', '[]')) loop
    if (r ->> 0)::int < 0 or (r ->> 0)::int > 1439 or (r ->> 1)::int <= (r ->> 0)::int or (r ->> 1)::int > 2880 then
      perform public._err('BAD_INPUT');
    end if;
  end loop;
  if v_id is null then
    insert into public.special_hours (business_id, from_date, to_date) values (b.id, (x ->> 'from_date')::date, (x ->> 'to_date')::date)
    returning id into v_id;
  elsif not public._owns('special_hours', v_id, b.id) then
    perform public._err('NOT_FOUND');
  end if;
  update public.special_hours set section_id = public._uuid(x ->> 'section_id'),
      from_date = (x ->> 'from_date')::date, to_date = (x ->> 'to_date')::date,
      ranges = coalesce(x -> 'ranges', '[]'), label_ar = left(coalesce(x ->> 'label_ar', ''), 60),
      label_en = left(coalesce(x ->> 'label_en', ''), 60)
    where id = v_id;
  return jsonb_build_object('id', v_id);
exception when check_violation or invalid_datetime_format or null_value_not_allowed then
  perform public._err('BAD_INPUT');
end $$;

create or replace function public.own_special_hours_delete(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
begin
  delete from public.special_hours where id = public._uuid(p ->> 'id') and business_id = b.id;
  return jsonb_build_object('ok', found);
end $$;

-- ───────────────────────── staff & resources ─────────────────────────

create or replace function public.own_staff_upsert(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  x jsonb := coalesce(p -> 'item', '{}');
  v_id uuid := public._uuid(x ->> 'id');
  v_svcs uuid[];
begin
  perform public._need_owns('sections', public._uuid(x ->> 'section_id'), b.id);
  if btrim(coalesce(x ->> 'label_ar', '') || coalesce(x ->> 'label_en', '')) = '' then perform public._err('BAD_NAME'); end if;
  if jsonb_typeof(x -> 'services') = 'array' then
    select array_agg(public._uuid(e)) into v_svcs from jsonb_array_elements_text(x -> 'services') e;
    if exists (select 1 from unnest(v_svcs) u where u is null or not public._owns('services', u, b.id)) then
      perform public._err('NOT_ALLOWED');
    end if;
  end if;
  if v_id is null then
    insert into public.staff (business_id) values (b.id) returning id into v_id;
  elsif not public._owns('staff', v_id, b.id) then
    perform public._err('NOT_FOUND');
  end if;
  update public.staff set section_id = public._uuid(x ->> 'section_id'),
      label_ar = left(coalesce(x ->> 'label_ar', ''), 40), label_en = left(coalesce(x ->> 'label_en', ''), 40),
      services = v_svcs, active = coalesce((x ->> 'active')::boolean, true), sort = public._int(x ->> 'sort', 0)
    where id = v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.own_staff_delete(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  v_id uuid := public._uuid(p ->> 'id');
begin
  if exists (select 1 from public.bookings where staff_id = v_id) then
    update public.staff set active = false where id = v_id and business_id = b.id;
    return jsonb_build_object('ok', true, 'archived', true);
  end if;
  delete from public.staff where id = v_id and business_id = b.id;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.own_resource_upsert(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  x jsonb := coalesce(p -> 'item', '{}');
  v_id uuid := public._uuid(x ->> 'id');
begin
  perform public._need_owns('sections', public._uuid(x ->> 'section_id'), b.id);
  if v_id is null then
    insert into public.resources (business_id) values (b.id) returning id into v_id;
  elsif not public._owns('resources', v_id, b.id) then
    perform public._err('NOT_FOUND');
  end if;
  update public.resources set section_id = public._uuid(x ->> 'section_id'),
      label_ar = left(coalesce(x ->> 'label_ar', ''), 40), label_en = left(coalesce(x ->> 'label_en', ''), 40),
      capacity = least(500, greatest(1, public._int(x ->> 'capacity', 1))),
      active = coalesce((x ->> 'active')::boolean, true), sort = public._int(x ->> 'sort', 0)
    where id = v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.own_resource_delete(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  v_id uuid := public._uuid(p ->> 'id');
begin
  if exists (select 1 from public.services where resource_id = v_id)
     or exists (select 1 from public.bookings where resource_id = v_id) then
    update public.resources set active = false where id = v_id and business_id = b.id;
    return jsonb_build_object('ok', true, 'archived', true);
  end if;
  delete from public.resources where id = v_id and business_id = b.id;
  return jsonb_build_object('ok', found);
end $$;

-- ───────────────────────── settings & profile ─────────────────────────
-- Owners tune only what Ahmed sold them (entitlements); everything else is ignored.

create or replace function public.own_settings_update(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  e jsonb := coalesce(b.entitlements, '{}');
  x jsonb := coalesce(p -> 'settings', '{}');
  c jsonb := '{}';
begin
  if x ? 'notice_min'   then c := c || jsonb_build_object('notice_min', least(2880, greatest(0, public._int(x ->> 'notice_min', 60)))); end if;
  if x ? 'horizon_days' then c := c || jsonb_build_object('horizon_days', least(90, greatest(1, public._int(x ->> 'horizon_days', 30)))); end if;
  if x ? 'hijri'        then c := c || jsonb_build_object('hijri', coalesce((x ->> 'hijri')::boolean, true)); end if;
  if x ? 'max_per_phone' then c := c || jsonb_build_object('max_per_phone', least(10, greatest(1, public._int(x ->> 'max_per_phone', 3)))); end if;
  if x ? 'customer' and x #>> '{customer,email}' in ('off','optional','required') then
    c := c || jsonb_build_object('customer', jsonb_build_object('email', x #>> '{customer,email}'));
  end if;
  if x ? 'staff_choice' and coalesce((e ->> 'staff_choice')::boolean, false) then
    c := c || jsonb_build_object('staff_choice', coalesce((x ->> 'staff_choice')::boolean, true));
  end if;
  if x ? 'prayer' and coalesce((e ->> 'prayer')::boolean, false) then
    c := c || jsonb_build_object('prayer', jsonb_strip_nulls(jsonb_build_object(
      'on',         (x #>> '{prayer,on}')::boolean,
      'fajr',       (x #>> '{prayer,fajr}')::boolean,
      'before_min', least(30, greatest(0, public._int(x #>> '{prayer,before_min}', null))),
      'after_min',  least(60, greatest(5, public._int(x #>> '{prayer,after_min}', null))),
      'jumuah_min', least(120, greatest(15, public._int(x #>> '{prayer,jumuah_min}', null))))));
  end if;
  if x ? 'payment' and coalesce((e ->> 'payments')::boolean, false) then
    c := c || jsonb_build_object('payment', jsonb_strip_nulls(jsonb_build_object(
      'mode', case when x #>> '{payment,mode}' in ('shop','deposit','full') then x #>> '{payment,mode}' end,
      'deposit_kind', case when x #>> '{payment,deposit_kind}' in ('percent','amount') then x #>> '{payment,deposit_kind}' end,
      'deposit_value', greatest(0, public._int(x #>> '{payment,deposit_value}', null)))));
  end if;
  if x ? 'self_manage' and coalesce((e ->> 'self_manage')::boolean, false) then
    c := c || jsonb_build_object('self_manage', jsonb_build_object(
      'cutoff_hours', least(72, greatest(0, public._int(x #>> '{self_manage,cutoff_hours}', 3)))));
  end if;
  if x ? 'home' and coalesce((e ->> 'home_service')::boolean, false) then
    c := c || jsonb_build_object('home', jsonb_strip_nulls(jsonb_build_object(
      'fee_halalas', least(100000, greatest(0, public._int(x #>> '{home,fee_halalas}', null))),
      'travel_min',  least(180, greatest(0, public._int(x #>> '{home,travel_min}', null))))));
  end if;
  update public.businesses set settings = public._jmerge(settings, c) where id = b.id returning * into b;
  return jsonb_build_object('settings', b.settings, 'cfg', public._cfg(b));
end $$;

create or replace function public.own_profile_update(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  x jsonb := coalesce(p -> 'profile', '{}');
  v_phone text := public._phone(x ->> 'phone');
begin
  if coalesce(x ->> 'phone', '') <> '' and v_phone is null then perform public._err('BAD_PHONE'); end if;
  update public.businesses set
    name_ar    = case when x ? 'name_ar' then left(btrim(x ->> 'name_ar'), 80) else name_ar end,
    name_en    = case when x ? 'name_en' then left(btrim(x ->> 'name_en'), 80) else name_en end,
    tagline_ar = case when x ? 'tagline_ar' then left(x ->> 'tagline_ar', 140) else tagline_ar end,
    tagline_en = case when x ? 'tagline_en' then left(x ->> 'tagline_en', 140) else tagline_en end,
    phone      = case when x ? 'phone' then v_phone else phone end,
    address_ar = case when x ? 'address_ar' then left(x ->> 'address_ar', 200) else address_ar end,
    address_en = case when x ? 'address_en' then left(x ->> 'address_en', 200) else address_en end,
    maps_url   = case when x ? 'maps_url' then nullif(left(x ->> 'maps_url', 300), '') else maps_url end,
    site_url   = case when x ? 'site_url' then nullif(left(x ->> 'site_url', 300), '') else site_url end,
    instagram  = case when x ? 'instagram' then nullif(left(x ->> 'instagram', 60), '') else instagram end,
    lat        = case when x ? 'lat' then (x ->> 'lat')::double precision else lat end,
    lng        = case when x ? 'lng' then (x ->> 'lng')::double precision else lng end
  where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── waitlist ─────────────────────────

create or replace function public.own_waitlist(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
begin
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', w.id, 'service_id', w.service_id, 'service_name_ar', s.name_ar, 'service_name_en', s.name_en,
      'day', w.day, 'part', w.part, 'qty', w.qty, 'name', w.name, 'phone', w.phone, 'status', w.status,
      'created_at', w.created_at) order by w.day, w.created_at)
    from public.waitlist w left join public.services s on s.id = w.service_id
    where w.business_id = b.id and w.day >= public._today() - 1 and w.status in ('waiting','contacted')), '[]'));
end $$;

create or replace function public.own_waitlist_update(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
begin
  if p ->> 'status' not in ('waiting','contacted','booked','removed') then perform public._err('BAD_INPUT'); end if;
  update public.waitlist set status = p ->> 'status' where id = public._uuid(p ->> 'id') and business_id = b.id;
  return jsonb_build_object('ok', found);
end $$;

-- ───────────────────────── billing (care plans) ─────────────────────────

create or replace function public.own_billing(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
begin
  return jsonb_build_object(
    'subscription', coalesce((select to_jsonb(x) from public.subscriptions x where x.business_id = b.id),
                             jsonb_build_object('status', 'none')),
    'plans', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('yearly_saving_halalas', x.monthly_halalas * 12 - x.yearly_halalas)
                                        order by x.sort) from public.plans x), '[]'),
    'setup_halalas', b.setup_halalas);
end $$;

-- An owner asks to start, switch or stop a care plan. Ahmed confirms it (adm_plan_set) once paid.
create or replace function public.own_plan_request(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  v_code text := nullif(p ->> 'plan_code', 'none');
  v_int text := coalesce(p ->> 'interval', 'monthly');
  pl public.plans;
  amount integer := 0;
begin
  if v_code is not null and not exists (select 1 from public.plans where code = v_code) then perform public._err('BAD_INPUT'); end if;
  if v_int not in ('monthly','yearly') then perform public._err('BAD_INPUT'); end if;
  insert into public.subscriptions (business_id, status) values (b.id, 'none') on conflict (business_id) do nothing;
  update public.subscriptions set requested_code = coalesce(v_code, 'none'), requested_interval = v_int, requested_at = now()
   where business_id = b.id;
  if v_code is not null then
    select * into pl from public.plans where code = v_code;
    amount := case when v_int = 'yearly' then pl.yearly_halalas else pl.monthly_halalas end;
  end if;
  insert into public.notifications (kind, title_ar, title_en, body_ar, body_en, url, ref_id)
  values ('plan_request',
          'طلب تغيير الباقة · ' || coalesce(nullif(b.name_ar, ''), b.name_en),
          'Plan change request · ' || coalesce(nullif(b.name_en, ''), b.name_ar),
          coalesce(pl.name_ar, 'بدون باقة') || case when v_code is null then '' else ' · ' || (amount / 100)::text || ' ر.س' end,
          coalesce(pl.name_en, 'No plan') || case when v_code is null then '' else ' · ' || (amount / 100)::text || ' SAR / ' || v_int end,
          '/admin/#/businesses/' || b.id, b.id);
  return public.own_billing(p);
end $$;

-- ───────────────────────── push subscriptions ─────────────────────────

create or replace function public.own_push_subscribe(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then perform public._err('NOT_ALLOWED'); end if;
  if coalesce(p ->> 'endpoint', '') !~ '^https://' or p -> 'keys' ->> 'p256dh' is null or p -> 'keys' ->> 'auth' is null then
    perform public._err('BAD_INPUT');
  end if;
  insert into public.push_subscriptions (user_id, endpoint, keys, lang, ua)
  values (auth.uid(), p ->> 'endpoint', p -> 'keys', case when p ->> 'lang' = 'en' then 'en' else 'ar' end, left(coalesce(p ->> 'ua', ''), 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys, lang = excluded.lang, ua = excluded.ua;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.own_push_unsubscribe(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.push_subscriptions where endpoint = p ->> 'endpoint' and user_id = auth.uid();
  return jsonb_build_object('ok', found);
end $$;


-- Fix a customer's details on a booking (typo in the name, a new phone, a note from the call).
create or replace function public.own_booking_edit(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses := public._biz(p);
  bk public.bookings;
  v_phone text := public._phone(p ->> 'phone');
begin
  if p ? 'phone' and coalesce(p ->> 'phone', '') <> '' and v_phone is null then perform public._err('BAD_PHONE'); end if;
  update public.bookings set
      name  = case when p ? 'name' then left(btrim(coalesce(p ->> 'name', '')), 80) else name end,
      phone = case when p ? 'phone' then v_phone else phone end,
      email = case when p ? 'email' then nullif(lower(btrim(coalesce(p ->> 'email', ''))), '') else email end,
      note  = case when p ? 'note' then left(nullif(btrim(coalesce(p ->> 'note', '')), ''), 500) else note end
    where id = public._uuid(p ->> 'booking_id') and business_id = b.id
    returning * into bk;
  if not found then perform public._err('NOT_FOUND'); end if;
  return public._booking_row(bk);
end $$;
