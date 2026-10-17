-- Mamar Booking · 008 "talk to a person" from the website assistant.
--
-- When a visitor asks for Ahmed, the chat shows a small form (name, WhatsApp number, message). The `chat`
-- Edge Function passes it to svc_chat_contact, which stores it with the last few chat turns and raises a
-- notification — so it arrives like a setup request: push, email (with a one-tap WhatsApp reply) and the
-- admin's chat page. Limits: 3 a day per visitor, 3 a day per number, 40 a day for the whole site.

create table if not exists public.chat_contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null,                    -- E.164
  message     text not null default '',
  lang        text not null default 'ar',
  transcript  jsonb not null default '[]',      -- [{role, content}], the last few turns before the form
  who         text not null default '',         -- visitor hash (as in chat_usage), for the daily limit
  status      text not null default 'new' check (status in ('new','done')),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists chat_contacts_status_idx on public.chat_contacts(status, created_at desc);
alter table public.chat_contacts enable row level security;

create or replace function public.svc_chat_contact(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name  text := left(btrim(regexp_replace(coalesce(p ->> 'name', ''), '\s+', ' ', 'g')), 80);
  v_phone text := public._phone(p ->> 'phone');
  v_msg   text := left(btrim(coalesce(p ->> 'message', '')), 1000);
  v_lang  text := case when p ->> 'lang' = 'en' then 'en' else 'ar' end;
  v_who   text := left(coalesce(p ->> 'who', ''), 80);
  v_tr    jsonb := '[]';
  c       public.chat_contacts;
begin
  if v_name = '' or v_phone is null then perform public._err('BAD_INPUT'); end if;
  if (select count(*) from public.chat_contacts where created_at > now() - interval '1 day'
        and ((v_who <> '' and who = v_who) or phone = v_phone)) >= 3
     or (select count(*) from public.chat_contacts where created_at > now() - interval '1 day') >= 40 then
    perform public._err('RATE_LIMITED');
  end if;
  -- keep at most the last 8 turns, each trimmed, as plain {role, content}
  select coalesce(jsonb_agg(jsonb_build_object('role', case when e ->> 'role' = 'assistant' then 'assistant' else 'user' end,
                                               'content', left(coalesce(e ->> 'content', ''), 500)) order by o), '[]')
    into v_tr
    from (select e, o from jsonb_array_elements(case when jsonb_typeof(p -> 'transcript') = 'array' then p -> 'transcript' else '[]' end)
            with ordinality as x(e, o) order by o desc limit 8) t;

  insert into public.chat_contacts (name, phone, message, lang, transcript, who)
  values (v_name, v_phone, v_msg, v_lang, v_tr, v_who) returning * into c;

  insert into public.notifications (kind, title_ar, title_en, body_ar, body_en, url, ref_id)
  values ('chat_contact', 'رسالة من محادثة الموقع · ' || v_name, 'Website chat message · ' || v_name,
          coalesce(nullif(left(v_msg, 140), ''), 'يريد التحدث معك') || ' · ' || v_phone,
          coalesce(nullif(left(v_msg, 140), ''), 'Would like to talk to you') || ' · ' || v_phone,
          '/admin/#/chat', c.id);
  return jsonb_build_object('ok', true);
end $$;

-- The admin's chat page: the messages (newest first) and how busy the assistant has been.
create or replace function public.adm_chat_contacts(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(to_jsonb(c) - 'who' order by c.status = 'done', c.created_at desc)
      from (select * from public.chat_contacts order by created_at desc limit 100) c), '[]'));
end $$;

create or replace function public.adm_chat_contact_set(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_status text := p ->> 'status';
begin
  perform public._need_admin();
  if v_status not in ('new', 'done') then perform public._err('BAD_INPUT'); end if;
  update public.chat_contacts set status = v_status, done_at = case when v_status = 'done' then now() end
   where id = public._uuid(p ->> 'id');
  if not found then perform public._err('NOT_FOUND'); end if;
  perform public._ping(public._admin_bid(), 'admin');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.adm_chat_stats(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date;
begin
  perform public._need_admin();
  return jsonb_build_object(
    'today', coalesce((select n from public.chat_usage where day = d and who = '*'), 0),
    'week', coalesce((select sum(n) from public.chat_usage where day > d - 7 and who = '*'), 0),
    'visitors_today', (select count(*) from public.chat_usage where day = d and who <> '*'),
    'open_contacts', (select count(*) from public.chat_contacts where status = 'new'));
end $$;

-- The notify function reads this: for a chat message it now also gets the message itself.
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
    'contact', case when n.kind = 'chat_contact'
                 then (select to_jsonb(c) - 'who' from public.chat_contacts c where c.id = n.ref_id) end,
    'targets', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', s.keys, 'lang', s.lang))
                         from public.push_subscriptions s join public.admins a on a.user_id = s.user_id), '[]'));
end $$;
