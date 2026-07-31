-- ════════════════════════════════════════════════════════════════════════════
--  Surface (do NOT silently change) RLS state on PII tables built outside the
--  repo (audit L3).
--
--  student_grades and subjects were created directly in Supabase (per
--  tools/add-sync-columns.sql). The repo commits only a PARENT read policy for
--  each (parent_read_linked_grades / parent_read_subjects) — there is NO committed
--  teacher-write or school-read policy and NO committed `enable row level
--  security`. So a rebuild-from-repo cannot reproduce their protection, and the
--  live state is unverifiable from source control.
--
--  This migration deliberately does NOT flip RLS on: if the live table relies on
--  RLS being OFF plus grants (only the parent SELECT policy is present), enabling
--  it would immediately break teacher grade entry (no teacher INSERT/UPDATE
--  policy). Instead it RAISES A WARNING describing exactly what is missing so an
--  operator can author the correct policy set and enable RLS deliberately.
--
--  To FIX (run manually after confirming the live policies): enable RLS and add
--  teacher-write + school-read policies mirroring student_conduct
--  (conduct_teacher_write / conduct_read in docs/database-setup.sql §17), e.g.:
--
--    alter table public.student_grades enable row level security;
--    create policy grades_teacher_write on public.student_grades for all
--      to authenticated
--      using      (public.current_user_role() = 'teacher'::public.user_role
--                  and public.teaches_class(class_id))
--      with check (public.current_user_role() = 'teacher'::public.user_role
--                  and public.teaches_class(class_id));
--    create policy grades_school_read on public.student_grades for select
--      to authenticated
--      using (public.current_user_role() = 'school_admin'::public.user_role
--             and school_id = public.current_user_school_id());
--    -- subjects: add a school-scoped read policy for staff, then enable RLS.
--
--  student_conduct already has RLS enabled with a full policy set, so it needs
--  nothing here.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('student_grades', 'subjects')
      and c.relkind = 'r'
      and c.relrowsecurity = false
  loop
    raise warning
      'RLS is NOT enabled on public.% — its parent policy is inert and staff grants are unfiltered. Author teacher-write + school-read policies, then enable RLS (see this migration''s header).',
      r.relname;
  end loop;
end $$;
