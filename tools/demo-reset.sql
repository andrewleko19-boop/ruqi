-- ════════════════════════════════════════════════════════════════════════════
--  محو زرعة العرض — ولا شيءَ غيرها.
--
--  يُشغَّل بعد التصوير (أو قبل إعادة الزرع). كلُّ صفٍّ زرعه demo-seed.sql معرّفُه
--  يبدأ بـ 'dddddddd'، فالحذفُ يستهدف الوسمَ وحده ولا يقارب بياناتِك الحقيقية.
--
--  ⚠️ استثناءٌ مقصود: المدرستان اللتان كانتا عندك أصلاً («طارق بن زياد» و
--  «أسامة بن زيد») **لا تُحذفان** — الزرعُ لم يُنشئهما بل ملأهما. يُحذف ما
--  زُرع فيهما (طلابٌ وكادرٌ وحضورٌ ووثائق) وتبقيان كما وجدناهما.
--
--  ويُنظَّف معه ما خلّفته بذرةُ الاختبار القديمة (supabase/seed.sql) بمعرّفاتها
--  المعروفة، فهي التي عجزتَ عن الدخول بها ولا فائدةَ من بقائها.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── ١) زرعةُ العرض: كلُّ ما وُسم بـ dddddddd ─────────────────────────────────
-- الترتيبُ من الابن إلى الأب. وأكثرُ الجداول عليها ON DELETE CASCADE، لكنّ
-- الحذفَ الصريح أوضحُ من الاتّكال على سلسلةٍ قد تتغيّر.
delete from public.parent_links            where id::text like 'dddddddd%';
delete from public.transfer_documents      where id::text like 'dddddddd%';
delete from public.result_sheets           where id::text like 'dddddddd%';
delete from public.monthly_statements      where id::text like 'dddddddd%';
delete from public.school_requests         where id::text like 'dddddddd%';
delete from public.emergency_reports       where id::text like 'dddddddd%';
delete from public.staff_attendance        where id::text like 'dddddddd%';
delete from public.daily_attendance        where id::text like 'dddddddd%';
delete from public.daily_student_attendance where id::text like 'dddddddd%';
delete from public.student_conduct         where id::text like 'dddddddd%';
delete from public.student_grades          where id::text like 'dddddddd%';
delete from public.subject_components      where id::text like 'dddddddd%';
delete from public.subjects                where id::text like 'dddddddd%';
delete from public.staff_assignments       where id::text like 'dddddddd%';
delete from public.class_teacher           where id::text like 'dddddddd%';
delete from public.staff_credentials       where id::text like 'dddddddd%';
delete from public.students                where id::text like 'dddddddd%';
delete from public.classes                 where id::text like 'dddddddd%';
delete from public.staff_records           where id::text like 'dddddddd%';
delete from public.users                   where id::text like 'dddddddd%';
delete from auth.users                     where id::text like 'dddddddd%';
delete from public.schools                 where id::text like 'dddddddd%';
delete from public.directorates            where id::text like 'dddddddd%';

-- الأعدادُ المعلَنة عادت كاذبةً بعد الحذف — تُعاد إلى الواقع.
update public.schools s
   set total_students = (select count(*) from public.students t where t.school_id = s.id and t.is_active),
       total_teachers = (select count(*) from public.staff_records f
                          where f.school_id = s.id and f.active and f.staff_type = 'teaching');

-- ── ٢) بذرةُ الاختبار القديمة (supabase/seed.sql) ───────────────────────────
-- حساباتُها لا تعمل أصلاً: كُتبت في auth.users بلا صفوفٍ في auth.identities،
-- فيردّ GoTrue «Invalid login credentials». لا معنى لبقائها.
delete from public.daily_student_attendance
 where school_id in ('a0000000-0000-0000-0000-00000000000a',
                     'b0000000-0000-0000-0000-00000000000b');
delete from public.attendance_submissions
 where school_id in ('a0000000-0000-0000-0000-00000000000a',
                     'b0000000-0000-0000-0000-00000000000b');
delete from public.daily_attendance
 where school_id in ('a0000000-0000-0000-0000-00000000000a',
                     'b0000000-0000-0000-0000-00000000000b');
delete from public.staff_attendance
 where school_id in ('a0000000-0000-0000-0000-00000000000a',
                     'b0000000-0000-0000-0000-00000000000b');
delete from public.school_personnel
 where school_id in ('a0000000-0000-0000-0000-00000000000a',
                     'b0000000-0000-0000-0000-00000000000b');
delete from public.students
 where school_id in ('a0000000-0000-0000-0000-00000000000a',
                     'b0000000-0000-0000-0000-00000000000b');
delete from public.class_teacher
 where class_id in ('ca000000-0000-0000-0000-00000000000a',
                    'cb000000-0000-0000-0000-00000000000b');
delete from public.classes
 where id in ('ca000000-0000-0000-0000-00000000000a',
              'cb000000-0000-0000-0000-00000000000b');
delete from public.users where id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666');
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666');
delete from public.schools where id in (
  'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
delete from public.directorates where id = 'd0000000-0000-0000-0000-000000000001';

commit;

-- ── ٣) ما بقي؟ ──────────────────────────────────────────────────────────────
select 'صفوف عرضٍ باقية (يجب أن تكون صفراً):' as ماذا,
       (select count(*) from public.schools    where id::text like 'dddddddd%')
     + (select count(*) from public.students   where id::text like 'dddddddd%')
     + (select count(*) from auth.users        where id::text like 'dddddddd%') as العدد
union all
select 'مدارسك الباقية', (select count(*) from public.schools)
union all
select 'طلابك الباقون',  (select count(*) from public.students);
