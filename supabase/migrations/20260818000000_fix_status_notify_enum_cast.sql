-- ════════════════════════════════════════════════════════════════════════════
--  انحدارٌ يمنع كلّ تغييرٍ لحالة الطالب — إصلاحٌ عاجل.
--
--  الزناد _notify_parents_status_change (هجرة 20260815000200) يبني الوصف هكذا:
--
--      v_label := case new.status
--        when 'transferred' then 'نُقل إلى مدرسة أخرى'
--        ...
--        else new.status                      -- ← هنا العلّة
--      end;
--
--  و new.status نوعُه enum public.student_status. وPostgres يوحّد نوعَ CASE من
--  فروعه: الفروعُ النصّية مجهولةُ النوع (unknown) وفرعُ else معروفٌ (enum)، فيُحسم
--  النوعُ إلى enum ثمّ تُحاوَل ترقيةُ النصوص العربية إلى قيمِ enum — فتفشل:
--
--      ERROR: invalid input value for enum student_status: "نُقل إلى مدرسة أخرى"
--
--  والأثر أنّ **كلّ** تحويلِ حالة يفشل — ترقين قيدٍ ونقلٌ وتخرّجٌ وإخراجٌ من
--  العام — إلّا العودةَ إلى «نشط» وحدها، لأنّ الزناد يخرج قبل هذا السطر لها.
--  ولم يظهر في أيّ اختبار: زُرعت الحالة في الاختبارات بـ INSERT لا UPDATE،
--  والزنادُ AFTER UPDATE وحده.
--
--  وصمَته الواجهةُ فوقه: enqueueOrSyncStudent تبتلع الخطأ وتصفّ العمليةَ في
--  طابور «أوفلاين» فتقول «سيُحدَّث عند الاتصال» — والمستخدم متّصل، والعملية
--  مرفوضةٌ رفضاً دائماً، فتُعاد المحاولة أبداً بلا جدوى. أُصلح ذلك في db.js.
--
--  الإصلاح: ::text على الفرع الأخير، فيُحسم نوعُ CASE نصّاً كما ينبغي.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public._notify_parents_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'active' then return new; end if;   -- العودة للقيد لا تُنذر

  -- ⚠ ::text إلزاميّ: بدونه يُحسم نوعُ CASE إلى enum فتفشل ترقيةُ النصوص
  --   العربية إلى قيمِ enum، ويُرفض التحديثُ كلُّه.
  v_label := case new.status::text
    when 'transferred' then 'نُقل إلى مدرسة أخرى'
    when 'out_of_year' then 'أُخرج من العام الدراسي'
    when 'graduated'   then 'تخرّج'
    when 'struck_off'  then 'رُقّن قيده'
    else new.status::text
  end;

  perform public.notify_user(
    pl.user_id, 'student_status_changed',
    'تغيّر قيد ' || coalesce(new.full_name, 'ابنك/ابنتك'),
    v_label || case when nullif(btrim(coalesce(new.status_reason, '')), '') is not null
                    then ' — ' || new.status_reason else '' end,
    'student', new.id
  )
  from public.parent_links pl
  where pl.student_id = new.id;

  return new;
end; $$;

alter function public._notify_parents_status_change() owner to postgres;

notify pgrst, 'reload schema';
