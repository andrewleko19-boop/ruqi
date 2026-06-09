-- ════════════════════════════════════════════════════════════════════════════
--  NSAMS — Database setup (reference)
--
--  Run this in the Supabase project's SQL Editor. Every statement is
--  idempotent (IF [NOT] EXISTS / DROP POLICY IF EXISTS), so it is safe to
--  re-run after a partial application.
--
--  Prerequisite: the helper function current_user_school_id() must already
--  exist (it is used by the app's existing RLS policies and returns the
--  school_id of the currently-authenticated user).
--
--  NOTE: the app is a client-only PWA — schema lives in Supabase, not in
--  migrations in this repo. This file is committed for REFERENCE only.
--
--  The teacher-account feature also needs the Edge Function
--  `supabase/functions/admin-create-staff` deployed. Its secrets
--  (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) are
--  auto-injected by Supabase — nothing to set, and the service-role key
--  never reaches the browser.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 1 — Staff attendance (دوام الموظفين)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1  Admins & workers roster (no app login)
create table if not exists public.school_personnel (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null,
  full_name   text not null,
  kind        text not null check (kind in ('admin','worker')),
  national_id text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.school_personnel enable row level security;

drop policy if exists sp_admin_all on public.school_personnel;
create policy sp_admin_all on public.school_personnel
  for all to authenticated
  using      (school_id = current_user_school_id())
  with check (school_id = current_user_school_id());

-- 1.2  Per-person daily staff attendance
create table if not exists public.staff_attendance (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null,
  date              date not null,
  kind              text not null check (kind in ('teacher','admin','worker')),
  teacher_id        uuid references public.users(id),
  personnel_id      uuid references public.school_personnel(id),
  status            text not null default 'present' check (status in ('present','absent','leave','late')),
  check_in_original timestamptz,
  check_in_adjusted timestamptz,
  check_out         timestamptz,
  late_minutes      int,
  source            text not null default 'manager' check (source in ('self','manager')),
  adjusted_by       uuid,
  adjust_reason     text,
  note              text,
  recorded_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.staff_attendance enable row level security;

create unique index if not exists staff_att_teacher_date
  on public.staff_attendance (teacher_id, date)   where teacher_id   is not null;
create unique index if not exists staff_att_personnel_date
  on public.staff_attendance (personnel_id, date) where personnel_id is not null;

-- Principal: full access to their school
drop policy if exists sa_admin_all on public.staff_attendance;
create policy sa_admin_all on public.staff_attendance
  for all to authenticated
  using (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'))
  with check (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'));

-- Teacher: read own row + self-sign
drop policy if exists sa_teacher_select on public.staff_attendance;
create policy sa_teacher_select on public.staff_attendance
  for select to authenticated using (teacher_id = auth.uid());

drop policy if exists sa_teacher_insert on public.staff_attendance;
create policy sa_teacher_insert on public.staff_attendance
  for insert to authenticated with check (teacher_id = auth.uid() and source = 'self');

drop policy if exists sa_teacher_update on public.staff_attendance;
create policy sa_teacher_update on public.staff_attendance
  for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- 1.3  Daily aggregate columns + work-start time (lateness calc)
alter table public.daily_attendance
  add column if not exists admins_present  int default 0,
  add column if not exists admins_absent   int default 0,
  add column if not exists workers_present int default 0,
  add column if not exists workers_absent  int default 0,
  add column if not exists teachers_absent int default 0;

alter table public.schools add column if not exists work_start_time time;

grant select, insert, update, delete on public.school_personnel to authenticated;
grant select, insert, update, delete on public.staff_attendance to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 2 — Student information system (SIS) + audit + school identity
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1  Structured student columns (core + optional). The app keeps the existing
--      full_name column populated from first/father/family on every write.
alter table public.students
  add column if not exists first_name       text,
  add column if not exists father_name      text,
  add column if not exists family_name      text,
  add column if not exists birth_date       date,
  add column if not exists mother_name      text,
  add column if not exists mother_family    text,
  add column if not exists grandfather_name text,
  add column if not exists card_number      text,
  add column if not exists birth_place      text,
  add column if not exists contact_phone    text,
  add column if not exists res_governorate  text,
  add column if not exists res_region       text,
  add column if not exists res_subdistrict  text,
  add column if not exists res_town         text,
  add column if not exists res_sector       text,
  add column if not exists res_block        text,
  add column if not exists res_record       text,   -- column kept; field removed from UI
  add column if not exists recorded_by      uuid,
  add column if not exists created_at        timestamptz default now(),
  add column if not exists updated_at        timestamptz default now();

-- No duplicate national_id within a school (active students only)
create unique index if not exists students_natid_school
  on public.students (school_id, national_id)
  where national_id is not null and is_active;

-- 2.2  Generic audit log (sensitive edits: students now, more later)
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid,
  actor_id   uuid,
  entity     text not null,
  entity_id  uuid,
  action     text not null,
  changes    jsonb,
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (school_id = current_user_school_id());

grant select, insert on public.audit_log to authenticated;

-- 2.3  School identity (lat/lng already exist on schools)
alter table public.schools
  add column if not exists complex_name   text,
  add column if not exists classification text,
  add column if not exists education_type text,
  add column if not exists shift          text,
  add column if not exists student_type   text;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 3 — Teacher account credentials (principal-provisioned logins)
--
--  Rows are written by the admin-create-staff Edge Function (service role).
--  RLS makes them readable ONLY by the school's own admin — never the teacher
--  or any other role. The password is stored retrievable by explicit product
--  requirement (mirrors the official app); mitigated by strict RLS.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.staff_credentials (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null,
  user_id    uuid not null references public.users(id) on delete cascade,
  username   text not null unique,
  password   text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.staff_credentials enable row level security;

drop policy if exists staff_cred_admin on public.staff_credentials;
create policy staff_cred_admin on public.staff_credentials
  for all to authenticated
  using (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'))
  with check (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'));

grant select, insert, update, delete on public.staff_credentials to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 4 — Edge Function (service_role) grants
--
--  The admin-create-staff Edge Function runs as service_role and writes to
--  public.users and public.staff_credentials. service_role bypasses RLS but
--  still needs table-level GRANTs. Without these the insert fails with
--  "permission denied for table users".
-- ════════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on public.users             to service_role;
grant select, insert, update, delete on public.staff_credentials to service_role;

