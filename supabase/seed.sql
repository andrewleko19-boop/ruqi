-- بيانات بذر لاختبار RLS محلياً عبر supabase start.
-- يُنشئ مديريةً ومدرستين ومديرَين وطلاباً وفصولاً وحضوراً — الحدّ الأدنى
-- الذي يحتاجه rls-sql-test.mjs ليُثبت أن كل مدرسة معزولة عن الأخرى.
-- كل عبارة idempotent (ON CONFLICT DO NOTHING) — يُعاد تشغيله بأمان.

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

-- مستخدمان في auth.users (مفتاح أجنبي لـ public.users)
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
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT DO NOTHING;

-- مديرا مدرسة
INSERT INTO public.users (id, full_name, role, school_id, permission_role)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'مدير مدرسة ألف', 'school_admin',
   'a0000000-0000-0000-0000-00000000000a', 'school_admin'),
  ('22222222-2222-2222-2222-222222222222',
   'مدير مدرسة باء', 'school_admin',
   'b0000000-0000-0000-0000-00000000000b', 'school_admin')
ON CONFLICT DO NOTHING;

-- فصل لكل مدرسة
INSERT INTO public.classes (id, school_id, name, grade, section, academic_year)
VALUES
  ('ca000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', 'أول أ', '1', 'أ', '2025-2026'),
  ('cb000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b', 'أول أ', '1', 'أ', '2025-2026')
ON CONFLICT DO NOTHING;

-- طالبان لكل مدرسة
INSERT INTO public.students (id, school_id, class_id, full_name, gender)
VALUES
  ('5a000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000a',
   'ca000000-0000-0000-0000-00000000000a', 'طالب ألف-1', 'male'),
  ('5a000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-00000000000a',
   'ca000000-0000-0000-0000-00000000000a', 'طالبة ألف-2', 'female'),
  ('5b000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-00000000000b',
   'cb000000-0000-0000-0000-00000000000b', 'طالب باء-1', 'male'),
  ('5b000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-00000000000b',
   'cb000000-0000-0000-0000-00000000000b', 'طالبة باء-2', 'female')
ON CONFLICT DO NOTHING;

-- حضور يومي (مستوى المدرسة)
INSERT INTO public.daily_attendance (id, school_id, date, total_students,
  present_count, absent_count, submitted_by)
VALUES
  ('da000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a', CURRENT_DATE, 2, 2, 0,
   '11111111-1111-1111-1111-111111111111'),
  ('da000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b', CURRENT_DATE, 2, 1, 1,
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
  ('as000000-0000-0000-0000-00000000000a',
   'ca000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-00000000000a',
   CURRENT_DATE, '11111111-1111-1111-1111-111111111111', 'confirmed'),
  ('as000000-0000-0000-0000-00000000000b',
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
   CURRENT_DATE, 'teacher', '11111111-1111-1111-1111-111111111111',
   'present', '11111111-1111-1111-1111-111111111111'),
  ('5f000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-00000000000b',
   CURRENT_DATE, 'teacher', '22222222-2222-2222-2222-222222222222',
   'present', '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;
