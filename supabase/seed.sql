-- بيانات بذر لاختبار RLS ولتشغيل جميع البوابات محلياً عبر supabase start.
-- يُنشئ مديريةً ومدرستين وحسابات تجريبية لكل الأدوار: مديران مدرسيان
-- ومستخدم مديرية ومستخدم وزارة ومعلمان وربطُ وليّ أمر، مع طلاب وفصول
-- وحضور. الحدّ الأدنى الذي يحتاجه rls-sql-test.mjs + شاشة دخول لكل بوابة.
--
-- كل عبارة idempotent (ON CONFLICT DO NOTHING) — يُعاد تشغيله بأمان.
-- كلمة المرور الموحّدة للحسابات التجريبية: TestPass123!

-- مديرية
INSERT INTO public.directorates (id, name, governorate)
VALUES ('d0000000-0000-0000-0000-000000000001', 'مديرية اختبارية', 'دمشق')
ON CONFLICT DO NOTHING;

-- مدرستان
INSERT INTO public.schools (id, directorate_id, name, school_type)
VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
   'مدرسة ألف الاختبارية', 'primary'),
  ('b0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000001',
   'مدرسة باء الاختبارية', 'primary')
ON CONFLICT DO NOTHING;

-- مستخدمو auth.users (لكل بوابة). كلمة المرور واحدة: TestPass123!
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin-a@ruqi-test.local',
   extensions.crypt('TestPass123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('22222222-2222-2222-2222-222222222222',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin-b@ruqi-test.local',
   extensions.crypt('TestPass123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('33333333-3333-3333-3333-333333333333',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ministry@ruqi-test.local',
   extensions.crypt('TestPass123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-4444-444444444444',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'directorate@ruqi-test.local',
   extensions.crypt('TestPass123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('55555555-5555-5555-5555-555555555555',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teacher-a@ruqi-test.local',
   extensions.crypt('TestPass123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('66666666-6666-6666-6666-666666666666',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teacher-b@ruqi-test.local',
   extensions.crypt('TestPass123!', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT DO NOTHING;

-- صفوف public.users المطابقة (parent لا يدخل هنا — يستعمل OTP)
INSERT INTO public.users
  (id, full_name, role, school_id, directorate_id, permission_role)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'مدير مدرسة ألف',
   'school_admin', 'a0000000-0000-0000-0000-00000000000a', NULL, 'school_admin'),
  ('22222222-2222-2222-2222-222222222222', 'مدير مدرسة باء',
   'school_admin', 'b0000000-0000-0000-0000-00000000000b', NULL, 'school_admin'),
  ('33333333-3333-3333-3333-333333333333', 'موظف الوزارة',
   'ministry_user', NULL, NULL, 'ministry_staff'),
  ('44444444-4444-4444-4444-444444444444', 'موظف المديرية',
   'directorate_user', NULL, 'd0000000-0000-0000-0000-000000000001', 'directorate_staff'),
  ('55555555-5555-5555-5555-555555555555', 'معلم مدرسة ألف',
   'teacher', 'a0000000-0000-0000-0000-00000000000a', NULL, 'teacher'),
  ('66666666-6666-6666-6666-666666666666', 'معلم مدرسة باء',
   'teacher', 'b0000000-0000-0000-0000-00000000000b', NULL, 'teacher')
ON CONFLICT DO NOTHING;

-- فصل لكل مدرسة
INSERT INTO public.classes (id, school_id, name, grade, section, academic_year)
VALUES
  ('ca000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'أول أ', '1', 'أ', '2025-2026'),
  ('cb000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b', 'أول أ', '1', 'أ', '2025-2026')
ON CONFLICT DO NOTHING;

-- ربط المعلم بالفصل (بوابة المعلم تعرض فصولاً حسب هذا الجدول)
INSERT INTO public.class_teacher (class_id, teacher_id)
VALUES
  ('ca000000-0000-0000-0000-00000000000a', '55555555-5555-5555-5555-555555555555'),
  ('cb000000-0000-0000-0000-00000000000b', '66666666-6666-6666-6666-666666666666')
ON CONFLICT DO NOTHING;

-- طالبان لكل مدرسة
INSERT INTO public.students (id, school_id, class_id, full_name, gender, parent_phone)
VALUES
  ('5a000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000a',
   'ca000000-0000-0000-0000-00000000000a', 'طالب ألف-1', 'male',  '+963900000001'),
  ('5a000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-00000000000a',
   'ca000000-0000-0000-0000-00000000000a', 'طالبة ألف-2', 'female', '+963900000002'),
  ('5b000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-00000000000b',
   'cb000000-0000-0000-0000-00000000000b', 'طالب باء-1', 'male',  '+963900000003'),
  ('5b000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-00000000000b',
   'cb000000-0000-0000-0000-00000000000b', 'طالبة باء-2', 'female', '+963900000004')
ON CONFLICT DO NOTHING;

-- حضور يومي (مستوى المدرسة)
INSERT INTO public.daily_attendance (id, school_id, date,
  students_present, students_absent, submitted_by)
VALUES
  ('da000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', CURRENT_DATE, 2, 0,
   '11111111-1111-1111-1111-111111111111'),
  ('da000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b', CURRENT_DATE, 1, 1,
   '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

-- حضور طلاب فردي
INSERT INTO public.daily_student_attendance
  (id, student_id, school_id, class_id, date, status, recorded_by)
VALUES
  ('aa000000-0000-0000-0000-000000000001',
   '5a000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000a',
   'ca000000-0000-0000-0000-00000000000a',
   CURRENT_DATE, 'present', '11111111-1111-1111-1111-111111111111'),
  ('ab000000-0000-0000-0000-000000000001',
   '5b000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-00000000000b',
   'cb000000-0000-0000-0000-00000000000b',
   CURRENT_DATE, 'absent', '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

-- تقديمات حضور
INSERT INTO public.attendance_submissions
  (id, class_id, school_id, date, submitted_by, status)
VALUES
  ('ae000000-0000-0000-0000-00000000000a',
   'ca000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a',
   CURRENT_DATE, '11111111-1111-1111-1111-111111111111', 'confirmed'),
  ('ae000000-0000-0000-0000-00000000000b',
   'cb000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b',
   CURRENT_DATE, '22222222-2222-2222-2222-222222222222', 'pending')
ON CONFLICT DO NOTHING;

-- كادر مدرسي
INSERT INTO public.school_personnel (id, school_id, full_name, kind)
VALUES
  ('5e000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'إداري ألف', 'admin'),
  ('5e000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b', 'إداري باء', 'admin')
ON CONFLICT DO NOTHING;

-- حضور كادر
INSERT INTO public.staff_attendance
  (id, school_id, date, kind, teacher_id, status, recorded_by)
VALUES
  ('5f000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a',
   CURRENT_DATE, 'teacher', '55555555-5555-5555-5555-555555555555',
   'present', '11111111-1111-1111-1111-111111111111'),
  ('5f000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b',
   CURRENT_DATE, 'teacher', '66666666-6666-6666-6666-666666666666',
   'present', '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;
