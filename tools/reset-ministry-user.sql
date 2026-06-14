-- ════════════════════════════════════════════════════════════════════════════
--  reset-ministry-user.sql
--
--  يُنشئ أو يُعيد ضبط حساب مشرف النظام (ministry_user) مرة واحدة وبشكل آمن.
--  شغّله في: Supabase Dashboard → SQL Editor
--
--  ما يفعله:
--    1. إذا وُجد أي حساب بنطاق @nsams.test يحوّله إلى @nsams.app
--    2. يضبط كلمة المرور لقيمة معروفة
--    3. يؤكّد البريد تلقائياً (بدون حاجة لإرسال رسالة)
--    4. يضمن وجود صف public.users بالدور الصحيح
--
--  آمن للتشغيل أكثر من مرة (idempotent).
-- ════════════════════════════════════════════════════════════════════════════

-- ── الخطوة 1: تحويل أي حساب @nsams.test إلى @nsams.app ─────────────────────
UPDATE auth.users
SET
  email      = replace(email, '@nsams.test', '@nsams.app'),
  updated_at = NOW()
WHERE email LIKE '%@nsams.test';

-- ── الخطوة 2: ضبط كلمة المرور وتأكيد البريد ────────────────────────────────
--
--  *** غيّر كلمة المرور هنا قبل التشغيل ***
--  يجب أن تكون 8 أحرف على الأقل.
--
UPDATE auth.users
SET
  encrypted_password = crypt('Admin@NSAMS2025', gen_salt('bf')),
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  updated_at         = NOW()
WHERE email = 'ministry@nsams.app';

-- ── الخطوة 3: إذا لم يُنشأ الحساب بعد — أنشئه من الصفر ────────────────────
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'ministry@nsams.app',
  crypt('Admin@NSAMS2025', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'ministry@nsams.app'
);

-- ── الخطوة 4: ضمان صف public.users بالدور الصحيح ───────────────────────────
INSERT INTO public.users (id, full_name, role)
SELECT id, 'مشرف النظام', 'ministry_user'
FROM   auth.users
WHERE  email = 'ministry@nsams.app'
ON CONFLICT (id) DO UPDATE
  SET role      = 'ministry_user',
      full_name = COALESCE(public.users.full_name, 'مشرف النظام');

-- ── التحقق: يجب أن يعود صفاً واحداً ────────────────────────────────────────
SELECT
  au.id,
  au.email,
  au.email_confirmed_at IS NOT NULL AS email_confirmed,
  pu.role,
  pu.full_name
FROM   auth.users   au
JOIN   public.users pu ON pu.id = au.id
WHERE  au.email = 'ministry@nsams.app';
