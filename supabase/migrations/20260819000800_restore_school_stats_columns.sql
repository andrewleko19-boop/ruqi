-- ════════════════════════════════════════════════════════════════════════════
--  عشرةُ أعمدةٍ سقطت من توقيع دالّتَي الإحصاء — فقرأت اللوحاتُ أصفاراً.
--
--  هجرةُ `20260817000000_rename_teaching_hours_to_weekly_lessons` كان غرضُها
--  المكتوبُ في تعليقها: «نُعيدهما دون تغييرٍ في السلوك: اسم العمود وحده». لكنّها
--  كُتبت من الذاكرة لا اشتقاقاً من النسخة القائمة، فخرجت بتوقيعٍ آخر:
--
--      get_directorate_school_stats:  ١٤ عموداً  →  ٧
--      get_ministry_school_stats:     ١٥ عموداً  →  ٨
--
--  الساقط: school_type، students_total/male/female/unknown، وكلُّ
--  staff_teaching/admin/professional/worker/guard.
--
--  والواجهةُ تجمع في المتصفّح: `structStats.reduce((t,s) => t + (Number(s[k])||0), 0)`
--  فالعمودُ الغائب undefined، و Number(undefined)||0 = صفر. لا خطأَ يُرمى ولا
--  سطرَ في سجلّ — بطاقةٌ كاملةٌ تكتب أصفاراً وهي واثقة.
--
--  والدليلُ القاطع أنّ «بلا نوع محدّد» ساوى عددَ المدارس كلَّها: عمود
--  schools.school_type معرَّف NOT NULL DEFAULT 'primary' بقيد CHECK، فقيمةٌ
--  فارغةٌ مستحيلةٌ في البيانات — ولا تفسيرَ إلّا غيابُ العمود عن الاستجابة.
--  ونجا عمودا النصاب وحدهما من الحذف، فبقيا يعرضان رقماً بينما جيرانُهما صفر.
--
--  الاستعادةُ هنا **ليست نسخاً أعمى** عن ٢٠٢٦٠٨١٤: فيها تصحيحان مقصودان.
--
--   ١) sr.teaching_hours ← sr.weekly_lessons — وهو سببُ هجرة ٠٨‑١٧ الأصليّ،
--      ولا يجوز إسقاطُه ونحن نُصلح ما أفسدَته.
--
--   ٢) عمودا النصاب يُشتقّان من **سلطتهما** لا من حقلٍ في سجلّ الشخص. هجرة
--      `20260819000100_quota_from_authority_not_default` قرّرت صراحةً أنّ
--      staff_records.weekly_lessons «لم يعد يصلح حَكَماً على نفسه» — فهو حصصُ
--      الشخص المسجَّلة، لا نصابٌ قرّرته جهة. والنصابُ الفعليّ:
--          coalesce(schools.quota_max_lessons, teaching_quota_bounds.max_lessons)
--      كما تفعل get_teaching_load بالضبط. وإبقاءُ الدالّتين على المصدر المُبطَل
--      كان سيُبقي في اللوحتين رقماً لا صاحبَ له.
--
--      ⚠️ أثرٌ متوقَّعٌ لا عطل: ما دامت الوزارة لم تضبط الحدَّ الوطنيّ (فرَّغته
--      تلك الهجرة عمداً)، يصير «بلا نصاب محدّد» = عددَ المعلّمين كلِّهم. وهي
--      الحقيقةُ الصادقة: لا جهةَ حدّدت النصاب بعد.
--
--  وتُحذف الشيفرةُ الميتة من نسخة ٠٨‑١٧: qta CTE كانت تُحسب ولا تُقرأ، وعمودُ
--  ‎_reserved‎ لاغٍ — أثرُ التجميع لا الاشتقاق.
--
--  تغيّرُ نوع الإرجاع يوجب DROP: `create or replace` لا يبدّل التوقيع.
-- ════════════════════════════════════════════════════════════════════════════

-- ── إحصاءات المديرية ────────────────────────────────────────────────────────
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
language plpgsql stable security definer set search_path = public as $$
declare
  v_dir     uuid;
  v_nat_max integer;
begin
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.is_active
    and u.role = 'directorate_user'::public.user_role;

  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  -- الحدُّ الوطنيّ مرجعٌ واحدٌ للجميع؛ فارغٌ يعني أنّ الوزارة لم تحدّده.
  select b.max_lessons into v_nat_max from public.teaching_quota_bounds b limit 1;

  return query
  with sch as (
    select s.id, s.name, s.school_type,
           -- النصاب من سلطته: قرارُ المدرسة أوّلاً، فالوطنيّ، وإلّا لا شيء.
           coalesce(s.quota_max_lessons, v_nat_max) as eff_max
    from public.schools s
    where s.directorate_id = v_dir and s.archived_at is null
  ),
  stu as (
    select st.school_id as sid,
           count(*)::int                                    as c_total,
           count(*) filter (where st.gender = 'male')::int   as c_male,
           count(*) filter (where st.gender = 'female')::int as c_female,
           count(*) filter (where st.gender is null)::int    as c_unknown
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
           count(*) filter (where sch.eff_max is not null
                              and coalesce(ld.total, 0) > sch.eff_max)::int as c_over,
           count(*) filter (where sch.eff_max is null)::int                 as c_noquota
    from public.staff_records sr
    join sch on sch.id = sr.school_id
    left join ld on ld.sid = sr.id
    where sr.active and sr.staff_type = 'teaching'
    -- eff_max في GROUP BY: التبعيةُ الوظيفية لا تُستنتج من CTE بلا مفتاحٍ معلوم.
    group by sr.school_id, sch.eff_max
  )
  select sch.id, sch.name, sch.school_type,
         coalesce(stu.c_total, 0),   coalesce(stu.c_male, 0),
         coalesce(stu.c_female, 0),  coalesce(stu.c_unknown, 0),
         coalesce(stf.c_teaching, 0),     coalesce(stf.c_admin, 0),
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
  'إحصاء كل مدرسة في مديرية المستدعي: الطلاب بالجنس والكادر بالفئة، والنصاب من سلطته (تجاوز المدرسة ← الحدّ الوطنيّ).';


-- ── إحصاءات الوزارة ─────────────────────────────────────────────────────────
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
language plpgsql stable security definer set search_path = public as $$
declare
  v_nat_max integer;
begin
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.is_active
      and u.role = 'ministry_user'::public.user_role
  ) then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي الوزارة فقط';
  end if;

  select b.max_lessons into v_nat_max from public.teaching_quota_bounds b limit 1;

  return query
  with sch as (
    select s.id, s.name, s.school_type,
           d.name as dir_name, d.governorate as gov,
           coalesce(s.quota_max_lessons, v_nat_max) as eff_max
    from public.schools s
    join public.directorates d on d.id = s.directorate_id
    where s.archived_at is null
      and (p_governorate is null or d.governorate = p_governorate)
  ),
  stu as (
    select st.school_id as sid,
           count(*)::int                                    as c_total,
           count(*) filter (where st.gender = 'male')::int   as c_male,
           count(*) filter (where st.gender = 'female')::int as c_female
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
           count(*) filter (where sch.eff_max is not null
                              and coalesce(ld.total, 0) > sch.eff_max)::int as c_over,
           count(*) filter (where sch.eff_max is null)::int                 as c_noquota
    from public.staff_records sr
    join sch on sch.id = sr.school_id
    left join ld on ld.sid = sr.id
    where sr.active and sr.staff_type = 'teaching'
    group by sr.school_id, sch.eff_max
  )
  select sch.id, sch.name, sch.school_type, sch.dir_name, sch.gov,
         coalesce(stu.c_total, 0), coalesce(stu.c_male, 0), coalesce(stu.c_female, 0),
         coalesce(stf.c_teaching, 0),     coalesce(stf.c_admin, 0),
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
  'إحصاء مدارس محافظةٍ بعينها (أو القُطر كلّه): الطلاب بالجنس والكادر بالفئة، والنصاب من سلطته.';
