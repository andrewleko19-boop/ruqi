-- ════════════════════════════════════════════════════════════════════════════
--  الطلاب المغادرون: مكانٌ لهم عابرٌ للصفوف، وكشفٌ للمديرية.
--
--  اليوم يظهرون شرائحَ داخل قائمة كلّ صفٍّ في المدرسة (transferred / graduated
--  / out_of_year / struck_off) — والمدير الذي يريد قائمةَ من غادروا هذا العام
--  يفتح كلّ صفٍّ على حدة. والمديرية لا ترى شيئاً ألبتّة، فلا يمكنها الإبلاغ عن
--  ظاهرة: مدرسةٌ يرتفع عندها الترقين، أو تنقّلات خارجية كثيرة.
--
--  دالّتان SECURITY DEFINER بنطاقٍ يُشتقّ من الدور، على منوال دوالّ الإحصاء
--  والدليل. لا تُقرأ students مباشرةً — كلّ منهما تختار الحقول التي تحتاجها
--  الواجهة فقط، بلا حقولٍ شخصيّة.
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.get_departed_students(uuid, text);

create or replace function public.get_departed_students(
  p_school_id uuid default null,
  p_status    text default null
) returns table(
  student_id       uuid,
  full_name        text,
  national_id      text,
  status           text,
  status_reason    text,
  status_changed_at timestamptz,
  class_id         uuid,
  class_label      text,
  grade            text,
  parent_phone     text
) language plpgsql stable security definer set search_path = public as $$
declare
  v_role text; v_school uuid; v_dir uuid;
begin
  select u.role::text, u.school_id, u.directorate_id
    into v_role, v_school, v_dir
    from public.users u where u.id = auth.uid() and u.is_active;

  if v_role not in ('school_admin', 'directorate_user') then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;

  -- students.status هو enum public.student_status لا نصّاً — لا ينفع الربطُ
  -- المباشر بالنصّ. نصبّه إلى text في المقارنة، والتصفية على القيمة النصّية.
  return query
  select s.id, s.full_name, s.national_id,
         coalesce(s.status::text, 'active'),
         s.status_reason::text,
         s.status_changed_at,
         c.id,
         coalesce(c.name, 'الصف ' || c.grade || ' / ' || c.section)::text,
         c.grade::text,
         s.parent_phone
    from public.students s
    left join public.classes c on c.id = s.class_id
    left join public.schools sc on sc.id = s.school_id
   where coalesce(s.status::text, 'active') <> 'active'
     and case v_role
           when 'school_admin'     then s.school_id = v_school
           when 'directorate_user' then sc.directorate_id = v_dir
           else false
         end
     and (p_school_id is null or s.school_id = p_school_id)
     and (p_status is null or coalesce(s.status::text, 'active') = p_status)
   order by s.status_changed_at desc nulls last, s.full_name
   limit 2000;
end; $$;

alter function public.get_departed_students(uuid, text) owner to postgres;
revoke all on function public.get_departed_students(uuid, text) from public, anon;
grant execute on function public.get_departed_students(uuid, text)
  to authenticated, service_role;


-- ── مجاميع المديرية بحسب المدرسة ─────────────────────────────────────────────
drop function if exists public.get_directorate_departures();

create or replace function public.get_directorate_departures()
returns table(
  school_id     uuid,
  school_name   text,
  transferred   integer,
  out_of_year   integer,
  graduated     integer,
  struck_off    integer,
  total_departed integer
) language plpgsql stable security definer set search_path = public as $$
declare v_dir uuid;
begin
  select u.directorate_id into v_dir
    from public.users u where u.id = auth.uid() and u.is_active
      and u.role = 'directorate_user'::public.user_role;
  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة للمديرية' using errcode = '42501';
  end if;

  -- المقارنة على النصّ لأنّ status enum؛ enum::text = literal لا يُنشئ التباس.
  return query
  select sc.id, sc.name::text,
         count(*) filter (where s.status::text = 'transferred')::int,
         count(*) filter (where s.status::text = 'out_of_year')::int,
         count(*) filter (where s.status::text = 'graduated')::int,
         count(*) filter (where s.status::text = 'struck_off')::int,
         count(*) filter (where coalesce(s.status::text, 'active') <> 'active')::int
    from public.schools sc
    left join public.students s on s.school_id = sc.id
   where sc.directorate_id = v_dir
     and sc.archived_at is null
   group by sc.id, sc.name
   order by count(*) filter (where coalesce(s.status::text, 'active') <> 'active') desc,
            sc.name;
end; $$;

alter function public.get_directorate_departures() owner to postgres;
revoke all on function public.get_directorate_departures() from public, anon;
grant execute on function public.get_directorate_departures()
  to authenticated, service_role;

notify pgrst, 'reload schema';
