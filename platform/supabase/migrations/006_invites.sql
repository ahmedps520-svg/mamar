-- Mamar Booking · 006 sign-in by email link, owner invites, server-side secrets.
--
-- Nobody creates passwords for anyone: Ahmed and the owners sign in with a link emailed to them.
-- The first time an address signs in, Supabase creates its auth user and the trigger below turns it
-- into an admin (if it is on admin_emails) and/or a member of every business that invited it.

create table if not exists public.admin_emails (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table if not exists public.member_invites (
  business_id uuid not null references public.businesses(id) on delete cascade,
  email       text not null check (email = lower(email)),
  created_at  timestamptz not null default now(),
  primary key (business_id, email)
);

-- Keys the server generates for itself (VAPID for Web Push, the webhook secret). Never typed by a
-- person, never in the repo, readable only through svc_ functions.
create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_emails enable row level security;
alter table public.member_invites enable row level security;
alter table public.app_secrets enable row level security;

insert into public.app_secrets (key, value)
values ('hook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- New auth user → admin and/or owner, by email.
create or replace function public._on_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(coalesce(new.email, ''));
begin
  if e = '' then return new; end if;
  if exists (select 1 from public.admin_emails where email = e) then
    insert into public.admins (user_id) values (new.id) on conflict do nothing;
  end if;
  insert into public.members (business_id, user_id, role)
  select business_id, new.id, 'owner' from public.member_invites where email = e
  on conflict do nothing;
  delete from public.member_invites where email = e;
  return new;
end $$;

drop trigger if exists mamar_on_auth_user on auth.users;
create trigger mamar_on_auth_user after insert on auth.users
  for each row execute function public._on_auth_user();

-- Attach an owner by email. If they have never signed in, they are invited: the first time they
-- sign in at mamar.site/manage with that email, they land straight in their dashboard.
create or replace function public.adm_attach_owner(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_bid uuid := public._uuid(p ->> 'business_id');
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_uid uuid;
begin
  perform public._need_admin();
  if not exists (select 1 from public.businesses where id = v_bid) then perform public._err('NOT_FOUND'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._err('BAD_EMAIL'); end if;
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    insert into public.member_invites (business_id, email) values (v_bid, v_email) on conflict do nothing;
    return jsonb_build_object('ok', true, 'invited', true, 'email', v_email);
  end if;
  insert into public.members (business_id, user_id, role) values (v_bid, v_uid, 'owner') on conflict do nothing;
  return jsonb_build_object('ok', true, 'user_id', v_uid, 'email', v_email);
end $$;

create or replace function public.adm_invite_cancel(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  delete from public.member_invites
   where business_id = public._uuid(p ->> 'business_id') and email = lower(btrim(coalesce(p ->> 'email', '')));
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.adm_invites(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._need_admin();
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'created_at', created_at)
    order by created_at) from public.member_invites where business_id = public._uuid(p ->> 'business_id')), '[]'));
end $$;

-- Secrets for the notify function (it creates its own VAPID keys on first run).
create or replace function public.svc_secret_get(p jsonb default '{}') returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('value', (select value from public.app_secrets where key = p ->> 'key'))
$$;

create or replace function public.svc_secret_set(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_secrets (key, value) values (p ->> 'key', p ->> 'value')
  on conflict (key) do nothing;          -- first writer wins; never overwrite a live key
  return jsonb_build_object('value', (select value from public.app_secrets where key = p ->> 'key'));
end $$;
