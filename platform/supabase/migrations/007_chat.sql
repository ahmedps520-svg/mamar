-- Mamar Booking · 007 the website assistant's daily caps.
--
-- The `chat` Edge Function asks svc_chat_take before every answer. It counts one message for the visitor
-- (a SHA-256 of their IP — never the IP itself) and one for the whole site, per Jeddah day, and says
-- whether both are still under their caps. Rows older than a week are dropped as it goes.

create table if not exists public.chat_usage (
  day  date not null,
  who  text not null,                  -- visitor hash, or '*' for the site-wide total
  n    integer not null default 0,
  primary key (day, who)
);
alter table public.chat_usage enable row level security;

create or replace function public.svc_chat_take(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d     date := (now() at time zone 'Asia/Riyadh')::date;
  v_who text := left(coalesce(p ->> 'who', ''), 80);
  mine  integer;
  total integer;
begin
  if v_who = '' or v_who = '*' then perform public._err('BAD_INPUT'); end if;
  insert into public.chat_usage (day, who, n) values (d, v_who, 1)
    on conflict (day, who) do update set n = chat_usage.n + 1 returning n into mine;
  insert into public.chat_usage (day, who, n) values (d, '*', 1)
    on conflict (day, who) do update set n = chat_usage.n + 1 returning n into total;
  delete from public.chat_usage where day < d - 7;
  return jsonb_build_object(
    'ok', mine <= coalesce((p ->> 'per_visitor')::int, 25) and total <= coalesce((p ->> 'per_day')::int, 600),
    'mine', mine, 'total', total);
end $$;

-- How busy the assistant has been (admin): today and the last seven days.
create or replace function public.adm_chat_stats(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date;
begin
  perform public._need_admin();
  return jsonb_build_object(
    'today', coalesce((select n from public.chat_usage where day = d and who = '*'), 0),
    'week', coalesce((select sum(n) from public.chat_usage where day > d - 7 and who = '*'), 0),
    'visitors_today', (select count(*) from public.chat_usage where day = d and who <> '*'));
end $$;
