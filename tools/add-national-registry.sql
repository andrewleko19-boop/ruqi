-- ════════════════════════════════════════════════════════════════════════════
-- المرحلة 2 من إعادة الهيكلة الوزارية — السجلّ الوطني (National Registry)
-- ════════════════════════════════════════════════════════════════════════════
--  يُنشئ جدولَي السجلّ الوطني للطلاب والكادر التعليمي، ويربطهما بالجداول
--  الحالية (students, staff_records) عبر أعمدة FK. يُجمّد بيانات الهوية
--  المرتبطة بالسجلّ الوطني بحيث لا يمكن تعديلها من واجهة المدرسة مباشرةً،
--  وإنما عبر RPC مخصّصة (link_student_to_registry / link_staff_to_registry).
--
--  الحالات: إنشاء الجداول · أعمدة FK · التعبئة الرجعية · triggers القفل
--           · RLS · دوال RPC.
--
--  يُطبَّق يدوياً في محرّر Supabase SQL. كل العبارات idempotent وقابلة
--  لإعادة التشغيل. الترتيب مهم: نُعبّئ البيانات أولاً ثم نُلحق المُحفّزات.
-- ════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────
-- 1) جدول السجلّ الوطني للطلاب
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.national_students_registry (
  national_id       text primary key,
  first_name        text not null,
  father_name       text,
  family_name       text,
  full_name         text not null,
  mother_name       text,
  mother_family     text,
  grandfather_name  text,
  gender            text check (gender in ('male','female')),
  birth_date        date,
  birth_place       text,
  card_number       text,
  res_governorate   text,
  res_region        text,
  res_subdistrict   text,
  res_town          text,
  res_sector        text,
  res_block         text,
  res_record        text,
  source            text not null default 'central_import',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  row_version       int not null default 1
);

comment on table  public.national_students_registry is 'السجلّ الوطني المركزي للطلاب — المصدر الموثوق لبيانات هوية الطالب';
comment on column public.national_students_registry.national_id is 'الرقم الوطني — المفتاح الأساسي';
comment on column public.national_students_registry.source      is 'مصدر السجلّ: central_import | manual_ministry | auto_seeded';


-- ──────────────────────────────────────────────────────────────────────────
-- 2) جدول السجلّ الوطني للكادر التعليمي
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.national_staff_registry (
  self_number       text primary key,   -- الرقم الذاتي
  general_number    text,               -- الرقم العام
  national_id       text unique,
  full_name         text not null,
  mother_name       text,
  gender            text check (gender in ('male','female')),
  birth_date        date,
  birth_place       text,
  certificate       text,
  higher_degree     text,
  specialization    text,
  source            text not null default 'central_import',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  row_version       int not null default 1
);

comment on table  public.national_staff_registry is 'السجلّ الوطني المركزي للكادر التعليمي — المصدر الموثوق لبيانات الهوية';
comment on column public.national_staff_registry.self_number    is 'الرقم الذاتي — المفتاح الأساسي';
comment on column public.national_staff_registry.general_number is 'الرقم العام';


-- ──────────────────────────────────────────────────────────────────────────
-- 3) أعمدة FK على جدول students
-- ──────────────────────────────────────────────────────────────────────────
alter table public.students
  add column if not exists registry_national_id text;

-- FK مع DO block لضمان الـ idempotency
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'students_registry_national_id_fkey'
      and table_name = 'students'
      and table_schema = 'public'
  ) then
    alter table public.students
      add constraint students_registry_national_id_fkey
      foreign key (registry_national_id)
      references public.national_students_registry (national_id)
      on update cascade
      on delete set null;
  end if;
end$$;

comment on column public.students.registry_national_id is 'ربط الطالب بالسجلّ الوطني — عند الربط تُقفل حقول الهوية المرآتية';


-- ──────────────────────────────────────────────────────────────────────────
-- 4) أعمدة على جدول staff_records
-- ──────────────────────────────────────────────────────────────────────────
alter table public.staff_records
  add column if not exists registry_self_number text,
  add column if not exists self_number          text,
  add column if not exists general_number       text,
  add column if not exists gender               text check (gender in ('male','female'));

-- FK للكادر
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'staff_records_registry_self_number_fkey'
      and table_name = 'staff_records'
      and table_schema = 'public'
  ) then
    alter table public.staff_records
      add constraint staff_records_registry_self_number_fkey
      foreign key (registry_self_number)
      references public.national_staff_registry (self_number)
      on update cascade
      on delete set null;
  end if;
end$$;

comment on column public.staff_records.registry_self_number is 'ربط الكادر بالسجلّ الذاتي — عند الربط تُقفل حقول الهوية المرآتية';
comment on column public.staff_records.self_number          is 'الرقم الذاتي المرآتي (مرجع محلي، قد يكون بلا ربط بالسجلّ)';
comment on column public.staff_records.general_number       is 'الرقم العام المرآتي';


-- ──────────────────────────────────────────────────────────────────────────
-- 5) تعبئة رجعية لـ national_students_registry من بيانات students الحالية
-- ──────────────────────────────────────────────────────────────────────────
-- نختار أكثر صف مكتملاً لكل رقم وطني (DISTINCT ON مرتّب بعدد الحقول غير-null)
insert into public.national_students_registry (
  national_id, first_name, father_name, family_name, full_name,
  mother_name, mother_family, grandfather_name,
  gender, birth_date, birth_place, card_number,
  source
)
select distinct on (national_id)
  national_id,
  coalesce(first_name, ''),
  father_name,
  family_name,
  coalesce(full_name, coalesce(first_name, '') || ' ' || coalesce(family_name, '')),
  mother_name,
  mother_family,
  grandfather_name,
  gender,
  birth_date,
  birth_place,
  card_number,
  'auto_seeded'
from public.students
where national_id is not null
  and national_id <> ''
order by
  national_id,
  -- أعطِ الأولوية للصف ذي أكثر حقول غير-null
  (
    (case when first_name        is not null then 1 else 0 end) +
    (case when father_name       is not null then 1 else 0 end) +
    (case when family_name       is not null then 1 else 0 end) +
    (case when mother_name       is not null then 1 else 0 end) +
    (case when mother_family     is not null then 1 else 0 end) +
    (case when grandfather_name  is not null then 1 else 0 end) +
    (case when birth_date        is not null then 1 else 0 end) +
    (case when birth_place       is not null then 1 else 0 end) +
    (case when card_number       is not null then 1 else 0 end)
  ) desc
on conflict (national_id) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 6) تعبئة رجعية لـ national_staff_registry من بيانات staff_records الحالية
-- ──────────────────────────────────────────────────────────────────────────
-- نستخدم بادئة 'auto-' + national_id كـ self_number مؤقت لأن staff_records
-- لم يكن فيه self_number قبل هذه الهجرة؛ السجلات الحقيقية تأتي من الاستيراد
-- المركزي أو من ربط يدوي عبر link_staff_to_registry.
insert into public.national_staff_registry (
  self_number, national_id, full_name,
  mother_name, gender, birth_date, birth_place,
  certificate, higher_degree, specialization,
  source
)
select
  'auto-' || national_id,
  national_id,
  full_name,
  mother_name,
  null,           -- gender لم يكن موجوداً في staff_records
  birth_date,
  null,           -- birth_place لم يكن موجوداً في staff_records
  certificate,
  higher_degree,
  specialization,
  'auto_seeded'
from public.staff_records
where national_id is not null
  and national_id <> ''
on conflict (self_number) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 7) تعبئة رجعية لـ registry_national_id على students
-- ──────────────────────────────────────────────────────────────────────────
update public.students
   set registry_national_id = national_id
 where national_id is not null
   and national_id <> ''
   and national_id in (select national_id from public.national_students_registry)
   and registry_national_id is null;


-- ──────────────────────────────────────────────────────────────────────────
-- 8) Trigger قفل حقول الهوية المرتبطة بالسجلّ الوطني — students
--    (يُنشأ بعد التعبئة الرجعية كي لا يتعارض معها)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.lock_student_registry_mirrors()
returns trigger language plpgsql as $$
begin
  -- السماح بالتجاوز من داخل RPC الربط
  if current_setting('nsams.skip_registry_lock', true) = 'true' then
    return new;
  end if;

  -- القفل فعّال فقط عندما يكون الطالب مرتبطاً بالسجلّ الوطني
  if new.registry_national_id is not null then
    if (
      new.first_name       is distinct from old.first_name       or
      new.father_name      is distinct from old.father_name      or
      new.family_name      is distinct from old.family_name      or
      new.full_name        is distinct from old.full_name        or
      new.gender           is distinct from old.gender           or
      new.birth_date       is distinct from old.birth_date       or
      new.national_id      is distinct from old.national_id      or
      new.mother_name      is distinct from old.mother_name      or
      new.mother_family    is distinct from old.mother_family    or
      new.grandfather_name is distinct from old.grandfather_name or
      new.card_number      is distinct from old.card_number      or
      new.birth_place      is distinct from old.birth_place
    ) then
      raise exception 'لا يمكن تعديل حقل مرتبط بالسجل الوطني للطالب';
    end if;
  end if;

  return new;
end$$;

drop trigger if exists t_lock_student_registry_mirrors on public.students;
create trigger t_lock_student_registry_mirrors
  before update on public.students
  for each row execute function public.lock_student_registry_mirrors();


-- ──────────────────────────────────────────────────────────────────────────
-- 9) Trigger قفل حقول الهوية المرتبطة بالسجلّ الذاتي — staff_records
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.lock_staff_registry_mirrors()
returns trigger language plpgsql as $$
begin
  -- السماح بالتجاوز من داخل RPC الربط
  if current_setting('nsams.skip_registry_lock', true) = 'true' then
    return new;
  end if;

  -- القفل فعّال فقط عندما يكون الكادر مرتبطاً بالسجلّ الذاتي
  if new.registry_self_number is not null then
    if (
      new.full_name      is distinct from old.full_name      or
      new.national_id    is distinct from old.national_id    or
      new.mother_name    is distinct from old.mother_name    or
      new.birth_date     is distinct from old.birth_date     or
      new.gender         is distinct from old.gender         or
      new.self_number    is distinct from old.self_number    or
      new.general_number is distinct from old.general_number
    ) then
      raise exception 'لا يمكن تعديل حقل مرتبط بالسجل الذاتي للكادر';
    end if;
  end if;

  return new;
end$$;

drop trigger if exists t_lock_staff_registry_mirrors on public.staff_records;
create trigger t_lock_staff_registry_mirrors
  before update on public.staff_records
  for each row execute function public.lock_staff_registry_mirrors();


-- ──────────────────────────────────────────────────────────────────────────
-- 10) RLS على جدولَي السجلّ الوطني
-- ──────────────────────────────────────────────────────────────────────────

-- أ) السجلّ الوطني للطلاب
alter table public.national_students_registry enable row level security;

drop policy if exists ministry_users_all_students_registry    on public.national_students_registry;
drop policy if exists no_direct_access_students_registry      on public.national_students_registry;

-- وزارة: وصول كامل
create policy ministry_users_all_students_registry
  on public.national_students_registry
  for all
  to authenticated
  using (
    (select role from public.users where id = auth.uid()) = 'ministry_user'
  )
  with check (
    (select role from public.users where id = auth.uid()) = 'ministry_user'
  );

-- باقي المستخدمين: لا قراءة مباشرة (الوصول عبر RPCs فقط)
create policy no_direct_access_students_registry
  on public.national_students_registry
  for select
  to authenticated
  using (false);

-- ب) السجلّ الوطني للكادر
alter table public.national_staff_registry enable row level security;

drop policy if exists ministry_users_all_staff_registry    on public.national_staff_registry;
drop policy if exists no_direct_access_staff_registry      on public.national_staff_registry;

-- وزارة: وصول كامل
create policy ministry_users_all_staff_registry
  on public.national_staff_registry
  for all
  to authenticated
  using (
    (select role from public.users where id = auth.uid()) = 'ministry_user'
  )
  with check (
    (select role from public.users where id = auth.uid()) = 'ministry_user'
  );

-- باقي المستخدمين: لا قراءة مباشرة
create policy no_direct_access_staff_registry
  on public.national_staff_registry
  for select
  to authenticated
  using (false);


-- ──────────────────────────────────────────────────────────────────────────
-- 11) RPC: link_student_to_registry
--     تربط طالباً بسجلّ وطني وتنسخ حقول الهوية منه، وتكتب audit_log.
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.link_student_to_registry(uuid, text);
create or replace function public.link_student_to_registry(
  p_student_id uuid,
  p_national_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id   uuid;
  v_caller_role text;
  v_caller_school uuid;
  v_stu_school  uuid;
  v_registry    public.national_students_registry%rowtype;
begin
  -- 1) هوية المستدعي
  v_caller_id := auth.uid();
  select role, school_id
    into v_caller_role, v_caller_school
    from public.users
   where id = v_caller_id;

  -- 2) مدرسة الطالب
  select school_id
    into v_stu_school
    from public.students
   where id = p_student_id;

  if not found then
    raise exception 'الطالب غير موجود';
  end if;

  -- 3) التحقق من الصلاحية: مدير مدرسة الطالب فقط (أو مستخدم وزارة)
  if not (
    v_caller_role = 'ministry_user'
    or (v_caller_role = 'school_admin' and v_caller_school = v_stu_school)
  ) then
    raise exception 'غير مصرّح بتنفيذ هذه العملية';
  end if;

  -- 4) جلب سجلّ الهوية من السجلّ الوطني
  select * into v_registry
    from public.national_students_registry
   where national_id = p_national_id;

  if not found then
    raise exception 'الرقم الوطني % غير موجود في السجلّ الوطني', p_national_id;
  end if;

  -- 5) تطبيق التحديث مع تجاوز trigger القفل
  set local nsams.skip_registry_lock = 'true';

  update public.students set
    registry_national_id = v_registry.national_id,
    national_id          = v_registry.national_id,
    first_name           = v_registry.first_name,
    father_name          = v_registry.father_name,
    family_name          = v_registry.family_name,
    full_name            = v_registry.full_name,
    gender               = v_registry.gender,
    birth_date           = v_registry.birth_date,
    mother_name          = v_registry.mother_name,
    mother_family        = v_registry.mother_family,
    grandfather_name     = v_registry.grandfather_name,
    card_number          = v_registry.card_number,
    birth_place          = v_registry.birth_place
  where id = p_student_id;

  -- 6) audit_log
  insert into public.audit_log
    (school_id, actor_id, entity, entity_id, action, changes, reason)
  values
    (v_stu_school, v_caller_id, 'student', p_student_id,
     'link_to_registry',
     jsonb_build_object(
       'registry_national_id', v_registry.national_id,
       'full_name',            v_registry.full_name
     ),
     'ربط بالسجلّ الوطني');

  -- 7) إعادة بيانات السجلّ
  return to_jsonb(v_registry);
end$$;

grant execute on function public.link_student_to_registry(uuid, text) to authenticated;

comment on function public.link_student_to_registry(uuid, text) is
  'تربط طالباً بالسجلّ الوطني وتنسخ حقول هويته منه. تتطلب دور school_admin لمدرسة الطالب أو ministry_user.';


-- ──────────────────────────────────────────────────────────────────────────
-- 12) RPC: link_staff_to_registry
--     تربط فرداً من الكادر بالسجلّ الذاتي وتنسخ حقول الهوية منه.
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.link_staff_to_registry(uuid, text);
create or replace function public.link_staff_to_registry(
  p_staff_id   uuid,
  p_self_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;
  v_staff_school  uuid;
  v_registry      public.national_staff_registry%rowtype;
begin
  -- 1) هوية المستدعي
  v_caller_id := auth.uid();
  select role, school_id
    into v_caller_role, v_caller_school
    from public.users
   where id = v_caller_id;

  -- 2) مدرسة الكادر
  select school_id
    into v_staff_school
    from public.staff_records
   where id = p_staff_id;

  if not found then
    raise exception 'سجلّ الكادر غير موجود';
  end if;

  -- 3) التحقق من الصلاحية
  if not (
    v_caller_role = 'ministry_user'
    or (v_caller_role = 'school_admin' and v_caller_school = v_staff_school)
  ) then
    raise exception 'غير مصرّح بتنفيذ هذه العملية';
  end if;

  -- 4) جلب سجلّ الكادر من السجلّ الذاتي
  select * into v_registry
    from public.national_staff_registry
   where self_number = p_self_number;

  if not found then
    raise exception 'الرقم الذاتي % غير موجود في السجلّ الوطني للكادر', p_self_number;
  end if;

  -- 5) تطبيق التحديث مع تجاوز trigger القفل
  set local nsams.skip_registry_lock = 'true';

  update public.staff_records set
    registry_self_number = v_registry.self_number,
    self_number          = v_registry.self_number,
    general_number       = v_registry.general_number,
    full_name            = v_registry.full_name,
    national_id          = v_registry.national_id,
    mother_name          = v_registry.mother_name,
    birth_date           = v_registry.birth_date,
    gender               = v_registry.gender
  where id = p_staff_id;

  -- 6) audit_log
  insert into public.audit_log
    (school_id, actor_id, entity, entity_id, action, changes, reason)
  values
    (v_staff_school, v_caller_id, 'staff', p_staff_id,
     'link_to_registry',
     jsonb_build_object(
       'registry_self_number', v_registry.self_number,
       'full_name',            v_registry.full_name,
       'national_id',          v_registry.national_id
     ),
     'ربط بالسجلّ الذاتي للكادر');

  -- 7) إعادة بيانات السجلّ
  return to_jsonb(v_registry);
end$$;

grant execute on function public.link_staff_to_registry(uuid, text) to authenticated;

comment on function public.link_staff_to_registry(uuid, text) is
  'تربط فرداً من الكادر بالسجلّ الذاتي الوطني وتنسخ حقول هويته منه. تتطلب دور school_admin لمدرسة الكادر أو ministry_user.';


-- ════════════════════════════════════════════════════════════════════════════
-- ملاحظات التحقق:
--
--   -- 1) عدد السجلات المعبّأة في السجلّ الوطني للطلاب:
--   select count(*) from public.national_students_registry where source = 'auto_seeded';
--
--   -- 2) عدد الطلاب المرتبطين:
--   select count(*) from public.students where registry_national_id is not null;
--
--   -- 3) عدد سجلات الكادر المعبّأة:
--   select count(*) from public.national_staff_registry where source = 'auto_seeded';
--
--   -- 4) اختبار trigger القفل على طالب مرتبط:
--   -- update public.students set first_name = 'test'
--   -- where registry_national_id is not null limit 1;
--   -- يجب أن يُنتج: ERROR: لا يمكن تعديل حقل مرتبط بالسجل الوطني للطالب
--
--   -- 5) اختبار RPC الربط (استدعِه من عميل مصادق):
--   -- select public.link_student_to_registry('<student_uuid>', '<national_id>');
--   -- select public.link_staff_to_registry('<staff_uuid>', '<self_number>');
--
--   -- 6) التحقق من عدم بقاء registry_national_id بلا سجلّ مقابل:
--   select count(*) from public.students s
--   left join public.national_students_registry r on r.national_id = s.registry_national_id
--   where s.registry_national_id is not null and r.national_id is null;
--   -- يجب أن يساوي 0
-- ════════════════════════════════════════════════════════════════════════════
