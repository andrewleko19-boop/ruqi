-- ════════════════════════════════════════════════════════════════════════════
--  REVERT the SECURITY INVOKER conversion (undoes removed migration 000200).
--
--  Migration 20260624000200 converted these functions from SECURITY DEFINER to
--  SECURITY INVOKER to satisfy lint 0029. That was a mistake: they are
--  SECURITY DEFINER *by design*. As SECURITY INVOKER they run with the caller's
--  privileges and therefore:
--
--    • cannot call public.notify_user() — an internal SECURITY DEFINER helper on
--      which `authenticated` has NO EXECUTE grant. This is the cause of
--      "permission denied for function notify_user" → HTTP 403 on
--      /rest/v1/rpc/review_school_request (directorate approve/reject), and the
--      same break in review_monthly_statement / send_attendance_reminder.
--
--    • cannot perform their privileged cross-tenant writes. e.g.
--      review_school_request inserts public.students / public.classes, which only
--      have school-scoped write RLS — a directorate_user invoker is denied.
--
--  This migration restores SECURITY DEFINER on the 26 functions 000200 touched.
--  Idempotent: `alter function … security definer` is a no-op if already definer.
--
--  NOT touched (were ALWAYS SECURITY INVOKER — pure helpers, never 0029-flagged):
--    _nsams_phone_core, get_academic_year
--
--  search_path stays pinned (set by migration 20260624000000; this ALTER does
--  not affect proconfig). notify_user remains DEFINER and is deliberately NOT
--  granted to `authenticated` — only its DEFINER callers reach it; the client
--  never calls it directly.
--
--  The lint 0029 warnings these functions raise are accepted as informational:
--  they require both DEFINER privileges and `authenticated` EXECUTE, and are
--  guarded by internal role checks + REVOKE from anon. A proper resolution
--  (moving client-invisible helpers to a private, non-exposed schema) is planned
--  as a separate hardening pass.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  -- Explicit allow-list: ONLY the functions migration 000200 converted.
  -- A blanket "all INVOKER → DEFINER" would wrongly promote genuine invoker
  -- helpers (e.g. _nsams_phone_core, get_academic_year) and any future ones.
  names text[] := array[
    'end_staff_assignment', 'execute_annual_promotion', 'get_class_absence_log',
    'get_directorate_compliance', 'get_directorate_dropout_summary',
    'get_directorate_grades_coverage', 'get_directorate_trend',
    'get_dropout_risk_students', 'get_ministry_trend', 'get_periodic_reports',
    'get_school_trend', 'get_sync_state', 'is_school_day',
    'link_staff_to_registry', 'link_student_to_registry',
    'pull_attendance_delta', 'pull_conduct_delta', 'pull_grades_delta',
    'pull_students_delta', 'review_monthly_statement', 'review_result_sheet',
    'review_school_request', 'send_attendance_reminder', 'set_student_status',
    'upsert_staff_assignment', 'upsert_sync_state'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
    from   pg_proc      p
    join   pg_namespace n on n.oid = p.pronamespace
    where  n.nspname = 'public'
      and  p.proname = any(names)
      and  p.prorettype <> 'pg_catalog.trigger'::regtype
      and  not exists (
             select 1 from pg_depend d
             where d.objid = p.oid and d.deptype = 'e'
           )
  loop
    execute format('alter function %s security definer', r.sig);
  end loop;
end $$;
