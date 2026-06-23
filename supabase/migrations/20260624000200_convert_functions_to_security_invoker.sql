-- ════════════════════════════════════════════════════════════════════════════
--  Lint 0029 — authenticated_security_definer_function_executable
--
--  Convert NSAMS application-logic functions from SECURITY DEFINER to
--  SECURITY INVOKER. With SECURITY INVOKER the function runs with the
--  caller's privileges, so Postgres RLS on any table it touches applies
--  normally. Each function already contains its own role check
--  (raise exception if wrong role), so callers are still rejected when
--  they should be — the only change is the privilege context of the body.
--
--  Idempotent — ALTER FUNCTION … SECURITY INVOKER is a no-op if already set.
--
--  ──────────────────────────────────────────────────────────────────────────
--  PERMANENTLY EXCLUDED — remain SECURITY DEFINER for the reasons below:
--
--  • RLS helper functions (12):
--      auth_role, auth_school_id, auth_directorate_id
--      current_user_role, current_user_school_id, current_user_directorate_id
--      current_user_is_parent
--      teaches_class, class_belongs_to_my_school, class_in_my_school
--      school_in_my_directorate, is_principal_in_my_directorate
--
--    These are called directly inside RLS USING / WITH CHECK clauses on
--    public.users and public.schools. If they ran as SECURITY INVOKER they
--    would re-trigger the very RLS policies that called them, producing an
--    infinite evaluation loop (→ stack overflow / 500 error on every query).
--    SECURITY DEFINER breaks the loop by bypassing RLS for the helper's own
--    sub-queries. This is the intentional design, documented in the schema
--    comment at the is_principal_in_my_directorate definition.
--
--  • parent_sync_links:
--    Reads auth.users (SELECT email … WHERE id = auth.uid()) to derive the
--    parent's phone number. The authenticated role has no SELECT on auth.users;
--    only elevated roles (postgres / service_role) can access that schema.
--    SECURITY INVOKER would make the auth.users query fail at runtime.
--
--  • get_school_staff_for_directorate, get_school_assignments_for_directorate:
--    Query public.staff_records, which intentionally has only a school_admin
--    RLS policy — directorate SELECT is explicitly absent to protect sensitive
--    personal columns (national_id, phone, residential_zone, mother_name).
--    These functions provide a curated, non-sensitive view via SECURITY DEFINER.
--    SECURITY INVOKER would silently return 0 rows for directorate users.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from   pg_proc      p
    join   pg_namespace n on n.oid = p.pronamespace
    where  n.nspname = 'public'
      and  p.prosecdef
      -- skip trigger functions (fire as table owner, not via EXECUTE)
      and  p.prorettype <> 'pg_catalog.trigger'::regtype
      -- skip extension-owned functions (PostGIS, pg_net, …)
      and  not exists (
             select 1 from pg_depend d
             where d.objid = p.oid and d.deptype = 'e'
           )
      -- only functions that authenticated can actually call
      -- (these are the ones generating lint 0029 warnings)
      and  has_function_privilege('authenticated', p.oid, 'EXECUTE')
      -- permanently excluded (see header comment for reasoning)
      and  p.proname not in (
             -- RLS helpers — recursion risk
             'auth_role',
             'auth_school_id',
             'auth_directorate_id',
             'current_user_role',
             'current_user_school_id',
             'current_user_directorate_id',
             'current_user_is_parent',
             'teaches_class',
             'class_belongs_to_my_school',
             'class_in_my_school',
             'school_in_my_directorate',
             'is_principal_in_my_directorate',
             -- Requires auth.users access (elevated privileges only)
             'parent_sync_links',
             -- Intentionally no directorate SELECT on sensitive staff columns
             'get_school_staff_for_directorate',
             'get_school_assignments_for_directorate'
           )
  loop
    execute format('alter function %s security invoker', r.sig);
  end loop;
end $$;
