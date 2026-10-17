-- Pitch: Haircube Salon (Al Naeem, Jeddah) on Mamar Booking.
-- Facts from haircubesalon.com and their Google Maps listing (October 2026): two barbers, the service list and
-- prices, the address, the phone on their site, and hours (Sat–Wed 3–11 PM, Thu–Fri 3–11:30 PM, Sunday closed).
-- Durations are NOT published by the salon: the ones below are placeholders to confirm with them.
-- Not a client yet: no owner is attached, so bookings show up only in Mamar's admin. Safe to re-run.

insert into public.businesses (id, slug, status, is_demo, kind, name_ar, name_en, tagline_ar, tagline_en, phone,
  address_ar, address_en, instagram, site_url, langs, look, theme, entitlements, settings)
values ('b1c0be00-0000-4000-8000-000000000001', 'haircube', 'active', false, 'salon',
  'صالون هيركيوب', 'Haircube Salon', 'قصّة دقيقة. أسلوب لا يبهت.', 'Precision cuts. Timeless style.', '+966501116291',
  'شارع النعيم، حي النعيم، جدة', 'An Naeem St, Al Naeem, Jeddah', 'haircubesalon', 'https://ahmedps520-svg.github.io/haircube/',
  '{ar,en}', 'custom',
  '{"mode":"dark","bg":"#121212","ink":"#F2EEE6","accent":"#F2EEE6","font":"Tajawal"}',
  '{"langs_both":true,"staff_choice":true,"prayer":true,"custom_look":true,"self_manage":true,"max_services":15}',
  '{"staff_choice":true,"prayer":{"on":true,"after_min":20,"jumuah_min":60},"notice_min":30,"horizon_days":21,"self_manage":{"cutoff_hours":2}}')
on conflict (id) do update set slug = excluded.slug, status = excluded.status, is_demo = false, kind = excluded.kind,
  name_ar = excluded.name_ar, name_en = excluded.name_en, tagline_ar = excluded.tagline_ar, tagline_en = excluded.tagline_en,
  phone = excluded.phone, address_ar = excluded.address_ar, address_en = excluded.address_en, instagram = excluded.instagram,
  site_url = excluded.site_url, langs = excluded.langs, look = excluded.look, theme = excluded.theme,
  entitlements = excluded.entitlements, settings = excluded.settings;

insert into public.sections (id, business_id, name_ar, name_en, audience, sort) values
  ('b1c0be00-0000-4000-8000-0000000000a1', 'b1c0be00-0000-4000-8000-000000000001', 'الصالون', 'Salon', 'all', 0)
on conflict (id) do nothing;

-- Hours: weekday 0 = Sunday (closed). Minutes after midnight.
delete from public.hours where business_id = 'b1c0be00-0000-4000-8000-000000000001';
insert into public.hours (business_id, section_id, weekday, open_min, close_min)
select 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000a1', d, 900, case when d in (4, 5) then 1410 else 1380 end
from generate_series(1, 6) d;

-- The two barbers, as the salon itself lists them for booking (the owner renames or removes staff in the app)
insert into public.staff (id, business_id, label_ar, label_en, sort) values
  ('b1c0be00-0000-4000-8000-0000000000b1', 'b1c0be00-0000-4000-8000-000000000001', 'والتر', 'Walter', 1),
  ('b1c0be00-0000-4000-8000-0000000000b2', 'b1c0be00-0000-4000-8000-000000000001', 'نيكولاس', 'Nicolas', 2)
on conflict (id) do update set label_ar = excluded.label_ar, label_en = excluded.label_en, active = true;

insert into public.categories (id, business_id, name_ar, name_en, sort) values
  ('b1c0be00-0000-4000-8000-0000000000c1', 'b1c0be00-0000-4000-8000-000000000001', 'القص واللحية', 'Haircut & beard', 1),
  ('b1c0be00-0000-4000-8000-0000000000c2', 'b1c0be00-0000-4000-8000-000000000001', 'الباقات المميزة', 'Premium packages', 2)
on conflict (id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, sort = excluded.sort;

insert into public.services (id, business_id, category_id, name_ar, name_en, desc_ar, desc_en, duration_min, buffer_min,
  step_min, mode, resource_id, max_qty, per_person, price_halalas, price_from, location, sort) values
  ('b1c0be00-0000-4000-8000-0000000000d1', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c1',
   'قص شعر — قصير', 'Haircut — short style', 'يشمل غسيل الشعر والتصفيف ومشروباً.', 'Includes head wash, styling and a drink.', 45, 5, 15, 'staff', null, 1, false, 7000, false, 'shop', 1),
  ('b1c0be00-0000-4000-8000-0000000000d2', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c1',
   'قص شعر — متوسط أو طويل', 'Haircut — mid or long style', 'يشمل غسيل الشعر والتصفيف ومشروباً.', 'Includes head wash, styling and a drink.', 60, 5, 15, 'staff', null, 1, false, 8000, false, 'shop', 2),
  ('b1c0be00-0000-4000-8000-0000000000d3', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c1',
   'قص شعر قصير ولحية', 'Short haircut & beard', 'قص وتهذيب لحية، مع غسيل وتصفيف ومشروب.', 'Haircut and beard trim, with head wash, styling and a drink.', 60, 5, 15, 'staff', null, 1, false, 9000, false, 'shop', 3),
  ('b1c0be00-0000-4000-8000-0000000000d4', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c1',
   'قص شعر متوسط أو طويل ولحية', 'Mid or long haircut & beard', 'يشمل غسيل الشعر والتصفيف ومشروباً.', 'Includes head wash, styling and a drink.', 75, 5, 15, 'staff', null, 1, false, 10000, false, 'shop', 4),
  ('b1c0be00-0000-4000-8000-0000000000d5', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c1',
   'تدريج ولحية', 'Taper fade & beard', 'تدريج ولحية فقط، بدون غسيل أو تصفيف.', 'Taper and beard only — no wash or styling.', 45, 5, 15, 'staff', null, 1, false, 6500, false, 'shop', 5),
  ('b1c0be00-0000-4000-8000-0000000000d6', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c1',
   'تدريج', 'Taper fade', 'تدريج فقط، بدون غسيل أو تصفيف.', 'Taper fade only — no wash or styling.', 30, 5, 15, 'staff', null, 1, false, 4500, false, 'shop', 6),
  ('b1c0be00-0000-4000-8000-0000000000d7', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c1',
   'تهذيب اللحية أو حلاقتها', 'Beard trim or shave', 'تهذيب أو حلاقة، مع مشروب.', 'Trim or shave, with a drink.', 30, 5, 15, 'staff', null, 1, false, 4000, false, 'shop', 7),
  ('b1c0be00-0000-4000-8000-0000000000d8', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c2',
   'الباقة الفضية', 'Silver package', 'قص، غسيل مميّز، تصفيف، تقشير وماسك للوجه، ومشروب.', 'Haircut, premium head wash, styling, face scrub, face mask and a drink.', 75, 5, 15, 'staff', null, 1, false, 14500, false, 'shop', 8),
  ('b1c0be00-0000-4000-8000-0000000000d9', 'b1c0be00-0000-4000-8000-000000000001', 'b1c0be00-0000-4000-8000-0000000000c2',
   'الباقة الذهبية', 'Gold package', 'قص وتهذيب لحية، غسيل مميّز، تصفيف، تقشير وماسك للوجه، ومشروب.', 'Haircut, beard trim, premium head wash, styling, face scrub, face mask and a drink.', 90, 5, 15, 'staff', null, 1, false, 16500, false, 'shop', 9)
on conflict (id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, desc_ar = excluded.desc_ar,
  desc_en = excluded.desc_en, duration_min = excluded.duration_min, buffer_min = excluded.buffer_min, step_min = excluded.step_min,
  mode = excluded.mode, price_halalas = excluded.price_halalas, sort = excluded.sort, active = true, category_id = excluded.category_id;
