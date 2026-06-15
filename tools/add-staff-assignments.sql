-- ════════════════════════════════════════════════════════════════════════════
-- المرحلة 3أ — التكاليف (staff_assignments) + مزامنة class_teacher + القوائم
-- ════════════════════════════════════════════════════════════════════════════
--  يفصل سجلّ التكليف الإداري/الفني (HR) عن جسر صلاحيات المعلّم (class_teacher).
--  التكليف الفني الصفّي التدريسي — حين يحمل user_id (حساب دخول) — يُزامَن آلياً
--  إلى class_teacher عبر RPC، فينعكس فوراً على getTeacherClasses وواجهة المعلم.
--
--  يُطبَّق يدوياً في محرّر Supabase SQL. كل العبارات idempotent وقابلة لإعادة
--  التشغيل. الترتيب: توسيع lookup_lists ثم الزرع ثم الجدول ثم RLS ثم RPCs.
-- ════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────
-- 1) توسيع قيد list_type لإضافة نوعَي التكليف الجديدين
-- ──────────────────────────────────────────────────────────────────────────
alter table public.lookup_lists drop constraint if exists lookup_lists_list_type_check;
alter table public.lookup_lists add constraint lookup_lists_list_type_check
  check (list_type in (
    'admin_role','specialization','certificate','higher_degree',
    'leave_type','ministerial_doc','support_job','educational_zone',
    'job_title','school_admin_role'   -- جديدان (الصفة الوظيفية / الصفة الإدارية)
  ));

-- ──────────────────────────────────────────────────────────────────────────
-- 2) زرع القيم (كما زوّدها المستخدم) — لا تكرار عبر on conflict do nothing
-- ──────────────────────────────────────────────────────────────────────────

-- 2.1  الصفة الوظيفية — التكليف الفني
insert into public.lookup_lists (list_type, value, sort_order) values
  ('job_title', 'معلم',                          1),
  ('job_title', 'معلم صف',                       2),
  ('job_title', 'مدرس',                          3),
  ('job_title', 'مدرس رشيدي',                    4),
  ('job_title', 'معلم احتياط',                   5),
  ('job_title', 'معلم تربية خاصة',               6),
  ('job_title', 'معلم حرفة',                     7),
  ('job_title', 'معلم خط',                       8),
  ('job_title', 'معلم مهارات',                   9),
  ('job_title', 'معلم روضة',                    10),
  ('job_title', 'مربية حضانة',                  11),
  ('job_title', 'مساعد معلم روضة',              12),
  ('job_title', 'أخصائي توحد تعديل سلوك',       13),
  ('job_title', 'أخصائي توحد صعوبات تعلم',      14),
  ('job_title', 'إشارة',                        15),
  ('job_title', 'تأهيل نطق',                    16),
  ('job_title', 'تعويضي',                       17),
  ('job_title', 'مكفوفين لغة برايل',            18)
on conflict do nothing;

-- 2.2  الصفة الإدارية — التكليف الإداري
insert into public.lookup_lists (list_type, value, sort_order) values
  ('school_admin_role', 'أمين سر',               1),
  ('school_admin_role', 'أمين سر حاسوب',         2),
  ('school_admin_role', 'أمين مخبر',             3),
  ('school_admin_role', 'أمين مستودع',           4),
  ('school_admin_role', 'أمين مكتبة',            5),
  ('school_admin_role', 'إرشاد نفسي',            6),
  ('school_admin_role', 'تربية خاصة',            7),
  ('school_admin_role', 'تعويضي',                8),
  ('school_admin_role', 'حارس',                  9),
  ('school_admin_role', 'دعم نفسي',             10),
  ('school_admin_role', 'رئيس دروس',            11),
  ('school_admin_role', 'سائق',                 12),
  ('school_admin_role', 'مجيز',                 13),
  ('school_admin_role', 'محفظ',                 14),
  ('school_admin_role', 'م.حماية',              15),
  ('school_admin_role', 'مساعد معلم روضة',      16),
  ('school_admin_role', 'مساعد مكتب تنظيم',     17),
  ('school_admin_role', 'مستخدم',               18),
  ('school_admin_role', 'مشرف باص',             19),
  ('school_admin_role', 'مشرف قسم',             20),
  ('school_admin_role', 'معاون أمين سر',        21),
  ('school_admin_role', 'معاون أمين مكتبة',     22),
  ('school_admin_role', 'معاون مدير',           23),
  ('school_admin_role', 'معلم أول',             24),
  ('school_admin_role', 'معلم احتياط',          25),
  ('school_admin_role', 'منشط',                 26),
  ('school_admin_role', 'موجه إدارة',           27),
  ('school_admin_role', 'ميسر',                 28)
on conflict do nothing;

-- ──────────────────────────────────────────────────────────────────────────
-- 3) جدول التكاليف — سجلّ HR منفصل عن class_teacher
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_assignments (
  id              uuid        primary key default gen_random_uuid(),
  school_id       uuid        not null references public.schools(id) on delete cascade,
  staff_id        uuid        references public.staff_records(id) on delete cascade,
  user_id         uuid        references public.users(id) on delete set null,  -- حساب الدخول (للمزامنة)
  assignment_kind text        not null check (assignment_kind in ('technical','administrative')),
  job_title       text        not null,        -- من lookup_lists (job_title / school_admin_role)
  class_id        uuid        references public.classes(id) on delete set null,  -- nullable للإداري
  section         text,
  subject_ids     uuid[]      not null default '{}',   -- للتكليف الفني التدريسي
  lesson_count    int,                                  -- عدد الدروس
  start_date      date,        -- تاريخ البدء
  commence_date   date,        -- تاريخ المباشرة
  assignment_date date,        -- تاريخ التكليف
  execution_start date,        -- بدء التنفيذ
  academic_year   text        not null,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists staff_assignments_school
  on public.staff_assignments (school_id, academic_year)
  where active = true;

alter table public.staff_assignments enable row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 4) RLS — school_admin كامل ضمن مدرسته (تستنسخ staff_records). لا قراءة مباشرة
--    للمديرية (تمرّ عبر get_school_assignments_for_directorate).
-- ──────────────────────────────────────────────────────────────────────────
drop policy if exists staff_assignments_school_admin on public.staff_assignments;
create policy staff_assignments_school_admin on public.staff_assignments
  for all to authenticated
  using (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  )
  with check (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  );

grant select, insert, update, delete on public.staff_assignments to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5) RPC: upsert_staff_assignment — يكتب التكليف ويُزامن class_teacher عند اللزوم
--    SECURITY DEFINER؛ يتحقّق من school_admin؛ المزامنة فقط لتكليف فني صفّي
--    تدريسي يحمل user_id (لأن class_teacher.teacher_id → users).
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.upsert_staff_assignment(jsonb);
create or replace function public.upsert_staff_assignment(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_school   uuid;
  v_id       uuid;
  v_year     text;
  v_kind     text;
  v_class    uuid;
  v_user     uuid;
  v_subjects uuid[];
begin
  -- صلاحية المستدعي
  select u.school_id into v_school
  from public.users u where u.id = auth.uid() and u.role = 'school_admin';
  if v_school is null then
    raise exception 'غير مصرّح: هذه الدالة لمدير المدرسة فقط';
  end if;

  v_id       := nullif(p->>'id','')::uuid;
  v_year     := coalesce(nullif(p->>'academic_year',''), '');
  v_kind     := p->>'assignment_kind';
  v_class    := nullif(p->>'class_id','')::uuid;
  v_user     := nullif(p->>'user_id','')::uuid;
  v_subjects := coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p->'subject_ids','[]'::jsonb))),
    '{}'::uuid[]);

  if v_kind not in ('technical','administrative') then
    raise exception 'نوع التكليف غير صالح';
  end if;

  if v_id is null then
    insert into public.staff_assignments (
      school_id, staff_id, user_id, assignment_kind, job_title, class_id, section,
      subject_ids, lesson_count, start_date, commence_date, assignment_date,
      execution_start, academic_year, active)
    values (
      v_school,
      nullif(p->>'staff_id','')::uuid,
      v_user, v_kind, p->>'job_title', v_class, nullif(p->>'section',''),
      v_subjects,
      nullif(p->>'lesson_count','')::int,
      nullif(p->>'start_date','')::date,
      nullif(p->>'commence_date','')::date,
      nullif(p->>'assignment_date','')::date,
      nullif(p->>'execution_start','')::date,
      v_year, true)
    returning id into v_id;
  else
    update public.staff_assignments set
      staff_id        = nullif(p->>'staff_id','')::uuid,
      user_id         = v_user,
      assignment_kind = v_kind,
      job_title       = p->>'job_title',
      class_id        = v_class,
      section         = nullif(p->>'section',''),
      subject_ids     = v_subjects,
      lesson_count    = nullif(p->>'lesson_count','')::int,
      start_date      = nullif(p->>'start_date','')::date,
      commence_date   = nullif(p->>'commence_date','')::date,
      assignment_date = nullif(p->>'assignment_date','')::date,
      execution_start = nullif(p->>'execution_start','')::date,
      academic_year   = v_year,
      updated_at      = now()
    where id = v_id and school_id = v_school;
    if not found then raise exception 'التكليف غير موجود أو خارج نطاقك'; end if;
  end if;

  -- مزامنة class_teacher: تكليف فني صفّي تدريسي بحساب دخول → جسر صلاحية المعلّم
  if v_kind = 'technical' and v_class is not null and v_user is not null and v_year <> '' then
    insert into public.class_teacher (class_id, teacher_id, academic_year, role, subject_ids)
    values (v_class, v_user, v_year,
            case when array_length(v_subjects,1) is null then 'homeroom' else 'subject' end,
            v_subjects)
    on conflict (class_id, teacher_id, academic_year)
    do update set role = excluded.role, subject_ids = excluded.subject_ids;
  end if;

  return v_id;
end; $$;

revoke all on function public.upsert_staff_assignment(jsonb) from public, anon;
grant execute on function public.upsert_staff_assignment(jsonb) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 6) RPC: end_staff_assignment — إنهاء التكليف وحذف صف class_teacher المُزامَن
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.end_staff_assignment(uuid);
create or replace function public.end_staff_assignment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
  v_asn    public.staff_assignments;
begin
  select u.school_id into v_school
  from public.users u where u.id = auth.uid() and u.role = 'school_admin';
  if v_school is null then
    raise exception 'غير مصرّح: هذه الدالة لمدير المدرسة فقط';
  end if;

  select * into v_asn from public.staff_assignments
  where id = p_id and school_id = v_school;
  if not found then raise exception 'التكليف غير موجود أو خارج نطاقك'; end if;

  update public.staff_assignments set active = false, updated_at = now()
  where id = p_id;

  -- إزالة جسر الصلاحية المُزامَن (إن وُجد)
  if v_asn.assignment_kind = 'technical'
     and v_asn.class_id is not null and v_asn.user_id is not null then
    delete from public.class_teacher
    where class_id = v_asn.class_id
      and teacher_id = v_asn.user_id
      and academic_year = v_asn.academic_year;
  end if;
end; $$;

revoke all on function public.end_staff_assignment(uuid) from public, anon;
grant execute on function public.end_staff_assignment(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 7) RPC: get_school_assignments_for_directorate — قراءة منقّحة للمديرية
--    (تستنسخ get_school_staff_for_directorate)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.get_school_assignments_for_directorate(p_school_id uuid)
returns table (
  id              uuid,
  assignment_kind text,
  job_title       text,
  class_id        uuid,
  section         text,
  subject_ids     uuid[],
  lesson_count    int,
  academic_year   text,
  active          boolean
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.users u
    join public.schools s on s.id = p_school_id
    where u.id = auth.uid()
      and u.role = 'directorate_user'
      and u.directorate_id = s.directorate_id
  ) then
    raise exception 'access denied';
  end if;

  return query
    select sa.id, sa.assignment_kind, sa.job_title, sa.class_id, sa.section,
           sa.subject_ids, sa.lesson_count, sa.academic_year, sa.active
    from public.staff_assignments sa
    where sa.school_id = p_school_id and sa.active = true
    order by sa.assignment_kind, sa.job_title;
end; $$;

revoke all on function public.get_school_assignments_for_directorate(uuid) from public, anon;
grant execute on function public.get_school_assignments_for_directorate(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ملاحظات التحقق:
--   -- إنشاء تكليف فني صفّي بحساب معلم ثم:
--   select * from public.class_teacher where teacher_id = '<user_id>';  -- يجب أن يظهر
--   -- إنهاء التكليف ثم التأكد من اختفاء صف class_teacher المُزامَن.
--   select list_type, count(*) from public.lookup_lists
--     where list_type in ('job_title','school_admin_role') group by list_type;
-- ════════════════════════════════════════════════════════════════════════════
