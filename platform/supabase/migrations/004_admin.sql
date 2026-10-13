-- Mamar Booking · 004 selling Mamar: price sheet, setup requests, admin, notifications.

-- 5,799 SAR / ٥٬٧٩٩ ر.س
create or replace function public._sar(halalas integer, lang text default 'en') returns text
language sql immutable as $$
  select case when lang = 'ar'
    then translate(to_char(coalesce(halalas, 0) / 100, 'FM999,999,990'), '0123456789,', '٠١٢٣٤٥٦٧٨٩٬') || ' ر.س'
    else to_char(coalesce(halalas, 0) / 100, 'FM999,999,990') || ' SAR' end
$$;

-- ───────────────────────── the configurator estimate ─────────────────────────
-- Mirrors platform/estimate.js exactly (a differential test keeps them in step).
-- answers: see platform/contract.js → SETUP_ANSWERS.

create or replace function public._service_count(a jsonb) returns integer
language sql immutable as $$
  select case
    when coalesce((a ->> 'services_later')::boolean, false) or jsonb_typeof(a -> 'services') <> 'array'
      then greatest(0, coalesce(public._int(a ->> 'service_count', 0), 0))
    else jsonb_array_length(a -> 'services') end
$$;

create or replace function public._estimate(a jsonb) returns jsonb
language plpgsql stable as $$
declare
  n integer := public._service_count(a);
  br integer := least(20, greatest(1, coalesce(public._int(a ->> 'branches', 1), 1)));
  v_lines jsonb;
  v_total integer;
  v_code text := nullif(coalesce(a #>> '{plan,code}', 'none'), 'none');
  v_int text := case when a #>> '{plan,interval}' = 'yearly' then 'yearly' else 'monthly' end;
  pl public.plans;
begin
  with chosen(key, qty) as (
              select 'base_standard', 1
    union all select 'look_custom', 1       where a ->> 'look' = 'custom'
    union all select 'langs_both', 1        where a ->> 'langs' = 'both'
    union all select 'staff_choice', 1      where coalesce((a ->> 'staff_choice')::boolean, false)
    union all select 'sections', 1          where coalesce((a ->> 'sections')::boolean, false)
    union all select 'home_service', 1      where coalesce((a ->> 'home_service')::boolean, false)
    union all select 'prayer', 1            where coalesce((a ->> 'prayer')::boolean, false)
    union all select 'hijri', 1             where coalesce((a ->> 'hijri')::boolean, false)
    union all select 'payments', 1          where a ->> 'payment' in ('deposit','full')
    union all select 'customer_email', 1    where a ->> 'customer' = 'name_phone_email'
    union all select 'customer_sms', 1      where a ->> 'customer' = 'sms'
    union all select 'customer_accounts', 1 where a ->> 'customer' = 'accounts'
    union all select 'self_manage', 1       where coalesce((a #>> '{extras,self_manage}')::boolean, false)
    union all select 'waitlist', 1          where coalesce((a #>> '{extras,waitlist}')::boolean, false)
    union all select 'services_16_40', 1    where n between 16 and 40
    union all select 'services_40_plus', 1  where n > 40
    union all select 'branch_extra', br - 1 where br > 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', pi.key, 'grp', pi.grp, 'label_ar', pi.label_ar, 'label_en', pi.label_en, 'qty', c.qty,
           'unit_halalas', pi.amount_halalas,
           'amount_halalas', case when pi.amount_halalas is null then null else pi.amount_halalas * c.qty end,
           'quote', pi.amount_halalas is null) order by pi.sort, pi.key), '[]'),
         coalesce(sum(pi.amount_halalas * c.qty), 0)::int
    into v_lines, v_total
    from chosen c join public.price_items pi on pi.key = c.key and pi.active;

  if v_code is not null then
    select * into pl from public.plans where code = v_code;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'setup_halalas', v_total,
    'has_quote', exists (select 1 from jsonb_array_elements(v_lines) l where (l ->> 'quote')::boolean),
    'service_count', n,
    'plan', case when pl.code is null then jsonb_build_object('code', 'none', 'amount_halalas', 0)
      else jsonb_build_object(
        'code', pl.code, 'interval', v_int, 'name_ar', pl.name_ar, 'name_en', pl.name_en,
        'amount_halalas', case when v_int = 'yearly' then pl.yearly_halalas else pl.monthly_halalas end,
        'saving_halalas', case when v_int = 'yearly' then pl.monthly_halalas * 12 - pl.yearly_halalas else 0 end) end);
end $$;

create or replace function public.pub_price_sheet(p jsonb default '{}') returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'key', key, 'grp', grp, 'label_ar', label_ar, 'label_en', label_en, 'desc_ar', desc_ar, 'desc_en', desc_en,
        'amount_halalas', amount_halalas, 'per_unit', per_unit, 'sort', sort) order by sort, key)
      from public.price_items where active), '[]'),
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'name_ar', name_ar, 'name_en', name_en, 'desc_ar', desc_ar, 'desc_en', desc_en,
        'monthly_halalas', monthly_halalas, 'yearly_halalas', yearly_halalas,
        'yearly_saving_halalas', monthly_halalas * 12 - yearly_halalas) order by sort)
      from public.plans), '[]'))
$$;

-- ───────────────────────── setup requests ─────────────────────────

create or replace function public._request_notification(r public.setup_requests) returns void
language plpgsql as $$
begin
  insert into public.notifications (kind, title_ar, title_en, body_ar, body_en, url, ref_id)
  values ('setup_request',
          'طلب جديد · ' || coalesce(nullif(r.answers #>> '{business,name_ar}', ''), r.business_name) || ' · ' || public._sar(r.setup_halalas, 'ar'),
          'New request · ' || coalesce(nullif(r.answers #>> '{business,name_en}', ''), r.business_name) || ' · ' || public._sar(r.setup_halalas, 'en'),
          r.contact_name || case when r.plan_code is not null
            then ' · ' || coalesce((select name_ar from public.plans where code = r.plan_code), '') else '' end,
          r.contact_name || case when r.plan_code is not null
            then ' · ' || coalesce((select name_en from public.plans where code = r.plan_code), '') || ' (' || r.plan_interval || ')' else '' end,
          '/admin/#/requests/' || r.id, r.id);
end $$;

create or replace function public._request_values(a jsonb, contact jsonb) returns jsonb
language plpgsql stable as $$
declare
  est jsonb := public._estimate(a);
begin
  return jsonb_build_object(
    'estimate', est,
    'business_name', left(btrim(coalesce(nullif(a #>> '{business,name_ar}', ''), nullif(a #>> '{business,name_en}', ''), '')), 80),
    'contact_name', left(btrim(coalesce(contact ->> 'name', '')), 80),
    'phone', public._phone(contact ->> 'phone'),
    'email', nullif(lower(btrim(coalesce(contact ->> 'email', ''))), ''));
end $$;

-- The business finished /start/. The total the browser showed is ignored and recomputed here.
create or replace function public.pub_submit_setup(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a jsonb := coalesce(p -> 'answers', '{}');
  v jsonb;
  r public.setup_requests;
  v_ref text;
begin
  if coalesce(p ->> 'website', '') <> '' then
    return jsonb_build_object('ref', public._ref('SR'), 'estimate', public._estimate(a));
  end if;
  if length(a::text) > 60000 then perform public._err('BAD_INPUT'); end if;
  v := public._request_values(a, coalesce(p -> 'contact', '{}'));
  if length(v ->> 'business_name') < 2 then perform public._err('BAD_NAME', '{"field":"business"}'); end if;
  if length(v ->> 'contact_name') < 2 then perform public._err('BAD_NAME', '{"field":"contact"}'); end if;
  if v ->> 'phone' is null then perform public._err('BAD_PHONE'); end if;
  if (select count(*) from public.setup_requests where phone = v ->> 'phone' and created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.setup_requests where created_at > now() - interval '1 hour' and source = 'web') >= 30 then
    perform public._err('RATE_LIMITED');
  end if;
  loop
    v_ref := public._ref('SR');
    exit when not exists (select 1 from public.setup_requests where ref = v_ref);
  end loop;
  insert into public.setup_requests (ref, status, source, business_name, contact_name, phone, email, lang, answers,
                                     estimate, setup_halalas, plan_code, plan_interval, plan_halalas)
  values (v_ref, 'new', 'web', v ->> 'business_name', v ->> 'contact_name', v ->> 'phone', v ->> 'email',
          case when p ->> 'lang' = 'en' then 'en' else 'ar' end, a, v -> 'estimate',
          (v #>> '{estimate,setup_halalas}')::int, nullif(v #>> '{estimate,plan,code}', 'none'),
          v #>> '{estimate,plan,interval}', coalesce((v #>> '{estimate,plan,amount_halalas}')::int, 0))
  returning * into r;
  perform public._request_notification(r);
  return jsonb_build_object('id', r.id, 'ref', r.ref, 'estimate', r.estimate);
end $$;

-- ───────────────────────── request → business ─────────────────────────

create or replace function public._slugify(t text) returns text
language sql immutable as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g')), 36)
$$;

-- Rough Arabic → Latin for booking links when a business only has an Arabic name (ورد → ward-ish).
create or replace function public._translit(t text) returns text
language plpgsql immutable as $$
declare
  m text[] := array['ا','a','أ','a','إ','i','آ','a','ب','b','ت','t','ث','th','ج','j','ح','h','خ','kh','د','d','ذ','th',
                    'ر','r','ز','z','س','s','ش','sh','ص','s','ض','d','ط','t','ظ','z','ع','a','غ','gh','ف','f','ق','q',
                    'ك','k','ل','l','م','m','ن','n','ه','h','ة','a','و','w','ي','y','ى','a','ء','','ئ','e','ؤ','o'];
  r text := regexp_replace(coalesce(t, ''), '[ً-ْـ]', '', 'g');
begin
  for i in 1 .. array_length(m, 1) / 2 loop
    r := replace(r, m[2 * i - 1], m[2 * i]);
  end loop;
  return r;
end $$;

create or replace function public._unique_slug(want text) returns text
language plpgsql stable as $$
declare
  base text := public._slugify(want);
  s text;
  i integer := 1;
begin
  if length(base) < 3 then base := 'biz-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)); end if;
  s := base;
  while exists (select 1 from public.businesses where slug = s) loop
    i := i + 1;
    s := base || '-' || i;
  end loop;
  return s;
end $$;

create or replace function public._business_from_answers(a jsonb, contact jsonb, p_slug text, p_request uuid, p_setup integer)
returns uuid
language plpgsql as $$
declare
  v_kind text := case when a #>> '{business,kind}' in ('salon','carwash','activity','other') then a #>> '{business,kind}' else 'salon' end;
  v_langs text[] := case a ->> 'langs' when 'both' then array['ar','en'] when 'en' then array['en'] else array['ar'] end;
  n integer := public._service_count(a);
  v_bid uuid;
  v_sec uuid;
  v_res uuid;
  secs uuid[] := '{}';
  v_mode text;
  i integer;
  svc jsonb;
  d text;
  rng jsonb;
  v_staff_n integer := least(30, greatest(1, coalesce(public._int(a #>> '{slots,staff_count}', 1), 1)));
  v_cap integer := least(500, greatest(1, coalesce(public._int(a #>> '{slots,capacity}',
                     case when v_kind = 'activity' then 8 else 2 end), 2)));
  v_hours jsonb := a -> 'hours';
  v_code text := nullif(coalesce(a #>> '{plan,code}', 'none'), 'none');
begin
  v_mode := case when a #>> '{slots,mode}' in ('staff','capacity') then a #>> '{slots,mode}'
                 when v_kind in ('carwash','activity') then 'capacity' else 'staff' end;

  insert into public.businesses (slug, status, kind, name_ar, name_en, phone, site_url, instagram, langs, look, theme,
                                 entitlements, settings, request_id, setup_halalas)
  values (
    public._unique_slug(coalesce(nullif(p_slug, ''), nullif(public._slugify(a #>> '{business,name_en}'), ''),
                                 nullif(public._slugify(public._translit(a #>> '{business,name_ar}')), ''), 'biz')),
    'draft', v_kind,
    left(coalesce(nullif(a #>> '{business,name_ar}', ''), a #>> '{business,name_en}', ''), 80),
    left(coalesce(nullif(a #>> '{business,name_en}', ''), a #>> '{business,name_ar}', ''), 80),
    public._phone(contact ->> 'phone'),
    nullif(left(a #>> '{business,site_url}', 300), ''),
    nullif(left(a #>> '{business,instagram}', 60), ''),
    v_langs,
    case when a ->> 'look' = 'custom' then 'custom' else 'standard' end,
    case when a ->> 'look' = 'custom' then jsonb_strip_nulls(jsonb_build_object(
      'mode', case when a #>> '{brand,mode}' = 'dark' then 'dark' else 'light' end,
      'accent', case when a #>> '{brand,accent}' ~ '^#[0-9A-Fa-f]{6}$' then a #>> '{brand,accent}' end))
    else '{}'::jsonb end,
    jsonb_build_object(
      'langs_both',   a ->> 'langs' = 'both',
      'staff_choice', coalesce((a ->> 'staff_choice')::boolean, false),
      'sections',     coalesce((a ->> 'sections')::boolean, false),
      'home_service', coalesce((a ->> 'home_service')::boolean, false),
      'prayer',       coalesce((a ->> 'prayer')::boolean, false),
      'payments',     a ->> 'payment' in ('deposit','full'),
      'self_manage',  coalesce((a #>> '{extras,self_manage}')::boolean, false),
      'waitlist',     coalesce((a #>> '{extras,waitlist}')::boolean, false),
      'custom_look',  a ->> 'look' = 'custom',
      'max_services', case when n > 40 then 999 when n > 15 then 40 else 15 end),
    jsonb_build_object(
      'payment',  jsonb_build_object('mode', case when a ->> 'payment' in ('deposit','full') then a ->> 'payment' else 'shop' end,
                                     'deposit_kind', 'percent', 'deposit_value', 25),
      'customer', jsonb_build_object('email', case when a ->> 'customer' = 'name_phone_email' then 'optional' else 'off' end),
      'hijri',    coalesce((a ->> 'hijri')::boolean, true),
      'prayer',   jsonb_build_object('on', true)),
    p_request, p_setup)
  returning id into v_bid;

  -- sections
  if coalesce((a ->> 'sections')::boolean, false) then
    insert into public.sections (business_id, name_ar, name_en, audience, sort)
    values (v_bid, 'قسم الرجال', 'Men', 'men', 0) returning id into v_sec;
    secs := secs || v_sec;
    insert into public.sections (business_id, name_ar, name_en, audience, sort)
    values (v_bid, 'قسم النساء', 'Women', 'women', 1) returning id into v_sec;
    secs := secs || v_sec;
  else
    insert into public.sections (business_id, name_ar, name_en, audience, sort)
    values (v_bid, 'الرئيسي', 'Main', 'all', 0) returning id into v_sec;
    secs := secs || v_sec;
  end if;

  -- hours: {"0": [[600, 1320]], …}; default Sat–Thu 10:00–22:00, Fri 16:00–23:00
  if jsonb_typeof(v_hours) <> 'object' then
    v_hours := '{"0":[[600,1320]],"1":[[600,1320]],"2":[[600,1320]],"3":[[600,1320]],"4":[[600,1320]],"5":[[960,1380]],"6":[[600,1320]]}';
  end if;
  foreach v_sec in array secs loop
    for d, rng in select * from jsonb_each(v_hours) loop
      if d ~ '^[0-6]$' and jsonb_typeof(rng) = 'array' then
        insert into public.hours (business_id, section_id, weekday, open_min, close_min)
        select v_bid, v_sec, d::smallint, (r ->> 0)::int, (r ->> 1)::int
        from jsonb_array_elements(rng) r
        where (r ->> 0)::int between 0 and 1439 and (r ->> 1)::int > (r ->> 0)::int and (r ->> 1)::int <= 2880;
      end if;
    end loop;
  end loop;

  -- who or what limits a slot
  if v_mode = 'capacity' then
    insert into public.resources (business_id, label_ar, label_en, capacity)
    values (v_bid,
            case v_kind when 'carwash' then 'المغاسل' when 'activity' then 'المقاعد' else 'الأماكن' end,
            case v_kind when 'carwash' then 'Wash bays' when 'activity' then 'Seats' else 'Places' end,
            v_cap)
    returning id into v_res;
  else
    for i in 1..v_staff_n loop
      insert into public.staff (business_id, label_ar, label_en, sort)
      values (v_bid,
              case v_kind when 'salon' then 'كرسي ' else 'فريق ' end || translate(i::text, '0123456789', '٠١٢٣٤٥٦٧٨٩'),
              case v_kind when 'salon' then 'Chair ' else 'Team ' end || i, i);
    end loop;
  end if;

  -- services (when the business typed them in)
  if not coalesce((a ->> 'services_later')::boolean, false) and jsonb_typeof(a -> 'services') = 'array' then
    i := 0;
    for svc in select * from jsonb_array_elements(a -> 'services') loop
      i := i + 1;
      insert into public.services (business_id, name_ar, name_en, duration_min, price_halalas, mode, resource_id,
                                   max_qty, per_person, sort)
      values (v_bid,
              left(coalesce(nullif(svc ->> 'name_ar', ''), svc ->> 'name', svc ->> 'name_en', ''), 80),
              left(coalesce(nullif(svc ->> 'name_en', ''), svc ->> 'name', svc ->> 'name_ar', ''), 80),
              least(720, greatest(5, coalesce(public._int(svc ->> 'duration_min', 30), 30))),
              greatest(0, round(coalesce((svc ->> 'price_sar')::numeric, 0) * 100))::int,
              v_mode, v_res,
              case when v_mode = 'capacity' then least(50, greatest(1, coalesce(public._int(svc ->> 'max_qty', null),
                case when v_kind = 'activity' then least(8, v_cap) else 1 end))) else 1 end,
              v_mode = 'capacity' and v_kind = 'activity',
              i);
    end loop;
  end if;

  insert into public.subscriptions (business_id, plan_code, interval, status)
  values (v_bid, v_code, case when v_code is null then null when a #>> '{plan,interval}' = 'yearly' then 'yearly' else 'monthly' end,
          case when v_code is null then 'none' else 'pending' end);

  return v_bid;
end $$;

-- ───────────────────────── admin ─────────────────────────

create or replace function public.adm_overview(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  return jsonb_build_object(
    'requests', jsonb_build_object(
      'new', (select count(*) from public.setup_requests where status = 'new'),
      'open', (select count(*) from public.setup_requests where status in ('new','reviewing','quoted')),
      'drafts', (select count(*) from public.setup_requests where status = 'draft')),
    'businesses', jsonb_build_object(
      'active', (select count(*) from public.businesses where status = 'active' and not is_demo),
      'awaiting_payment', (select count(*) from public.businesses where status = 'awaiting_payment'),
      'draft', (select count(*) from public.businesses where status = 'draft'),
      'demo', (select count(*) from public.businesses where is_demo)),
    'plans', jsonb_build_object(
      -- demo businesses never count as revenue
      'active', (select count(*) from public.subscriptions s join public.businesses b on b.id = s.business_id
                 where s.status = 'active' and not b.is_demo),
      'requested', (select count(*) from public.subscriptions s join public.businesses b on b.id = s.business_id
                    where s.requested_code is not null and not b.is_demo),
      'mrr_halalas', coalesce((select sum(case when s.interval = 'yearly' then pl.yearly_halalas / 12 else pl.monthly_halalas end)
                               from public.subscriptions s join public.plans pl on pl.code = s.plan_code
                               join public.businesses b on b.id = s.business_id
                               where s.status = 'active' and not b.is_demo), 0)),
    'bookings_today', (select count(*) from public.bookings bk
                        where not exists (select 1 from public.businesses b where b.id = bk.business_id and b.is_demo)
                          and status in ('confirmed','completed','pending_payment')
                          and starts_at >= public._at(public._today(), 0) and starts_at < public._at(public._today() + 1, 0)),
    'unread', (select count(*) from public.notifications where read_at is null),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc)
                               from (select * from public.notifications order by created_at desc limit 12) n), '[]'));
end $$;

create or replace function public.adm_requests(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'ref', r.ref, 'status', r.status, 'source', r.source, 'business_name', r.business_name,
      'name_ar', r.answers #>> '{business,name_ar}', 'name_en', r.answers #>> '{business,name_en}',
      'kind', r.answers #>> '{business,kind}', 'contact_name', r.contact_name, 'phone', r.phone, 'email', r.email,
      'setup_halalas', r.setup_halalas, 'plan_code', r.plan_code, 'plan_interval', r.plan_interval,
      'plan_halalas', r.plan_halalas, 'business_id', r.business_id, 'created_at', r.created_at,
      'updated_at', r.updated_at) order by r.created_at desc)
    from public.setup_requests r
    where (p ->> 'status' is null and r.status <> 'draft') or r.status = p ->> 'status'), '[]'));
end $$;

create or replace function public.adm_request(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r public.setup_requests;
begin
  perform public._need_admin();
  select * into r from public.setup_requests where id = public._uuid(p ->> 'id');
  if not found then perform public._err('NOT_FOUND'); end if;
  return to_jsonb(r);
end $$;

create or replace function public.adm_request_update(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.setup_requests;
begin
  perform public._need_admin();
  if p ? 'status' and p ->> 'status' not in ('new','reviewing','quoted','converted','declined') then
    perform public._err('BAD_INPUT');
  end if;
  update public.setup_requests set
      status = coalesce(p ->> 'status', status),
      note = case when p ? 'note' then left(p ->> 'note', 4000) else note end
    where id = public._uuid(p ->> 'id')
    returning * into r;
  if not found then perform public._err('NOT_FOUND'); end if;
  return to_jsonb(r);
end $$;

create or replace function public.adm_request_delete(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  delete from public.setup_requests where id = public._uuid(p ->> 'id') and business_id is null;
  return jsonb_build_object('ok', found);
end $$;

-- Assisted mode: Ahmed fills /start/ for a client. Drafts survive across devices.
create or replace function public.adm_draft_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a jsonb := coalesce(p -> 'answers', '{}');
  v jsonb := public._request_values(a, coalesce(p -> 'contact', '{}'));
  v_id uuid := public._uuid(p ->> 'id');
  v_ref text;
begin
  perform public._need_admin();
  if v_id is not null and exists (select 1 from public.setup_requests where id = v_id and status = 'draft') then
    update public.setup_requests set answers = a, estimate = v -> 'estimate',
        business_name = v ->> 'business_name', contact_name = v ->> 'contact_name', phone = v ->> 'phone',
        email = v ->> 'email', setup_halalas = (v #>> '{estimate,setup_halalas}')::int,
        plan_code = nullif(v #>> '{estimate,plan,code}', 'none'), plan_interval = v #>> '{estimate,plan,interval}',
        plan_halalas = coalesce((v #>> '{estimate,plan,amount_halalas}')::int, 0),
        lang = case when p ->> 'lang' = 'en' then 'en' else 'ar' end
      where id = v_id;
  else
    loop
      v_ref := public._ref('SR');
      exit when not exists (select 1 from public.setup_requests where ref = v_ref);
    end loop;
    insert into public.setup_requests (ref, status, source, business_name, contact_name, phone, email, lang, answers,
                                       estimate, setup_halalas, plan_code, plan_interval, plan_halalas)
    values (v_ref, 'draft', 'assisted', v ->> 'business_name', v ->> 'contact_name', v ->> 'phone', v ->> 'email',
            case when p ->> 'lang' = 'en' then 'en' else 'ar' end, a, v -> 'estimate',
            (v #>> '{estimate,setup_halalas}')::int, nullif(v #>> '{estimate,plan,code}', 'none'),
            v #>> '{estimate,plan,interval}', coalesce((v #>> '{estimate,plan,amount_halalas}')::int, 0))
    returning id into v_id;
  end if;
  return (select jsonb_build_object('id', r.id, 'ref', r.ref, 'estimate', r.estimate, 'updated_at', r.updated_at)
          from public.setup_requests r where r.id = v_id);
end $$;

-- Finish assisted mode: save as a request, and optionally create the business straight away.
create or replace function public.adm_submit_assisted(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  saved jsonb;
  r public.setup_requests;
  v_bid uuid;
begin
  perform public._need_admin();
  saved := public.adm_draft_save(p);
  update public.setup_requests set status = 'new' where id = (saved ->> 'id')::uuid returning * into r;
  if length(r.business_name) < 2 then perform public._err('BAD_NAME'); end if;
  if coalesce((p ->> 'create')::boolean, false) then
    v_bid := public._business_from_answers(r.answers, jsonb_build_object('phone', r.phone), p ->> 'slug', r.id, r.setup_halalas);
    update public.setup_requests set status = 'converted', business_id = v_bid where id = r.id returning * into r;
  end if;
  return jsonb_build_object('request_id', r.id, 'ref', r.ref, 'business_id', v_bid,
    'slug', (select slug from public.businesses where id = v_bid), 'estimate', r.estimate);
end $$;

create or replace function public.adm_business_create(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.setup_requests;
  v_bid uuid;
begin
  perform public._need_admin();
  select * into r from public.setup_requests where id = public._uuid(p ->> 'request_id') for update;
  if not found then perform public._err('NOT_FOUND'); end if;
  if r.business_id is not null then
    return jsonb_build_object('business_id', r.business_id, 'slug', (select slug from public.businesses where id = r.business_id), 'existing', true);
  end if;
  v_bid := public._business_from_answers(r.answers, jsonb_build_object('phone', r.phone), p ->> 'slug', r.id, r.setup_halalas);
  update public.setup_requests set status = 'converted', business_id = v_bid where id = r.id;
  return jsonb_build_object('business_id', v_bid, 'slug', (select slug from public.businesses where id = v_bid));
end $$;

create or replace function public.adm_businesses(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'status', b.status, 'is_demo', b.is_demo, 'kind', b.kind,
      'name_ar', b.name_ar, 'name_en', b.name_en, 'look', b.look, 'langs', to_jsonb(b.langs),
      'setup_halalas', b.setup_halalas, 'created_at', b.created_at,
      'plan_code', s.plan_code, 'plan_interval', s.interval, 'plan_status', s.status,
      'plan_requested', s.requested_code, 'plan_requested_interval', s.requested_interval,
      'owners', (select count(*) from public.members m where m.business_id = b.id),
      'upcoming', (select count(*) from public.bookings x where x.business_id = b.id
                     and x.status in ('pending_payment','confirmed') and x.starts_at >= now()))
      order by b.is_demo, b.created_at desc)
    from public.businesses b left join public.subscriptions s on s.business_id = b.id), '[]'));
end $$;

create or replace function public.adm_business(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  b public.businesses;
begin
  perform public._need_admin();
  select * into b from public.businesses where id = public._uuid(p ->> 'business_id');
  if not found then perform public._err('NOT_FOUND'); end if;
  return public.own_overview(jsonb_build_object('business_id', b.id)) || jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role))
                         from public.members m join auth.users u on u.id = m.user_id where m.business_id = b.id), '[]'),
    'request', (select to_jsonb(r) from public.setup_requests r where r.id = b.request_id),
    'secrets', jsonb_build_object('moyasar_pk', b.moyasar_pk,
                                  'has_sk', exists (select 1 from public.business_secrets s where s.business_id = b.id and s.moyasar_sk is not null)),
    'pay_flags', coalesce((select jsonb_agg(public._booking_row(x) order by x.created_at desc)
                           from public.bookings x where x.business_id = b.id and x.pay_flag is not null), '[]'));
end $$;

create or replace function public.adm_business_update(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses;
  x jsonb := coalesce(p -> 'patch', '{}');
  v_langs text[];
begin
  perform public._need_admin();
  select * into b from public.businesses where id = public._uuid(p ->> 'business_id') for update;
  if not found then perform public._err('NOT_FOUND'); end if;
  if x ? 'status' and x ->> 'status' not in ('draft','awaiting_payment','active','paused') then perform public._err('BAD_INPUT'); end if;
  if x ? 'look' and x ->> 'look' not in ('standard','custom') then perform public._err('BAD_INPUT'); end if;
  if x ? 'kind' and x ->> 'kind' not in ('salon','carwash','activity','other') then perform public._err('BAD_INPUT'); end if;
  if x ? 'slug' and (x ->> 'slug' !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
                     or exists (select 1 from public.businesses where slug = x ->> 'slug' and id <> b.id)) then
    perform public._err('SLUG_TAKEN');
  end if;
  if x ? 'langs' then
    select array_agg(distinct l) into v_langs from jsonb_array_elements_text(x -> 'langs') l where l in ('ar','en');
    if v_langs is null then perform public._err('BAD_INPUT'); end if;
  end if;
  update public.businesses set
    status       = coalesce(x ->> 'status', status),
    slug         = coalesce(x ->> 'slug', slug),
    kind         = coalesce(x ->> 'kind', kind),
    name_ar      = coalesce(left(x ->> 'name_ar', 80), name_ar),
    name_en      = coalesce(left(x ->> 'name_en', 80), name_en),
    look         = coalesce(x ->> 'look', look),
    langs        = coalesce(v_langs, langs),
    theme        = case when x ? 'theme' and jsonb_typeof(x -> 'theme') = 'object' then x -> 'theme' else theme end,
    entitlements = case when x ? 'entitlements' then public._jmerge(entitlements, x -> 'entitlements') else entitlements end,
    settings     = case when x ? 'settings' then public._jmerge(settings, x -> 'settings') else settings end,
    is_demo      = coalesce((x ->> 'is_demo')::boolean, is_demo),
    city         = coalesce(x ->> 'city', city),
    setup_halalas = case when x ? 'setup_halalas' then public._int(x ->> 'setup_halalas', setup_halalas) else setup_halalas end,
    phone        = case when x ? 'phone' then public._phone(x ->> 'phone') else phone end
  where id = b.id
  returning * into b;
  return jsonb_build_object('id', b.id, 'slug', b.slug, 'status', b.status);
end $$;

-- On Supabase: create the user in Dashboard → Authentication → Add user, then attach by email here.
create or replace function public.adm_attach_owner(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid;
begin
  perform public._need_admin();
  if not exists (select 1 from public.businesses where id = public._uuid(p ->> 'business_id')) then perform public._err('NOT_FOUND'); end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(coalesce(p ->> 'email', '')));
  if v_uid is null then perform public._err('USER_NOT_FOUND'); end if;
  insert into public.members (business_id, user_id, role) values (public._uuid(p ->> 'business_id'), v_uid, 'owner')
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'user_id', v_uid);
end $$;

create or replace function public.adm_detach_owner(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  delete from public.members where business_id = public._uuid(p ->> 'business_id') and user_id = public._uuid(p ->> 'user_id');
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.adm_set_moyasar_keys(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_bid uuid := public._uuid(p ->> 'business_id');
begin
  perform public._need_admin();
  if coalesce(p ->> 'pk', '') !~ '^pk_(test|live)_[A-Za-z0-9]+$' then perform public._err('BAD_INPUT'); end if;
  if coalesce(p ->> 'sk', '') <> '' and p ->> 'sk' !~ '^sk_(test|live)_[A-Za-z0-9]+$' then perform public._err('BAD_INPUT'); end if;
  update public.businesses set moyasar_pk = p ->> 'pk' where id = v_bid;
  if not found then perform public._err('NOT_FOUND'); end if;
  if coalesce(p ->> 'sk', '') <> '' then
    insert into public.business_secrets (business_id, moyasar_sk) values (v_bid, p ->> 'sk')
    on conflict (business_id) do update set moyasar_sk = excluded.moyasar_sk, updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.adm_price_items_update(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  x jsonb;
  n integer := 0;
begin
  perform public._need_admin();
  for x in select * from jsonb_array_elements(coalesce(p -> 'items', '[]')) loop
    update public.price_items set
      amount_halalas = case when x ? 'amount_halalas' then public._int(x ->> 'amount_halalas', null) else amount_halalas end,
      label_ar = coalesce(left(x ->> 'label_ar', 120), label_ar),
      label_en = coalesce(left(x ->> 'label_en', 120), label_en),
      desc_ar  = coalesce(left(x ->> 'desc_ar', 400), desc_ar),
      desc_en  = coalesce(left(x ->> 'desc_en', 400), desc_en),
      active   = coalesce((x ->> 'active')::boolean, active)
    where key = x ->> 'key';
    n := n + (case when found then 1 else 0 end);
  end loop;
  return jsonb_build_object('updated', n) || public.pub_price_sheet('{}');
end $$;

create or replace function public.adm_plans_update(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  x jsonb;
begin
  perform public._need_admin();
  for x in select * from jsonb_array_elements(coalesce(p -> 'plans', '[]')) loop
    update public.plans set
      monthly_halalas = coalesce(public._int(x ->> 'monthly_halalas', null), monthly_halalas),
      yearly_halalas  = coalesce(public._int(x ->> 'yearly_halalas', null), yearly_halalas),
      name_ar = coalesce(left(x ->> 'name_ar', 60), name_ar), name_en = coalesce(left(x ->> 'name_en', 60), name_en),
      desc_ar = coalesce(left(x ->> 'desc_ar', 400), desc_ar), desc_en = coalesce(left(x ->> 'desc_en', 400), desc_en)
    where code = x ->> 'code';
  end loop;
  return public.pub_price_sheet('{}');
end $$;

-- Confirm a care plan once the business has paid (or stop one).
create or replace function public.adm_plan_set(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_bid uuid := public._uuid(p ->> 'business_id');
  v_code text := nullif(p ->> 'plan_code', 'none');
begin
  perform public._need_admin();
  if v_code is not null and not exists (select 1 from public.plans where code = v_code) then perform public._err('BAD_INPUT'); end if;
  if coalesce(p ->> 'status', 'active') not in ('none','pending','active','past_due','cancelled') then perform public._err('BAD_INPUT'); end if;
  insert into public.subscriptions (business_id, status) values (v_bid, 'none') on conflict (business_id) do nothing;
  update public.subscriptions set
    plan_code = v_code,
    interval = case when v_code is null then null when p ->> 'interval' = 'yearly' then 'yearly' else 'monthly' end,
    status = case when v_code is null then 'none' else coalesce(p ->> 'status', 'active') end,
    period_end = nullif(p ->> 'period_end', '')::date,
    requested_code = null, requested_interval = null, requested_at = null
  where business_id = v_bid;
  return (select to_jsonb(s) from public.subscriptions s where s.business_id = v_bid);
end $$;

-- rows: [{day, fajr, dhuhr, asr, maghrib, isha}] from platform/prayer.js
create or replace function public.adm_prayer_upsert(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_city text := coalesce(nullif(p ->> 'city', ''), 'jeddah');
  n integer;
begin
  perform public._need_admin();
  insert into public.prayer_times (city, day, fajr, dhuhr, asr, maghrib, isha)
  select v_city, (r ->> 'day')::date, (r ->> 'fajr')::time, (r ->> 'dhuhr')::time, (r ->> 'asr')::time,
         (r ->> 'maghrib')::time, (r ->> 'isha')::time
  from jsonb_array_elements(coalesce(p -> 'rows', '[]')) r
  on conflict (city, day) do update set fajr = excluded.fajr, dhuhr = excluded.dhuhr, asr = excluded.asr,
    maghrib = excluded.maghrib, isha = excluded.isha;
  get diagnostics n = row_count;
  return jsonb_build_object('upserted', n) || public.adm_prayer_status(jsonb_build_object('city', v_city));
end $$;

create or replace function public.adm_prayer_status(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_city text := coalesce(nullif(p ->> 'city', ''), 'jeddah');
begin
  perform public._need_admin();
  return (select jsonb_build_object('city', v_city, 'first_day', min(day), 'last_day', max(day), 'days', count(*),
                                    'days_left', coalesce(max(day) - public._today(), 0))
          from public.prayer_times where city = v_city);
end $$;

create or replace function public.adm_notifications(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc)
    from (select * from public.notifications order by created_at desc
          limit least(200, greatest(1, public._int(p ->> 'limit', 50)))) n), '[]'),
    'unread', (select count(*) from public.notifications where read_at is null));
end $$;

create or replace function public.adm_notifications_read(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  update public.notifications set read_at = now()
   where read_at is null
     and (coalesce((p ->> 'all')::boolean, false)
          or id in (select public._uuid(x) from jsonb_array_elements_text(coalesce(p -> 'ids', '[]')) x));
  return jsonb_build_object('unread', (select count(*) from public.notifications where read_at is null));
end $$;

-- ───────────────────────── server-side (Edge Function / dev server) ─────────────────────────

-- Everything the notify function needs for one notification: the texts, the request (for the
-- email) and every admin's push endpoints.
create or replace function public.svc_notification(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  n public.notifications;
begin
  select * into n from public.notifications where id = public._uuid(p ->> 'id');
  if not found then perform public._err('NOT_FOUND'); end if;
  return jsonb_build_object(
    'notification', to_jsonb(n),
    'request', case when n.kind = 'setup_request'
                 then (select to_jsonb(r) from public.setup_requests r where r.id = n.ref_id) end,
    'targets', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', s.keys, 'lang', s.lang))
                         from public.push_subscriptions s join public.admins a on a.user_id = s.user_id), '[]'));
end $$;

create or replace function public.svc_push_gone(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.push_subscriptions where endpoint = p ->> 'endpoint';
  return jsonb_build_object('ok', found);
end $$;

-- "Send me a test notification" from the admin (exercises push + email end to end).
create or replace function public.adm_notify_test(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  insert into public.notifications (kind, title_ar, title_en, body_ar, body_en, url)
  values ('test', 'تجربة إشعار من ممر', 'Test notification from Mamar',
          'إذا وصلك هذا فالإشعارات تعمل.', 'If you can read this, notifications work.', '/admin/');
  return jsonb_build_object('ok', true);
end $$;
