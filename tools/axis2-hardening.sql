-- ════════════════════════════════════════════════════════════════════════════
-- المرحلة 3 — تقوية المحور 2: إصلاح التخريج بعد شِم is_active (المرحلة 1)
-- ════════════════════════════════════════════════════════════════════════════
--  المشكلة: execute_annual_promotion كانت تُخرّج الطالب بـ set is_active=false،
--  لكن شِم المرحلة 1 (t_sync_student_is_active) يُعيد اشتقاق is_active من status.
--  وبما أن status يبقى 'active'، يعود is_active إلى true → يبقى الخرّيج نشطاً خطأً.
--
--  الإصلاح: التخريج يضبط status='graduated' (والشِم يضبط is_active تلقائياً).
--  بقية الدالة كما هي (الترفيع/الإعادة لا يلمسان is_active، فلا يتأثّران).
--
--  يُطبَّق يدوياً في محرّر Supabase SQL. idempotent (create or replace).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.execute_annual_promotion(p_class_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_grade        int;
  v_section      text;
  v_school_id    uuid;
  v_acad_year    text;
  v_next_year    text;
  v_promoted     int := 0;
  v_repeated     int := 0;
  v_graduated    int := 0;
  v_skipped      int := 0;
  r              record;
  v_target_grade int;
  v_target_cid   uuid;
begin
  select c.grade, c.section, c.school_id, c.academic_year
  into v_grade, v_section, v_school_id, v_acad_year
  from public.classes c where c.id = p_class_id;
  if not found then raise exception 'الصف غير موجود'; end if;

  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.school_id = v_school_id and u.role = 'school_admin'
  ) then raise exception 'غير مصرّح'; end if;

  v_next_year := (split_part(v_acad_year,'-',1)::int + 1)::text
              || '-'
              || (split_part(v_acad_year,'-',1)::int + 2)::text;

  for r in
    select s.id as student_id, s.full_name, yr.result
    from public.students s
    left join public.student_year_results yr
           on yr.student_id = s.id and yr.academic_year = v_acad_year
    where s.class_id = p_class_id and s.is_active = true
  loop
    if r.result is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- الصف 12 + ناجح → تخريج (status='graduated'؛ الشِم يضبط is_active=false)
    if v_grade = 12 and r.result = 'ناجح' then
      update public.students
         set status = 'graduated', status_reason = 'تخريج آلي'
       where id = r.student_id;
      insert into public.audit_log(actor_id, school_id, entity, action, changes)
      values (auth.uid(), v_school_id, 'student', 'graduate',
              jsonb_build_object('academic_year', v_acad_year, 'grade', v_grade, 'name', r.full_name));
      v_graduated := v_graduated + 1;
      continue;
    end if;

    v_target_grade := case when r.result = 'ناجح' then v_grade + 1 else v_grade end;

    -- إيجاد أو إنشاء صف العام الجديد
    select id into v_target_cid from public.classes
    where school_id = v_school_id
      and grade = v_target_grade
      and section = v_section
      and academic_year = v_next_year
    limit 1;

    if v_target_cid is null then
      insert into public.classes(id, school_id, grade, section, academic_year, name)
      values (gen_random_uuid(), v_school_id, v_target_grade, v_section, v_next_year,
              'الصف ' || v_target_grade || ' / ' || v_section)
      returning id into v_target_cid;
    end if;

    update public.students set class_id = v_target_cid where id = r.student_id;
    insert into public.audit_log(actor_id, school_id, entity, action, changes)
    values (auth.uid(), v_school_id, 'student', 'promote',
            jsonb_build_object('from_class', p_class_id, 'to_class', v_target_cid,
                               'result', r.result, 'academic_year', v_acad_year, 'name', r.full_name));

    if r.result = 'ناجح' then v_promoted := v_promoted + 1;
    else v_repeated := v_repeated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'promoted',  v_promoted,
    'repeated',  v_repeated,
    'graduated', v_graduated,
    'skipped',   v_skipped
  );
end; $$;

revoke all on function public.execute_annual_promotion(uuid) from public, anon;
grant execute on function public.execute_annual_promotion(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ملاحظات التحقق:
--   -- بعد ترفيع صف 12 بنتائج ناجحة:
--   select status, is_active from public.students where id = '<graduate_id>';
--   -- يجب: status='graduated' و is_active=false (مشتقّ من الشِم).
-- ════════════════════════════════════════════════════════════════════════════
