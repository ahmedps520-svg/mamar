-- Mamar Booking · Supabase-only setup. Paste AFTER the migrations (see platform/README.md).
-- Not run locally: Realtime, Storage and pg_cron exist only on Supabase.

-- Live updates: Realtime streams changes to the version counters (no personal data in this table).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'live_pings') then
    alter publication supabase_realtime add table public.live_pings;
  end if;
end $$;

-- Logos: a public bucket anyone can read; only admins can upload or replace.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists "logos read" on storage.objects;
create policy "logos read" on storage.objects for select to anon, authenticated using (bucket_id = 'logos');
drop policy if exists "logos admin write" on storage.objects;
create policy "logos admin write" on storage.objects for insert to authenticated with check (bucket_id = 'logos' and public._is_admin());
drop policy if exists "logos admin update" on storage.objects;
create policy "logos admin update" on storage.objects for update to authenticated using (bucket_id = 'logos' and public._is_admin());
drop policy if exists "logos admin delete" on storage.objects;
create policy "logos admin delete" on storage.objects for delete to authenticated using (bucket_id = 'logos' and public._is_admin());

-- Release unpaid holds every 5 minutes (they are also released lazily on every booking).
-- Needs the pg_cron extension: Dashboard → Database → Extensions → pg_cron → enable, then run:
-- select cron.schedule('mamar-expire-holds', '*/5 * * * *', $$select public.svc_expire_holds('{}')$$);

-- Make yourself the admin (after creating your user in Authentication → Users):
-- insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';

-- Notifications → the `notify` Edge Function, straight from the database (pg_net), signed with a
-- secret the database generated itself (app_secrets.hook_secret). No webhook form, no typed keys.
-- Needs one row telling it where the functions live:
--   insert into public.app_secrets (key, value) values ('functions_url', 'https://<project-ref>.supabase.co/functions/v1')
--   on conflict (key) do update set value = excluded.value;
create extension if not exists pg_net with schema extensions;

create or replace function public._notify_http_trg() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  base text := (select value from public.app_secrets where key = 'functions_url');
begin
  if base is null then return null; end if;
  perform net.http_post(
    url := base || '/notify',
    body := jsonb_build_object('record', jsonb_build_object('id', new.id)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', (select value from public.app_secrets where key = 'hook_secret')));
  return null;
end $$;

drop trigger if exists notifications_http on public.notifications;
create trigger notifications_http after insert on public.notifications
  for each row execute function public._notify_http_trg();
revoke all on function public._notify_http_trg() from public, anon, authenticated;

-- Who may become admin by signing in with an email link (run with the real address, not in the repo):
--   insert into public.admin_emails (email) values ('you@example.com') on conflict do nothing;
