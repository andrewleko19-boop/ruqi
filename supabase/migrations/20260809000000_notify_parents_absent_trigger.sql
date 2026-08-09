-- ════════════════════════════════════════════════════════════════════════════
--  إشعار وليّ الأمر فور تسجيل غياب ابنه (الميزة 6).
--
--  الحالة قبل هذه الهجرة: سلسلة الإشعار مبنيّةٌ بكاملها تقريباً —
--    • send-push يعرف النوع 'student_absent' ويوجّهه إلى بوّابة وليّ الأمر
--      صراحةً (أولياء الأمور في auth.users لا public.users فلا دور لهم).
--    • save-push-subscription وsw.js ومفتاح VAPID العامّ كلّها جاهزة، وبوّابة
--      وليّ الأمر تستدعي registerPushSubscription أصلاً.
--    • notify_user موجودةٌ في قاعدة البيانات الحيّة (هجرة 20260731000000 تسحب
--      صلاحيّتها، ولو غابت الدالة لفشلت تلك الهجرة).
--  الناقص: المُطلِق نفسه. كان معرَّفاً في docs/database-setup.sql وحدَه — وذاك
--  ملفّ تهيئةٍ يُشغَّل يدوياً مرّةً عند الإقلاع، لا يمرّ بمسار الهجرات. فأيّ
--  بيئةٍ جديدة (أو إعادة بناء) تقوم بلا إشعارات غياب، ولا سبيل للتحقّق من
--  وجوده عبر سجلّ الهجرات. هذه الهجرة تنقله إلى المسار المُدار.
--
--  ⚠️ الهجرة لا تمسّ notify_user إطلاقاً — ولا يجوز أن تمسّها: مفتاح الخدمة
--     مكتوبٌ داخل جسمها في قاعدة البيانات الحيّة (ملفّ التهيئة يحمل نائباً
--     نصّياً 'YOUR_SB_SECRET_KEY_HERE' يُستبدَل يدوياً عند الإقلاع)، فأيّ
--     `create or replace` هنا كان سيدهس المفتاح الحقيقي ويوقف كلّ الإشعارات
--     في البوّابات الستّ صامتاً. للتحقّق من سلامة المفتاح استعمل
--     tools/check-push-health.sql.
--
--  إعادة التطبيق آمنة: الدالة `create or replace` والمُطلِق يُسقَط ثمّ يُنشأ.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public._notify_parents_absent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  -- 'absent' وحدها تُشعِر: التأخّر والغياب المبرَّر ليسا حدثاً يستدعي إزعاج الأهل.
  if new.status is distinct from 'absent'      then return new; end if;
  -- منعُ التكرار: حفظُ الكشف مرّةً أخرى يُحدّث صفوف الطلاب كلَّها (upsert على
  -- student_id,date)، فبلا هذا الشرط يصل الأهلَ إشعارٌ جديد مع كلّ تصحيحٍ
  -- يجريه المعلّم على أيّ طالبٍ آخر في الشعبة.
  if old.status is not distinct from 'absent'  then return new; end if;

  select full_name into v_name from public.students where id = new.student_id;

  perform public.notify_user(
    pl.user_id,
    'student_absent',
    'تغيّب ' || coalesce(v_name, 'الطالب'),
    'سُجِّل غياب ابنك/ابنتك بتاريخ ' || new.date::text,
    'daily_student_attendance',
    new.id
  )
  from public.parent_links pl
  where pl.student_id = new.student_id;

  return new;
end; $$;

drop trigger if exists t_notify_parents_absent on public.daily_student_attendance;
create trigger t_notify_parents_absent
  after insert or update on public.daily_student_attendance
  for each row execute function public._notify_parents_absent();
