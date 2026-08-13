-- ════════════════════════════════════════════════════════════════════════════
--  ١) المجمّع التربوي يصير قائمةً مرجعية يضبطها المشرف، لا نصّاً حرّاً.
--  ٢) اسم صاحب التكليف (staff_id) يُتحقَّق من تبعيّته لكادر مدرسة المستدعي.
--
--  المجمّع التربوي يُطبَع في ترويسة بطاقة العلامات وورقة «لا مانع»، وكل مدرسة
--  كانت تكتبه بيدها: «مجمع جبلة» و«المجمع التربوي في جبلة» و«جبلة» ثلاثُ صيغ
--  لمجمّعٍ واحد، فيتفتّت التجميع في لوحتَي المديرية والوزارة. صار المشرف يُعرّفه
--  مرّةً لكل مديرية، وتختار المدرسةُ من قائمة. القائمة لكل مديرية — كالمناطق
--  التعليمية تماماً — لأن مجمّعات اللاذقية لا تعني حمص.
--
--  أما staff_id فكان يُكتب من حمولة المتصفح بلا فحص، بينما class_id وuser_id
--  فُحِصا في 20260731000100. الثغرة نفسها: مديرُ مدرسةٍ يعرف معرّف كادرٍ في
--  مدرسة أخرى يربط تكليفه به، فيظهر اسمُ موظّفٍ غريب في تكاليفه وفي بيانه
--  الشهريّ. الفحص هنا يسدّها بنفس نمط الفحصين الآخرين.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ١) نوع قائمة جديد: school_complex ──────────────────────────────────────
alter table public.lookup_lists
  drop constraint if exists lookup_lists_list_type_check;

alter table public.lookup_lists
  add constraint lookup_lists_list_type_check check (
    list_type = any (array[
      'admin_role', 'specialization', 'certificate', 'higher_degree',
      'leave_type', 'ministerial_doc', 'support_job', 'educational_zone',
      'job_title', 'school_admin_role', 'school_complex'
    ])
  );

comment on column public.lookup_lists.list_type is
  'نوع القائمة المرجعية. school_complex وeducational_zone لكل مديرية (directorate_id غير فارغ)، والبقية عامّة.';

-- ── ٢) فحص تبعيّة staff_id في upsert_staff_assignment ──────────────────────
create or replace function public.upsert_staff_assignment(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_school   uuid;
  v_id       uuid;
  v_year     text;
  v_kind     text;
  v_class    uuid;
  v_user     uuid;
  v_staff    uuid;
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
  v_staff    := nullif(p->>'staff_id','')::uuid;
  v_subjects := coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p->'subject_ids','[]'::jsonb))),
    '{}'::uuid[]);

  if v_kind not in ('technical','administrative') then
    raise exception 'نوع التكليف غير صالح';
  end if;

  -- الاسم يأتي من حمولة المتصفح كما يأتي الصف والحساب. بدون هذا الفحص يربط
  -- مديرُ مدرسةٍ تكليفَه بكادرِ مدرسةٍ أخرى، فيتسرّب اسمٌ عابر للنطاق إلى
  -- جدول التكاليف وإلى البيان الشهريّ المرفوع للمديرية.
  if v_staff is not null and not exists (
    select 1 from public.staff_records sr
    where sr.id = v_staff and sr.school_id = v_school
  ) then
    raise exception 'الاسم المحدّد لا يتبع كادر مدرستك';
  end if;

  if v_id is null then
    insert into public.staff_assignments (
      school_id, staff_id, user_id, assignment_kind, job_title, class_id, section,
      subject_ids, lesson_count, start_date, commence_date, assignment_date,
      execution_start, academic_year, active)
    values (
      v_school, v_staff,
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
      staff_id        = v_staff,
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
