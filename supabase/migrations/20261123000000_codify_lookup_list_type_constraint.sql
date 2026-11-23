-- ═════════════════════════════════════════════════════════════════════════════
--  تثبيت قيد lookup_lists.list_type كما هو في القاعدة الحيّة (بلا school_complex).
--
--  الانجراف: 20260813000000 أضافت school_complex إلى القيد، ثم هجرةٌ أُسقط ملفُّها من
--  git (20260819000800_remove_school_complex، حُذفت في revert 635c0a7) أعادت كتابته
--  بدونها وطُبِّقت على القاعدة. فالحيّ = ١٠ قيم، والهجرات القائمة تنتهي بـ١١.
--
--  لا تُستعاد school_complex: واجهة المدرسة تقرأ المجمّع التربوي من educational_zone
--  (school/script.js: fillComplexSelect) ولا شيفرة تشغيليّة تقرأ school_complex.
--
--  أثرٌ حيّ: لا شيء (القيد مطابقٌ أصلاً). إن وُجد صفٌّ بنوع school_complex فستفشل
--  الهجرة بصوتٍ عالٍ بدل أن تحذفه — والحيّ 0 صفوف.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.lookup_lists drop constraint if exists lookup_lists_list_type_check;
alter table public.lookup_lists add constraint lookup_lists_list_type_check check (
  list_type = any (array[
    'admin_role', 'specialization', 'certificate', 'higher_degree',
    'leave_type', 'ministerial_doc', 'support_job', 'educational_zone',
    'job_title', 'school_admin_role'
  ])
);

comment on column public.lookup_lists.list_type is
  'نوع القائمة المرجعية. educational_zone لكل مديرية (directorate_id غير فارغ) وتُستعمل أيضاً للمجمّع التربوي (schools.complex_name)؛ والبقية عامّة.';
