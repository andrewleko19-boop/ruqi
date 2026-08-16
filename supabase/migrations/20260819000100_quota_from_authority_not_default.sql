-- ════════════════════════════════════════════════════════════════════════════
--  «النصاب ١٢» لم يضعه أحد — وكان يحكم على المعلّمين.
--
--  المدير يفتح تبويب الكوادر فيقرأ: «سناء — الحمل ١٦، النصاب ١٢، تجاوز ٤»
--  بلونٍ أحمر. فيسأل: مَن قال إنّ نصابها ١٢؟ لا الوزارة ولا هو.
--
--  مصدران للرقم، وكلاهما مغلوط:
--
--   ١) get_teaching_load كانت تأخذ النصاب من staff_records.weekly_lessons —
--      حقلٌ في سجلّ الشخص نفسه. فالمقارنة صارت «حِملُه مقابل رقمٍ كُتب في
--      خانته»، لا مقابل نصابٍ قرّرته جهةٌ لها صلاحية. ومَن كتب الرقم أصلاً؟
--      مُدخِلُ البيانات، أو استيرادٌ، أو صفرٌ منسيّ. حكمٌ بلا حاكم.
--
--   ٢) teaching_quota_bounds — وهو الجدول الذي **تضبطه الوزارة فعلاً** — كان
--      يُنشأ بـ `default 12` و `default 24`، ويُزرع بصفٍّ من الافتراضين. فحتى
--      لو قرأناه، لقرأنا رقماً اخترعته هجرةٌ لا قراراً وزارياً. ولا سبيل إلى
--      التمييز بين «الوزارة اختارت ١٢» و«أحدٌ لم يفتح النافذة قطّ».
--
--  الإصلاح مبدؤه: **لا رقمَ بلا صاحب.**
--   · تُنزَع الافتراضات، ويصير العمودان يقبلان الفراغ، ويُفرَّغ الصفُّ المزروع.
--     فارغٌ يعني «لم يُحدَّد» صراحةً، وهي حقيقةٌ تُقال لا تُخفى برقم.
--   · get_teaching_load تأخذ النصاب من سلطته: تجاوزُ المدرسة إن وُجد، وإلّا
--     الحدُّ الوطنيّ، وإلّا لا شيء. وتُرجع الحدَّين معاً فيُعرَف النقصُ كما
--     يُعرَف التجاوز — نصفُ النصاب حدٌّ أدنى، وكان مهملاً.
--   · weekly_lessons يبقى في سجلّ الكادر بوصفه ما هو: حصصُ الشخص المسجَّلة،
--     يُتحقَّق منها بالحدَّين. لكنّه لم يعد يصلح حَكَماً على نفسه.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.teaching_quota_bounds alter column min_lessons drop default;
alter table public.teaching_quota_bounds alter column max_lessons drop default;
alter table public.teaching_quota_bounds alter column min_lessons drop not null;
alter table public.teaching_quota_bounds alter column max_lessons drop not null;

-- القيد كان يفترض رقمين؛ الآن الفراغ حالةٌ مشروعة تعني «لم يُحدَّد».
alter table public.teaching_quota_bounds drop constraint if exists teaching_quota_bounds_range;
alter table public.teaching_quota_bounds add  constraint teaching_quota_bounds_range
  check (
    (min_lessons is null or min_lessons >= 0)
    and (min_lessons is null or max_lessons is null or max_lessons >= min_lessons)
  );

/* تفريغُ الصفّ المزروع — وبشرطٍ لا مجازفة: updated_by فارغٌ يعني أنّ أحداً لم
   يحفظ من النافذة قطّ، فالقيمتان من الهجرة لا من الوزارة. ولو كانت الوزارة قد
   اختارت ١٢ و٢٤ فعلاً لبقي أثرُها في updated_by فلا نمحو قرارها. */
update public.teaching_quota_bounds
   set min_lessons = null, max_lessons = null
 where updated_by is null;

comment on column public.teaching_quota_bounds.min_lessons is
  'أدنى حصصٍ أسبوعية وطنياً. فارغ = لم تحدّده الوزارة بعد — لا رقمَ مفترَض.';
comment on column public.teaching_quota_bounds.max_lessons is
  'أعلى حصصٍ أسبوعية وطنياً. فارغ = لم تحدّده الوزارة بعد — لا رقمَ مفترَض.';


-- ── get_teaching_load: النصاب من سلطته ──────────────────────────────────────
--  توقيعُ الإرجاع يتغيّر (quota_min جديد) فلا يكفي CREATE OR REPLACE.
drop function if exists public.get_teaching_load(uuid);

create function public.get_teaching_load(p_school_id uuid default null)
returns table (
  staff_id     uuid,
  full_name    text,
  school_id    uuid,
  school_name  text,
  quota        integer,   -- الحدّ الأعلى الفعليّ (مدرسيّ ← وطنيّ ← فارغ)
  quota_min    integer,   -- الحدّ الأدنى الفعليّ
  assigned     integer,
  excess       integer,   -- ما فوق الأعلى
  shortfall    integer    -- ما دون الأدنى
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_role   text;
  v_school uuid;
  v_dir    uuid;
  v_nat_min integer;
  v_nat_max integer;
begin
  select u.role::text, u.school_id, u.directorate_id
    into v_role, v_school, v_dir
  from public.users u where u.id = auth.uid() and u.is_active;

  if v_role not in ('school_admin', 'directorate_user', 'ministry_user') then
    raise exception 'غير مصرّح: هذه الدالة للمدرسة أو المديرية أو الوزارة';
  end if;

  select b.min_lessons, b.max_lessons into v_nat_min, v_nat_max
    from public.teaching_quota_bounds b limit 1;

  return query
  with scope as (
    select s.id, s.name, s.quota_min_lessons, s.quota_max_lessons
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
    select sr.id        as r_staff,
           sr.full_name as r_name,
           sr.school_id as r_school,
           scope.name   as r_school_name,
           -- النصاب من سلطته: قرارُ المدرسة أوّلاً، فالوطنيّ، وإلّا لا شيء.
           coalesce(scope.quota_max_lessons, v_nat_max) as r_max,
           coalesce(scope.quota_min_lessons, v_nat_min) as r_min,
           coalesce(ld.total, 0)::int                   as r_assigned
    from public.staff_records sr
    join scope on scope.id = sr.school_id
    left join ld on ld.sid = sr.id
    where sr.active and sr.staff_type = 'teaching'
  )
  select r_staff, r_name, r_school, r_school_name, r_max, r_min, r_assigned,
         case when r_max is null then null else greatest(0, r_assigned - r_max) end,
         case when r_min is null then null else greatest(0, r_min - r_assigned) end
  from rows
  order by
    case when r_max is not null and r_assigned > r_max then 0   -- تجاوزوا أوّلاً
         when r_min is not null and r_assigned < r_min then 1   -- ثمّ دون النصاب
         else 2 end,
    (r_assigned - coalesce(r_max, 0)) desc,
    r_name;
end; $$;

alter function public.get_teaching_load(uuid) owner to postgres;
revoke all on function public.get_teaching_load(uuid) from public, anon;
grant execute on function public.get_teaching_load(uuid) to authenticated, service_role;

comment on function public.get_teaching_load(uuid) is
  'حِمل التدريس مقابل النصاب الفعليّ (تجاوز المدرسة ← الحدّ الوطنيّ). فارغٌ يعني أنّ لا جهةَ حدّدته — لا رقمَ مفترَض.';

notify pgrst, 'reload schema';
