-- ════════════════════════════════════════════════════════════════════════════
-- إزالة مفهوم «المجمّع التربوي» من قاعدة البيانات.
--
-- الوضع السابق: قيم المجمّع تُخزَّن في lookup_lists من نوع school_complex
-- والقيمة المختارة في schools.complex_name. القسم أُزيل من واجهة المديرية
-- في جولةٍ سابقة، لكن البيانات بقيت في قاعدة البيانات.
--
-- هذه الهجرة:
-- ١) تحذف جميع إدخالات lookup_lists من نوع school_complex.
-- ٢) تصفّر complex_name في جميع صفوف schools.
-- ٣) تُزيل school_complex من قيد CHECK (لا يُضاف بعد اليوم).
-- ════════════════════════════════════════════════════════════════════════════

-- ١) حذف الخيارات المرجعية
delete from public.lookup_lists where list_type = 'school_complex';

-- ٢) مسح القيمة المحفوظة في كل مدرسة
update public.schools set complex_name = null where complex_name is not null;

-- ٣) تحديث قيد CHECK ليستبعد school_complex
alter table public.lookup_lists
  drop constraint if exists lookup_lists_list_type_check;

alter table public.lookup_lists
  add constraint lookup_lists_list_type_check check (
    list_type = any (array[
      'admin_role', 'specialization', 'certificate', 'higher_degree',
      'leave_type', 'ministerial_doc', 'support_job', 'educational_zone',
      'job_title', 'school_admin_role'
    ])
  );
