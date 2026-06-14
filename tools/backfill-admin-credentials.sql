-- ════════════════════════════════════════════════════════════════════════════
--  backfill-admin-credentials.sql
--
--  يُعبّئ جدول admin_credentials للحسابات القديمة (school_admin / directorate_user)
--  التي أُنشئت قبل إضافة الجدول، فتظهر بياناتها في مودال «بيانات الحساب».
--  شغّله في: Supabase Dashboard → SQL Editor
--
--  ما يفعله لكل حساب قديم بلا صف في admin_credentials:
--    1. يُولّد كلمة مرور عشوائية جديدة (12 حرفاً)
--    2. يُعيد تعيين كلمة المرور في auth.users لتطابق المُولَّدة
--    3. يخزّن البريد + كلمة المرور الجديدة في admin_credentials
--
--  ⚠️  تنبيه: هذا يُبطل كلمات المرور الحالية لتلك الحسابات. بعد التشغيل افتح
--      مودال «بيانات الحساب» في اللوحة لقراءة الكلمات الجديدة وأبلغ أصحابها بها.
--
--  آمن للتشغيل أكثر من مرة (idempotent): يتخطّى أي حساب له صف مسبقاً.
--
--  ملاحظة: إن ظهر خطأ «function crypt does not exist» أو «gen_salt does not
--  exist»، استبدل crypt(...) و gen_salt(...) بـ extensions.crypt(...) و
--  extensions.gen_salt(...) على الترتيب.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r      RECORD;
  new_pw TEXT;
BEGIN
  FOR r IN
    SELECT u.id, au.email
    FROM   public.users u
    JOIN   auth.users   au ON au.id = u.id
    WHERE  u.role IN ('school_admin', 'directorate_user')
      AND  au.email IS NOT NULL
      AND  NOT EXISTS (
             SELECT 1 FROM public.admin_credentials c WHERE c.user_id = u.id
           )
  LOOP
    -- كلمة مرور عشوائية مقروءة (12 حرفاً، حروف وأرقام)
    new_pw := substr(
                replace(replace(md5(random()::text || clock_timestamp()::text), '0', 'A'), '1', 'b'),
                1, 12
              );

    -- إعادة تعيين كلمة المرور في المصادقة
    UPDATE auth.users
    SET encrypted_password = crypt(new_pw, gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        updated_at         = NOW()
    WHERE id = r.id;

    -- تخزين البيانات لعرضها في المودال
    INSERT INTO public.admin_credentials (user_id, email, password)
    VALUES (r.id, r.email, new_pw);
  END LOOP;
END $$;

-- ── التحقق: يعرض الحسابات وبياناتها الجديدة ────────────────────────────────
SELECT
  pu.full_name,
  pu.role,
  c.email,
  c.password,
  c.created_at
FROM   public.admin_credentials c
JOIN   public.users pu ON pu.id = c.user_id
ORDER  BY c.created_at DESC;
