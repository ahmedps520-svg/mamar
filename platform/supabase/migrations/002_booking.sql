-- Mamar Booking · 002 slot engine and the public booking API
--
-- One function, _slots(), decides what is bookable. pub_slots shows its output and pub_book
-- accepts a start only if _slots() offers it — so a customer can never pick a time the server refuses.

create or replace function public._uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  if t is null or t = '' then return null; end if;
  return t::uuid;
exception when others then
  return null;
end $$;

create or replace function public._int(t text, dflt integer) returns integer
language plpgsql immutable as $$
begin
  if t is null or t = '' then return dflt; end if;
  return t::integer;
exception when others then
  return dflt;
end $$;

create or replace function public._section_for(s public.services, p_section uuid) returns uuid
language sql stable as $$
  select coalesce(
    s.section_id,
    (select id from public.sections where id = p_section and business_id = s.business_id),
    (select id from public.sections where business_id = s.business_id order by sort, id limit 1))
$$;

-- Opening ranges for one business day of one section (special hours win over weekly hours).
create or replace function public._day_ranges(bid uuid, sec uuid, d date)
returns table (open_at timestamptz, close_at timestamptz)
language plpgsql stable as $$
declare
  sp public.special_hours;
begin
  select * into sp from public.special_hours
   where business_id = bid and (section_id = sec or section_id is null) and d between from_date and to_date
   order by (section_id is null), (to_date - from_date), from_date desc
   limit 1;
  if found then
    return query
      select public._at(d, (r ->> 0)::int), public._at(d, (r ->> 1)::int)
      from jsonb_array_elements(sp.ranges) r
      where (r ->> 1)::int > (r ->> 0)::int;
  else
    return query
      select public._at(d, h.open_min), public._at(d, h.close_min)
      from public.hours h
      where h.section_id = sec and h.weekday = extract(dow from d)::int;
  end if;
end $$;

-- Prayer pauses: [adhan − before, adhan + after). Friday's Dhuhr uses the Jumu'ah length.
create or replace function public._prayer_windows(p_city text, d1 date, d2 date, pc jsonb)
returns table (w tstzrange)
language sql stable as $$
  select tstzrange(
           x.t - make_interval(mins => coalesce((pc ->> 'before_min')::int, 0)),
           x.t + make_interval(mins => case when v.nm = 'dhuhr' and extract(isodow from pt.day) = 5
                                            then coalesce((pc ->> 'jumuah_min')::int, 60)
                                            else coalesce((pc ->> 'after_min')::int, 25) end),
           '[)')
  from public.prayer_times pt
  cross join lateral (values ('fajr', pt.fajr), ('dhuhr', pt.dhuhr), ('asr', pt.asr),
                             ('maghrib', pt.maghrib), ('isha', pt.isha)) v(nm, tm)
  cross join lateral (select (pt.day + v.tm) at time zone 'Asia/Riyadh' as t) x
  where pt.city = p_city and pt.day between d1 and d2
    and (v.nm <> 'fajr' or coalesce((pc ->> 'fajr')::boolean, false))
$$;

-- Every bookable start for one service on one business day.
--   staff mode    → staff_ids = free eligible staff, least busy first; left_qty = how many
--   capacity mode → left_qty = places left at the busiest moment of the slot (peak, not sum)
-- p_ignore skips one booking (rescheduling it). p_owner relaxes notice, horizon and prayer pauses.
create or replace function public._slots(
  p_svc uuid, p_day date, p_section uuid default null, p_staff uuid default null,
  p_qty integer default 1, p_loc text default 'shop', p_ignore uuid default null, p_owner boolean default false)
returns table (start_at timestamptz, end_at timestamptz, staff_ids uuid[], left_qty integer)
language plpgsql stable as $$
declare
  s public.services;
  b public.businesses;
  cfg jsonb;
  sec uuid;
  dur interval;
  tail interval;
  step interval;
  earliest timestamptz;
  latest timestamptz;
  pray boolean;
begin
  select * into s from public.services where id = p_svc and active;
  if not found then return; end if;
  select * into b from public.businesses where id = s.business_id;
  cfg := public._cfg(b);
  if s.section_id is not null and p_section is not null and s.section_id <> p_section then return; end if;
  sec := public._section_for(s, p_section);
  if sec is null then return; end if;
  if p_loc not in ('shop','mobile') then return; end if;
  if p_loc = 'mobile' and (s.location = 'shop' or not (cfg #>> '{home,on}')::boolean) then return; end if;
  if p_loc = 'shop' and s.location = 'mobile' then return; end if;
  if p_qty < 1 or p_qty > s.max_qty then return; end if;
  if s.mode = 'staff' and p_qty <> 1 then return; end if;

  dur  := make_interval(mins => s.duration_min);
  tail := make_interval(mins => s.buffer_min
            + case when p_loc = 'mobile' then (cfg #>> '{home,travel_min}')::int else 0 end);
  step := make_interval(mins => s.step_min);
  pray := not p_owner and coalesce((cfg #>> '{prayer,on}')::boolean, false);
  if p_owner then
    earliest := '-infinity';
    latest   := 'infinity';
  else
    earliest := now() + make_interval(mins => (cfg ->> 'notice_min')::int);
    latest   := public._at(public._today() + (cfg ->> 'horizon_days')::int + 1, 0);
  end if;

  return query
  with cand as (
    select gs as st, gs + dur as en, tstzrange(gs, gs + dur + tail, '[)') as br
    from public._day_ranges(b.id, sec, p_day) r
    cross join lateral generate_series(r.open_at, r.close_at - dur, step) gs
    where gs >= earliest and gs < latest
  ),
  open_c as (
    select c.* from cand c
    where not exists (
            select 1 from public.blocks bl
            where bl.business_id = b.id and bl.staff_id is null and bl.resource_id is null
              and (bl.section_id is null or bl.section_id = sec) and bl.during && c.br)
      and (not pray or not exists (
            select 1 from public._prayer_windows(b.city, p_day - 1, p_day + 1, cfg -> 'prayer') pw
            where pw.w && tstzrange(c.st, c.en, '[)')))
  )
  select o.st, o.en, x.ids, x.lft
  from open_c o
  cross join lateral (
    -- staff mode
    select array_agg(sf.id order by sf.load, sf.sort, sf.id) as ids, count(*)::int as lft
    from (
      select st2.id, st2.sort,
        (select count(*) from public.bookings bk2
          where bk2.staff_id = st2.id and bk2.status in ('pending_payment','confirmed')
            and bk2.starts_at >= public._at(p_day, 0) and bk2.starts_at < public._at(p_day + 1, 0)) as load
      from public.staff st2
      where s.mode = 'staff' and st2.business_id = b.id and st2.active
        and (st2.section_id is null or st2.section_id = sec)
        and (st2.services is null or s.id = any(st2.services))
        and (p_staff is null or st2.id = p_staff)
        and not exists (
          select 1 from public.bookings bk
          where bk.staff_id = st2.id and bk.id is distinct from p_ignore
            and (bk.status = 'confirmed' or (bk.status = 'pending_payment' and bk.hold_until > now()))
            and bk.busy && o.br)
        and not exists (select 1 from public.blocks bl where bl.staff_id = st2.id and bl.during && o.br)
    ) sf
    having count(*) > 0
    union all
    -- capacity mode
    select null::uuid[], (r.capacity - pk.peak)::int
    from public.resources r
    cross join lateral (
      select coalesce(max(u.used), 0)::int as peak
      from (
        select (select coalesce(sum(bk.qty), 0) from public.bookings bk
                 where bk.resource_id = r.id and bk.id is distinct from p_ignore
                   and (bk.status = 'confirmed' or (bk.status = 'pending_payment' and bk.hold_until > now()))
                   and bk.busy @> pt.t) as used
        from (
          select lower(o.br) as t
          union
          select lower(bk3.busy) from public.bookings bk3
           where bk3.resource_id = r.id and bk3.id is distinct from p_ignore
             and (bk3.status = 'confirmed' or (bk3.status = 'pending_payment' and bk3.hold_until > now()))
             and bk3.busy && o.br and lower(bk3.busy) > lower(o.br)
        ) pt
      ) u
    ) pk
    where s.mode = 'capacity' and r.id = s.resource_id and r.active
      and not exists (select 1 from public.blocks bl where bl.resource_id = r.id and bl.during && o.br)
      and r.capacity - pk.peak >= p_qty
  ) x
  order by o.st;
end $$;

-- Price for one booking. Offers live now apply; weekday offers apply only when p_at falls on that day.
create or replace function public._price(s public.services, p_at timestamptz, p_qty integer, p_loc text, cfg jsonb)
returns jsonb
language sql stable as $$
  with base as (
    select s.price_halalas * (case when s.per_person then greatest(1, coalesce(p_qty, 1)) else 1 end) as p
  ),
  best as (
    select o.id, o.title_ar, o.title_en,
           least(base.p, case o.kind when 'percent' then round(base.p * o.value / 100.0)::int else o.value end) as d
    from public.offers o, base
    where o.business_id = s.business_id and o.active and o.kind in ('percent','amount')
      and (o.service_ids is null or s.id = any(o.service_ids))
      and (o.starts_at is null or o.starts_at <= now())
      and (o.ends_at is null or o.ends_at > now())
      and (o.weekdays is null
           or (p_at is not null and extract(dow from p_at at time zone 'Asia/Riyadh')::int = any(o.weekdays)))
    order by 4 desc, o.created_at
    limit 1
  ),
  fee as (
    select case when p_loc = 'mobile' then coalesce((cfg #>> '{home,fee_halalas}')::int, 0) else 0 end as f
  )
  select jsonb_build_object(
    'price', base.p, 'discount', coalesce(best.d, 0), 'fee', fee.f,
    'total', base.p - coalesce(best.d, 0) + fee.f,
    'offer_id', best.id, 'offer_ar', best.title_ar, 'offer_en', best.title_en)
  from base cross join fee left join best on true
$$;

create or replace function public._due(total integer, cfg jsonb) returns integer
language sql immutable as $$
  select case cfg #>> '{payment,mode}'
    when 'full' then total
    when 'deposit' then least(total, case cfg #>> '{payment,deposit_kind}'
                                       when 'amount' then (cfg #>> '{payment,deposit_value}')::int
                                       else ceil(total * (cfg #>> '{payment,deposit_value}')::numeric / 100)::int end)
    else 0 end
$$;

-- Load a service whose business is live (or previewable by its members).
create or replace function public._live_service(p_id uuid) returns public.services
language plpgsql stable as $$
declare
  s public.services;
  st text;
begin
  select * into s from public.services where id = p_id and active;
  if not found then perform public._err('NOT_FOUND'); end if;
  select status into st from public.businesses where id = s.business_id;
  if st <> 'active' and not public._is_member(s.business_id) then perform public._err('NOT_FOUND'); end if;
  return s;
end $$;

-- The one place a booking row is written (customers, owners and reschedules all come through here).
create or replace function public._book_core(
  s public.services, b public.businesses, cfg jsonb, v_start timestamptz, v_sec uuid, v_staff uuid,
  v_qty integer, v_loc text, cust jsonb, v_source text, v_owner boolean, v_force boolean)
returns jsonb
language plpgsql as $$
declare
  v_day date := (v_start at time zone 'Asia/Riyadh')::date;
  cand record;
  pr jsonb;
  v_total integer;
  v_due integer;
  v_status text;
  v_token text := public._token();
  v_ref text;
  v_id uuid;
  v_end timestamptz;
  v_tail interval;
  v_sid uuid;
  sec uuid := public._section_for(s, v_sec);
  st public.staff;
begin
  -- Lazily release payment holds that ran out, so they stop blocking the exclusion constraint.
  update public.bookings set status = 'expired'
   where business_id = b.id and status = 'pending_payment' and hold_until <= now();

  -- Capacity is checked under a row lock on the shared resource: concurrent bookers queue here.
  if s.mode = 'capacity' then
    perform 1 from public.resources where id = s.resource_id for update;
  end if;

  select * into cand from (
    select * from public._slots(s.id, v_day,     sec, v_staff, v_qty, v_loc, null, v_owner)
    union all
    select * from public._slots(s.id, v_day - 1, sec, v_staff, v_qty, v_loc, null, v_owner)
  ) x where x.start_at = v_start
  limit 1;

  if not found and not v_force then
    if not v_owner and v_start < now() + make_interval(mins => (cfg ->> 'notice_min')::int) then
      perform public._err('TOO_SOON');
    end if;
    perform public._err('SLOT_TAKEN');
  end if;

  v_end  := v_start + make_interval(mins => s.duration_min);
  v_tail := make_interval(mins => s.buffer_min
              + case when v_loc = 'mobile' then (cfg #>> '{home,travel_min}')::int else 0 end);
  pr      := public._price(s, v_start, v_qty, v_loc, cfg);
  v_total := (pr ->> 'total')::int;
  v_due   := case when v_owner then 0 else public._due(v_total, cfg) end;
  v_status := case when v_due > 0 then 'pending_payment' else 'confirmed' end;

  loop
    v_ref := public._ref('MB');
    exit when not exists (select 1 from public.bookings where ref = v_ref);
  end loop;

  -- Staff mode: try the free chairs, least busy first. An owner forcing a booking onto a chosen chair
  -- tries that chair; if it is genuinely taken the booking stays unassigned rather than double-booked.
  if s.mode = 'staff' and (cand.staff_ids is not null or (v_force and v_staff is not null)) then
    foreach v_sid in array coalesce(cand.staff_ids, array[v_staff]) loop
      begin
        select * into st from public.staff where id = v_sid;
        insert into public.bookings (
          ref, business_id, section_id, service_id, staff_id, resource_id, qty, starts_at, ends_at, busy,
          status, hold_until, name, phone, email, note, location, lat, lng, address,
          price_halalas, discount_halalas, fee_halalas, total_halalas, due_now_halalas, offer_id,
          token_hash, lang, source, service_name_ar, service_name_en, staff_label_ar, staff_label_en)
        values (
          v_ref, b.id, sec, s.id, v_sid, null, 1, v_start, v_end, tstzrange(v_start, v_end + v_tail, '[)'),
          v_status, case when v_due > 0 then now() + make_interval(mins => (cfg ->> 'hold_min')::int) end,
          coalesce(cust ->> 'name', ''), cust ->> 'phone', cust ->> 'email', cust ->> 'note', v_loc,
          (cust ->> 'lat')::double precision, (cust ->> 'lng')::double precision, cust ->> 'address',
          (pr ->> 'price')::int, (pr ->> 'discount')::int, (pr ->> 'fee')::int, v_total, v_due,
          public._uuid(pr ->> 'offer_id'), public._hash(v_token), coalesce(cust ->> 'lang', 'ar'), v_source,
          s.name_ar, s.name_en, st.label_ar, st.label_en)
        returning id into v_id;
        exit;
      exception when exclusion_violation then
        v_id := null;   -- someone took this chair a moment ago; try the next one
      end;
    end loop;
    if v_id is null and not v_force then perform public._err('SLOT_TAKEN'); end if;
  end if;

  if v_id is null then
    -- capacity mode, or an owner forcing a walk-in with no chair free
    insert into public.bookings (
      ref, business_id, section_id, service_id, staff_id, resource_id, qty, starts_at, ends_at, busy,
      status, hold_until, name, phone, email, note, location, lat, lng, address,
      price_halalas, discount_halalas, fee_halalas, total_halalas, due_now_halalas, offer_id,
      token_hash, lang, source, service_name_ar, service_name_en)
    values (
      v_ref, b.id, sec, s.id, null, case when s.mode = 'capacity' then s.resource_id end, v_qty, v_start, v_end,
      tstzrange(v_start, v_end + v_tail, '[)'),
      v_status, case when v_due > 0 then now() + make_interval(mins => (cfg ->> 'hold_min')::int) end,
      coalesce(cust ->> 'name', ''), cust ->> 'phone', cust ->> 'email', cust ->> 'note', v_loc,
      (cust ->> 'lat')::double precision, (cust ->> 'lng')::double precision, cust ->> 'address',
      (pr ->> 'price')::int, (pr ->> 'discount')::int, (pr ->> 'fee')::int, v_total, v_due,
      public._uuid(pr ->> 'offer_id'), public._hash(v_token), coalesce(cust ->> 'lang', 'ar'), v_source,
      s.name_ar, s.name_en)
    returning id into v_id;
  end if;

  return (select jsonb_build_object(
      'booking_id', bk.id, 'ref', bk.ref, 'token', v_token, 'status', bk.status,
      'starts_at', bk.starts_at, 'ends_at', bk.ends_at, 'hold_until', bk.hold_until,
      'qty', bk.qty, 'location', bk.location,
      'service_name_ar', bk.service_name_ar, 'service_name_en', bk.service_name_en,
      'staff_label_ar', bk.staff_label_ar, 'staff_label_en', bk.staff_label_en,
      'price_halalas', bk.price_halalas, 'discount_halalas', bk.discount_halalas, 'fee_halalas', bk.fee_halalas,
      'total_halalas', bk.total_halalas, 'due_now_halalas', bk.due_now_halalas)
    from public.bookings bk where bk.id = v_id);
end $$;

-- ───────────────────────── public reads ─────────────────────────

create or replace function public._public_service(s public.services, cfg jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', s.id, 'section_id', s.section_id, 'category_id', s.category_id,
    'name_ar', s.name_ar, 'name_en', s.name_en, 'desc_ar', s.desc_ar, 'desc_en', s.desc_en,
    'duration_min', s.duration_min, 'mode', s.mode, 'max_qty', s.max_qty, 'per_person', s.per_person,
    'price_from', s.price_from, 'location', s.location,
    'price', public._price(s, null, 1, 'shop', cfg))
$$;

create or replace function public.pub_business(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  b public.businesses;
  cfg jsonb;
begin
  select * into b from public.businesses
   where slug = lower(coalesce(p ->> 'slug', '')) or id = public._uuid(p ->> 'business_id')
   limit 1;
  if not found or (b.status <> 'active' and not public._is_member(b.id)) then
    perform public._err('NOT_FOUND');
  end if;
  cfg := public._cfg(b);
  return jsonb_build_object(
    'business', jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'status', b.status, 'is_demo', b.is_demo, 'kind', b.kind,
      'name_ar', b.name_ar, 'name_en', b.name_en, 'tagline_ar', b.tagline_ar, 'tagline_en', b.tagline_en,
      'phone', b.phone, 'address_ar', b.address_ar, 'address_en', b.address_en,
      'maps_url', b.maps_url, 'site_url', b.site_url, 'instagram', b.instagram,
      'lat', b.lat, 'lng', b.lng, 'city', b.city,
      'langs', to_jsonb(b.langs), 'look', b.look, 'theme', b.theme, 'moyasar_pk', b.moyasar_pk),
    'flow', cfg - 'max_per_phone',
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name_ar', x.name_ar, 'name_en', x.name_en, 'audience', x.audience) order by x.sort, x.id)
      from public.sections x where x.business_id = b.id), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'section_id', x.section_id, 'name_ar', x.name_ar, 'name_en', x.name_en) order by x.sort, x.id)
      from public.categories x where x.business_id = b.id), '[]'),
    'services', coalesce((select jsonb_agg(public._public_service(x, cfg) order by x.sort, x.created_at)
      from public.services x where x.business_id = b.id and x.active), '[]'),
    'staff', case when (cfg ->> 'staff_choice')::boolean then coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'section_id', x.section_id, 'label_ar', x.label_ar, 'label_en', x.label_en,
        'services', to_jsonb(x.services)) order by x.sort, x.id)
      from public.staff x where x.business_id = b.id and x.active), '[]') else '[]' end,
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'value', x.value, 'title_ar', x.title_ar, 'title_en', x.title_en,
        'service_ids', to_jsonb(x.service_ids), 'weekdays', to_jsonb(x.weekdays),
        'starts_at', x.starts_at, 'ends_at', x.ends_at) order by x.created_at)
      from public.offers x where x.business_id = b.id and x.active
        and (x.starts_at is null or x.starts_at <= now()) and (x.ends_at is null or x.ends_at > now())), '[]'),
    'hours', coalesce((select jsonb_agg(jsonb_build_object(
        'section_id', h.section_id, 'weekday', h.weekday, 'open_min', h.open_min, 'close_min', h.close_min)
        order by h.weekday, h.open_min)
      from public.hours h where h.business_id = b.id), '[]'),
    'live', coalesce((select jsonb_build_object('catalog', lp.catalog_v, 'slots', lp.slots_v)
      from public.live_pings lp where lp.business_id = b.id), jsonb_build_object('catalog', 0, 'slots', 0)));
end $$;

-- A customer rescheduling passes their manage token so their own booking doesn't block its own slot.
create or replace function public._own_booking(p_token text, p_service uuid) returns uuid
language sql stable as $$
  select id from public.bookings
  where coalesce(p_token, '') <> '' and token_hash = public._hash(p_token) and service_id = p_service
    and status in ('pending_payment','confirmed')
  limit 1
$$;

create or replace function public.pub_days(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.services;
  b public.businesses;
  cfg jsonb;
  t0 date := public._today();
  d date;
  n integer;
  out_days jsonb := '[]';
  v_staff uuid;
  v_qty integer := public._int(p ->> 'qty', 1);
  v_loc text := coalesce(p ->> 'location', 'shop');
  v_ignore uuid;
  v_sec uuid;
begin
  s := public._live_service(public._uuid(p ->> 'service_id'));
  select * into b from public.businesses where id = s.business_id;
  cfg := public._cfg(b);
  v_staff := case when (cfg ->> 'staff_choice')::boolean then public._uuid(p ->> 'staff_id') end;
  v_ignore := public._own_booking(p ->> 'token', s.id);
  v_sec := public._section_for(s, public._uuid(p ->> 'section_id'));
  for d in select generate_series(t0 - 1, t0 + (cfg ->> 'horizon_days')::int, interval '1 day')::date loop
    select count(*) into n
      from public._slots(s.id, d, public._uuid(p ->> 'section_id'), v_staff, v_qty, v_loc, v_ignore, false);
    if d >= t0 or n > 0 then
      -- closed = no opening hours that day at all (vs. open but fully booked)
      out_days := out_days || jsonb_build_array(jsonb_build_object('day', d, 'n', n,
        'closed', not exists (select 1 from public._day_ranges(b.id, v_sec, d))));
    end if;
  end loop;
  return jsonb_build_object('service_id', s.id, 'days', out_days);
end $$;

create or replace function public.pub_slots(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.services;
  b public.businesses;
  cfg jsonb;
  d date;
  v_staff uuid;
  v_qty integer := public._int(p ->> 'qty', 1);
  v_loc text := coalesce(p ->> 'location', 'shop');
  v_ignore uuid;
begin
  s := public._live_service(public._uuid(p ->> 'service_id'));
  select * into b from public.businesses where id = s.business_id;
  cfg := public._cfg(b);
  begin
    d := (p ->> 'day')::date;
  exception when others then
    perform public._err('BAD_INPUT');
  end;
  v_staff := case when (cfg ->> 'staff_choice')::boolean then public._uuid(p ->> 'staff_id') end;
  v_ignore := public._own_booking(p ->> 'token', s.id);
  return jsonb_build_object(
    'day', d,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('t', x.start_at, 'end', x.end_at, 'n', x.left_qty)
                                         order by x.start_at)
      from public._slots(s.id, d, public._uuid(p ->> 'section_id'), v_staff, v_qty, v_loc, v_ignore, false) x), '[]'),
    'price', public._price(s, public._at(d, 720), v_qty, v_loc, cfg));
end $$;

-- ───────────────────────── public writes ─────────────────────────

create or replace function public.pub_book(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.services;
  b public.businesses;
  cfg jsonb;
  v_start timestamptz;
  v_phone text := public._phone(p ->> 'phone');
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_email text := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
  v_loc text := coalesce(p ->> 'location', 'shop');
  v_qty integer := public._int(p ->> 'qty', 1);
  v_source text := case when p ->> 'source' in ('web','embed','link') then p ->> 'source' else 'web' end;
  v_staff uuid;
begin
  -- Honeypot: bots fill the invisible "website" field. Answer politely, store nothing.
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('ref', public._ref('MB'), 'status', 'confirmed', 'token', public._token());
  end if;

  s := public._live_service(public._uuid(p ->> 'service_id'));
  select * into b from public.businesses where id = s.business_id;
  if b.status <> 'active' then perform public._err('NOT_FOUND'); end if;
  cfg := public._cfg(b);

  begin
    v_start := (p ->> 'start')::timestamptz;
  exception when others then
    perform public._err('BAD_INPUT');
  end;
  if v_start is null then perform public._err('BAD_INPUT'); end if;

  if length(v_name) < 2 or length(v_name) > 80 then perform public._err('BAD_NAME'); end if;
  if v_phone is null then perform public._err('BAD_PHONE'); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._err('BAD_EMAIL'); end if;
  if cfg #>> '{customer,email}' = 'required' and v_email is null then perform public._err('BAD_EMAIL'); end if;
  if v_loc = 'mobile' and p ->> 'lat' is null and coalesce(btrim(p ->> 'address'), '') = '' then
    perform public._err('NEED_LOCATION');
  end if;
  v_staff := case when (cfg ->> 'staff_choice')::boolean then public._uuid(p ->> 'staff_id') end;

  -- Abuse limits: a phone can hold a few upcoming bookings; a business takes a burst at most.
  if (select count(*) from public.bookings
       where business_id = b.id and phone = v_phone and status in ('pending_payment','confirmed')
         and starts_at > now()) >= (cfg ->> 'max_per_phone')::int then
    perform public._err('RATE_LIMITED');
  end if;
  if (select count(*) from public.bookings
       where business_id = b.id and created_at > now() - interval '10 minutes'
         and source in ('web','embed','link')) >= 40 then
    perform public._err('RATE_LIMITED');
  end if;

  return public._book_core(s, b, cfg, v_start, public._uuid(p ->> 'section_id'), v_staff, v_qty, v_loc,
    jsonb_build_object('name', v_name, 'phone', v_phone, 'email', v_email,
                       'note', left(nullif(btrim(coalesce(p ->> 'note', '')), ''), 500),
                       'lat', p -> 'lat', 'lng', p -> 'lng',
                       'address', left(nullif(btrim(coalesce(p ->> 'address', '')), ''), 300),
                       'lang', case when p ->> 'lang' = 'en' then 'en' else 'ar' end),
    v_source, false, false);
end $$;

-- What the confirmation / manage page shows. The token is the only key.
create or replace function public._booking_view(bk public.bookings) returns jsonb
language plpgsql stable as $$
declare
  b public.businesses;
  cfg jsonb;
  cut interval;
  can boolean;
begin
  select * into b from public.businesses where id = bk.business_id;
  cfg := public._cfg(b);
  cut := make_interval(hours => coalesce((cfg #>> '{self_manage,cutoff_hours}')::int, 3));
  can := (cfg #>> '{self_manage,on}')::boolean and bk.status in ('pending_payment','confirmed')
         and bk.starts_at - cut > now();
  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', bk.id, 'ref', bk.ref, 'status', bk.status, 'starts_at', bk.starts_at, 'ends_at', bk.ends_at,
      'hold_until', bk.hold_until, 'service_id', bk.service_id, 'section_id', bk.section_id, 'qty', bk.qty,
      'service_name_ar', bk.service_name_ar, 'service_name_en', bk.service_name_en,
      'staff_label_ar', bk.staff_label_ar, 'staff_label_en', bk.staff_label_en,
      'location', bk.location, 'address', bk.address, 'lat', bk.lat, 'lng', bk.lng,
      'name', bk.name, 'phone', bk.phone, 'note', bk.note,
      'price_halalas', bk.price_halalas, 'discount_halalas', bk.discount_halalas, 'fee_halalas', bk.fee_halalas,
      'total_halalas', bk.total_halalas, 'due_now_halalas', bk.due_now_halalas, 'paid_halalas', bk.paid_halalas,
      'lang', bk.lang),
    'business', jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name_ar', b.name_ar, 'name_en', b.name_en, 'phone', b.phone,
      'address_ar', b.address_ar, 'address_en', b.address_en, 'maps_url', b.maps_url,
      'langs', to_jsonb(b.langs), 'look', b.look, 'theme', b.theme, 'is_demo', b.is_demo,
      'moyasar_pk', b.moyasar_pk),
    'can_cancel', can,
    'can_reschedule', can,
    'cutoff_hours', coalesce((cfg #>> '{self_manage,cutoff_hours}')::int, 3));
end $$;

create or replace function public.pub_booking(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  bk public.bookings;
begin
  select * into bk from public.bookings where token_hash = public._hash(p ->> 'token') limit 1;
  if not found or coalesce(p ->> 'token', '') = '' then perform public._err('NOT_FOUND'); end if;
  return public._booking_view(bk);
end $$;

create or replace function public.pub_cancel(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  bk public.bookings;
  v jsonb;
begin
  select * into bk from public.bookings where token_hash = public._hash(p ->> 'token') limit 1 for update;
  if not found or coalesce(p ->> 'token', '') = '' then perform public._err('NOT_FOUND'); end if;
  v := public._booking_view(bk);
  if not (v ->> 'can_cancel')::boolean then perform public._err('TOO_LATE'); end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(coalesce(p ->> 'reason', 'customer'), 200)
   where id = bk.id
   returning * into bk;
  return public._booking_view(bk);
end $$;

create or replace function public.pub_reschedule(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  bk public.bookings;
  s public.services;
  b public.businesses;
  cfg jsonb;
  v jsonb;
  v_start timestamptz;
  v_day date;
  cand record;
  v_sid uuid;
  st public.staff;
  v_tail interval;
begin
  select * into bk from public.bookings where token_hash = public._hash(p ->> 'token') limit 1 for update;
  if not found or coalesce(p ->> 'token', '') = '' then perform public._err('NOT_FOUND'); end if;
  v := public._booking_view(bk);
  if not (v ->> 'can_reschedule')::boolean then perform public._err('TOO_LATE'); end if;
  select * into s from public.services where id = bk.service_id and active;
  if not found then perform public._err('NOT_FOUND'); end if;
  select * into b from public.businesses where id = bk.business_id;
  cfg := public._cfg(b);
  begin
    v_start := (p ->> 'start')::timestamptz;
  exception when others then
    perform public._err('BAD_INPUT');
  end;
  v_day := (v_start at time zone 'Asia/Riyadh')::date;

  if s.mode = 'capacity' then
    perform 1 from public.resources where id = s.resource_id for update;
  end if;

  select * into cand from (
    select * from public._slots(s.id, v_day,     bk.section_id, null, bk.qty, bk.location, bk.id, false)
    union all
    select * from public._slots(s.id, v_day - 1, bk.section_id, null, bk.qty, bk.location, bk.id, false)
  ) x where x.start_at = v_start limit 1;
  if not found then perform public._err('SLOT_TAKEN'); end if;

  v_sid := case when s.mode <> 'staff' then null
                when bk.staff_id = any(cand.staff_ids) then bk.staff_id
                else cand.staff_ids[1] end;
  select * into st from public.staff where id = v_sid;
  v_tail := upper(bk.busy) - bk.ends_at;

  update public.bookings set
    starts_at = v_start,
    ends_at = v_start + (bk.ends_at - bk.starts_at),
    busy = tstzrange(v_start, v_start + (bk.ends_at - bk.starts_at) + v_tail, '[)'),
    staff_id = v_sid,
    staff_label_ar = st.label_ar,
    staff_label_en = st.label_en
  where id = bk.id
  returning * into bk;
  return public._booking_view(bk);
exception when exclusion_violation then
  perform public._err('SLOT_TAKEN');
end $$;

create or replace function public.pub_waitlist_join(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.services;
  b public.businesses;
  v_phone text := public._phone(p ->> 'phone');
  v_day date;
begin
  s := public._live_service(public._uuid(p ->> 'service_id'));
  select * into b from public.businesses where id = s.business_id;
  if not (public._cfg(b) ->> 'waitlist')::boolean then perform public._err('FEATURE_OFF'); end if;
  if v_phone is null then perform public._err('BAD_PHONE'); end if;
  if length(btrim(coalesce(p ->> 'name', ''))) < 2 then perform public._err('BAD_NAME'); end if;
  begin
    v_day := (p ->> 'day')::date;
  exception when others then
    perform public._err('BAD_INPUT');
  end;
  if v_day < public._today() then perform public._err('BAD_INPUT'); end if;
  if exists (select 1 from public.waitlist where business_id = b.id and phone = v_phone and day = v_day
               and service_id = s.id and status = 'waiting') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if (select count(*) from public.waitlist where phone = v_phone and created_at > now() - interval '1 day') >= 5 then
    perform public._err('RATE_LIMITED');
  end if;
  insert into public.waitlist (business_id, service_id, day, part, qty, name, phone)
  values (b.id, s.id, v_day,
          case when p ->> 'part' in ('morning','afternoon','evening') then p ->> 'part' else 'any' end,
          greatest(1, public._int(p ->> 'qty', 1)), left(btrim(p ->> 'name'), 80), v_phone);
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── payments (Moyasar) ─────────────────────────

create or replace function public.pub_attach_payment(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  bk public.bookings;
begin
  select * into bk from public.bookings
   where id = public._uuid(p ->> 'booking_id') and token_hash = public._hash(p ->> 'token') for update;
  if not found then perform public._err('NOT_FOUND'); end if;
  if coalesce(p ->> 'moyasar_id', '') !~ '^[A-Za-z0-9_-]{6,80}$' then perform public._err('BAD_INPUT'); end if;
  if bk.moyasar_id is not null and bk.moyasar_id <> p ->> 'moyasar_id' then perform public._err('NOT_ALLOWED'); end if;
  update public.bookings set moyasar_id = p ->> 'moyasar_id' where id = bk.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pub_payment_status(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  bk public.bookings;
begin
  select * into bk from public.bookings
   where id = public._uuid(p ->> 'booking_id') and token_hash = public._hash(p ->> 'token');
  if not found then perform public._err('NOT_FOUND'); end if;
  return jsonb_build_object('status', bk.status, 'paid_halalas', bk.paid_halalas,
    'due_now_halalas', bk.due_now_halalas, 'hold_until', bk.hold_until, 'pay_flag', bk.pay_flag,
    'moyasar_id', bk.moyasar_id);
end $$;

create or replace function public.svc_payment_context(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  bk public.bookings;
begin
  select * into bk from public.bookings where id = public._uuid(p ->> 'booking_id');
  if not found then perform public._err('NOT_FOUND'); end if;
  return jsonb_build_object(
    'booking_id', bk.id, 'business_id', bk.business_id, 'status', bk.status, 'moyasar_id', bk.moyasar_id,
    'due_now_halalas', bk.due_now_halalas, 'currency', 'SAR',
    'secret_key', (select moyasar_sk from public.business_secrets where business_id = bk.business_id));
end $$;

-- Idempotent: the Edge Function may call it several times for the same payment.
create or replace function public.svc_confirm_payment(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  bk public.bookings;
  b public.businesses;
  v_amount integer := public._int(p ->> 'amount_halalas', -1);
  v_mid text := p ->> 'moyasar_id';
  still_free boolean;
begin
  select * into bk from public.bookings where id = public._uuid(p ->> 'booking_id') for update;
  if not found then perform public._err('NOT_FOUND'); end if;
  if bk.moyasar_id is not null and bk.moyasar_id <> v_mid then perform public._err('NOT_ALLOWED'); end if;
  if bk.paid_halalas > 0 and bk.moyasar_id = v_mid then
    return jsonb_build_object('ok', true, 'already', true, 'status', bk.status);
  end if;
  if coalesce(p ->> 'status', '') <> 'paid' or coalesce(p ->> 'currency', 'SAR') <> 'SAR' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_PAID', 'status', bk.status);
  end if;
  select * into b from public.businesses where id = bk.business_id;

  if v_amount <> bk.due_now_halalas then
    update public.bookings set pay_flag = 'amount_mismatch', moyasar_id = v_mid, paid_halalas = greatest(v_amount, 0)
     where id = bk.id;
    insert into public.notifications (kind, title_ar, title_en, body_ar, body_en, url, ref_id)
    values ('payment_flag', 'مبلغ دفع غير مطابق · ' || b.name_ar, 'Payment amount mismatch · ' || b.name_en,
            bk.ref, bk.ref, '/admin/#/businesses/' || b.id, bk.id);
    return jsonb_build_object('ok', false, 'reason', 'AMOUNT_MISMATCH');
  end if;

  if bk.status = 'pending_payment' or bk.status = 'confirmed' then
    update public.bookings set status = 'confirmed', paid_halalas = v_amount, moyasar_id = v_mid, hold_until = null
     where id = bk.id;
    return jsonb_build_object('ok', true, 'status', 'confirmed');
  end if;

  -- Paid after the hold ran out. Keep the booking if its time is still free; otherwise flag a refund.
  if bk.status = 'expired' then
    select exists (
      select 1 from public._slots(bk.service_id, (bk.starts_at at time zone 'Asia/Riyadh')::date, bk.section_id,
                                  case when bk.staff_id is not null then bk.staff_id end, bk.qty, bk.location, bk.id, true) x
      where x.start_at = bk.starts_at) into still_free;
    if still_free then
      begin
        update public.bookings set status = 'confirmed', paid_halalas = v_amount, moyasar_id = v_mid, hold_until = null
         where id = bk.id;
        return jsonb_build_object('ok', true, 'status', 'confirmed', 'late', true);
      exception when exclusion_violation then
        null;
      end;
    end if;
    update public.bookings set pay_flag = 'needs_refund', paid_halalas = v_amount, moyasar_id = v_mid where id = bk.id;
    insert into public.notifications (kind, title_ar, title_en, body_ar, body_en, url, ref_id)
    values ('payment_flag', 'دفعة تحتاج استرداداً · ' || b.name_ar, 'Payment needs a refund · ' || b.name_en,
            bk.ref, bk.ref, '/admin/#/businesses/' || b.id, bk.id);
    return jsonb_build_object('ok', false, 'reason', 'NEEDS_REFUND');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'BAD_STATE', 'status', bk.status);
end $$;

create or replace function public.svc_expire_holds(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  n integer;
begin
  update public.bookings set status = 'expired' where status = 'pending_payment' and hold_until <= now();
  get diagnostics n = row_count;
  return jsonb_build_object('expired', n);
end $$;

-- Cheap version check for the live doorbell's polling fallback (and the admin channel: nil uuid).
create or replace function public.pub_live(p jsonb default '{}') returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select jsonb_build_object('catalog', catalog_v, 'slots', slots_v, 'admin', admin_v)
       from public.live_pings where business_id = public._uuid(p ->> 'business_id')),
    jsonb_build_object('catalog', 0, 'slots', 0, 'admin', 0))
$$;
