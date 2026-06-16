-- =============================================================================
-- المرحلة 4أ — بنية المزامنة التحتية (idempotent)
-- يُطبَّق يدوياً في Supabase SQL editor — بعد add-sync-columns.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. trigger دالة bump_row_version
--    تُحدِّث updated_at + تزيد row_version عند كل UPDATE
-- -----------------------------------------------------------------------------

create or replace function public.bump_row_version()
returns trigger language plpgsql as $$
begin
  new.updated_at  := now();
  new.row_version := coalesce(old.row_version, 0) + 1;
  return new;
end;
$$;

-- طبّق trigger على كل الجداول الحرجة (DROP IF EXISTS أولاً لضمان idempotent)
do $$ declare t text; begin
  foreach t in array array[
    'students',
    'student_grades',
    'student_conduct',
    'daily_student_attendance',
    'attendance_submissions',
    'staff_records',
    'staff_attendance',
    'staff_assignments'
  ] loop
    execute format(
      'drop trigger if exists t_bump_row_version on public.%I', t);
    execute format(
      'create trigger t_bump_row_version
       before update on public.%I
       for each row execute function public.bump_row_version()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. جدول sync_state — علامة مائية per-device/per-table
-- -----------------------------------------------------------------------------

create table if not exists public.sync_state (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  device_id      text        not null,
  table_name     text        not null,
  last_pulled_at timestamptz not null default '1970-01-01',
  updated_at     timestamptz not null default now(),
  unique (user_id, device_id, table_name)
);

alter table public.sync_state enable row level security;

-- حذف السياسة أولاً (idempotent)
drop policy if exists sync_state_self on public.sync_state;
create policy sync_state_self on public.sync_state
  using     (user_id = auth.uid())
  with check(user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. RPCs — سحب دلتا (delta pull) — SECURITY DEFINER
--    كل RPC تتحقق من صلاحية الصف عبر join بـ students
-- -----------------------------------------------------------------------------

-- سحب دلتا الطلاب للصف الواحد
create or replace function public.pull_students_delta(
  p_class_id uuid,
  p_since    timestamptz)
returns setof public.students
language sql security definer stable as $$
  select * from public.students
  where class_id = p_class_id
    and updated_at > p_since
  order by updated_at;
$$;

-- سحب دلتا الدرجات للصف الواحد
create or replace function public.pull_grades_delta(
  p_class_id uuid,
  p_since    timestamptz)
returns setof public.student_grades
language sql security definer stable as $$
  select sg.*
  from public.student_grades sg
  join public.students s on s.id = sg.student_id
  where s.class_id = p_class_id
    and sg.updated_at > p_since
  order by sg.updated_at;
$$;

-- سحب دلتا الحضور اليومي للصف الواحد
create or replace function public.pull_attendance_delta(
  p_class_id uuid,
  p_since    timestamptz)
returns setof public.daily_student_attendance
language sql security definer stable as $$
  select da.*
  from public.daily_student_attendance da
  join public.students s on s.id = da.student_id
  where s.class_id = p_class_id
    and da.updated_at > p_since
  order by da.updated_at;
$$;

-- سحب دلتا السلوك للصف الواحد
create or replace function public.pull_conduct_delta(
  p_class_id uuid,
  p_since    timestamptz)
returns setof public.student_conduct
language sql security definer stable as $$
  select sc.*
  from public.student_conduct sc
  join public.students s on s.id = sc.student_id
  where s.class_id = p_class_id
    and sc.updated_at > p_since
  order by sc.updated_at;
$$;

-- -----------------------------------------------------------------------------
-- 4. RPC — تحديث علامة المزامنة (upsert_sync_state)
-- -----------------------------------------------------------------------------

create or replace function public.upsert_sync_state(
  p_device_id  text,
  p_table_name text,
  p_pulled_at  timestamptz)
returns void language sql security definer as $$
  insert into public.sync_state (user_id, device_id, table_name, last_pulled_at)
  values (auth.uid(), p_device_id, p_table_name, p_pulled_at)
  on conflict (user_id, device_id, table_name)
  do update set last_pulled_at = excluded.last_pulled_at,
                updated_at     = now();
$$;

-- -----------------------------------------------------------------------------
-- 5. RPC — قراءة علامة مزامنة جدول معيّن (get_sync_state)
--    تُعيد '1970-01-01' إذا لم يوجد سجلّ بعد (أول sync كامل)
-- -----------------------------------------------------------------------------

create or replace function public.get_sync_state(
  p_device_id  text,
  p_table_name text)
returns timestamptz language sql security definer stable as $$
  select coalesce(
    (select last_pulled_at from public.sync_state
     where user_id    = auth.uid()
       and device_id  = p_device_id
       and table_name = p_table_name),
    '1970-01-01'::timestamptz);
$$;
