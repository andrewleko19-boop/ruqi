-- ════════════════════════════════════════════════════════════════════════════
--  fix-directorate-principals-rls.sql
--
--  يجعل مدراء المدارس (school_admin) يظهرون في تبويب «المدراء» بلوحة المديرية.
--  شغّله في: Supabase Dashboard → SQL Editor
--
--  المشكلة:
--    مدير المدرسة ينتمي لمديرية عبر مدرسته (schools.directorate_id). لكن لم تكن
--    هناك سياسة RLS تسمح لمستخدم المديرية بقراءة صفوف school_admin، فكان لا يرى
--    سوى صفّه فيظهر التبويب فارغاً — بما في ذلك المدراء المُضافون من لوحة المشرف.
--
--  الحل:
--    سياسة SELECT على public.users تتيح لمستخدم المديرية قراءة كل school_admin
--    تتبع مدرسته نفس المديرية. لا حاجة لأي ترحيل بيانات — الرابط موجود مسبقاً
--    عبر schools.directorate_id الذي يُحدَّد عند إنشاء المدرسة.
--
--  آمن للتشغيل أكثر من مرة (idempotent).
--
--  ملاحظة: تعتمد السياسة على الدالة current_user_directorate_id() وهي
--  SECURITY DEFINER (تتجاوز RLS) لتفادي العَوْد اللانهائي. إن ظهر خطأ
--  «infinite recursion detected in policy for relation users» فهذا يعني أن
--  الدالة ليست SECURITY DEFINER؛ أعد تعريفها بالكتلة المعلّقة في الأسفل.
-- ════════════════════════════════════════════════════════════════════════════

-- (اختياري) ضمان أن الدالة المساعدة SECURITY DEFINER لتفادي العَوْد —
-- أزل التعليق فقط إن ظهر خطأ infinite recursion:
-- create or replace function public.current_user_directorate_id()
-- returns uuid language sql stable security definer set search_path = public as $$
--   select directorate_id from public.users where id = auth.uid()
-- $$;

drop policy if exists users_directorate_select_principals on public.users;
create policy users_directorate_select_principals on public.users
  for select to authenticated
  using (
    role = 'school_admin'
    and current_user_directorate_id() is not null
    and exists (
      select 1
      from   public.schools s
      where  s.id             = public.users.school_id
        and  s.directorate_id  = current_user_directorate_id()
    )
  );

-- ── التحقق: استبدل <directorate_id> بمعرّف مديريتك لرؤية مدرائها ──────────────
--  (أو شغّله كمستخدم المديرية من اللوحة وافتح تبويب «المدراء»)
-- select u.id, u.full_name, u.role, s.name as school, s.directorate_id
-- from   public.users u
-- left   join public.schools s on s.id = u.school_id
-- where  u.role = 'school_admin'
-- order  by s.directorate_id, u.full_name;
