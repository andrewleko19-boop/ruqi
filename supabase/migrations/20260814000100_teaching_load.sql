-- ════════════════════════════════════════════════════════════════════════════
--  نصاب التدريس: مقارنة الدروس المسندة بالنصاب القانوني.
--
--  الحقلان موجودان منذ البداية ولم يُقارَنا قطّ:
--    staff_records.teaching_hours   → النصاب القانوني (١٥ ساعة مثلاً)
--    staff_assignments.lesson_count → الدروس المسندة في تكليفٍ بعينه
--  والمعلّم قد يحمل تكاليف عدّة، فالحمل الفعليّ هو مجموعها.
--
--  وهذا الحساب كان **مستحيلاً** قبل أن يصير staff_id إجبارياً في التكاليف:
--  التكليف بلا صاحب لا يُنسب حملُه إلى أحد. لذلك يأتي هذا الملف بعده لا قبله.
--
--  تمييزٌ لازم بين حالتين تبدوان واحدة في الحساب الساذج:
--    • نصابٌ محدَّد والحمل يفوقه  → تجاوزٌ يستوجب تنبيهاً أحمر.
--    • نصابٌ غير محدَّد (NULL)      → بيانٌ ناقص، لا تجاوز.
--  الخلط بينهما — بجعل NULL صفراً — يُشهِّر بكل معلّمٍ لم يُملأ نصابه بعدُ
--  على أنّه متجاوز. فالنصاب يبقى NULL، والفائض NULL معه، وتُعدّ الحالتان
--  منفصلتين في الإحصاء.
--
--  والقياس: الوزارة لا تسحب مئتَي ألف معلّم لتعدّهم في المتصفّح. التجميع
--  لكل مدرسة في دوال الإحصاء، والأسماء لا تُطلب إلا لمدرسةٍ واحدة.
-- ════════════════════════════════════════════════════════════════════════════

-- ── تفصيل نصاب مدرسةٍ واحدة (أسماء) ────────────────────────────────────────
-- مدير المدرسة يرى مدرسته، والمديرية مدارسها، والوزارة الكلّ.
create or replace function public.get_teaching_load(p_school_id uuid default null)
returns table(
  staff_id     uuid,
  full_name    text,
  school_id    uuid,
  school_name  text,
  quota        integer,
  assigned     integer,
  excess       integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_school uuid; v_dir uuid;
begin
  select u.role::text, u.school_id, u.directorate_id
    into v_role, v_school, v_dir
  from public.users u where u.id = auth.uid() and u.is_active;

  if v_role not in ('school_admin', 'directorate_user', 'ministry_user') then
    raise exception 'غير مصرّح: هذه الدالة للمدرسة أو المديرية أو الوزارة';
  end if;

  return query
  with scope as (
    select s.id, s.name
    from public.schools s
    where s.archived_at is null
      and case v_role
            when 'school_admin'     then s.id = v_school
            when 'directorate_user' then s.directorate_id = v_dir
            else true                                   -- ministry_user
          end
      and (p_school_id is null or s.id = p_school_id)
  ),
  ld as (
    select sa.staff_id as sid, sum(coalesce(sa.lesson_count, 0))::int as total
    from public.staff_assignments sa
    join scope on scope.id = sa.school_id
    where sa.active and sa.staff_id is not null
    group by sa.staff_id
  ),
  rows as (
    select sr.id           as r_staff,
           sr.full_name    as r_name,
           sr.school_id    as r_school,
           scope.name      as r_school_name,
           sr.teaching_hours              as r_quota,
           coalesce(ld.total, 0)::int     as r_assigned
    from public.staff_records sr
    join scope on scope.id = sr.school_id
    left join ld on ld.sid = sr.id
    where sr.active and sr.staff_type = 'teaching'
  )
  select r_staff, r_name, r_school, r_school_name, r_quota, r_assigned,
         case when r_quota is null then null
              else greatest(0, r_assigned - r_quota) end
  from rows
  -- المتجاوزون أوّلاً، ثم من لا نصاب له (بيانٌ ناقص يُستكمل)، ثم البقية.
  order by
    case when r_quota is not null and r_assigned > r_quota then 0
         when r_quota is null                              then 1
         else 2 end,
    (r_assigned - coalesce(r_quota, 0)) desc,
    r_name;
end; $$;

alter function public.get_teaching_load(uuid) owner to postgres;
revoke all on function public.get_teaching_load(uuid) from public, anon;
grant execute on function public.get_teaching_load(uuid) to authenticated;
comment on function public.get_teaching_load(uuid) is
  'نصاب التدريس لكل معلّم: النصاب القانوني والدروس المسندة والفائض. النطاق بحسب دور المستدعي.';

-- ── إضافة عمودَي النصاب إلى إحصاءات المديرية ───────────────────────────────
-- تغييرُ نوع الإرجاع يوجب الإسقاط: create or replace لا يبدّل التوقيع.
drop function if exists public.get_directorate_school_stats();

create function public.get_directorate_school_stats()
returns table(
  school_id           uuid,
  school_name         text,
  school_type         text,
  students_total      integer,
  students_male       integer,
  students_female     integer,
  students_unknown    integer,
  staff_teaching      integer,
  staff_admin         integer,
  staff_professional  integer,
  staff_worker        integer,
  staff_guard         integer,
  teachers_over_quota integer,
  teachers_no_quota   integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_dir uuid;
begin
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';

  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  return query
  with sch as (
    select s.id, s.name, s.school_type
    from public.schools s
    where s.directorate_id = v_dir and s.archived_at is null
  ),
  stu as (
    select st.school_id as sid,
           count(*)::int                                        as c_total,
           count(*) filter (where st.gender = 'male')::int       as c_male,
           count(*) filter (where st.gender = 'female')::int     as c_female,
           count(*) filter (where st.gender is null)::int        as c_unknown
    from public.students st
    join sch on sch.id = st.school_id
    where st.is_active
    group by st.school_id
  ),
  stf as (
    select sr.school_id as sid,
           count(*) filter (where sr.staff_type = 'teaching')::int     as c_teaching,
           count(*) filter (where sr.staff_type = 'admin')::int        as c_admin,
           count(*) filter (where sr.staff_type = 'professional')::int as c_professional,
           count(*) filter (where sr.staff_type = 'worker')::int       as c_worker,
           count(*) filter (where sr.staff_type = 'guard')::int        as c_guard
    from public.staff_records sr
    join sch on sch.id = sr.school_id
    where sr.active
    group by sr.school_id
  ),
  ld as (
    select sa.staff_id as sid, sum(coalesce(sa.lesson_count, 0))::int as total
    from public.staff_assignments sa
    join sch on sch.id = sa.school_id
    where sa.active and sa.staff_id is not null
    group by sa.staff_id
  ),
  qta as (
    select sr.school_id as sid,
           count(*) filter (where sr.teaching_hours is not null
                              and coalesce(ld.total, 0) > sr.teaching_hours)::int as c_over,
           count(*) filter (where sr.teaching_hours is null)::int                 as c_noquota
    from public.staff_records sr
    join sch on sch.id = sr.school_id
    left join ld on ld.sid = sr.id
    where sr.active and sr.staff_type = 'teaching'
    group by sr.school_id
  )
  select sch.id, sch.name, sch.school_type,
         coalesce(stu.c_total, 0),   coalesce(stu.c_male, 0),
         coalesce(stu.c_female, 0),  coalesce(stu.c_unknown, 0),
         coalesce(stf.c_teaching, 0), coalesce(stf.c_admin, 0),
         coalesce(stf.c_professional, 0), coalesce(stf.c_worker, 0),
         coalesce(stf.c_guard, 0),
         coalesce(qta.c_over, 0), coalesce(qta.c_noquota, 0)
  from sch
  left join stu on stu.sid = sch.id
  left join stf on stf.sid = sch.id
  left join qta on qta.sid = sch.id
  order by sch.name;
end; $$;

alter function public.get_directorate_school_stats() owner to postgres;
revoke all on function public.get_directorate_school_stats() from public, anon;
grant execute on function public.get_directorate_school_stats() to authenticated;
comment on function public.get_directorate_school_stats() is
  'إحصاء كل مدرسة في مديرية المستدعي: الطلاب بالجنس والكادر بالفئة وتجاوزات نصاب التدريس.';

-- ── وإلى إحصاءات الوزارة ───────────────────────────────────────────────────
drop function if exists public.get_ministry_school_stats(text);

create function public.get_ministry_school_stats(p_governorate text default null)
returns table(
  school_id           uuid,
  school_name         text,
  school_type         text,
  directorate_name    text,
  governorate         text,
  students_total      integer,
  students_male       integer,
  students_female     integer,
  staff_teaching      integer,
  staff_admin         integer,
  staff_professional  integer,
  staff_worker        integer,
  staff_guard         integer,
  teachers_over_quota integer,
  teachers_no_quota   integer
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'ministry_user'
  ) then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي الوزارة فقط';
  end if;

  return query
  with sch as (
    select s.id, s.name, s.school_type, d.name as dir_name, d.governorate as gov
    from public.schools s
    join public.directorates d on d.id = s.directorate_id
    where s.archived_at is null
      and (p_governorate is null or d.governorate = p_governorate)
  ),
  stu as (
    select st.school_id as sid,
           count(*)::int                                        as c_total,
           count(*) filter (where st.gender = 'male')::int       as c_male,
           count(*) filter (where st.gender = 'female')::int     as c_female
    from public.students st
    join sch on sch.id = st.school_id
    where st.is_active
    group by st.school_id
  ),
  stf as (
    select sr.school_id as sid,
           count(*) filter (where sr.staff_type = 'teaching')::int     as c_teaching,
           count(*) filter (where sr.staff_type = 'admin')::int        as c_admin,
           count(*) filter (where sr.staff_type = 'professional')::int as c_professional,
           count(*) filter (where sr.staff_type = 'worker')::int       as c_worker,
           count(*) filter (where sr.staff_type = 'guard')::int        as c_guard
    from public.staff_records sr
    join sch on sch.id = sr.school_id
    where sr.active
    group by sr.school_id
  ),
  ld as (
    select sa.staff_id as sid, sum(coalesce(sa.lesson_count, 0))::int as total
    from public.staff_assignments sa
    join sch on sch.id = sa.school_id
    where sa.active and sa.staff_id is not null
    group by sa.staff_id
  ),
  qta as (
    select sr.school_id as sid,
           count(*) filter (where sr.teaching_hours is not null
                              and coalesce(ld.total, 0) > sr.teaching_hours)::int as c_over,
           count(*) filter (where sr.teaching_hours is null)::int                 as c_noquota
    from public.staff_records sr
    join sch on sch.id = sr.school_id
    left join ld on ld.sid = sr.id
    where sr.active and sr.staff_type = 'teaching'
    group by sr.school_id
  )
  select sch.id, sch.name, sch.school_type, sch.dir_name, sch.gov,
         coalesce(stu.c_total, 0), coalesce(stu.c_male, 0), coalesce(stu.c_female, 0),
         coalesce(stf.c_teaching, 0), coalesce(stf.c_admin, 0),
         coalesce(stf.c_professional, 0), coalesce(stf.c_worker, 0),
         coalesce(stf.c_guard, 0),
         coalesce(qta.c_over, 0), coalesce(qta.c_noquota, 0)
  from sch
  left join stu on stu.sid = sch.id
  left join stf on stf.sid = sch.id
  left join qta on qta.sid = sch.id
  order by sch.name;
end; $$;

alter function public.get_ministry_school_stats(text) owner to postgres;
revoke all on function public.get_ministry_school_stats(text) from public, anon;
grant execute on function public.get_ministry_school_stats(text) to authenticated;
comment on function public.get_ministry_school_stats(text) is
  'إحصاء مدارس محافظةٍ بعينها (أو القُطر كلّه): الطلاب والكادر وتجاوزات نصاب التدريس.';
