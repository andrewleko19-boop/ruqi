-- ════════════════════════════════════════════════════════════════════════════
--  سجلُّ الإجازات: يُدخَل فيُرى — في المدرسة والمديرية والوزارة.
--
--  الإجازة تُسجَّل اليوم في نافذةٍ تخصّ موظّفاً واحداً، ولا تُقرأ إلا من النافذة
--  نفسها. فلا يوجد في التطبيق كلِّه موضعٌ يقول «كم إجازةً في مدرستي هذا الشهر»
--  — يفتح المديرُ سبعين نافذة ليعرف، فلا يفتح. والمديرية والوزارة لا تريان
--  شيئاً ألبتّة: RLS تسمح لمستخدم المديرية بالقراءة نظريّاً ولا واجهةَ تقرأ،
--  والوزارة بلا سياسةٍ أصلاً.
--
--  والنتيجة أنّ بياناً يُدخله المديرُ بيده كلَّ شهر لا يصل أحداً ولا يُبنى عليه
--  قرار — وهو أوّلُ ما يُسأل عنه عند نقص الكادر.
--
--  دالّتان SECURITY DEFINER، والنطاق يُشتقّ من الدور لا من المعاملات:
--   · get_leaves_register — سطرٌ لكلّ إجازة باسم صاحبها.
--   · get_leaves_summary  — مجاميع: للمديرية بمدارسها، وللوزارة بمحافظاتها.
--
--  الأسماء تظهر لمن يملك رؤيتها أصلاً: مديرُ المدرسة كادرَه، والمديريةُ كادرَ
--  مدارسها — وكلاهما يقرؤهما اليوم في «دليل الكادر». والوزارة لا تحتاج أسماء
--  على مستوى القطر، فتقرأ المجاميع وحدها ولا يُعاد إليها سطرٌ باسم.
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.get_leaves_register(smallint, smallint, uuid);

create or replace function public.get_leaves_register(
  p_month     smallint,
  p_year      smallint,
  p_school_id uuid default null
) returns table(
  leave_id    uuid,
  staff_id    uuid,
  full_name   text,
  staff_type  text,
  school_id   uuid,
  school_name text,
  leave_type  text,
  leave_days  integer,
  note        text
) language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_school uuid;
  v_dir uuid;
begin
  select u.role::text, u.school_id, u.directorate_id
    into v_role, v_school, v_dir
    from public.users u where u.id = auth.uid();

  if v_role is null then raise exception 'غير مصرّح' using errcode = '42501'; end if;

  -- الوزارة لا تقرأ أسماء الكادر على مستوى القطر: لها المجاميع.
  if v_role not in ('school_admin', 'directorate_user') then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;

  return query
  select sl.id, sl.staff_id,
         coalesce(sr.full_name, '—')::text,
         coalesce(sr.staff_type, '')::text,
         sl.school_id, sc.name::text,
         sl.leave_type::text, sl.leave_days, sl.note::text
    from public.staff_leaves sl
    join public.schools sc on sc.id = sl.school_id
    left join public.staff_records sr on sr.id = sl.staff_id
   where sl.month = p_month
     and sl.year  = p_year
     -- النطاق من الدور: معرّفُ مدرسةٍ أجنبية يُفرِغ النتيجة ولا يوسّعها.
     and case v_role
           when 'school_admin'      then sl.school_id = v_school
           when 'directorate_user'  then sc.directorate_id = v_dir
           else false
         end
     and (p_school_id is null or sl.school_id = p_school_id)
   order by sc.name, sr.full_name
   limit 2000;
end; $$;

alter function public.get_leaves_register(smallint, smallint, uuid) owner to postgres;
revoke all on function public.get_leaves_register(smallint, smallint, uuid) from public, anon;
grant execute on function public.get_leaves_register(smallint, smallint, uuid)
  to authenticated, service_role;


drop function if exists public.get_leaves_summary(smallint, smallint);

create or replace function public.get_leaves_summary(
  p_month smallint,
  p_year  smallint
) returns table(
  scope_id     uuid,
  scope_label  text,
  staff_count  integer,
  leave_count  integer,
  total_days   integer,
  by_type      jsonb
) language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_school uuid;
  v_dir uuid;
begin
  select u.role::text, u.school_id, u.directorate_id
    into v_role, v_school, v_dir
    from public.users u where u.id = auth.uid();

  if v_role not in ('school_admin', 'directorate_user', 'ministry_user') then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;

  return query
  -- التجميع بحسب الدور: المدرسة ترى نفسها، والمديرية مدارسها، والوزارة
  -- محافظاتها. والمفتاح نصّيّ للمحافظة (لا معرّف لها) فيُعاد null في scope_id.
  with scoped as (
    select sl.staff_id, sl.leave_type, sl.leave_days,
           case when v_role = 'ministry_user' then null else sl.school_id end as gid,
           case when v_role = 'ministry_user' then d.governorate else sc.name end as glabel
      from public.staff_leaves sl
      join public.schools sc      on sc.id = sl.school_id
      join public.directorates d  on d.id  = sc.directorate_id
     where sl.month = p_month and sl.year = p_year
       and case v_role
             when 'school_admin'     then sl.school_id = v_school
             when 'directorate_user' then sc.directorate_id = v_dir
             else true                       -- الوزارة: القطر كلّه
           end
  ),
  -- ⚠ المجاميع وخريطةُ الأنواع تُحسبان في تجميعين منفصلين ثمّ تُضمّان.
  -- ضمُّهما في تجميعٍ واحد عبر lateral يضاعف الصفوف بعدد الأنواع: مدرسةٌ فيها
  -- إجازتان من نوعين تُحسب أربع إجازاتٍ وستّة عشر يوماً بدل ثمانية. ورقمٌ
  -- مضاعَفٌ في لوحة الوزارة أسوأ من غيابه: يُبنى عليه قرارُ نقصِ كادر.
  totals as (
    select gid, glabel,
           count(distinct staff_id)::int    as n_staff,
           count(*)::int                    as n_leaves,
           coalesce(sum(leave_days), 0)::int as n_days
      from scoped group by gid, glabel
  ),
  per_type as (
    select gid, glabel, jsonb_object_agg(leave_type, days) as types
      from (select gid, glabel, leave_type, sum(leave_days)::int as days
              from scoped group by gid, glabel, leave_type) x
     group by gid, glabel
  )
  select t.gid, t.glabel, t.n_staff, t.n_leaves, t.n_days,
         coalesce(p.types, '{}'::jsonb)
    from totals t
    left join per_type p
           on p.glabel = t.glabel and p.gid is not distinct from t.gid
   order by t.n_days desc, t.glabel;
end; $$;

alter function public.get_leaves_summary(smallint, smallint) owner to postgres;
revoke all on function public.get_leaves_summary(smallint, smallint) from public, anon;
grant execute on function public.get_leaves_summary(smallint, smallint)
  to authenticated, service_role;

notify pgrst, 'reload schema';
