-- ════════════════════════════════════════════════════════════════════════════
--  «عدد الساعات» كذبةٌ على الاستعمال — الحقلُ يحمل عددَ حصصٍ أسبوعية.
--
--  الاسم `teaching_hours` كُتب أوّلَ الأمر على أنّه ساعات، لكنّ الاستعمال
--  الفعليّ خالفه: `get_teaching_load` تجمع `staff_assignments.lesson_count`
--  (حصصاً) ثمّ تقارنها بـ`teaching_hours`. فمقارنةُ حصصٍ بساعاتٍ باسم واحد،
--  والمدير يقرأ «ساعات» ويكتب حصصاً — ثمّ يُبنى على هذا تنبيهُ التجاوز
--  وتقاريرُ المديرية ونصابُ القطر.
--
--  والحدود الافتراضية (١٢–٢٤) تناسب الحصصَ أصلاً بالمصادفة، فلا رقمَ زُرع
--  يتغيّر — يتغيّر اسمُه لا قيمتُه ولا شيءٌ في السلوك.
--
--  RENAME COLUMN وحده: postgres يُعيد كتابة كلّ الفهارس والقيود والاعتماديّات
--  آلياً. الدوالُّ التي تنصّ على الاسم القديم تُعاد بلا تغييرٍ في السلوك —
--  السطرُ الوحيد المتغيّر فيها اسمُ العمود.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.staff_records
  rename column teaching_hours to weekly_lessons;
comment on column public.staff_records.weekly_lessons is
  'عدد الحصص الأسبوعية للمعلّم — النصاب الذي يقارَن به مجموع lesson_count في تكاليفه.';

alter table public.schools rename column quota_min_hours to quota_min_lessons;
alter table public.schools rename column quota_max_hours to quota_max_lessons;
comment on column public.schools.quota_min_lessons is
  'تجاوزٌ اختياريّ للحدّ الأدنى الوطنيّ (حصصاً). فارغ = اتبع teaching_quota_bounds.';
comment on column public.schools.quota_max_lessons is
  'تجاوزٌ اختياريّ للحدّ الأعلى الوطنيّ (حصصاً). فارغ = اتبع teaching_quota_bounds.';

alter table public.teaching_quota_bounds rename column min_hours to min_lessons;
alter table public.teaching_quota_bounds rename column max_hours to max_lessons;

alter table public.teaching_quota_bounds
  drop constraint if exists teaching_quota_bounds_range;
alter table public.teaching_quota_bounds
  add constraint teaching_quota_bounds_range
  check (min_lessons >= 0 and max_lessons >= min_lessons);
comment on column public.teaching_quota_bounds.min_lessons is
  'أدنى عدد حصصٍ أسبوعية يقبله النصاب الوطنيّ.';
comment on column public.teaching_quota_bounds.max_lessons is
  'أعلى عدد حصصٍ أسبوعية يقبله النصاب الوطنيّ.';

-- ── إعادةُ الدالّة بلا تغييرٍ في السلوك، فقط اسم العمود ─────────────────────
create or replace function public.get_teaching_load(p_school_id uuid default null)
returns table(
  staff_id     uuid,
  full_name    text,
  school_id    uuid,
  school_name  text,
  quota        integer,
  assigned     integer,
  excess       integer
) language plpgsql stable security definer set search_path = public as $$
declare
  v_role   text;
  v_school uuid;
  v_dir    uuid;
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
            else true
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
           sr.weekly_lessons              as r_quota,   -- كان teaching_hours
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

-- ── دوالّ إحصاءات المديرية والوزارة تعدّ «عبَر النصاب» أو «بلا نصاب» ─────────
--  كلاهما تعتمد على `sr.teaching_hours` — الاسم القديم — في `count(*) filter`.
--  نُعيدهما دون تغييرٍ في السلوك: اسم العمود وحده.

drop function if exists public.get_directorate_school_stats();
create or replace function public.get_directorate_school_stats()
returns table(
  school_id           uuid,
  school_name         text,
  students_active     integer,
  students_new_month  integer,
  teachers_active     integer,
  teachers_over_quota integer,
  teachers_no_quota   integer
) language plpgsql stable security definer set search_path = public as $$
declare v_dir uuid;
begin
  select u.directorate_id into v_dir
    from public.users u where u.id = auth.uid() and u.is_active
      and u.role = 'directorate_user'::public.user_role;
  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة للمديرية';
  end if;

  return query
  with scope as (
    select s.id as sid, s.name as sname
      from public.schools s
     where s.directorate_id = v_dir and s.archived_at is null
  ),
  stu as (
    select st.school_id,
           count(*) filter (where st.is_active)::int              as active,
           count(*) filter (where st.is_active and st.created_at >= date_trunc('month', current_date))::int as new_month
      from public.students st group by st.school_id
  ),
  tch as (
    select sr.school_id,
           count(*) filter (where sr.staff_type = 'teaching' and sr.active)::int as active
      from public.staff_records sr group by sr.school_id
  ),
  qta as (
    select sr.school_id,
           sum(coalesce(sa.lesson_count, 0))::int                                as total_assigned,
           count(*) filter (where sr.weekly_lessons is not null
                                  and coalesce(sa.lesson_count, 0) > 0)::int    as with_load,
           count(*) filter (where sr.weekly_lessons is null)::int                as c_noquota,
           count(distinct case when sr.weekly_lessons is not null
                                     and sr.weekly_lessons < 0 then null end)   as _reserved
      from public.staff_records sr
      left join public.staff_assignments sa
             on sa.staff_id = sr.id and sa.active
     where sr.active and sr.staff_type = 'teaching'
     group by sr.school_id
  ),
  qta_over as (
    select sr.school_id,
           count(*) filter (where sr.weekly_lessons is not null
                                  and (select coalesce(sum(sa.lesson_count),0)
                                         from public.staff_assignments sa
                                        where sa.staff_id = sr.id and sa.active) > sr.weekly_lessons)::int as c_over,
           count(*) filter (where sr.weekly_lessons is null)::int                as c_noquota
      from public.staff_records sr
     where sr.active and sr.staff_type = 'teaching'
     group by sr.school_id
  )
  select sc.sid, sc.sname,
         coalesce(stu.active, 0), coalesce(stu.new_month, 0),
         coalesce(tch.active, 0),
         coalesce(qta_over.c_over, 0), coalesce(qta_over.c_noquota, 0)
    from scope sc
    left join stu on stu.school_id = sc.sid
    left join tch on tch.school_id = sc.sid
    left join qta_over on qta_over.school_id = sc.sid
   order by sc.sname;
end; $$;

alter function public.get_directorate_school_stats() owner to postgres;
revoke all on function public.get_directorate_school_stats() from public, anon;
grant execute on function public.get_directorate_school_stats() to authenticated;

drop function if exists public.get_ministry_school_stats(text);
create or replace function public.get_ministry_school_stats(p_governorate text default null)
returns table(
  school_id           uuid,
  school_name         text,
  directorate_name    text,
  governorate         text,
  students_active     integer,
  teachers_active     integer,
  teachers_over_quota integer,
  teachers_no_quota   integer
) language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  select u.role::text into v_role
    from public.users u where u.id = auth.uid() and u.is_active;
  if v_role <> 'ministry_user' then
    raise exception 'غير مصرّح: هذه الدالة للوزارة';
  end if;

  return query
  with scope as (
    select s.id as sid, s.name as sname, d.name as dname, d.governorate as gov
      from public.schools s
      join public.directorates d on d.id = s.directorate_id
     where s.archived_at is null
       and (p_governorate is null or d.governorate = p_governorate)
  ),
  stu as (
    select st.school_id, count(*) filter (where st.is_active)::int as active
      from public.students st group by st.school_id
  ),
  tch as (
    select sr.school_id,
           count(*) filter (where sr.staff_type = 'teaching' and sr.active)::int as active,
           count(*) filter (where sr.staff_type = 'teaching' and sr.active
                                  and sr.weekly_lessons is not null
                                  and (select coalesce(sum(sa.lesson_count),0)
                                         from public.staff_assignments sa
                                        where sa.staff_id = sr.id and sa.active) > sr.weekly_lessons)::int as c_over,
           count(*) filter (where sr.staff_type = 'teaching' and sr.active
                                  and sr.weekly_lessons is null)::int as c_noquota
      from public.staff_records sr group by sr.school_id
  )
  select sc.sid, sc.sname, sc.dname, sc.gov,
         coalesce(stu.active, 0),
         coalesce(tch.active, 0),
         coalesce(tch.c_over, 0), coalesce(tch.c_noquota, 0)
    from scope sc
    left join stu on stu.school_id = sc.sid
    left join tch on tch.school_id = sc.sid
   order by sc.sname;
end; $$;

alter function public.get_ministry_school_stats(text) owner to postgres;
revoke all on function public.get_ministry_school_stats(text) from public, anon;
grant execute on function public.get_ministry_school_stats(text) to authenticated;

-- ── دوالّ الدليل تُرجع الاسم الجديد في التوقيع ──────────────────────────────
--  تغييرُ نوع الإرجاع يوجب DROP+CREATE — لا يبدّله create or replace.
--  السلوك واحد؛ العمود المُرجَع يحمل الاسم الجديد فقط.

drop function if exists public.get_staff_directory(uuid, text, text, integer, integer);
create or replace function public.get_staff_directory(
  p_school_id  uuid    default null,
  p_staff_type text    default null,
  p_search     text    default null,
  p_limit      integer default 100,
  p_offset     integer default 0
)
returns table(
  id uuid, school_id uuid, school_name text, directorate_name text,
  staff_type text, full_name text, mother_name text, national_id text,
  gender text, birth_date date, certificate text, higher_degree text,
  specialization text, subject_taught text, teaching_rank text,
  weekly_lessons integer,   -- كان teaching_hours
  seniority_year integer, job_title text, start_date date, phone text,
  landline text, residential_zone text, educational_zone text,
  roster_type text, ministerial_doc text, self_number text,
  general_number text, assigned_grade text, assigned_section text,
  total_count bigint
) language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_school uuid; v_dir uuid;
  v_lim integer; v_off integer; v_q text;
begin
  select u.role::text, u.school_id, u.directorate_id
    into v_role, v_school, v_dir
    from public.users u where u.id = auth.uid() and u.is_active;
  if v_role not in ('school_admin', 'directorate_user', 'ministry_user') then
    raise exception 'غير مصرّح: هذه الدالة للمدرسة أو المديرية أو الوزارة';
  end if;
  v_lim := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_off := greatest(coalesce(p_offset, 0), 0);
  v_q   := nullif(btrim(coalesce(p_search, '')), '');

  return query
  with scope as (
    select s.id, s.name, d.name as dir_name
      from public.schools s
      join public.directorates d on d.id = s.directorate_id
     where s.archived_at is null
       and case v_role
             when 'school_admin'     then s.id = v_school
             when 'directorate_user' then s.directorate_id = v_dir
             else true
           end
       and (p_school_id is null or s.id = p_school_id)
  ),
  hits as (
    select sr.*, scope.name as sch_name, scope.dir_name as d_name,
           count(*) over () as n_total
      from public.staff_records sr
      join scope on scope.id = sr.school_id
     where sr.active
       and (p_staff_type is null or sr.staff_type = p_staff_type)
       and (v_q is null
            or public.ar_norm(sr.full_name) like '%' || public.ar_norm(v_q) || '%'
            or sr.national_id  like '%' || v_q || '%'
            or sr.self_number  like '%' || v_q || '%')
     order by scope.name, sr.staff_type, sr.full_name
     limit v_lim offset v_off
  )
  select hits.id, hits.school_id, hits.sch_name, hits.d_name,
         hits.staff_type, hits.full_name, hits.mother_name, hits.national_id,
         hits.gender, hits.birth_date, hits.certificate, hits.higher_degree,
         hits.specialization, hits.subject_taught, hits.teaching_rank,
         hits.weekly_lessons,          -- كان teaching_hours
         hits.seniority_year, hits.job_title,
         hits.start_date, hits.phone, hits.landline, hits.residential_zone,
         hits.educational_zone, hits.roster_type, hits.ministerial_doc,
         hits.self_number, hits.general_number, hits.assigned_grade,
         hits.assigned_section, hits.n_total
  from hits;
end; $$;

alter function public.get_staff_directory(uuid, text, text, integer, integer) owner to postgres;
revoke all on function public.get_staff_directory(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.get_staff_directory(uuid, text, text, integer, integer) to authenticated;

-- ── والصيغة التي تقبل p_governorate (للوزارة) ───────────────────────────────
drop function if exists public.get_staff_directory(uuid, text, text, integer, integer, text);
create or replace function public.get_staff_directory(
  p_school_id   uuid    default null,
  p_staff_type  text    default null,
  p_search      text    default null,
  p_limit       integer default 100,
  p_offset      integer default 0,
  p_governorate text    default null
)
returns table(
  id uuid, school_id uuid, school_name text, directorate_name text,
  governorate text,
  staff_type text, full_name text, mother_name text, national_id text,
  gender text, birth_date date, certificate text, higher_degree text,
  specialization text, subject_taught text, teaching_rank text,
  weekly_lessons integer,   -- كان teaching_hours
  seniority_year integer, job_title text, start_date date, phone text,
  landline text, residential_zone text, educational_zone text,
  roster_type text, ministerial_doc text, self_number text,
  general_number text, assigned_grade text, assigned_section text,
  total_count bigint
) language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_school uuid; v_dir uuid; v_lim integer; v_off integer; v_q text;
begin
  select u.role::text, u.school_id, u.directorate_id
    into v_role, v_school, v_dir
    from public.users u where u.id = auth.uid() and u.is_active;
  if v_role not in ('school_admin', 'directorate_user', 'ministry_user') then
    raise exception 'غير مصرّح: هذه الدالة للمدرسة أو المديرية أو الوزارة';
  end if;
  -- p_governorate يعملُ للوزارة وحدها — تمريره من غيرها لا يوسّع النطاق (لا
  -- يُرمى، إنّما يُتجاهل: سلوكُ الصيغة الأولى نفسه، النطاق يبقى بحسب الدور).
  if v_role <> 'ministry_user' then p_governorate := null; end if;
  v_lim := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_off := greatest(coalesce(p_offset, 0), 0);
  v_q   := nullif(btrim(coalesce(p_search, '')), '');

  return query
  with scope as (
    select s.id, s.name, d.name as dir_name, d.governorate as g_name
      from public.schools s
      join public.directorates d on d.id = s.directorate_id
     where s.archived_at is null
       and case v_role
             when 'school_admin'     then s.id = v_school
             when 'directorate_user' then s.directorate_id = v_dir
             else true
           end
       and (p_governorate is null or d.governorate = p_governorate)
       and (p_school_id  is null or s.id           = p_school_id)
  ),
  hits as (
    select sr.*, scope.name as sch_name, scope.dir_name as d_name,
           scope.g_name as g_name, count(*) over () as n_total
      from public.staff_records sr
      join scope on scope.id = sr.school_id
     where sr.active
       and (p_staff_type is null or sr.staff_type = p_staff_type)
       and (v_q is null
            or public.ar_norm(sr.full_name) like '%' || public.ar_norm(v_q) || '%'
            or sr.national_id  like '%' || v_q || '%'
            or sr.self_number  like '%' || v_q || '%')
     order by scope.name, sr.staff_type, sr.full_name
     limit v_lim offset v_off
  )
  select hits.id, hits.school_id, hits.sch_name, hits.d_name, hits.g_name,
         hits.staff_type, hits.full_name, hits.mother_name, hits.national_id,
         hits.gender, hits.birth_date, hits.certificate, hits.higher_degree,
         hits.specialization, hits.subject_taught, hits.teaching_rank,
         hits.weekly_lessons,          -- كان teaching_hours
         hits.seniority_year, hits.job_title,
         hits.start_date, hits.phone, hits.landline, hits.residential_zone,
         hits.educational_zone, hits.roster_type, hits.ministerial_doc,
         hits.self_number, hits.general_number, hits.assigned_grade,
         hits.assigned_section, hits.n_total
  from hits;
end; $$;

alter function public.get_staff_directory(uuid, text, text, integer, integer, text) owner to postgres;
revoke all on function public.get_staff_directory(uuid, text, text, integer, integer, text) from public, anon;
grant execute on function public.get_staff_directory(uuid, text, text, integer, integer, text) to authenticated;

notify pgrst, 'reload schema';
