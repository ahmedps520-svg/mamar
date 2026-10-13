-- Mamar Booking · demo businesses (fictional — names, prices and services are invented for the demo
-- sites at mamar.site/demo/). Safe to paste into Supabase: re-running resets the demo catalogue but
-- never touches real businesses.

-- ───────── Ward Barbers — a barbershop, staff-based, Signature look ─────────
insert into public.businesses (id, slug, status, is_demo, kind, name_ar, name_en, tagline_ar, tagline_en, phone,
  address_ar, address_en, langs, look, theme, entitlements, settings)
values ('b0000000-0000-4000-8000-000000000001', 'ward-barber', 'active', true, 'salon',
  'ورد للحلاقة', 'Ward Barbers', 'حلاقة رجالية بهدوء ودقة', 'Quiet, precise grooming for men', '+966500000001',
  'حي الروضة، جدة', 'Al Rawdah, Jeddah', '{ar,en}', 'standard', '{}',
  '{"langs_both":true,"staff_choice":true,"prayer":true,"self_manage":true,"waitlist":true,"max_services":15}',
  '{"staff_choice":true,"prayer":{"on":true,"after_min":25,"jumuah_min":60},"notice_min":30,"horizon_days":21}')
on conflict (id) do update set slug = excluded.slug, status = excluded.status, is_demo = true, kind = excluded.kind,
  name_ar = excluded.name_ar, name_en = excluded.name_en, tagline_ar = excluded.tagline_ar, tagline_en = excluded.tagline_en,
  langs = excluded.langs, look = excluded.look, theme = excluded.theme, entitlements = excluded.entitlements,
  settings = excluded.settings;

-- ───────── Lamaa Car Spa — a car wash, shared bays + a mobile team, Custom look, deposits ─────────
insert into public.businesses (id, slug, status, is_demo, kind, name_ar, name_en, tagline_ar, tagline_en, phone,
  address_ar, address_en, langs, look, theme, entitlements, settings)
values ('b0000000-0000-4000-8000-000000000002', 'lamaa-carwash', 'active', true, 'carwash',
  'لمعة لغسيل السيارات', 'Lamaa Car Spa', 'عناية بسيارتك كأنها جديدة', 'Care that makes it feel new again', '+966500000002',
  'طريق الأمير سلطان، جدة', 'Prince Sultan Rd, Jeddah', '{ar,en}', 'custom',
  '{"mode":"light","bg":"#F7F5F0","ink":"#14201D","accent":"#0E6B5C","font":"Manrope"}',
  '{"langs_both":true,"home_service":true,"prayer":true,"payments":true,"custom_look":true,"self_manage":true,"max_services":15}',
  '{"payment":{"mode":"deposit","deposit_kind":"percent","deposit_value":25},"home":{"fee_halalas":3000,"travel_min":30},"prayer":{"on":true,"after_min":20},"notice_min":60}')
on conflict (id) do update set slug = excluded.slug, status = excluded.status, is_demo = true, kind = excluded.kind,
  name_ar = excluded.name_ar, name_en = excluded.name_en, tagline_ar = excluded.tagline_ar, tagline_en = excluded.tagline_en,
  langs = excluded.langs, look = excluded.look, theme = excluded.theme, entitlements = excluded.entitlements,
  settings = excluded.settings;

-- ───────── Sura Karting — heats with seats, party sizes, Custom dark look ─────────
insert into public.businesses (id, slug, status, is_demo, kind, name_ar, name_en, tagline_ar, tagline_en, phone,
  address_ar, address_en, langs, look, theme, entitlements, settings)
values ('b0000000-0000-4000-8000-000000000003', 'sura-karting', 'active', true, 'activity',
  'سرعة كارتنق', 'Sura Karting', 'حلبة داخلية. سباقات كل عشرين دقيقة.', 'Indoor track. A race every twenty minutes.', '+966500000003',
  'أبحر الشمالية، جدة', 'Obhur North, Jeddah', '{ar,en}', 'custom',
  '{"mode":"dark","bg":"#0D0D0F","ink":"#F2F0EA","accent":"#E8C547","font":"Readex Pro"}',
  '{"langs_both":true,"waitlist":true,"self_manage":true,"custom_look":true,"max_services":15}',
  '{"notice_min":20,"horizon_days":14,"self_manage":{"cutoff_hours":2}}')
on conflict (id) do update set slug = excluded.slug, status = excluded.status, is_demo = true, kind = excluded.kind,
  name_ar = excluded.name_ar, name_en = excluded.name_en, tagline_ar = excluded.tagline_ar, tagline_en = excluded.tagline_en,
  langs = excluded.langs, look = excluded.look, theme = excluded.theme, entitlements = excluded.entitlements,
  settings = excluded.settings;

-- Reset the demo catalogue (bookings on demo businesses are kept until the next reset).
delete from public.offers    where business_id in (select id from public.businesses where is_demo);
delete from public.hours     where business_id in (select id from public.businesses where is_demo);
delete from public.services  where business_id in (select id from public.businesses where is_demo)
  and id not in (select service_id from public.bookings where service_id is not null);
delete from public.staff     where business_id in (select id from public.businesses where is_demo)
  and id not in (select staff_id from public.bookings where staff_id is not null);

insert into public.sections (id, business_id, name_ar, name_en, audience, sort) values
  ('5e000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'الرئيسي', 'Main', 'all', 0),
  ('5e000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'الرئيسي', 'Main', 'all', 0),
  ('5e000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'الحلبة', 'Track', 'all', 0)
on conflict (id) do nothing;

-- Hours (minutes after midnight; > 1440 runs past midnight)
insert into public.hours (business_id, section_id, weekday, open_min, close_min)
select 'b0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', d,
       case when d = 5 then 960 else 600 end, case when d = 4 then 1500 when d = 5 then 1440 else 1410 end
from generate_series(0, 6) d;
insert into public.hours (business_id, section_id, weekday, open_min, close_min)
select 'b0000000-0000-4000-8000-000000000002'::uuid, '5e000000-0000-4000-8000-000000000002'::uuid, d, v.o, v.c
from generate_series(0, 6) d
cross join lateral (values (480, 720), (960, 1380)) v(o, c)
where d <> 5
union all
select 'b0000000-0000-4000-8000-000000000002'::uuid, '5e000000-0000-4000-8000-000000000002'::uuid, 5, 960, 1380;
insert into public.hours (business_id, section_id, weekday, open_min, close_min)
select 'b0000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000003', d,
       case when d = 5 then 840 else 960 end, case when d in (4, 5) then 1560 else 1500 end
from generate_series(0, 6) d;

-- Ward: three chairs (labels, no names)
insert into public.staff (id, business_id, label_ar, label_en, sort) values
  ('5f000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'الكرسي الأول', 'Chair one', 1),
  ('5f000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'الكرسي الثاني', 'Chair two', 2),
  ('5f000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'الكرسي الثالث', 'Chair three', 3)
on conflict (id) do update set label_ar = excluded.label_ar, label_en = excluded.label_en, active = true;

insert into public.resources (id, business_id, label_ar, label_en, capacity, sort) values
  ('5a000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'المغاسل', 'Wash bays', 3, 1),
  ('5a000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'الفريق المتنقل', 'Mobile team', 2, 2),
  ('5a000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'الكارتات', 'Karts', 10, 1)
on conflict (id) do update set capacity = excluded.capacity, active = true;

insert into public.categories (id, business_id, name_ar, name_en, sort) values
  ('5c000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'الحلاقة', 'Cuts', 1),
  ('5c000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'اللحية والوجه', 'Beard & face', 2),
  ('5c000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'الغسيل', 'Washes', 1),
  ('5c000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'العناية العميقة', 'Detailing', 2)
on conflict (id) do nothing;

insert into public.services (id, business_id, category_id, name_ar, name_en, desc_ar, desc_en, duration_min, buffer_min,
  step_min, mode, resource_id, max_qty, per_person, price_halalas, price_from, location, sort) values
  -- Ward Barbers
  ('5d000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000001',
   'قص الشعر', 'Haircut', 'قصّ وتصفيف مع غسيل.', 'Cut and style, with a wash.', 45, 10, 15, 'staff', null, 1, false, 8000, false, 'shop', 1),
  ('5d000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000001',
   'قص الشعر واللحية', 'Haircut & beard', 'الخدمة الكاملة مع منشفة ساخنة.', 'The full service, finished with a hot towel.', 60, 10, 15, 'staff', null, 1, false, 11000, false, 'shop', 2),
  ('5d000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000002',
   'تحديد اللحية', 'Beard trim & shape', 'تحديد بالموس وزيت للعناية.', 'Razor-lined and finished with oil.', 30, 5, 15, 'staff', null, 1, false, 5000, false, 'shop', 3),
  ('5d000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000001',
   'حلاقة الأطفال', 'Kids haircut', 'للأعمار حتى ١٢ سنة.', 'For ages up to 12.', 30, 5, 15, 'staff', null, 1, false, 6000, false, 'shop', 4),
  ('5d000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000002',
   'حلاقة بالموس والمنشفة الساخنة', 'Hot towel shave', 'حلاقة تقليدية هادئة.', 'A slow, traditional shave.', 40, 5, 15, 'staff', null, 1, false, 7000, false, 'shop', 5),
  ('5d000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000002',
   'تنظيف البشرة', 'Facial cleanse', 'تنظيف عميق وترطيب.', 'Deep cleanse and hydration.', 45, 10, 15, 'staff', null, 1, false, 12000, false, 'shop', 6),
  -- Lamaa Car Spa
  ('5d000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002', '5c000000-0000-4000-8000-000000000003',
   'غسيل خارجي', 'Exterior wash', 'غسيل يدوي وتجفيف بالمايكروفايبر.', 'Hand wash, microfibre dry.', 30, 10, 30, 'capacity', '5a000000-0000-4000-8000-000000000001', 1, false, 3500, false, 'shop', 1),
  ('5d000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000002', '5c000000-0000-4000-8000-000000000003',
   'غسيل داخلي وخارجي', 'Full wash, in & out', 'الخارج والمقصورة والزجاج والإطارات.', 'Outside, cabin, glass and tyres.', 60, 10, 30, 'capacity', '5a000000-0000-4000-8000-000000000001', 1, false, 7000, false, 'shop', 2),
  ('5d000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000002', '5c000000-0000-4000-8000-000000000004',
   'تنظيف داخلي عميق', 'Interior deep clean', 'تنظيف المقاعد والسجاد بالبخار.', 'Steam-cleaned seats and carpets.', 120, 15, 30, 'capacity', '5a000000-0000-4000-8000-000000000001', 1, false, 25000, false, 'shop', 3),
  ('5d000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000002', '5c000000-0000-4000-8000-000000000004',
   'تلميع وحماية سيراميك', 'Polish & ceramic coat', 'تلميع على مرحلتين وطبقة حماية.', 'Two-stage polish and a protective coat.', 180, 15, 60, 'capacity', '5a000000-0000-4000-8000-000000000001', 1, false, 65000, true, 'shop', 4),
  ('5d000000-0000-4000-8000-000000000015', 'b0000000-0000-4000-8000-000000000002', '5c000000-0000-4000-8000-000000000003',
   'غسيل كامل عند منزلك', 'Full wash at your home', 'نأتيك بالماء والكهرباء.', 'We bring the water and the power.', 75, 0, 30, 'capacity', '5a000000-0000-4000-8000-000000000002', 1, false, 9000, false, 'mobile', 5),
  -- Sura Karting
  ('5d000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000003', null,
   'سباق ١٠ دقائق', '10-minute race', 'تجهيز وتعليمات ثم سباق على الحلبة.', 'Briefing, kit-up, then ten minutes on track.', 15, 5, 20, 'capacity', '5a000000-0000-4000-8000-000000000003', 8, true, 6000, false, 'shop', 1),
  ('5d000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000003', null,
   'الجائزة الكبرى ٢٥ دقيقة', 'Grand Prix, 25 minutes', 'تأهيل ثم سباق مع ترتيب نهائي.', 'Qualifying, then a race with final standings.', 35, 5, 20, 'capacity', '5a000000-0000-4000-8000-000000000003', 8, true, 14000, false, 'shop', 2),
  ('5d000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000003', null,
   'سباق الأطفال', 'Kids heat (7–12)', 'كارتات أصغر وسرعة محدودة.', 'Smaller karts, limited speed.', 10, 5, 20, 'capacity', '5a000000-0000-4000-8000-000000000003', 6, true, 4500, false, 'shop', 3)
on conflict (id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, desc_ar = excluded.desc_ar,
  desc_en = excluded.desc_en, duration_min = excluded.duration_min, buffer_min = excluded.buffer_min, step_min = excluded.step_min,
  mode = excluded.mode, resource_id = excluded.resource_id, max_qty = excluded.max_qty, per_person = excluded.per_person,
  price_halalas = excluded.price_halalas, price_from = excluded.price_from, location = excluded.location,
  sort = excluded.sort, active = true, category_id = excluded.category_id;

insert into public.offers (business_id, service_ids, kind, value, title_ar, title_en, weekdays) values
  ('b0000000-0000-4000-8000-000000000001', array['5d000000-0000-4000-8000-000000000002']::uuid[], 'percent', 20,
   'عرض الأحد: خصم ٢٠٪ على قص الشعر واللحية', 'Sunday special: 20% off haircut & beard', array[0]::smallint[]),
  ('b0000000-0000-4000-8000-000000000002', array['5d000000-0000-4000-8000-000000000012']::uuid[], 'percent', 15,
   'خصم ١٥٪ على الغسيل الكامل', '15% off the full wash', null),
  ('b0000000-0000-4000-8000-000000000003', null, 'banner', 0,
   'الخميس: سباقات حتى الثانية فجراً', 'Thursdays: racing until 2 AM', null);

insert into public.subscriptions (business_id, plan_code, interval, status) values
  ('b0000000-0000-4000-8000-000000000001', 'care', 'yearly', 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'live', 'monthly', 'active'),
  ('b0000000-0000-4000-8000-000000000003', 'care', 'monthly', 'active')
on conflict (business_id) do nothing;
