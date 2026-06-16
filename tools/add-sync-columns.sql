-- =============================================================================
-- المرحلة 4أ — أعمدة المزامنة (idempotent)
-- يُطبَّق يدوياً في Supabase SQL editor
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. الجداول التي تفتقر إلى updated_at تماماً
--    نُضيف: updated_at + row_version + deleted_at (tombstone)
-- -----------------------------------------------------------------------------

-- student_grades (لا يوجد لها CREATE TABLE في repo — Supabase فقط)
alter table public.student_grades
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists row_version int         not null default 1,
  add column if not exists deleted_at  timestamptz;

-- student_conduct
alter table public.student_conduct
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists row_version int         not null default 1,
  add column if not exists deleted_at  timestamptz;

-- daily_student_attendance (لها created_at لكن لا updated_at)
alter table public.daily_student_attendance
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists row_version int         not null default 1,
  add column if not exists deleted_at  timestamptz;

-- attendance_submissions
alter table public.attendance_submissions
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists row_version int         not null default 1,
  add column if not exists deleted_at  timestamptz;

-- -----------------------------------------------------------------------------
-- 2. الجداول التي لها updated_at بالفعل
--    نُضيف فقط: row_version + deleted_at
-- -----------------------------------------------------------------------------

alter table public.students
  add column if not exists row_version int        not null default 1,
  add column if not exists deleted_at  timestamptz;

alter table public.staff_records
  add column if not exists row_version int        not null default 1,
  add column if not exists deleted_at  timestamptz;

alter table public.staff_attendance
  add column if not exists row_version int        not null default 1,
  add column if not exists deleted_at  timestamptz;

alter table public.emergency_reports
  add column if not exists row_version int        not null default 1,
  add column if not exists deleted_at  timestamptz;

-- staff_assignments + result_sheets أضيفا في م3 — نتحقق فقط
alter table public.staff_assignments
  add column if not exists row_version int        not null default 1,
  add column if not exists deleted_at  timestamptz;

alter table public.result_sheets
  add column if not exists row_version int        not null default 1,
  add column if not exists deleted_at  timestamptz;

-- -----------------------------------------------------------------------------
-- 3. فهارس B-tree على updated_at للسحب الدلتا الكفء
--    (partial index يستبعد الصفوف المحذوفة من الفهرس الحيّ)
-- -----------------------------------------------------------------------------

create index if not exists idx_students_updated
  on public.students (updated_at) where deleted_at is null;

create index if not exists idx_student_grades_updated
  on public.student_grades (updated_at) where deleted_at is null;

create index if not exists idx_student_conduct_updated
  on public.student_conduct (updated_at) where deleted_at is null;

create index if not exists idx_dsa_updated
  on public.daily_student_attendance (updated_at) where deleted_at is null;

create index if not exists idx_att_sub_updated
  on public.attendance_submissions (updated_at) where deleted_at is null;

create index if not exists idx_staff_att_updated
  on public.staff_attendance (updated_at) where deleted_at is null;
