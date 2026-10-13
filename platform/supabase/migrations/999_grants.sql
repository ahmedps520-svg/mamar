-- Mamar Booking · 999 grants. Always run last (and again after adding any function).
--
-- Postgres gives EXECUTE on every new function to PUBLIC, and Supabase adds default grants to
-- anon/authenticated. Both are revoked here, then granted back strictly by name prefix:
--   pub_ → anon, authenticated     own_, adm_ → authenticated     svc_ → service_role
--   _internal → nobody (they run inside security definer functions)

alter default privileges in schema public revoke execute on functions from public;

grant usage on schema public to anon, authenticated, service_role;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
    if f.name like 'pub\_%' then
      execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
    elsif f.name like 'own\_%' or f.name like 'adm\_%' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    elsif f.name like 'svc\_%' then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

-- Storage policies (logos) call this, so signed-in users may run it; it only answers yes/no.
grant execute on function public._is_admin() to authenticated;

-- No direct table access for clients. Realtime needs to read the version counters only.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.live_pings to anon, authenticated;
