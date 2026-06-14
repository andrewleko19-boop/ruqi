-- ════════════════════════════════════════════════════════════════════════════
--  fix-directorate-principals-rls.sql
--
--  يجعل مدراء المدارس (school_admin) يظهرون في تبويب «المدراء» بلوحة المديرية،
--  بلا التسبّب في عَوْد لا نهائي يكسر تسجيل الدخول (خطأ 500).
--  شغّله في: Supabase Dashboard → SQL Editor
--
--  ⚠️  إن كنت شغّلت نسخة سابقة من هذا الملف فكُسر تسجيل الدخول (خطأ 500 على
--      users)، فهذا الملف يُصلح ذلك: يحذف السياسة المعطوبة ويستبدلها بنسخة
--      آمنة من العَوْد. شغّله كاملاً.
--
--  المشكلة:
--    مدير المدرسة ينتمي لمديرية عبر مدرسته (schools.directorate_id). كانت تنقص
--    سياسة RLS تتيح لمستخدم المديرية قراءة صفوف school_admin، فيظهر التبويب
--    فارغاً.
--
--  فخّ العَوْد اللانهائي (السبب في خطأ 500):
--    لو فحصت السياسةُ الجدولَ public.schools مباشرةً، فإن قراءة schools تُفعّل
--    سياسة schools_directorate_select التي تستعلم عن public.users، فتُفعّل هذه
--    السياسة من جديد → حلقة لا نهائية تكسر كل استعلام users (ومنه الدخول).
--
--  الحل الجذري:
--    دالة واحدة SECURITY DEFINER تُجري الفحص كاملاً وتتجاوز RLS داخلياً، فلا
--    تدخل الحلقة جدولَي users/schools إطلاقاً.
--
--  آمن للتشغيل أكثر من مرة (idempotent). لا حاجة لأي ترحيل بيانات.
-- ════════════════════════════════════════════════════════════════════════════

-- الخطوة 0: احذف أي نسخة معطوبة سابقة من السياسة (مصدر خطأ 500)
drop policy if exists users_directorate_select_principals on public.users;

-- الخطوة 1: دالة الفحص — SECURITY DEFINER تتجاوز RLS فتمنع العَوْد
create or replace function public.is_principal_in_my_directorate(p_school_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from   public.schools s
    where  s.id             = p_school_id
      and  s.directorate_id  = (select directorate_id from public.users where id = auth.uid())
      and  s.directorate_id is not null
  );
$$;

-- الخطوة 2: السياسة — تستدعي الدالة فقط، بلا أي استعلام مباشر على users/schools
create policy users_directorate_select_principals on public.users
  for select to authenticated
  using (
    role = 'school_admin'
    and public.is_principal_in_my_directorate(public.users.school_id)
  );

-- ── التحقق: شغّل اللوحة كمستخدم المديرية وافتح تبويب «المدراء» ────────────────
--  أو اعرض كل المدراء وحالة ربط مدارسهم بمديرية:
-- select u.id, u.full_name, u.role, s.name as school, s.directorate_id
-- from   public.users u
-- left   join public.schools s on s.id = u.school_id
-- where  u.role = 'school_admin'
-- order  by s.directorate_id, u.full_name;
