-- ════════════════════════════════════════════════════════════════════════════
--  كشفُ حضورٍ أُخذ دون اتصال يُقبَل حتى بعد ثلاثة أيّام — لا اليومَ وحدَه.
--
--  سياستان تشترطان `date = CURRENT_DATE` على كتابة المعلّم:
--     dsa_teacher_write   (daily_student_attendance — صفوف الطلاب)
--     subs_teacher_insert (attendance_submissions    — صفّ الإرسال)
--
--  وهذا الشرط يكسر العملَ دون اتصال من وجهين:
--
--   ١) التأخّر. معلّمٌ أخذ حضورَ الخميس دون اتصال ولم يصل مزامنتُه قبل الأحد
--      (الجمعة والسبت عطلة) يُرفض كشفُه رفضاً دائماً. الطابورُ في التطبيق يحفظه
--      ولا يحذفه ويُظهره «رفضه الخادم»، لكنّه لا يهبط أبداً.
--
--   ٢) المنطقة الزمنيّة. CURRENT_DATE يُحسَب بمنطقة جلسة القاعدة (UTC في
--      Supabase)، والتطبيق يختم الكشفَ بتاريخ الجهاز المحلّيّ (سوريا UTC+3 بلا
--      توقيتٍ صيفيّ منذ ٢٠٢٢). فبين ٠٠:٠٠ و٠٣:٠٠ بتوقيت دمشق يكون تاريخُ الجهاز
--      يوماً **بعد** تاريخ القاعدة، فيُرفض كشفٌ سليم ليومه. (والتطبيق يكتب
--      التاريخ بصيغة محلّيّة عمداً — انظر localDateISO في shared/db.js.)
--
--  الحلّ: نافذةٌ تُحسَب بتوقيت دمشق:
--
--        date بين (اليومُ بدمشق − ٣) و (اليومُ بدمشق)
--
--  ● ثلاثةٌ لا يومٌ واحد: الخميس ← الأحد = ٣ أيّام بالضبط. «يومان» يرفضان
--    أشيعَ حالةِ تأخّرٍ حقيقيّة في الأسبوع الدراسيّ السوريّ.
--  ● الحدُّ الأعلى «اليومُ بدمشق» لا «اليومُ بـUTC»: يُسقط ثغرةَ الثلاث ساعات.
--    ولا مستقبلَ يُقبَل (كشفٌ مؤرَّخٌ بغدٍ لا معنى له).
--  ● الرقم ٣ مكتوبٌ في موضعين (السياستان) — غيّره فيهما معاً.
--
--  ⚠️ ما لا يتغيّر عمداً — وهو الأهمّ:
--   • حمايةُ الكشف المعتمَد من المدير. dsa_teacher_write ما زالت تحوي
--     `NOT EXISTS (… s.status = 'confirmed')` على الصفّ والتاريخ نفسهما، فكشفٌ
--     قديمٌ يُعاد (replay) لا يكتب فوق ما اعتمده المدير، وصارت تحميه لأيّ تاريخ
--     داخل النافذة لا لليوم وحده. وsubs_teacher_update (USING: status <> 'confirmed')
--     لم تُمسّ: upsert الإرسال على صفٍّ معتمَد يُرفض كما كان.
--   • ALTER POLICY لا DROP/CREATE: يعدّل التعبيرَ المحدَّد وحده، ويبقى الأمر
--     (ALL / INSERT) والأدوار (authenticated) وتعبيرُ USING كما هي. لا سياسةَ
--     أخرى ولا جدولاً ولا دالّةً ولا منحةً تُلمَس.
--   • سياسات المدير (subs_admin_update…) والقراءة ولي الأمر كما هي.
--
--  أثرٌ جانبيّ معلوم: كشفٌ متأخّر فيه غائب يُرسل للأهل إشعارَ غياب بتاريخ ذلك
--  اليوم (نصُّ الإشعار يحمل التاريخ). وهو المطلوب: الغيابُ حدث، والتأخّر في
--  وصوله لا في وقوعه.
--
--  إعادة التطبيق آمنة (ALTER POLICY idempotent). لا شيء يُمسّ في البيانات.
-- ════════════════════════════════════════════════════════════════════════════

-- ── صفوف حضور الطلاب ─────────────────────────────────────────────────────────
alter policy dsa_teacher_write on public.daily_student_attendance
  with check (
    public.current_user_role() = 'teacher'::public.user_role
    and public.teaches_class(class_id)
    and recorded_by = auth.uid()
    and date between ((now() at time zone 'Asia/Damascus')::date - 3)
                 and  (now() at time zone 'Asia/Damascus')::date
    and not exists (
      select 1
        from public.attendance_submissions s
       where s.class_id = daily_student_attendance.class_id
         and s.date     = daily_student_attendance.date
         and s.status   = 'confirmed'
    )
  );

-- ── صفّ إرسال الكشف ──────────────────────────────────────────────────────────
alter policy subs_teacher_insert on public.attendance_submissions
  with check (
    public.current_user_role() = 'teacher'::public.user_role
    and submitted_by = auth.uid()
    and date between ((now() at time zone 'Asia/Damascus')::date - 3)
                 and  (now() at time zone 'Asia/Damascus')::date
    and public.teaches_class(class_id)
  );
