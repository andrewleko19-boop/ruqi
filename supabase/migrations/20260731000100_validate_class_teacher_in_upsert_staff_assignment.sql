-- ════════════════════════════════════════════════════════════════════════════
--  Validate cross-tenant identifiers in upsert_staff_assignment (audit M2).
--
--  upsert_staff_assignment(jsonb) is SECURITY DEFINER and correctly verifies the
--  caller is a school_admin and pins staff_assignments.school_id to the caller's
--  school. But the class_teacher sync inserted (class_id, teacher_id) straight
--  from the JSON payload with NO check that the class belongs to the caller's
--  school or that the teacher is one of its users. class_teacher is exactly what
--  teaches_class() reads to authorize a teacher's access to attendance/grades/
--  conduct, so a school_admin who knows another school's class UUID could grant a
--  teacher cross-tenant access.
--
--  This replaces the function with the same body plus two existence checks before
--  the class_teacher upsert. Idempotent (create or replace).
-- ════════════════════════════════════════════════════════════════════════════

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
    -- class_teacher هو ما تقرأه teaches_class() لتخويل المعلّم على الحضور والدرجات
    -- والسلوك. الصف والمعلّم يأتيان من payload المتصفح، فبدون هذا التحقق يستطيع
    -- مدير مدرسة ربط معلّم بأي صفّ في مدرسة أخرى (منح صلاحية عابر للنطاق).
    if not exists (select 1 from public.classes c where c.id = v_class and c.school_id = v_school) then
      raise exception 'الصف المحدّد لا يتبع مدرستك';
    end if;
    if not exists (select 1 from public.users u where u.id = v_user and u.school_id = v_school) then
      raise exception 'المعلّم المحدّد لا يتبع مدرستك';
    end if;
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
