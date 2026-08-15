-- ════════════════════════════════════════════════════════════════════════════
--  دمج أدوار الصلاحيات: سبعةٌ تصير خمسة.
--
--  كانت المصفوفة تحمل زوجين متمايزين اسماً: directorate_staff/directorate_head
--  وministry_staff/minister — بنيّة أن يرى الرئيسُ ما لا يراه الموظّف. لكنّ
--  الواقع أنّ الزوجين **متطابقان حرفياً** في الوحدات الأربع عشرة كلّها: صفرُ
--  فرقٍ في أيّ خانة. فهما عمودان زائدان يُوسّعان المصفوفة بلا معنى، ويُوهمان
--  المشرفَ بتمييزٍ لا وجود له فيضبط أحدهما ظانّاً أنّه غيّر شيئاً.
--
--  وواقع الإدارة يوافق ذلك: المديرية حسابٌ واحد بصلاحياتٍ واحدة، وكذلك
--  الوزارة. من أراد تمييزاً بين رئيسٍ وموظّف فمكانُه الأدوارُ الوظيفية في
--  users.role لا مصفوفةُ الوحدات.
--
--  الدمج بلا فقدان: الصفوف المحذوفة نسخةٌ من الباقية، فحذفُها لا يُنقص
--  صلاحيةً لأحد. والمستخدمون المسنَدون إلى الدورين المحذوفين يُنقلون إلى
--  نظيرَيهما قبل تضييق القيد — وإلّا رفض القيدُ صفوفَهم.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ١) نقل المستخدمين قبل تضييق القيد ──────────────────────────────────────
update public.users
   set permission_role = 'directorate_staff'
 where permission_role = 'directorate_head';

update public.users
   set permission_role = 'ministry_staff'
 where permission_role = 'minister';

-- ── ٢) دمج الصلاحيات بالاتّحاد قبل الحذف ───────────────────────────────────
--  احتياطٌ لا تجميل: الجدول أعلاه متطابقٌ اليوم، لكن قد يكون مشرفٌ فعّل خانةً
--  للرئيس وحده بين إنشاء هذا الملفّ وتطبيقه. الاتّحاد يضمن ألّا يضيع ذلك.
update public.role_module_permissions dst
   set is_enabled = true
  from public.role_module_permissions src
 where src.role_key   = 'directorate_head'
   and dst.role_key   = 'directorate_staff'
   and dst.module_key = src.module_key
   and src.is_enabled = true
   and dst.is_enabled = false;

update public.role_module_permissions dst
   set is_enabled = true
  from public.role_module_permissions src
 where src.role_key   = 'minister'
   and dst.role_key   = 'ministry_staff'
   and dst.module_key = src.module_key
   and src.is_enabled = true
   and dst.is_enabled = false;

delete from public.role_module_permissions
 where role_key in ('directorate_head', 'minister');

-- ── ٣) تضييق القيدين ───────────────────────────────────────────────────────
alter table public.role_module_permissions
  drop constraint if exists role_module_permissions_role_key_check;

alter table public.role_module_permissions
  add constraint role_module_permissions_role_key_check check (
    role_key = any (array[
      'teacher', 'school_admin', 'directorate_staff', 'ministry_staff', 'parent'
    ])
  );

alter table public.users
  drop constraint if exists users_permission_role_check;

alter table public.users
  add constraint users_permission_role_check check (
    permission_role is null or permission_role = any (array[
      'teacher', 'school_admin', 'directorate_staff', 'ministry_staff'
    ])
  );

comment on column public.users.permission_role is
  'مستوى الصلاحيات في مصفوفة الوحدات. خمسة أدوار تقابل البوّابات: معلّم، مدير مدرسة، موظّف مديرية، موظّف وزارة، وليّ أمر (الأخير بلا صفٍّ في users).';

-- مخبأ مخطّط PostgREST يحفظ القيود، فبدون تحديثه يرفض API قيمةً صارت صالحة.
notify pgrst, 'reload schema';
