-- ════════════════════════════════════════════════════════════════════════════
--  Security hardening — resolves Supabase Security Advisor lints for project
--  (NSAMS-owned) functions. Idempotent; safe to re-run.
--
--   • 0011_function_search_path_mutable
--       SET a fixed search_path on every public function that lacks one, so a
--       caller cannot hijack name resolution via a mutable search_path.
--   • 0028_anon_security_definer_function_executable
--       Revoke the implicit anon/PUBLIC EXECUTE grant on SECURITY DEFINER
--       functions so they can no longer be invoked unauthenticated via
--       /rest/v1/rpc/<fn>. Access is kept for `authenticated` and `service_role`;
--       trigger functions get no grant back (triggers fire as the table owner,
--       they are never called via EXECUTE).
--
--  Extension-owned functions (PostGIS, pg_net, …) are deliberately skipped via
--  the `pg_depend deptype = 'e'` filter — they are handled separately.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Pin search_path on every project-owned function that lacks one.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not (p.proconfig is not null
               and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- 2. Remove anon/PUBLIC EXECUTE from anon-reachable SECURITY DEFINER functions.
--    Only functions anon can currently execute are touched, so intentionally
--    restricted functions (e.g. generate_monthly_reports) are left untouched.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig,
           (p.prorettype = 'pg_catalog.trigger'::regtype) as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from anon, public', r.sig);
    if not r.is_trigger then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    end if;
  end loop;
end $$;
