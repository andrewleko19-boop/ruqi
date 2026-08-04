-- ════════════════════════════════════════════════════════════════════════════
--  Require an identity match before national-registry link/copy (audit C2).
--
--  national_students_registry / national_staff_registry are ministry-only (RLS
--  using(false) for everyone else). But link_student_to_registry(uuid, text) and
--  link_staff_to_registry(uuid, text) are SECURITY DEFINER, granted to
--  `authenticated`, and previously fetched the registry row by the caller-supplied
--  national_id / self_number with NO name match, copied it into the caller's own
--  student/staff row, and RETURNED the whole registry row. Any school_admin could
--  therefore pass one of their own students plus any (guessable, largely
--  sequential) national_id and receive that citizen's full identity — defeating
--  the ministry-only restriction.
--
--  Fix mirrors public.lookup_student_for_transfer ("the number alone must yield
--  nothing"): the caller's existing student/staff name must match the registry
--  row (via public.ar_norm normalization) before anything is copied or returned.
--
--  Idempotent (create or replace). Requires public.ar_norm() (defined in the base
--  schema) — always present in a live NSAMS database.
-- ════════════════════════════════════════════════════════════════════════════

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
  v_stu_name_norm text;
  v_registry    public.national_students_registry%rowtype;
begin
  v_caller_id := auth.uid();
  select role, school_id
    into v_caller_role, v_caller_school
    from public.users
   where id = v_caller_id;

  select school_id,
         public.ar_norm(coalesce(full_name,'')   || ' ' || coalesce(first_name,'')  || ' ' ||
                        coalesce(father_name,'')  || ' ' || coalesce(family_name,''))
    into v_stu_school, v_stu_name_norm
    from public.students
   where id = p_student_id;

  if not found then
    raise exception 'الطالب غير موجود';
  end if;

  if not (
    v_caller_role = 'ministry_user'
    or (v_caller_role = 'school_admin' and v_caller_school = v_stu_school)
  ) then
    raise exception 'غير مصرّح بتنفيذ هذه العملية';
  end if;

  select * into v_registry
    from public.national_students_registry
   where national_id = p_national_id;

  if not found then
    raise exception 'الرقم الوطني % غير موجود في السجلّ الوطني', p_national_id;
  end if;

  -- Identity gate: the caller's existing student name must match the registry row,
  -- else the number alone would expose an arbitrary citizen's identity.
  if position(public.ar_norm(coalesce(v_registry.first_name,''))  in v_stu_name_norm) = 0
     or position(public.ar_norm(coalesce(v_registry.father_name,'')) in v_stu_name_norm) = 0
     or position(public.ar_norm(coalesce(v_registry.family_name,'')) in v_stu_name_norm) = 0 then
    raise exception 'اسم الطالب لا يطابق السجلّ الوطني لهذا الرقم — تحقّق من الرقم الوطني والاسم';
  end if;

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

  return to_jsonb(v_registry);
end$$;

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
  v_staff_name_norm text;
  v_reg_name_norm   text;
  v_registry      public.national_staff_registry%rowtype;
begin
  v_caller_id := auth.uid();
  select role, school_id
    into v_caller_role, v_caller_school
    from public.users
   where id = v_caller_id;

  select school_id, public.ar_norm(coalesce(full_name,''))
    into v_staff_school, v_staff_name_norm
    from public.staff_records
   where id = p_staff_id;

  if not found then
    raise exception 'سجلّ الكادر غير موجود';
  end if;

  if not (
    v_caller_role = 'ministry_user'
    or (v_caller_role = 'school_admin' and v_caller_school = v_staff_school)
  ) then
    raise exception 'غير مصرّح بتنفيذ هذه العملية';
  end if;

  select * into v_registry
    from public.national_staff_registry
   where self_number = p_self_number;

  if not found then
    raise exception 'الرقم الذاتي % غير موجود في السجلّ الوطني للكادر', p_self_number;
  end if;

  -- Identity gate (staff registry carries only full_name → two-way containment).
  v_reg_name_norm := public.ar_norm(coalesce(v_registry.full_name,''));
  if coalesce(v_staff_name_norm,'') = ''
     or (position(v_staff_name_norm in v_reg_name_norm) = 0
         and position(v_reg_name_norm in v_staff_name_norm) = 0) then
    raise exception 'اسم الكادر لا يطابق السجلّ الوطني لهذا الرقم — تحقّق من الرقم الذاتي والاسم';
  end if;

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

  return to_jsonb(v_registry);
end$$;
