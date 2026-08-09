-- ════════════════════════════════════════════════════════════════════════════
--  فحص سلامة سلسلة إشعارات الغياب (الميزة 6).
--
--  لماذا يلزم فحصٌ يدويّ: notify_user تبتلع كلّ خطأ عمداً
--  (`exception when others then null`) كي لا يُسقِط فشلُ الإشعار عمليةَ حفظ
--  الحضور نفسها. الثمن أنّ الإخفاق صامتٌ تماماً: لا إشعار يصل، ولا سطر في
--  السجلّات، ولا خطأ في الواجهة. هذا الملفّ يكشف الحلقة المقطوعة.
--
--  الاستعمال: Supabase → SQL Editor → الصق الملفّ كلَّه ونفّذه.
--             لا يعدّل شيئاً — قراءةٌ فقط.
-- ════════════════════════════════════════════════════════════════════════════

with checks as (

  -- 1) امتداد pg_net: بدونه لا تُستدعى دالة الحافة إطلاقاً.
  select 1 as ord, 'امتداد pg_net' as البند,
         case when exists (select 1 from pg_extension where extname = 'pg_net')
              then '✅ مثبَّت' else '❌ غير مثبَّت — لن يُرسل أيّ إشعار دفع' end as الحالة,
         'create extension pg_net;' as الإجراء_عند_الفشل

  -- 2) دالة notify_user.
  union all
  select 2, 'دالة notify_user',
         case when exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'notify_user')
         then '✅ موجودة' else '❌ مفقودة' end,
         'شغّل docs/database-setup.sql §5.3'

  -- 3) مفتاح الخدمة داخل notify_user — النائب النصّي يعني إخفاقاً صامتاً.
  --    لا يُطبَع المفتاح، بل صلاحيّته فقط.
  union all
  select 3, 'مفتاح الخدمة في notify_user',
         coalesce((
           select case
             when src like '%YOUR_SB_SECRET_KEY_HERE%'
               then '❌ لا يزال نائباً نصّياً — send-push سيردّ 401 والخطأ مبتلَع'
             when src ~ 'v_key\s*:=\s*''\s*'''
               then '❌ فارغ'
             else '✅ مضبوط' end
           from (
             select pg_get_functiondef(p.oid) as src
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'notify_user' limit 1
           ) s), '⚠️ تعذّرت القراءة'),
         'استبدل v_key في notify_user بمفتاح service_role من Settings → API'

  -- 4) مُطلِق الغياب.
  union all
  select 4, 'مُطلِق t_notify_parents_absent',
         case when exists (
           select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where c.relname = 'daily_student_attendance'
             and t.tgname  = 't_notify_parents_absent' and not t.tgisinternal)
         then '✅ مُركَّب' else '❌ غير مُركَّب' end,
         'طبّق هجرة 20260809000000_notify_parents_absent_trigger.sql'

  -- 5) اشتراكات الدفع: بلا اشتراكٍ واحدٍ على الأقلّ لا وجهةَ للإشعار.
  union all
  select 5, 'اشتراكات الدفع المسجَّلة',
         case when (select count(*) from public.push_subscriptions) > 0
              then '✅ ' || (select count(*)::text from public.push_subscriptions) || ' اشتراك'
              else '⚠️ لا يوجد — لم يفعّل أحدٌ الإشعارات بعد' end,
         'افتح بوّابة وليّ الأمر واضغط «تفعيل إشعارات الغياب»'

  -- 6) ربط أولياء الأمور بالطلاب: بلا ربطٍ لا يجد المُطلِق مستقبِلاً.
  union all
  select 6, 'روابط أولياء الأمور',
         case when (select count(*) from public.parent_links) > 0
              then '✅ ' || (select count(*)::text from public.parent_links) || ' رابط'
              else '⚠️ لا يوجد — لن يجد المُطلِق وليّاً يُشعِره' end,
         'تأكّد من أرقام هواتف الأهل (tools/backfill-parent-phone.sql)'

  -- 7) الحصيلة الفعلية: إشعارُ غيابٍ بلا push_sent_at يعني أنّ الصفّ أُدرِج
  --    لكنّ الدفع لم يخرج — وهذا بالضبط عَرَض مفتاح الخدمة الخاطئ.
  union all
  select 7, 'إشعارات الغياب آخر 7 أيام',
         coalesce((
           select '📊 ' || count(*)::text || ' إشعار، خرج منها ' ||
                  count(push_sent_at)::text || ' دفعاً'
           from public.notifications
           where type = 'student_absent' and created_at > now() - interval '7 days'
         ), '—'),
         'إن كان العدد > 0 والدفع = 0 فالمشكلة في البند 3 أو مفاتيح VAPID'
)
select البند, الحالة, الإجراء_عند_الفشل from checks order by ord;

-- ملاحظة أخيرة لا يمكن فحصها من قاعدة البيانات:
--   مفتاحا VAPID_PRIVATE_KEY وVAPID_PUBLIC_KEY يجب أن يكونا مضبوطين في
--   Edge Function secrets، وأن يطابق العامُّ منهما VAPID_PUBLIC_KEY في
--   shared/db.js. إن غابا ردّت send-push {ok:true, skipped:"no VAPID keys"}
--   بلا خطأ — إخفاقٌ صامتٌ آخر.
