-- ════════════════════════════════════════════════════════════════════════════
--  دورُ الصلاحيات الافتراضيّ يوافق مفاتيح المصفوفة — وإلّا فلوحةٌ بيضاء.
--
--  current_user_permission_role() تسقط عند غياب users.permission_role إلى
--  users.role النصّيّ الخام. وهذا يوافق مفتاح المصفوفة لدورين فقط بالمصادفة
--  ('teacher' و'school_admin')، ويخالفه للدورين الآخرين: القيمة التقنية
--  'directorate_user' بينما مفتاح المصفوفة 'directorate_staff'، و'ministry_user'
--  بينما المفتاح 'ministry_staff'.
--
--  فالحساب الذي يُنشأ ولا يُضبط له permission_role — ودالّة الحافة
--  admin-create-user لا تضبطه أصلاً — يرجع بصفر وحدات مفعّلة. و applyToDom
--  تُخفي عندها كلّ عنصرٍ يحمل data-module: لوحةُ مديريةٍ بلا تبويبٍ ولا زرّ،
--  بيضاءُ تماماً. ولا رسالةَ خطأ يقرؤها صاحبُها ولا شيءَ يستطيع الضغط عليه
--  ليُبلّغ عمّا يرى. والتعبئتان في هجرتَي ٠٨٠٦ و٠٨١٥ لمرّةٍ واحدة، فلا تنفعان
--  حساباً يُنشأ غداً.
--
--  فالخريطة تُكتب هنا مرّةً واحدة: مصدرُ الحقيقة للدور الافتراضيّ هو القاعدة،
--  لا كلُّ مسار إنشاءٍ على حدة — الحاليّة منها والتي تُكتب بعد سنة.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.current_user_permission_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.permission_role from public.users u where u.id = auth.uid()),
    (select case u.role::text
              when 'directorate_user' then 'directorate_staff'
              when 'ministry_user'    then 'ministry_staff'
              else u.role::text
            end
       from public.users u where u.id = auth.uid()),
    case when exists (select 1 from public.parent_links pl where pl.user_id = auth.uid())
         then 'parent' end
  );
$$;

revoke all on function public.current_user_permission_role() from public, anon;
grant execute on function public.current_user_permission_role() to authenticated;

-- وتعبئةُ ما نشأ فارغاً منذ آخر هجرة، لتبقى لوحة المشرف صادقةً فيما تعرضه:
-- القائمةُ المنسدلة كانت تُظهر «موظف مديرية» لحسابٍ قيمتُه NULL فعلاً.
update public.users set permission_role = 'directorate_staff'
 where role = 'directorate_user'::public.user_role and permission_role is null;
update public.users set permission_role = 'ministry_staff'
 where role = 'ministry_user'::public.user_role   and permission_role is null;
update public.users set permission_role = 'school_admin'
 where role = 'school_admin'::public.user_role    and permission_role is null;
update public.users set permission_role = 'teacher'
 where role = 'teacher'::public.user_role         and permission_role is null;

notify pgrst, 'reload schema';
