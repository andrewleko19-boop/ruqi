-- ════════════════════════════════════════════════════════════════════════════
--  إحصاءاتٌ مفصَّلة: الطلاب بالجنس، والكادر بالفئة، والمدارس بالنوع.
--
--  لوحتا المديرية والوزارة تعرضان الحضور فقط. أوّل سؤالٍ يسأله مسؤولٌ حقيقيّ
--  ليس «كم حضر اليوم» بل «كم مدرسةً ابتدائية عندي وكم طالبةً فيها» — وهذه
--  أرقامٌ لم تكن تُحسب أصلاً.
--
--  الحساب في القاعدة لا في المتصفّح: مديريةٌ بمئتَي مدرسة تعني ثمانين ألف صفٍّ
--  من الطلاب، سحبُها لتُعدّ في الواجهة يُثقل الشبكة ويستهلك ذاكرة الجهاز على
--  هواتف لا تحتملها. التجميع هنا يُرجع صفّاً لكل مدرسة أو لكل محافظة.
--
--  والصياغة بـCTE لا باستعلاماتٍ مرتبطة داخل SELECT: الأخيرة تُنفَّذ مرّةً لكل
--  مدرسة فتتضاعف كلفتها بعددها، والأولى تمسح كل جدولٍ مرّةً واحدة.
--
--  الأدوار مفصولة كما في get_directorate_trend / get_ministry_trend: كلٌّ
--  يقرأ نطاقه وحده، والدالة SECURITY DEFINER فالفحص هنا هو الحارس.
-- ════════════════════════════════════════════════════════════════════════════

-- ── المديرية: صفٌّ لكل مدرسة ────────────────────────────────────────────────
create or replace function public.get_directorate_school_stats()
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
  staff_guard         integer
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
  )
  select sch.id, sch.name, sch.school_type,
         coalesce(stu.c_total, 0),   coalesce(stu.c_male, 0),
         coalesce(stu.c_female, 0),  coalesce(stu.c_unknown, 0),
         coalesce(stf.c_teaching, 0), coalesce(stf.c_admin, 0),
         coalesce(stf.c_professional, 0), coalesce(stf.c_worker, 0),
         coalesce(stf.c_guard, 0)
  from sch
  left join stu on stu.sid = sch.id
  left join stf on stf.sid = sch.id
  order by sch.name;
end; $$;

alter function public.get_directorate_school_stats() owner to postgres;
revoke all on function public.get_directorate_school_stats() from public, anon;
grant execute on function public.get_directorate_school_stats() to authenticated;
comment on function public.get_directorate_school_stats() is
  'إحصاء كل مدرسة في مديرية المستدعي: الطلاب بالجنس والكادر بالفئة ونوع المدرسة.';

-- ── الوزارة: صفٌّ لكل محافظة ────────────────────────────────────────────────
create or replace function public.get_ministry_governorate_stats()
returns table(
  governorate           text,
  schools_total         integer,
  schools_primary       integer,
  schools_preparatory   integer,
  schools_secondary     integer,
  schools_untyped       integer,
  students_total        integer,
  students_male         integer,
  students_female       integer,
  staff_teaching        integer,
  staff_admin           integer,
  staff_professional    integer,
  staff_worker          integer,
  staff_guard           integer
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
    select s.id, s.school_type, d.governorate as gov
    from public.schools s
    join public.directorates d on d.id = s.directorate_id
    where s.archived_at is null
  ),
  sc as (
    select sch.gov as g,
           count(*)::int                                                 as c_total,
           count(*) filter (where sch.school_type = 'primary')::int       as c_prim,
           count(*) filter (where sch.school_type = 'preparatory')::int   as c_prep,
           count(*) filter (where sch.school_type = 'secondary')::int     as c_sec,
           count(*) filter (where sch.school_type is null)::int           as c_untyped
    from sch group by sch.gov
  ),
  stu as (
    select sch.gov as g,
           count(*)::int                                        as c_total,
           count(*) filter (where st.gender = 'male')::int       as c_male,
           count(*) filter (where st.gender = 'female')::int     as c_female
    from public.students st
    join sch on sch.id = st.school_id
    where st.is_active
    group by sch.gov
  ),
  stf as (
    select sch.gov as g,
           count(*) filter (where sr.staff_type = 'teaching')::int     as c_teaching,
           count(*) filter (where sr.staff_type = 'admin')::int        as c_admin,
           count(*) filter (where sr.staff_type = 'professional')::int as c_professional,
           count(*) filter (where sr.staff_type = 'worker')::int       as c_worker,
           count(*) filter (where sr.staff_type = 'guard')::int        as c_guard
    from public.staff_records sr
    join sch on sch.id = sr.school_id
    where sr.active
    group by sch.gov
  )
  select sc.g,
         sc.c_total, sc.c_prim, sc.c_prep, sc.c_sec, sc.c_untyped,
         coalesce(stu.c_total, 0), coalesce(stu.c_male, 0), coalesce(stu.c_female, 0),
         coalesce(stf.c_teaching, 0), coalesce(stf.c_admin, 0),
         coalesce(stf.c_professional, 0), coalesce(stf.c_worker, 0),
         coalesce(stf.c_guard, 0)
  from sc
  left join stu on stu.g = sc.g
  left join stf on stf.g = sc.g
  order by sc.g;
end; $$;

alter function public.get_ministry_governorate_stats() owner to postgres;
revoke all on function public.get_ministry_governorate_stats() from public, anon;
grant execute on function public.get_ministry_governorate_stats() to authenticated;
comment on function public.get_ministry_governorate_stats() is
  'إحصاء كل محافظة وطنياً: المدارس بالنوع والطلاب بالجنس والكادر بالفئة.';

-- ── الوزارة: صفٌّ لكل مدرسة داخل محافظة (التنقيب) ──────────────────────────
create or replace function public.get_ministry_school_stats(p_governorate text default null)
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
  staff_guard         integer
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
      -- معاملٌ فارغ يعني «كل القُطر»: الوزارة ترى الكلّ افتراضاً.
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
  )
  select sch.id, sch.name, sch.school_type, sch.dir_name, sch.gov,
         coalesce(stu.c_total, 0), coalesce(stu.c_male, 0), coalesce(stu.c_female, 0),
         coalesce(stf.c_teaching, 0), coalesce(stf.c_admin, 0),
         coalesce(stf.c_professional, 0), coalesce(stf.c_worker, 0),
         coalesce(stf.c_guard, 0)
  from sch
  left join stu on stu.sid = sch.id
  left join stf on stf.sid = sch.id
  order by sch.name;
end; $$;

alter function public.get_ministry_school_stats(text) owner to postgres;
revoke all on function public.get_ministry_school_stats(text) from public, anon;
grant execute on function public.get_ministry_school_stats(text) to authenticated;
comment on function public.get_ministry_school_stats(text) is
  'إحصاء مدارس محافظةٍ بعينها (أو القُطر كلّه إن كان المعامل فارغاً) للتنقيب من لوحة الوزارة.';
