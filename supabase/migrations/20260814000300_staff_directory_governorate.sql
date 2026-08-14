-- ════════════════════════════════════════════════════════════════════════════
--  دليل الكادر: ترشيحٌ بالمحافظة للوزارة.
--
--  الدالة السابقة تُرشِّح بمدرسةٍ واحدة، وهو ما يكفي المديرية. أما الوزارة
--  فقائمةُ مدارسها بالآلاف، ووحدةُ عملها المحافظة لا المدرسة — والمتطلَّب
--  أن ترى الوزارةُ أكثرَ من المديرية لا أقلّ.
--
--  إضافة معاملٍ تُبدّل التوقيع، وcreate or replace لا يبدّله؛ والإبقاء على
--  الصيغتين يُنشئ حِملاً زائداً يجعل النداء ملتبساً. فتُسقَط القديمة صراحةً.
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.get_staff_directory(uuid, text, text, integer, integer);

create function public.get_staff_directory(
  p_school_id   uuid    default null,
  p_staff_type  text    default null,
  p_search      text    default null,
  p_limit       integer default 100,
  p_offset      integer default 0,
  p_governorate text    default null
)
returns table(
  id                    uuid,
  school_id             uuid,
  school_name           text,
  directorate_name      text,
  governorate           text,
  staff_type            text,
  full_name             text,
  mother_name           text,
  national_id           text,
  gender                text,
  birth_date            date,
  certificate           text,
  higher_degree         text,
  specialization        text,
  subject_taught        text,
  teaching_rank         text,
  teaching_hours        integer,
  seniority_year        integer,
  job_title             text,
  start_date            date,
  phone                 text,
  landline              text,
  residential_zone      text,
  educational_zone      text,
  roster_type           text,
  ministerial_doc       text,
  self_number           text,
  general_number        text,
  assigned_grade        text,
  assigned_section      text,
  total_count           bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_role   text;
  v_school uuid;
  v_dir    uuid;
  v_lim    integer;
  v_off    integer;
  v_q      text;
  v_gov    text;
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
  -- ترشيحُ المحافظة للوزارة وحدها. تمريرُه من مديريةٍ لا يوسّع نطاقها — النطاق
  -- يبقى محكوماً بالدور أدناه — لكن تجاهُله صراحةً أوضح من تركه يتقاطع.
  v_gov := case when v_role = 'ministry_user'
                then nullif(btrim(coalesce(p_governorate, '')), '') end;

  return query
  with scope as (
    select s.id, s.name, d.name as dir_name, d.governorate as gov
    from public.schools s
    join public.directorates d on d.id = s.directorate_id
    where s.archived_at is null
      and case v_role
            when 'school_admin'     then s.id = v_school
            when 'directorate_user' then s.directorate_id = v_dir
            else true                                     -- ministry_user
          end
      and (p_school_id is null or s.id = p_school_id)
      and (v_gov is null or d.governorate = v_gov)
  ),
  hits as (
    select sr.*, scope.name as sch_name, scope.dir_name as d_name, scope.gov as g_name,
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
  select hits.id, hits.school_id, hits.sch_name, hits.d_name, hits.g_name,
         hits.staff_type, hits.full_name, hits.mother_name, hits.national_id,
         hits.gender, hits.birth_date, hits.certificate, hits.higher_degree,
         hits.specialization, hits.subject_taught, hits.teaching_rank,
         hits.teaching_hours, hits.seniority_year, hits.job_title,
         hits.start_date, hits.phone, hits.landline, hits.residential_zone,
         hits.educational_zone, hits.roster_type, hits.ministerial_doc,
         hits.self_number, hits.general_number, hits.assigned_grade,
         hits.assigned_section, hits.n_total
  from hits;
end; $$;

alter function public.get_staff_directory(uuid, text, text, integer, integer, text) owner to postgres;
revoke all on function public.get_staff_directory(uuid, text, text, integer, integer, text) from public, anon;
grant execute on function public.get_staff_directory(uuid, text, text, integer, integer, text) to authenticated;
comment on function public.get_staff_directory(uuid, text, text, integer, integer, text) is
  'دليل الكادر بسجلّه المهنيّ الكامل، مُرقَّماً ومبحوثاً. النطاق بحسب الدور؛ p_governorate للوزارة وحدها.';

-- ── فهرس البحث بالاسم: محاولةٌ ثانية بمخطّطٍ صريح ──────────────────────────
-- المحاولة الأولى (20260814000200) قد تكون ابتُلعت: pg_trgm عند Supabase يقيم
-- في مخطّط extensions، فلا يُحلّ gin_trgm_ops من search_path='public' الذي
-- تفرضه الدالة. هنا يُوسَّع المسار داخل الكتلة قبل التنفيذ. وif not exists
-- يجعلها بلا أثرٍ إن كان الفهرس قد أُنشئ فعلاً.
do $$
begin
  execute 'set local search_path = public, extensions';
  execute 'create index if not exists staff_records_name_trgm '
       || 'on public.staff_records using gin (public.ar_norm(full_name) gin_trgm_ops)';
  raise notice 'فهرس البحث بالاسم جاهز.';
exception when others then
  raise warning 'تعذّر إنشاء فهرس البحث بالاسم (%). البحث يعمل بمسحٍ تسلسليّ.', sqlerrm;
end $$;
