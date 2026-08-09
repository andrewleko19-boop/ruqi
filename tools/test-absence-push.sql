-- ════════════════════════════════════════════════════════════════════════════
--  اختبار سلسلة إشعار الغياب من طرفٍ إلى طرف — قبل بدء العام الدراسي.
--
--  لماذا: check-push-health.sql يفحص وجودَ الحلقات لا عملَها. وحدَه مرورُ
--  غيابٍ حقيقيّ عبر السلسلة كلّها (مُطلِق → notify_user → pg_net → send-push →
--  جهاز الوليّ) يُثبت أنّها تعمل. وبلا هذا الاختبار لن يُكتشف أيّ خللٍ قبل
--  أوّل غيابٍ حقيقيّ في أيلول — أي بعد فوات أوان الإصلاح الهادئ.
--
--  الاستعمال: Supabase → SQL Editor، خطوةً خطوة (لا تُنفّذ الملفّ دفعةً واحدة).
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ الخطوة 1 — من يصلح للاختبار؟ (قراءة فقط) ═══════════════════════════════
--  الفحص الحاسم هنا هو عمود «اشتراك الدفع»: قد تكون كلّ الاشتراكات المسجَّلة
--  لمدراء ومعلّمين ولا اشتراكَ لوليّ أمرٍ واحد — عندها كلّ الحلقات خضراء
--  ولا يصل الأهلَ شيء. الرقم الإجماليّ للاشتراكات لا يكشف هذا.

select
  s.id                          as معرّف_الطالب,
  s.full_name                   as الطالب,
  pl.user_id                    as وليّ_الأمر,
  case when exists (select 1 from public.push_subscriptions ps where ps.user_id = pl.user_id)
       then '✅ مشترك'
       else '❌ لا اشتراك — لن يصله إشعار' end   as اشتراك_الدفع,
  case when exists (select 1 from public.daily_student_attendance a
                    where a.student_id = s.id and a.date = current_date)
       then '⚠️ يوجد سجلّ اليوم — اختر تاريخاً آخر في الخطوة 2'
       else '✅ لا سجلّ اليوم' end               as سجلّ_اليوم
from public.parent_links pl
join public.students s on s.id = pl.student_id
order by s.full_name;


-- ═══ الخطوة 2 — أطلق غياباً تجريبياً ════════════════════════════════════════
--  ⚠️ هذا غيابٌ حقيقيّ يُدرَج في السجلّ وإشعارٌ حقيقيّ يصل هاتف وليّ الأمر.
--     نفّذها على حساب اختبارٍ تملكه، والخطوة 4 تمحو الأثر.
--  ⚠️ المُطلِق يمتنع عمداً إن كانت الحالة السابقة 'absent' (منع التكرار)، فاختر
--     تاريخاً بلا سجلّ — وإلّا لن يحدث شيء وتظنّ السلسلة معطّلة.

-- استبدل المعرّف بواحدٍ من الخطوة 1:
insert into public.daily_student_attendance (student_id, class_id, school_id, date, status, reason)
select s.id, s.class_id, s.school_id, current_date, 'absent', 'اختبار سلسلة الإشعارات'
from   public.students s
where  s.id = '00000000-0000-0000-0000-000000000000'   -- ← ضع معرّف الطالب هنا
on conflict (student_id, date) do update
  set status = 'absent', reason = 'اختبار سلسلة الإشعارات';


-- ═══ الخطوة 3 — بعد 5-10 ثوانٍ: هل خرج الإشعار فعلاً؟ ═══════════════════════
--  push_sent_at تضعه دالة send-push عند نجاح الإرسال، فهو الدليل القاطع.
--  وrespond_status يكشف سببَ الفشل الذي تبتلعه notify_user صامتاً:
--    401 → مفتاح الخدمة في notify_user لا يطابق SUPABASE_SERVICE_ROLE_KEY
--    200 مع sent=0 → الوليّ بلا اشتراك دفع، أو مفاتيح VAPID غائبة

select
  n.created_at                                          as وقت_الإشعار,
  n.title                                               as العنوان,
  case when n.push_sent_at is not null
       then '✅ خرج دفعاً في ' || n.push_sent_at::text
       else '❌ لم يخرج بعد' end                        as حالة_الدفع
from public.notifications n
where n.type = 'student_absent'
order by n.created_at desc
limit 5;

--  ردّ send-push كما رآه pg_net (أدقّ تشخيصٍ متاح):
select r.id, r.status_code as رمز_الردّ, r.error_msg as رسالة_الخطأ,
       left(r.content, 300) as محتوى_الردّ, r.created as الوقت
from   net._http_response r
order  by r.id desc
limit  5;


-- ═══ الخطوة 4 — تنظيف أثر الاختبار ═════════════════════════════════════════
--  يُنفَّذ بعد التأكّد من وصول الإشعار. رتّبٌ مقصود: الإشعارات أوّلاً لأنّ
--  entity_id فيها يشير إلى صفّ الحضور.

delete from public.notifications
where  type = 'student_absent'
  and  entity_id in (
         select id from public.daily_student_attendance
         where  reason = 'اختبار سلسلة الإشعارات'
       );

delete from public.daily_student_attendance
where  reason = 'اختبار سلسلة الإشعارات';
