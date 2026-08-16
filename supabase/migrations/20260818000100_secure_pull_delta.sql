-- ════════════════════════════════════════════════════════════════════════════
--  ⚠ حرِج: دوالُّ المزامنة الأربع كانت تُسلّم سجلَّ أيّ صفٍّ في القطر لأيّ مستخدم.
--
--  pull_students_delta / pull_grades_delta / pull_attendance_delta /
--  pull_conduct_delta كلُّها SECURITY DEFINER — تتجاوز RLS بالتصميم — وليس
--  فيها فحصُ صلاحيةٍ ألبتّة. تأخذ p_class_id وتُعيد كلَّ صفوفه.
--
--  و pull_students_delta ترجع `SETOF students`: الصفَّ كاملاً — الرقم الوطنيّ
--  واسم الأمّ وتاريخ الولادة وهاتف الأهل والعنوان بتفصيله. أُثبت الاستغلال
--  على قاعدةٍ محلّية: حسابُ وليّ أمرٍ لا صلةَ له بالصفّ قرأ عبر RLS **صفراً**،
--  ثمّ قرأ عبر الدالّة بيانات الطفل كاملةً.
--
--  والمهاجم أيُّ حسابٍ مصادَق: معلّمٌ في مدرسةٍ أخرى، أو وليُّ أمر. ولا يلزمه
--  إلّا معرّفُ صفّ — وهو ليس سرّاً: يظهر في روابط البوّابة وفي بيانات مصدَّرة.
--
--  الإصلاح: النطاق يُشتقّ من دور المُنادي لا من معامله — وهو المبدأ نفسه الذي
--  تحرسه tools/rls-audit/rpc-scope-test.mjs في بقيّة الدوالّ. المصرَّح لهم:
--   · معلّمُ الصفّ (teaches_class)
--   · مديرُ مدرسة الصفّ (class_in_my_school)
--   · موظّفُ المديرية التي تتبعها المدرسة
--   · الوزارة
--  وغيرُهم يُرَدّ بنتيجةٍ فارغة لا باستثناء: المزامنة تعمل في الخلفية، ورميُ
--  خطأٍ فيها يُوقف مزامنةَ الجداول الأخرى عند مستخدمٍ لا ذنب له.
-- ════════════════════════════════════════════════════════════════════════════

-- حارسٌ واحد يجمع الأدوار الأربعة، فلا يتفرّق الشرطُ على أربع دوالّ ثمّ يُصحَّح
-- في ثلاثٍ ويُنسى في الرابعة.
create or replace function public.may_sync_class(p_class_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.classes c
      join public.schools s on s.id = c.school_id
      left join public.users u on u.id = auth.uid()
     where c.id = p_class_id
       and (
         -- معلّم الصفّ نفسه
         exists (select 1 from public.class_teacher ct
                  where ct.class_id = c.id and ct.teacher_id = auth.uid())
         -- كادر مدرسة الصفّ (مديرها)
         or (u.school_id is not null and u.school_id = c.school_id)
         -- موظّف المديرية التي تتبعها المدرسة
         or (u.role = 'directorate_user'::public.user_role
             and u.directorate_id = s.directorate_id)
         -- الوزارة
         or u.role = 'ministry_user'::public.user_role
       )
  )
$$;

alter function public.may_sync_class(uuid) owner to postgres;
revoke all on function public.may_sync_class(uuid) from public, anon;
grant execute on function public.may_sync_class(uuid) to authenticated, service_role;

comment on function public.may_sync_class(uuid) is
  'هل يحقّ للمستدعي مزامنة بيانات هذا الصفّ؟ حارسُ دوالّ pull_*_delta.';


create or replace function public.pull_students_delta(p_class_id uuid, p_since timestamptz)
returns setof public.students
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.students
   where class_id = p_class_id
     and updated_at > p_since
     and public.may_sync_class(p_class_id)
   order by updated_at;
$$;

create or replace function public.pull_grades_delta(p_class_id uuid, p_since timestamptz)
returns setof public.student_grades
language sql stable security definer set search_path = public, pg_temp as $$
  select sg.*
    from public.student_grades sg
    join public.students s on s.id = sg.student_id
   where s.class_id = p_class_id
     and sg.updated_at > p_since
     and public.may_sync_class(p_class_id)
   order by sg.updated_at;
$$;

create or replace function public.pull_attendance_delta(p_class_id uuid, p_since timestamptz)
returns setof public.daily_student_attendance
language sql stable security definer set search_path = public, pg_temp as $$
  select da.*
    from public.daily_student_attendance da
    join public.students s on s.id = da.student_id
   where s.class_id = p_class_id
     and da.updated_at > p_since
     and public.may_sync_class(p_class_id)
   order by da.updated_at;
$$;

create or replace function public.pull_conduct_delta(p_class_id uuid, p_since timestamptz)
returns setof public.student_conduct
language sql stable security definer set search_path = public, pg_temp as $$
  select sc.*
    from public.student_conduct sc
    join public.students s on s.id = sc.student_id
   where s.class_id = p_class_id
     and sc.updated_at > p_since
     and public.may_sync_class(p_class_id)
   order by sc.updated_at;
$$;

do $$
declare f text;
begin
  foreach f in array array['pull_students_delta','pull_grades_delta',
                           'pull_attendance_delta','pull_conduct_delta'] loop
    execute format('alter function public.%I(uuid, timestamptz) owner to postgres', f);
    execute format('revoke all on function public.%I(uuid, timestamptz) from public, anon', f);
    execute format('grant execute on function public.%I(uuid, timestamptz) to authenticated, service_role', f);
  end loop;
end $$;

-- ── تشديدٌ ثانويّ: زنادات لا يجوز نداؤها مباشرةً ────────────────────────────
--  دوالُّ الزناد أُنشئت بلا REVOKE فورثت EXECUTE من PUBLIC. نداؤها مباشرةً
--  يفشل («trigger functions can only be called as triggers») فالأثر معدوم
--  عملياً، لكنّ سطحاً غيرَ لازمٍ يبقى سطحاً.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.prorettype = 'trigger'::regtype::oid
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
