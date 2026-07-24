-- ════════════════════════════════════════════════════════════════════════════
--  NSAMS — Database setup (reference)
--
--  Run this in the Supabase project's SQL Editor. Every statement is
--  idempotent (IF [NOT] EXISTS / DROP POLICY IF EXISTS), so it is safe to
--  re-run after a partial application.
--
--  Prerequisite: the helper function current_user_school_id() must already
--  exist (it is used by the app's existing RLS policies and returns the
--  school_id of the currently-authenticated user).
--
--  NOTE: the app is a client-only PWA — schema lives in Supabase, not in
--  migrations in this repo. This file is committed for REFERENCE only.
--
--  The teacher-account feature also needs the Edge Function
--  `supabase/functions/admin-create-staff` deployed. Its secrets
--  (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) are
--  auto-injected by Supabase — nothing to set, and the service-role key
--  never reaches the browser.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 1 — Staff attendance (دوام الموظفين)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1  Admins & workers roster (no app login)
create table if not exists public.school_personnel (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null,
  full_name   text not null,
  kind        text not null check (kind in ('admin','worker')),
  national_id text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.school_personnel enable row level security;

drop policy if exists sp_admin_all on public.school_personnel;
create policy sp_admin_all on public.school_personnel
  for all to authenticated
  using      (school_id = current_user_school_id())
  with check (school_id = current_user_school_id());

-- 1.2  Per-person daily staff attendance
create table if not exists public.staff_attendance (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null,
  date              date not null,
  kind              text not null check (kind in ('teacher','admin','worker')),
  teacher_id        uuid references public.users(id),
  personnel_id      uuid references public.school_personnel(id),
  status            text not null default 'present' check (status in ('present','absent','leave','late')),
  check_in_original timestamptz,
  check_in_adjusted timestamptz,
  check_out         timestamptz,
  late_minutes      int,
  source            text not null default 'manager' check (source in ('self','manager')),
  adjusted_by       uuid,
  adjust_reason     text,
  note              text,
  recorded_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.staff_attendance enable row level security;

create unique index if not exists staff_att_teacher_date
  on public.staff_attendance (teacher_id, date)   where teacher_id   is not null;
create unique index if not exists staff_att_personnel_date
  on public.staff_attendance (personnel_id, date) where personnel_id is not null;

-- Principal: full access to their school
drop policy if exists sa_admin_all on public.staff_attendance;
create policy sa_admin_all on public.staff_attendance
  for all to authenticated
  using (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'))
  with check (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'));

-- Teacher: read own row + self-sign
drop policy if exists sa_teacher_select on public.staff_attendance;
create policy sa_teacher_select on public.staff_attendance
  for select to authenticated using (teacher_id = auth.uid());

drop policy if exists sa_teacher_insert on public.staff_attendance;
create policy sa_teacher_insert on public.staff_attendance
  for insert to authenticated with check (teacher_id = auth.uid() and source = 'self');

drop policy if exists sa_teacher_update on public.staff_attendance;
create policy sa_teacher_update on public.staff_attendance
  for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- 1.3  Daily aggregate columns + work-start time (lateness calc)
alter table public.daily_attendance
  add column if not exists admins_present  int default 0,
  add column if not exists admins_absent   int default 0,
  add column if not exists workers_present int default 0,
  add column if not exists workers_absent  int default 0,
  add column if not exists teachers_absent int default 0;

alter table public.schools add column if not exists work_start_time time;

grant select, insert, update, delete on public.school_personnel to authenticated;
grant select, insert, update, delete on public.staff_attendance to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 2 — Student information system (SIS) + audit + school identity
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1  Structured student columns (core + optional). The app keeps the existing
--      full_name column populated from first/father/family on every write.
alter table public.students
  add column if not exists first_name       text,
  add column if not exists father_name      text,
  add column if not exists family_name      text,
  add column if not exists birth_date       date,
  add column if not exists mother_name      text,
  add column if not exists mother_family    text,
  add column if not exists grandfather_name text,
  add column if not exists card_number      text,
  add column if not exists birth_place      text,
  add column if not exists contact_phone    text,
  add column if not exists parent_phone     text,
  add column if not exists res_governorate  text,
  add column if not exists res_region       text,
  add column if not exists res_subdistrict  text,
  add column if not exists res_town         text,
  add column if not exists res_sector       text,
  add column if not exists res_block        text,
  add column if not exists res_record       text,   -- column kept; field removed from UI
  add column if not exists recorded_by      uuid,
  add column if not exists created_at        timestamptz default now(),
  add column if not exists updated_at        timestamptz default now();

-- No duplicate national_id within a school (active students only)
create unique index if not exists students_natid_school
  on public.students (school_id, national_id)
  where national_id is not null and is_active;

-- 2.2  Generic audit log (sensitive edits: students now, more later)
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid,
  actor_id   uuid,
  entity     text not null,
  entity_id  uuid,
  action     text not null,
  changes    jsonb,
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (school_id = current_user_school_id());

grant select, insert on public.audit_log to authenticated;

-- 2.3  School identity (lat/lng already exist on schools)
alter table public.schools
  add column if not exists complex_name   text,
  add column if not exists classification text,
  add column if not exists education_type text,
  add column if not exists shift          text,
  add column if not exists student_type   text;

-- 2.4  School UPDATE policy — without it, the admin's UPDATE silently affects
--      0 rows (identity/GPS edits appear to save then vanish on reload).
alter table public.schools enable row level security;
drop policy if exists schools_admin_update on public.schools;
create policy schools_admin_update on public.schools
  for update to authenticated
  using      (id = current_user_school_id())
  with check (id = current_user_school_id());

-- 2.5  audit_log SELECT for ministry_user — lets the admin portal read the full
--      cross-school audit log. The existing audit_log_select policy is school-scoped
--      (school_admin only); this separate policy broadens read access for ministry.
drop policy if exists audit_log_ministry_select on public.audit_log;
create policy audit_log_ministry_select on public.audit_log
  for select to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid()
            and u.role = 'ministry_user')
  );

-- 2.6  schools INSERT/SELECT for ministry_user — the admin portal creates new
--      schools and reads all schools regardless of directorate.
--
--      Table-level GRANT first: RLS policies are only evaluated AFTER Postgres
--      passes the table privilege check. Without this GRANT every write fails
--      with "permission denied for table schools" no matter what policies exist.
grant select, insert, update on public.schools to authenticated;

drop policy if exists schools_ministry_select on public.schools;
create policy schools_ministry_select on public.schools
  for select to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid()
            and u.role = 'ministry_user')
  );

drop policy if exists schools_ministry_insert on public.schools;
create policy schools_ministry_insert on public.schools
  for insert to authenticated
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid()
            and u.role = 'ministry_user')
  );

drop policy if exists schools_ministry_update on public.schools;
create policy schools_ministry_update on public.schools
  for update to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid()
            and u.role = 'ministry_user')
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid()
            and u.role = 'ministry_user')
  );


-- 2.7  إنشاء مستخدم الوزارة (ministry_user) — دليل تشغيل
--
--  لوحة الوزارة (ministry/) تسمح فقط لمستخدم دوره 'ministry_user'. إنشاء هذا
--  الحساب خطوتان: حساب في auth.users (المصادقة)، ثم صف مطابق في public.users
--  (الدور) مربوط بنفس الـ UID.
--
--  ⚠️  تحذير من نطاق .test: Supabase يرفض عناوين البريد ذات النطاقات المحجوزة
--      مثل ‎@example.test أو ‎@nsams.test ("Email address is invalid")، فيفشل
--      إرسال بريد الاسترجاع ولا يمكن إعادة تعيين كلمة المرور عبر البريد. استخدم
--      دائماً نطاقاً صالحاً (مثل ‎@nsams.app) لحسابات الوزارة/المديرية.
--
--  الخطوة 1 — إنشاء حساب المصادقة:
--      Dashboard → Authentication → Users → Add user
--      أدخل بريداً بنطاق صالح وكلمة مرور، وفعّل "Auto Confirm User".
--      انسخ الـ UID الناتج.
--
--  الخطوة 2 — أنشئ صف الدور (استبدل UID والاسم):
--      insert into public.users (id, full_name, role)
--      values ('<UID-من-الخطوة-1>', 'وزارة التربية', 'ministry_user')
--      on conflict (id) do update set role = excluded.role;
--
--  إعادة تعيين كلمة المرور دون بريد (يتجاوز رفض النطاق) — إن لزم:
--      update auth.users
--      set encrypted_password = crypt('<كلمة-مرور-جديدة>', gen_salt('bf')),
--          email_confirmed_at = coalesce(email_confirmed_at, now())
--      where email = '<البريد>';
--      -- إن ظهر "function crypt does not exist" استخدم extensions.crypt / extensions.gen_salt
--
--  إصلاح حساب أُنشئ بنطاق .test (تغيير البريد + كلمة المرور دفعة واحدة):
--      update auth.users
--      set email = '<بريد-بنطاق-صالح>',
--          encrypted_password = crypt('<كلمة-مرور-جديدة>', gen_salt('bf')),
--          email_confirmed_at = coalesce(email_confirmed_at, now())
--      where email = '<البريد-القديم-بنطاق-.test>';
--      -- آمن: الربط مع public.users عبر الـ UID لا البريد، فالدور لا يتأثر.

-- 2.8  is_active على public.users — لعرض حالة التعطيل في لوحة المشرف
--
--  حظر المستخدم يتم عبر auth.admin.updateUserById (ban_duration)، لكن لوحة المشرف
--  تقرأ من public.users فقط ولا ترى حالة الحظر. العمود is_active يُزامَن مع الحظر
--  في Edge Function (admin-create-user / action=deactivate) ليظهر شارة «مُعطَّل»
--  في الجدول بدلاً من زر «تعطيل».
alter table public.users add column if not exists is_active boolean not null default true;


-- 2.9  admin_credentials — حفظ بيانات دخول مدراء المدارس والمديريات
--
--  تُكتب الصفوف عبر Edge Function (service role) عند إنشاء حساب school_admin
--  أو directorate_user. ministry_user يرى الكل؛ directorate_user يرى فقط
--  مدراء مدارس مديريته.
create table if not exists public.admin_credentials (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  email      text not null,
  password   text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
alter table public.admin_credentials enable row level security;

grant select on public.admin_credentials to authenticated;
grant insert, delete on public.admin_credentials to service_role;

drop policy if exists admin_cred_ministry_select on public.admin_credentials;
create policy admin_cred_ministry_select on public.admin_credentials
  for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user')
  );

drop policy if exists admin_cred_directorate_select on public.admin_credentials;
create policy admin_cred_directorate_select on public.admin_credentials
  for select to authenticated
  using (
    exists (
      select 1
      from   public.users     target
      join   public.schools   s  on s.id = target.school_id
      join   public.users     me on me.id = auth.uid()
      where  target.id              = public.admin_credentials.user_id
        and  me.role                = 'directorate_user'
        and  s.directorate_id       = me.directorate_id
    )
  );

-- 2.10  سياسات schools للمديرية (SELECT / INSERT / UPDATE مقيَّد بمديريتها)
drop policy if exists schools_directorate_select on public.schools;
create policy schools_directorate_select on public.schools
  for select to authenticated
  using (
    directorate_id = (select directorate_id from public.users where id = auth.uid())
    and exists (select 1 from public.users where id = auth.uid() and role = 'directorate_user')
  );

drop policy if exists schools_directorate_insert on public.schools;
create policy schools_directorate_insert on public.schools
  for insert to authenticated
  with check (
    directorate_id = (select directorate_id from public.users where id = auth.uid())
    and exists (select 1 from public.users where id = auth.uid() and role = 'directorate_user')
  );

drop policy if exists schools_directorate_update on public.schools;
create policy schools_directorate_update on public.schools
  for update to authenticated
  using (
    directorate_id = (select directorate_id from public.users where id = auth.uid())
    and exists (select 1 from public.users where id = auth.uid() and role = 'directorate_user')
  )
  with check (
    directorate_id = (select directorate_id from public.users where id = auth.uid())
    and exists (select 1 from public.users where id = auth.uid() and role = 'directorate_user')
  );

-- 2.11  users SELECT للمديرية — قراءة مدراء مدارس مديريتها (تبويب «المدراء»)
--
--  مدير المدرسة (school_admin) ينتمي لمديرية عبر مدرسته (schools.directorate_id).
--  بلا هذه السياسة، لا يرى مستخدم المديرية إلا صفّه فقط في public.users فيظهر
--  تبويب «المدراء» فارغاً.
--
--  ⚠️  تحذير العَوْد اللانهائي: لا تستعلم عن public.schools داخل هذه السياسة
--      مباشرةً. قراءة schools تُفعّل سياسة schools_directorate_select التي
--      تستعلم بدورها عن public.users فتُفعّل هذه السياسة من جديد → عَوْد لا نهائي
--      (خطأ 500 على كل استعلام users، بما فيه تسجيل الدخول). الحل: دالة واحدة
--      SECURITY DEFINER تُجري الفحص كاملاً وتتجاوز RLS داخلياً، فلا تعود الحلقة
--      تدخل users/schools إطلاقاً.
create or replace function public.is_principal_in_my_directorate(p_school_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from   public.schools s
    where  s.id            = p_school_id
      and  s.directorate_id = (select directorate_id from public.users where id = auth.uid())
      and  s.directorate_id is not null
  );
$$;

drop policy if exists users_directorate_select_principals on public.users;
create policy users_directorate_select_principals on public.users
  for select to authenticated
  using (
    role = 'school_admin'
    and public.is_principal_in_my_directorate(public.users.school_id)
  );


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 3 — Teacher account credentials (principal-provisioned logins)
--
--  Rows are written by the admin-create-staff Edge Function (service role).
--  RLS makes them readable ONLY by the school's own admin — never the teacher
--  or any other role. The password is stored retrievable by explicit product
--  requirement (mirrors the official app); mitigated by strict RLS.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.staff_credentials (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null,
  user_id    uuid not null references public.users(id) on delete cascade,
  username   text not null unique,
  password   text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.staff_credentials enable row level security;

drop policy if exists staff_cred_admin on public.staff_credentials;
create policy staff_cred_admin on public.staff_credentials
  for all to authenticated
  using (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'))
  with check (school_id = current_user_school_id()
         and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin'));

grant select, insert, update, delete on public.staff_credentials to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 4 — Edge Function (service_role) grants
--
--  The admin-create-staff Edge Function runs as service_role and writes to
--  public.users and public.staff_credentials. service_role bypasses RLS but
--  still needs table-level GRANTs. Without these the insert fails with
--  "permission denied for table users".
-- ════════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on public.users             to service_role;
grant select, insert, update, delete on public.staff_credentials to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 5 — Notifications & Web Push
--
--  طبقتا الإشعارات:
--    أ) داخل التطبيق (مفتوح)  : جدول notifications + Supabase Realtime.
--    ب) خارج التطبيق (مغلق)   : Web Push عبر Edge Function send-push
--                                مُستدعاة من notify_user() عبر pg_net.
--
--  يُنشئ الإشعار: DB Trigger → notify_user() → notifications + send-push.
--  التذكير اليومي: pg_cron يعمل الساعة 09:30 بتوقيت سوريا (06:30 UTC).
--
--  ⚠️  قبل التشغيل:
--    1. ولّد مفاتيح VAPID:  npx web-push generate-vapid-keys
--    2. أضف الأسرار في Supabase → Settings → Edge Functions:
--         VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
--    3. استبدل القيمتين في ALTER DATABASE أدناه بالقيم الحقيقية.
-- ════════════════════════════════════════════════════════════════════════════

-- 5.0  امتدادات مطلوبة
create extension if not exists pg_net    schema extensions;
create extension if not exists pg_cron   schema pg_catalog;

-- 5.0b  (تم حذف ALTER DATABASE — غير مدعوم في Supabase المُدار)

-- 5.1  جدول اشتراكات Web Push
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  -- auth.users (لا public.users): أولياء الأمور موجودون في auth.users فقط.
  -- متوافق رجعياً للموظفين لأن public.users.id = auth.uid().
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth_key   text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists ps_owner on public.push_subscriptions;
create policy ps_owner on public.push_subscriptions
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on public.push_subscriptions to authenticated;
grant select                  on public.push_subscriptions to service_role;

-- 5.2  جدول صندوق الإشعارات
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  -- auth.users (لا public.users): يشمل أولياء الأمور؛ متوافق رجعياً (public.users.id = auth.uid()).
  recipient_id uuid not null references auth.users(id) on delete cascade,
  type         text not null,  -- report_new | report_status | duty_adjusted | attendance_reminder | student_absent
  title        text not null,
  body         text,
  entity       text,
  entity_id    uuid,
  read_at      timestamptz,
  push_sent_at timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.notifications enable row level security;

drop policy if exists notif_owner on public.notifications;
create policy notif_owner on public.notifications
  for all to authenticated
  using      (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

grant select, update on public.notifications to authenticated;
grant select, insert, update on public.notifications to service_role;

-- تفعيل Realtime (يُرسل INSERT للعميل المشترك فوراً)
alter publication supabase_realtime add table public.notifications;

-- 5.2b  إعادة توجيه مفاتيح FK إلى auth.users — لدعم إشعارات أولياء الأمور
--   أولياء الأمور موجودون في auth.users فقط (ليسوا في public.users، عمداً)، بينما
--   كانت notifications.recipient_id و push_subscriptions.user_id تشيران إلى
--   public.users(id). نُعيد توجيههما إلى auth.users(id) (مع إبقاء on delete cascade).
--   متوافق رجعياً تماماً لأن public.users.id = auth.uid(). الـ DO block يكتشف اسم
--   القيد ديناميكياً (قد يختلف بين القواعد) فيُسقطه ثم يُعيد إنشاءه — idempotent.
do $$
declare
  v_constraint text;
begin
  -- notifications.recipient_id → auth.users(id)
  for v_constraint in
    select tc.constraint_name
    from   information_schema.table_constraints tc
    join   information_schema.key_column_usage  kcu
           on  kcu.constraint_name   = tc.constraint_name
           and kcu.constraint_schema = tc.constraint_schema
    where  tc.constraint_type = 'FOREIGN KEY'
      and  tc.table_schema    = 'public'
      and  tc.table_name      = 'notifications'
      and  kcu.column_name    = 'recipient_id'
  loop
    execute format('alter table public.notifications drop constraint %I', v_constraint);
  end loop;
  alter table public.notifications
    add constraint notifications_recipient_id_fkey
    foreign key (recipient_id) references auth.users(id) on delete cascade;

  -- push_subscriptions.user_id → auth.users(id)
  for v_constraint in
    select tc.constraint_name
    from   information_schema.table_constraints tc
    join   information_schema.key_column_usage  kcu
           on  kcu.constraint_name   = tc.constraint_name
           and kcu.constraint_schema = tc.constraint_schema
    where  tc.constraint_type = 'FOREIGN KEY'
      and  tc.table_schema    = 'public'
      and  tc.table_name      = 'push_subscriptions'
      and  kcu.column_name    = 'user_id'
  loop
    execute format('alter table public.push_subscriptions drop constraint %I', v_constraint);
  end loop;
  alter table public.push_subscriptions
    add constraint push_subscriptions_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;
end $$;

-- 5.3  دالة مساعدة: إدراج إشعار + استدعاء send-push عبر pg_net
create or replace function public.notify_user(
  p_recipient_id uuid,
  p_type         text,
  p_title        text,
  p_body         text,
  p_entity       text    default null,
  p_entity_id    uuid    default null
) returns void language plpgsql security definer as $$
declare
  v_notif_id uuid;
  v_url      text;
  v_key      text;
begin
  insert into public.notifications(recipient_id, type, title, body, entity, entity_id)
  values (p_recipient_id, p_type, p_title, p_body, p_entity, p_entity_id)
  returning id into v_notif_id;

  -- استدعاء Edge Function لإرسال Web Push (fire-and-forget — لا يوقف الـ trigger)
  begin
    -- ⚠️ استبدل القيمة الثانية بمفتاح secret من Settings → API قبل التشغيل
    --    (لا تحفظ المفتاح الحقيقي في المستودع — GitHub يحظر دفعه)
    v_url := 'https://xocrzpjfvizgnsybegwr.supabase.co';
    v_key := 'YOUR_SB_SECRET_KEY_HERE';
    if v_url is not null and v_key is not null then
      -- pg_net exposes http_post in the `net` schema (NOT `extensions`, even when
      -- the extension itself is installed there). Its body parameter is jsonb —
      -- passing a bytea (e.g. convert_to(...)) raises "function does not exist",
      -- which the EXCEPTION handler below would silently swallow → no push sent.
      perform net.http_post(
        url     := v_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || v_key
                   ),
        body    := jsonb_build_object(
                     'notificationId', v_notif_id,
                     'recipientId',    p_recipient_id
                   ),
        timeout_milliseconds := 3000
      );
    end if;
  exception when others then
    null;  -- لا نوقف الـ trigger إذا فشل pg_net
  end;
end; $$;

-- 5.4  Trigger ١ — بلاغ جديد → مستخدمو المديرية
create or replace function public.trg_report_new()
returns trigger language plpgsql security definer as $$
declare
  v_school_name text;
  v_dir_id      uuid;
begin
  select s.name, s.directorate_id
  into   v_school_name, v_dir_id
  from   public.schools s
  where  s.id = new.school_id;

  perform public.notify_user(
    u.id,
    'report_new',
    'بلاغ جديد من ' || coalesce(v_school_name, 'مدرسة'),
    coalesce(left(new.description, 120), ''),
    'emergency_reports',
    new.id
  )
  from public.users u
  where u.role = 'directorate_user'
    and u.directorate_id = v_dir_id;

  return new;
end; $$;

drop trigger if exists t_report_new on public.emergency_reports;
create trigger t_report_new
  after insert on public.emergency_reports
  for each row execute function public.trg_report_new();

-- 5.5  Trigger ٢ — تحديث حالة البلاغ → مدير المدرسة
create or replace function public.trg_report_status()
returns trigger language plpgsql security definer as $$
declare v_title text;
begin
  if old.status is not distinct from new.status then return new; end if;

  v_title := case new.status
    when 'acknowledged' then 'تمت مراجعة بلاغك'
    when 'resolved'     then 'تم حل بلاغك'
    else null
  end;
  if v_title is null then return new; end if;

  perform public.notify_user(
    u.id,
    'report_status',
    v_title,
    'رقم البلاغ: ' || coalesce(new.receipt_number, new.id::text),
    'emergency_reports',
    new.id
  )
  from public.users u
  where u.role = 'school_admin'
    and u.school_id = new.school_id;

  return new;
end; $$;

drop trigger if exists t_report_status on public.emergency_reports;
create trigger t_report_status
  after update on public.emergency_reports
  for each row execute function public.trg_report_status();

-- 5.6  Trigger ٣ — تعديل دوام المعلم → إشعار للمعلم
create or replace function public.trg_duty_adjusted()
returns trigger language plpgsql security definer as $$
declare v_status_ar text;
begin
  if new.teacher_id is null then return new; end if;
  if new.adjusted_by is null or new.adjusted_by = new.teacher_id then return new; end if;
  -- في UPDATE نُرسل فقط إذا تغيّر الحقل الفعلي
  if TG_OP = 'UPDATE'
    and old.status               is not distinct from new.status
    and old.check_in_adjusted    is not distinct from new.check_in_adjusted
    and old.check_out            is not distinct from new.check_out
  then return new; end if;

  v_status_ar := case new.status
    when 'present' then 'حاضر'
    when 'absent'  then 'غائب'
    when 'late'    then 'متأخر'
    when 'leave'   then 'إجازة'
    else new.status
  end;

  perform public.notify_user(
    new.teacher_id,
    'duty_adjusted',
    'تعديل سجل دوامك',
    'قام المدير بتعديل دوامك ليوم ' || new.date::text
    || ' — الحالة: ' || v_status_ar,
    'staff_attendance',
    new.id
  );
  return new;
end; $$;

drop trigger if exists t_duty_adjusted on public.staff_attendance;
create trigger t_duty_adjusted
  after insert or update on public.staff_attendance
  for each row execute function public.trg_duty_adjusted();

-- 5.7  pg_cron — تذكير الدوام اليومي (09:30 بتوقيت سوريا = 06:30 UTC)
select cron.schedule(
  'attendance-daily-reminder',
  '30 6 * * *',
  $$
  select public.notify_user(
    u.id,
    'attendance_reminder',
    'تذكير: لم يُرسل سجل الحضور',
    'يرجى إرسال سجل حضور اليوم قبل نهاية الدوام',
    'school',
    s.id
  )
  from public.schools s
  join public.users u
       on u.school_id = s.id and u.role = 'school_admin'
  where not exists (
    select 1 from public.daily_attendance da
    where da.school_id = s.id and da.date = current_date
  );
  $$
);

-- 5.8  Trigger ٤ — تسجيل غياب طالب → إشعار أولياء أمره
--   يُطلق after insert or update على daily_student_attendance. يُشعِر فقط عند
--   الحالة 'absent' (لا late/excused)، ويمنع التكرار: إن كانت OLD.status='absent'
--   فلا حدث جديد (إعادة الحفظ بنفس الحالة لا تُرسل إشعاراً ثانياً). يستدعي
--   notify_user لكل ولي أمر مرتبط بالطالب عبر parent_links.
create or replace function public._notify_parents_absent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if new.status is distinct from 'absent'      then return new; end if;  -- absent فقط
  if old.status is not distinct from 'absent'  then return new; end if;  -- منع التكرار

  select full_name into v_name from public.students where id = new.student_id;

  perform public.notify_user(
    pl.user_id,
    'student_absent',
    'تغيّب ' || coalesce(v_name, 'الطالب'),
    'سُجِّل غياب ابنك/ابنتك بتاريخ ' || new.date::text,
    'daily_student_attendance',
    new.id
  )
  from public.parent_links pl
  where pl.student_id = new.student_id;

  return new;
end; $$;

drop trigger if exists t_notify_parents_absent on public.daily_student_attendance;
create trigger t_notify_parents_absent
  after insert or update on public.daily_student_attendance
  for each row execute function public._notify_parents_absent();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. التزام المدارس اليومي + تذكير يدوي من المديرية (Phase 1)
-- ════════════════════════════════════════════════════════════════════════════

-- 6.1  التزام آخر N يوم لكل مدرسة في مديرية المستخدم الحالي.
--      days_reported يستثني الجمعة والسبت (isodow 5 و6 — عطلة سوريا).
--      reported_today = هل توجد سجلات حضور طلابية اليوم
--      (متوافق مع منطق no_data في getSchoolsAttendanceStatus).
create or replace function public.get_directorate_compliance(p_days integer default 30)
returns table (
  school_id      uuid,
  days_reported  integer,
  reported_today boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_dir uuid;
begin
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';

  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 30;
  end if;

  return query
  select
    dsa.school_id,
    count(distinct dsa.date)
      filter (where extract(isodow from dsa.date) not in (5, 6))::integer,
    bool_or(dsa.date = current_date)
  from public.daily_student_attendance dsa
  join public.schools s on s.id = dsa.school_id
  where s.directorate_id = v_dir
    and dsa.date >  current_date - p_days
    and dsa.date <= current_date
  group by dsa.school_id;
end; $$;

revoke all on function public.get_directorate_compliance(integer) from public, anon;
grant execute on function public.get_directorate_compliance(integer) to authenticated;

-- 6.2  تذكير يدوي من المديرية لمدراء مدرسة لم تُرسل الحضور.
--      يتحقق أن المستدعي directorate_user وأن المدرسة ضمن مديريته.
--      يمنع التكرار: لا يُرسل لنفس المستلم أكثر من مرة كل 30 دقيقة.
--      يعيد عدد المدراء الذين أُرسل إليهم فعلاً (0 = «أُرسل مؤخراً»).
create or replace function public.send_attendance_reminder(p_school_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_dir         uuid;
  v_school_name text;
  v_school_dir  uuid;
  v_sent        integer := 0;
  r             record;
begin
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';

  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  select s.name, s.directorate_id into v_school_name, v_school_dir
  from public.schools s where s.id = p_school_id;

  if v_school_dir is null or v_school_dir is distinct from v_dir then
    raise exception 'غير مصرّح: المدرسة ليست ضمن مديريتك';
  end if;

  for r in
    select u.id
    from public.users u
    where u.role = 'school_admin'
      and u.school_id = p_school_id
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = u.id
          and n.type = 'attendance_reminder'
          and n.created_at > now() - interval '30 minutes'
      )
  loop
    perform public.notify_user(
      r.id,
      'attendance_reminder',
      'تذكير من المديرية: لم يصل سجل حضور اليوم',
      'يرجى إرسال سجل حضور مدرسة ' || coalesce(v_school_name, '') || ' لهذا اليوم.',
      'school',
      p_school_id
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end; $$;

revoke all on function public.send_attendance_reminder(uuid) from public, anon;
grant execute on function public.send_attendance_reminder(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. اتجاهات الحضور — المرحلة الثانية (مديرية / وزارة / مدرسة)
--    ثلاث دوال SECURITY DEFINER بنمط القسم 6:
--    • فحص الدور عبر users + auth.uid() (استثناء لغير المصرّح لهم)
--    • أيام العمل فقط: الجمعة والسبت مستثناة (isodow 5 و 6 — عطلة سوريا)
--    • generate_series + LEFT JOIN كي تظهر الأيام بلا تسجيل كصفوف صفرية
--      (استمرارية المنحنى في المخططات)
--    • سقف p_days بين 1 و 92
-- ════════════════════════════════════════════════════════════════════════════

-- 7.1  اتجاه حضور مديرية المستخدم الحالي عبر آخر N يوم عمل
create or replace function public.get_directorate_trend(p_days integer default 14)
returns table (
  day              date,
  present          integer,
  late             integer,
  absent           integer,
  excused          integer,
  schools_reported integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_dir uuid;
begin
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';

  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 14;
  end if;

  return query
  select
    g.g_day,
    coalesce(t.c_present, 0),
    coalesce(t.c_late, 0),
    coalesce(t.c_absent, 0),
    coalesce(t.c_excused, 0),
    coalesce(t.c_schools, 0)
  from (
    select gs::date as g_day
    from generate_series(current_date - (p_days - 1), current_date, interval '1 day') gs
    where extract(isodow from gs) not in (5, 6)
  ) g
  left join (
    select
      dsa.date                                                as t_day,
      count(*) filter (where dsa.status = 'present')::integer as c_present,
      count(*) filter (where dsa.status = 'late')::integer    as c_late,
      count(*) filter (where dsa.status = 'absent')::integer  as c_absent,
      count(*) filter (where dsa.status = 'excused')::integer as c_excused,
      count(distinct dsa.school_id)::integer                  as c_schools
    from public.daily_student_attendance dsa
    join public.schools s on s.id = dsa.school_id
    where s.directorate_id = v_dir
      and dsa.date >  current_date - p_days
      and dsa.date <= current_date
    group by dsa.date
  ) t on t.t_day = g.g_day
  order by g.g_day;
end; $$;

revoke all on function public.get_directorate_trend(integer) from public, anon;
grant execute on function public.get_directorate_trend(integer) to authenticated;

-- 7.2  الاتجاه الوطني (الوزارة) — نفس الشكل، كل المدارس
create or replace function public.get_ministry_trend(p_days integer default 14)
returns table (
  day              date,
  present          integer,
  late             integer,
  absent           integer,
  excused          integer,
  schools_reported integer
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'ministry_user'
  ) then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي الوزارة فقط';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 14;
  end if;

  return query
  select
    g.g_day,
    coalesce(t.c_present, 0),
    coalesce(t.c_late, 0),
    coalesce(t.c_absent, 0),
    coalesce(t.c_excused, 0),
    coalesce(t.c_schools, 0)
  from (
    select gs::date as g_day
    from generate_series(current_date - (p_days - 1), current_date, interval '1 day') gs
    where extract(isodow from gs) not in (5, 6)
  ) g
  left join (
    select
      dsa.date                                                as t_day,
      count(*) filter (where dsa.status = 'present')::integer as c_present,
      count(*) filter (where dsa.status = 'late')::integer    as c_late,
      count(*) filter (where dsa.status = 'absent')::integer  as c_absent,
      count(*) filter (where dsa.status = 'excused')::integer as c_excused,
      count(distinct dsa.school_id)::integer                  as c_schools
    from public.daily_student_attendance dsa
    where dsa.date >  current_date - p_days
      and dsa.date <= current_date
    group by dsa.date
  ) t on t.t_day = g.g_day
  order by g.g_day;
end; $$;

revoke all on function public.get_ministry_trend(integer) from public, anon;
grant execute on function public.get_ministry_trend(integer) to authenticated;

-- 7.3  اتجاه مدرسة واحدة — للمديرية المالكة أو الوزارة
create or replace function public.get_school_trend(p_school_id uuid, p_days integer default 30)
returns table (
  day     date,
  present integer,
  late    integer,
  absent  integer,
  excused integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_role       text;
  v_dir        uuid;
  v_school_dir uuid;
begin
  select u.role, u.directorate_id into v_role, v_dir
  from public.users u
  where u.id = auth.uid();

  select s.directorate_id into v_school_dir
  from public.schools s where s.id = p_school_id;

  if v_school_dir is null then
    raise exception 'المدرسة غير موجودة';
  end if;

  if not (v_role = 'ministry_user'
          or (v_role = 'directorate_user' and v_dir = v_school_dir)) then
    raise exception 'غير مصرّح: المدرسة ليست ضمن نطاق صلاحيتك';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 30;
  end if;

  return query
  select
    g.g_day,
    coalesce(t.c_present, 0),
    coalesce(t.c_late, 0),
    coalesce(t.c_absent, 0),
    coalesce(t.c_excused, 0)
  from (
    select gs::date as g_day
    from generate_series(current_date - (p_days - 1), current_date, interval '1 day') gs
    where extract(isodow from gs) not in (5, 6)
  ) g
  left join (
    select
      dsa.date                                                as t_day,
      count(*) filter (where dsa.status = 'present')::integer as c_present,
      count(*) filter (where dsa.status = 'late')::integer    as c_late,
      count(*) filter (where dsa.status = 'absent')::integer  as c_absent,
      count(*) filter (where dsa.status = 'excused')::integer as c_excused
    from public.daily_student_attendance dsa
    where dsa.school_id = p_school_id
      and dsa.date >  current_date - p_days
      and dsa.date <= current_date
    group by dsa.date
  ) t on t.t_day = g.g_day
  order by g.g_day;
end; $$;

revoke all on function public.get_school_trend(uuid, integer) from public, anon;
grant execute on function public.get_school_trend(uuid, integer) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. طلبات سير العمل — المدرسة ↔ المديرية (المرحلة الثالثة)
-- ════════════════════════════════════════════════════════════════════════════

-- 8.1  جدول school_requests
create table if not exists public.school_requests (
  id             uuid        primary key default gen_random_uuid(),
  school_id      uuid        not null references public.schools(id) on delete cascade,
  directorate_id uuid        not null,
  type           text        not null
                             check (type in ('add_class','add_student','correct_student')),
  status         text        not null default 'pending'
                             check (status in ('pending','approved','rejected')),
  payload        jsonb       not null default '{}',
  created_by     uuid        not null references auth.users(id),
  reviewed_by    uuid        references auth.users(id),
  review_reason  text,
  applied_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_school_req_dir_status
  on public.school_requests(directorate_id, status, created_at desc);
create index if not exists idx_school_req_school
  on public.school_requests(school_id, created_at desc);

-- 8.2  RLS + صلاحيات الجدول
alter table public.school_requests enable row level security;

-- صلاحيات الجدول الصريحة (RLS وحدها لا تكفي في Supabase)
grant select, insert on public.school_requests to authenticated;
grant update on public.school_requests to authenticated;

-- مدير المدرسة: يُنشئ ويقرأ طلبات مدرسته فقط
drop policy if exists school_req_admin_insert on public.school_requests;
create policy school_req_admin_insert on public.school_requests
  for insert to authenticated
  with check (school_id = current_user_school_id());

drop policy if exists school_req_admin_select on public.school_requests;
create policy school_req_admin_select on public.school_requests
  for select to authenticated
  using (school_id = current_user_school_id());

-- مستخدم المديرية: يقرأ ويُحدّث طلبات مديريته
drop policy if exists school_req_dir_select on public.school_requests;
create policy school_req_dir_select on public.school_requests
  for select to authenticated
  using (directorate_id = current_user_directorate_id());

drop policy if exists school_req_dir_update on public.school_requests;
create policy school_req_dir_update on public.school_requests
  for update to authenticated
  using (directorate_id = current_user_directorate_id());

-- 8.3  دالة المراجعة والتطبيق التلقائي — SECURITY DEFINER
create or replace function public.review_school_request(
  p_request_id uuid,
  p_decision   text,
  p_reason     text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dir     uuid;
  v_req     public.school_requests;
  v_payload jsonb;
begin
  -- تحقق من الدور
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';
  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'قيمة القرار غير صالحة';
  end if;

  -- جلب الطلب وتحقق من الملكية
  select * into v_req
  from public.school_requests r
  where r.id = p_request_id
    and r.directorate_id = v_dir
    and r.status = 'pending';
  if not found then
    raise exception 'الطلب غير موجود أو ليس ضمن نطاق صلاحيتك أو ليس معلقاً';
  end if;

  -- تحديث الحالة
  update public.school_requests set
    status        = p_decision,
    reviewed_by   = auth.uid(),
    review_reason = p_reason,
    updated_at    = now()
  where id = p_request_id;

  -- تطبيق تلقائي عند الموافقة
  if p_decision = 'approved' then
    v_payload := v_req.payload;

    if v_req.type = 'add_class' then
      insert into public.classes(id, school_id, grade, section, academic_year, name)
      values (
        gen_random_uuid(),
        v_req.school_id,
        (v_payload->>'grade')::int,
        v_payload->>'section',
        coalesce(nullif(v_payload->>'academic_year',''),
                 extract(year from now())::text || '-' || (extract(year from now())::int + 1)::text),
        coalesce(nullif(v_payload->>'name',''), '')
      )
      on conflict do nothing;

    elsif v_req.type = 'add_student' then
      insert into public.students(
        id, school_id, class_id,
        first_name, father_name, family_name, full_name,
        national_id, gender, birth_date,
        is_active, recorded_by, updated_at
      ) values (
        gen_random_uuid(),
        v_req.school_id,
        nullif(v_payload->>'class_id','')::uuid,
        nullif(trim(v_payload->>'first_name'),''),
        nullif(trim(v_payload->>'father_name'),''),
        nullif(trim(v_payload->>'family_name'),''),
        trim(concat_ws(' ',
          nullif(trim(v_payload->>'first_name'),''),
          nullif(trim(v_payload->>'father_name'),''),
          nullif(trim(v_payload->>'family_name'),'')))::text,
        nullif(trim(v_payload->>'national_id'),''),
        nullif(v_payload->>'gender',''),
        nullif(v_payload->>'birth_date','')::date,
        true, auth.uid(), now()
      );

    elsif v_req.type = 'correct_student' then
      update public.students set
        first_name  = coalesce(nullif(trim(v_payload->>'first_name'), ''),  first_name),
        father_name = coalesce(nullif(trim(v_payload->>'father_name'),''), father_name),
        family_name = coalesce(nullif(trim(v_payload->>'family_name'),''), family_name),
        birth_date  = coalesce(nullif(v_payload->>'birth_date','')::date,   birth_date),
        national_id = coalesce(nullif(trim(v_payload->>'national_id'),''),  national_id),
        updated_at  = now()
      where id      = (v_payload->>'student_id')::uuid
        and school_id = v_req.school_id;
    end if;

    update public.school_requests
      set applied_at = now()
    where id = p_request_id;
  end if;

  -- إشعار المدرسة بالنتيجة
  perform public.notify_user(
    v_req.created_by,
    case p_decision
      when 'approved' then 'request_approved'
      else                 'request_rejected'
    end,
    case p_decision
      when 'approved' then 'طلبك قُبل ✓'
      else                 'طلبك رُفض'
    end,
    coalesce(p_reason,
      case p_decision
        when 'approved' then 'تمت الموافقة على الطلب وتطبيقه.'
        else                 'رُفض الطلب من قِبل المديرية.'
      end),
    'school_requests',
    p_request_id
  );
end; $$;

revoke all on function public.review_school_request(uuid, text, text) from public, anon;
grant execute on function public.review_school_request(uuid, text, text) to authenticated;

-- 8.4  إشعار المديرية عند وصول طلب جديد
create or replace function public._notify_dir_new_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_school_name text;
begin
  select name into v_school_name from public.schools where id = NEW.school_id;
  perform public.notify_user(
    u.id,
    'request_new',
    'طلب جديد من مدرسة',
    coalesce(v_school_name, 'مدرسة'),
    'school_requests',
    NEW.id
  )
  from public.users u
  where u.directorate_id = NEW.directorate_id
    and u.role = 'directorate_user';
  return NEW;
end; $$;

drop trigger if exists trg_notify_dir_new_request on public.school_requests;
create trigger trg_notify_dir_new_request
  after insert on public.school_requests
  for each row execute function public._notify_dir_new_request();

-- ════════════════════════════════════════════════════════
--  تنظيف لمرة واحدة: مسح أعداد المعلمين/الطلاب الوهمية
--  شغّل هذا بعد تشغيل القسم 8 إذا كانت القيم الحالية وهمية.
--  الخطوة 1: إزالة قيد NOT NULL من العمودين (إذا وُجد)
--  الخطوة 2: مسح القيم
-- ════════════════════════════════════════════════════════
-- alter table public.schools alter column total_teachers drop not null;
-- alter table public.schools alter column total_students  drop not null;
-- update public.schools set total_teachers = null, total_students = null;

-- ════════════════════════════════════════════════════════
--  2.7  (تصلب اختياري) FK لربط audit_log بـ schools
--  يُمكّن PostgREST من تضمين بيانات المدرسة مباشرةً.
--  JavaScript يعمل بدونه (ربط يدوي)، لكن تشغيل هذا
--  يُحسّن الأداء ويُطبّق تكامل البيانات.
-- ════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'audit_log_school_id_fkey'
  ) then
    alter table public.audit_log
      add constraint audit_log_school_id_fkey
      foreign key (school_id) references public.schools(id) on delete set null;
  end if;
end$$;
-- إذا استمر خطأ 400 بعد تشغيل هذا، نفّذ:
-- notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 9 — تقويم العطل الرسمية (Holiday Calendar)
--
--  الجدول: school_holidays — كل مستخدم مصادق يقرأ، ministry_user فقط يكتب.
--  الدالة: is_school_day(date) — تُعيد true إذا كان يوم عمل (ليس جمعة/سبت ولا في العطل).
--  تُستخدم بعدها لاستبدال extract(isodow …) not in (5,6) في RPCs الاتجاهات.
--
--  ⚠️  شغّل هذا القسم أولاً قبل تشغيل القسم 10 (يعتمد على is_school_day).
-- ════════════════════════════════════════════════════════════════════════════

-- 9.1  جدول العطل الرسمية
create table if not exists public.school_holidays (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,
  name       text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
alter table public.school_holidays enable row level security;

drop policy if exists holidays_read on public.school_holidays;
create policy holidays_read on public.school_holidays
  for select to authenticated using (true);

drop policy if exists holidays_ministry_write on public.school_holidays;
create policy holidays_ministry_write on public.school_holidays
  for all to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role = 'ministry_user')
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role = 'ministry_user')
  );

grant select, insert, update, delete on public.school_holidays to authenticated;

-- 9.2  دالة is_school_day — يوم عمل = ليس جمعة/سبت وليس في قائمة العطل
create or replace function public.is_school_day(p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from p_date) not in (5, 6)
     and not exists (select 1 from public.school_holidays h where h.date = p_date);
$$;
grant execute on function public.is_school_day(date) to authenticated;

-- 9.3  تحديث get_directorate_compliance — يستخدم is_school_day بدلاً من isodow
create or replace function public.get_directorate_compliance(p_days integer default 30)
returns table (
  school_id      uuid,
  days_reported  integer,
  reported_today boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_dir uuid;
begin
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';

  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 30;
  end if;

  return query
  select
    dsa.school_id,
    count(distinct dsa.date)
      filter (where public.is_school_day(dsa.date))::integer,
    bool_or(dsa.date = current_date)
  from public.daily_student_attendance dsa
  join public.schools s on s.id = dsa.school_id
  where s.directorate_id = v_dir
    and dsa.date >  current_date - p_days
    and dsa.date <= current_date
  group by dsa.school_id;
end; $$;

revoke all on function public.get_directorate_compliance(integer) from public, anon;
grant execute on function public.get_directorate_compliance(integer) to authenticated;

-- 9.4  تحديث get_directorate_trend — يستخدم is_school_day في generate_series
create or replace function public.get_directorate_trend(p_days integer default 14)
returns table (
  day              date,
  present          integer,
  late             integer,
  absent           integer,
  excused          integer,
  schools_reported integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_dir uuid;
begin
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';

  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 14;
  end if;

  return query
  select
    g.g_day,
    coalesce(t.c_present, 0),
    coalesce(t.c_late, 0),
    coalesce(t.c_absent, 0),
    coalesce(t.c_excused, 0),
    coalesce(t.c_schools, 0)
  from (
    select gs::date as g_day
    from generate_series(current_date - (p_days - 1), current_date, interval '1 day') gs
    where public.is_school_day(gs::date)
  ) g
  left join (
    select
      dsa.date                                                as t_day,
      count(*) filter (where dsa.status = 'present')::integer as c_present,
      count(*) filter (where dsa.status = 'late')::integer    as c_late,
      count(*) filter (where dsa.status = 'absent')::integer  as c_absent,
      count(*) filter (where dsa.status = 'excused')::integer as c_excused,
      count(distinct dsa.school_id)::integer                  as c_schools
    from public.daily_student_attendance dsa
    join public.schools s on s.id = dsa.school_id
    where s.directorate_id = v_dir
      and dsa.date >  current_date - p_days
      and dsa.date <= current_date
    group by dsa.date
  ) t on t.t_day = g.g_day
  order by g.g_day;
end; $$;

revoke all on function public.get_directorate_trend(integer) from public, anon;
grant execute on function public.get_directorate_trend(integer) to authenticated;

-- 9.5  تحديث get_ministry_trend — يستخدم is_school_day
create or replace function public.get_ministry_trend(p_days integer default 14)
returns table (
  day              date,
  present          integer,
  late             integer,
  absent           integer,
  excused          integer,
  schools_reported integer
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'ministry_user'
  ) then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي الوزارة فقط';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 14;
  end if;

  return query
  select
    g.g_day,
    coalesce(t.c_present, 0),
    coalesce(t.c_late, 0),
    coalesce(t.c_absent, 0),
    coalesce(t.c_excused, 0),
    coalesce(t.c_schools, 0)
  from (
    select gs::date as g_day
    from generate_series(current_date - (p_days - 1), current_date, interval '1 day') gs
    where public.is_school_day(gs::date)
  ) g
  left join (
    select
      dsa.date                                                as t_day,
      count(*) filter (where dsa.status = 'present')::integer as c_present,
      count(*) filter (where dsa.status = 'late')::integer    as c_late,
      count(*) filter (where dsa.status = 'absent')::integer  as c_absent,
      count(*) filter (where dsa.status = 'excused')::integer as c_excused,
      count(distinct dsa.school_id)::integer                  as c_schools
    from public.daily_student_attendance dsa
    where dsa.date >  current_date - p_days
      and dsa.date <= current_date
    group by dsa.date
  ) t on t.t_day = g.g_day
  order by g.g_day;
end; $$;

revoke all on function public.get_ministry_trend(integer) from public, anon;
grant execute on function public.get_ministry_trend(integer) to authenticated;

-- 9.6  تحديث get_school_trend — يستخدم is_school_day
create or replace function public.get_school_trend(p_school_id uuid, p_days integer default 30)
returns table (
  day     date,
  present integer,
  late    integer,
  absent  integer,
  excused integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_role       text;
  v_dir        uuid;
  v_school_dir uuid;
begin
  select u.role, u.directorate_id into v_role, v_dir
  from public.users u
  where u.id = auth.uid();

  select s.directorate_id into v_school_dir
  from public.schools s where s.id = p_school_id;

  if v_school_dir is null then
    raise exception 'المدرسة غير موجودة';
  end if;

  if not (v_role = 'ministry_user'
          or (v_role = 'directorate_user' and v_dir = v_school_dir)) then
    raise exception 'غير مصرّح: المدرسة ليست ضمن نطاق صلاحيتك';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 30;
  end if;

  return query
  select
    g.g_day,
    coalesce(t.c_present, 0),
    coalesce(t.c_late, 0),
    coalesce(t.c_absent, 0),
    coalesce(t.c_excused, 0)
  from (
    select gs::date as g_day
    from generate_series(current_date - (p_days - 1), current_date, interval '1 day') gs
    where public.is_school_day(gs::date)
  ) g
  left join (
    select
      dsa.date                                                as t_day,
      count(*) filter (where dsa.status = 'present')::integer as c_present,
      count(*) filter (where dsa.status = 'late')::integer    as c_late,
      count(*) filter (where dsa.status = 'absent')::integer  as c_absent,
      count(*) filter (where dsa.status = 'excused')::integer as c_excused
    from public.daily_student_attendance dsa
    where dsa.school_id = p_school_id
      and dsa.date >  current_date - p_days
      and dsa.date <= current_date
    group by dsa.date
  ) t on t.t_day = g.g_day
  order by g.g_day;
end; $$;

revoke all on function public.get_school_trend(uuid, integer) from public, anon;
grant execute on function public.get_school_trend(uuid, integer) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 10 — إنذار التسرب المبكر (Early Dropout Warning)
--
--  16 يوم غياب في الفصل الواحد → ترقين قيد (threshold قابل للضبط).
--  الصفوف 1-9: يحق العودة بعد 15 يوماً.  الصفوف 10-12: انفصال نهائي.
--  get_dropout_risk_students: يُعيد طلاباً لم يُرقَّن قيدهم بعد.
--  get_directorate_dropout_summary: ملخص للمديرية.
--  pg_cron يومي (06:15 UTC = 09:15 سوريا): فحص + إشعار push لمدير المدرسة.
-- ════════════════════════════════════════════════════════════════════════════

-- 10.1  عمود حد الغياب في المدارس (قابل للتغيير لكل مدرسة)
alter table public.schools
  add column if not exists dropout_threshold_days int not null default 16;

-- 10.2  أعمدة تتبع ترقين القيد في جدول الطلاب
alter table public.students
  add column if not exists dropout_flagged_at  timestamptz,
  add column if not exists dropout_semester    text check (dropout_semester in ('1','2')),
  add column if not exists dropout_grade       int,
  add column if not exists dropout_return_at   date;

-- 10.3  دالة get_dropout_risk_students — طلاب بلغوا حد الغياب ولم يُرقَّن قيدهم
-- أُصلح نوع grade — classes.grade نصي في الإنتاج (CREATE OR REPLACE لا يقبل تغيير نوع الإرجاع)
drop function if exists public.get_dropout_risk_students(uuid);
create or replace function public.get_dropout_risk_students(p_school_id uuid)
returns table (
  student_id   uuid,
  full_name    text,
  grade        text,
  class_id     uuid,
  class_name   text,
  absent_days  bigint,
  threshold    int,
  semester     text
)
language plpgsql security definer set search_path = public as $$
declare
  v_role       text;
  v_caller_dir uuid;
  v_school_dir uuid;
  v_threshold  int;
  v_semester   text;
  v_sem_start  date;
  v_sem_end    date;
begin
  select u.role, u.directorate_id into v_role, v_caller_dir
  from public.users u where u.id = auth.uid();

  select s.directorate_id into v_school_dir
  from public.schools s where s.id = p_school_id;

  if not (
    v_role = 'ministry_user'
    or (v_role = 'directorate_user' and v_caller_dir = v_school_dir)
    or (v_role = 'school_admin' and exists (
          select 1 from public.users u
          where u.id = auth.uid() and u.school_id = p_school_id))
  ) then
    raise exception 'غير مصرّح';
  end if;

  select coalesce(s.dropout_threshold_days, 16) into v_threshold
  from public.schools s where s.id = p_school_id;

  if extract(month from current_date) >= 9 then
    v_semester  := '1';
    v_sem_start := make_date(extract(year from current_date)::int, 9, 1);
    v_sem_end   := make_date(extract(year from current_date)::int + 1, 1, 31);
  else
    v_semester  := '2';
    v_sem_start := make_date(extract(year from current_date)::int, 2, 1);
    v_sem_end   := make_date(extract(year from current_date)::int, 6, 30);
  end if;

  return query
  select
    dsa.student_id,
    stu.full_name,
    c.grade::text,
    c.id   as class_id,
    c.name as class_name,
    count(*) filter (where dsa.status = 'absent')::bigint as absent_days,
    v_threshold,
    v_semester
  from public.daily_student_attendance dsa
  join public.students stu on stu.id = dsa.student_id
  join public.classes  c   on c.id   = dsa.class_id
  where dsa.school_id = p_school_id
    and dsa.date between v_sem_start and least(v_sem_end, current_date)
    and stu.is_active
    and stu.dropout_flagged_at is null
  group by dsa.student_id, stu.full_name, c.grade, c.id, c.name
  having count(*) filter (where dsa.status = 'absent') >= v_threshold
  order by absent_days desc, c.grade, stu.full_name;
end; $$;

revoke all on function public.get_dropout_risk_students(uuid) from public, anon;
grant execute on function public.get_dropout_risk_students(uuid) to authenticated;

-- 10.4  دالة get_directorate_dropout_summary — ملخص التسرب لكل مدرسة في المديرية
create or replace function public.get_directorate_dropout_summary()
returns table (
  school_id     uuid,
  school_name   text,
  at_risk_count bigint,
  flagged_count bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_dir       uuid;
  v_semester  text;
  v_sem_start date;
  v_sem_end   date;
begin
  select u.directorate_id into v_dir
  from public.users u where u.id = auth.uid() and u.role = 'directorate_user';
  if v_dir is null then raise exception 'غير مصرّح'; end if;

  if extract(month from current_date) >= 9 then
    v_semester  := '1';
    v_sem_start := make_date(extract(year from current_date)::int, 9, 1);
    v_sem_end   := make_date(extract(year from current_date)::int + 1, 1, 31);
  else
    v_semester  := '2';
    v_sem_start := make_date(extract(year from current_date)::int, 2, 1);
    v_sem_end   := make_date(extract(year from current_date)::int, 6, 30);
  end if;

  return query
  select
    s.id                                                         as school_id,
    s.name                                                       as school_name,
    -- طلاب بلغوا الحد ولم يُرقَّن قيدهم بعد
    (select count(distinct sub.student_id)
     from public.daily_student_attendance sub
     join public.students st2 on st2.id = sub.student_id
                              and st2.is_active
                              and st2.dropout_flagged_at is null
     where sub.school_id = s.id
       and sub.date between v_sem_start and least(v_sem_end, current_date)
     group by sub.student_id
     having count(*) filter (where sub.status = 'absent')
            >= coalesce(s.dropout_threshold_days, 16)
    )                                                            as at_risk_count,
    -- طلاب مرقَّن قيدهم هذا الفصل
    (select count(*)
     from public.students st3
     where st3.school_id    = s.id
       and st3.dropout_flagged_at is not null
       and st3.dropout_semester = v_semester
    )                                                            as flagged_count
  from public.schools s
  where s.directorate_id = v_dir
  order by s.name;
end; $$;

revoke all on function public.get_directorate_dropout_summary() from public, anon;
grant execute on function public.get_directorate_dropout_summary() to authenticated;

-- 10.5  pg_cron يومي — فحص التسرب وإشعار المدير (09:15 سوريا = 06:15 UTC)
--       يتخطى أيام العطل (is_school_day).
--       يُحدّث dropout_flagged_at فقط مرة واحدة لكل طالب.
select cron.schedule(
  'dropout-daily-check',
  '15 6 * * *',
  $cron$
  do $$
  declare
    s          record;
    r          record;
    v_sem      text;
    v_sem_start date;
    v_sem_end   date;
    v_return_at date;
  begin
    if not public.is_school_day(current_date) then return; end if;

    if extract(month from current_date) >= 9 then
      v_sem       := '1';
      v_sem_start := make_date(extract(year from current_date)::int, 9, 1);
      v_sem_end   := make_date(extract(year from current_date)::int + 1, 1, 31);
    else
      v_sem       := '2';
      v_sem_start := make_date(extract(year from current_date)::int, 2, 1);
      v_sem_end   := make_date(extract(year from current_date)::int, 6, 30);
    end if;

    for s in
      select id, coalesce(dropout_threshold_days, 16) as threshold
      from public.schools
    loop
      for r in
        select
          dsa.student_id,
          stu.full_name,
          c.grade,
          count(*) filter (where dsa.status = 'absent') as absent_days
        from public.daily_student_attendance dsa
        join public.students stu on stu.id = dsa.student_id
        join public.classes  c   on c.id   = dsa.class_id
        where dsa.school_id = s.id
          and dsa.date between v_sem_start and current_date
          and stu.is_active
          and stu.dropout_flagged_at is null
        group by dsa.student_id, stu.full_name, c.grade
        having count(*) filter (where dsa.status = 'absent') >= s.threshold
      loop
        v_return_at := case when r.grade <= 9 then current_date + 15 else null end;

        update public.students set
          dropout_flagged_at = now(),
          dropout_semester   = v_sem,
          dropout_grade      = r.grade,
          dropout_return_at  = v_return_at
        where id = r.student_id and dropout_flagged_at is null;

        perform public.notify_user(
          u.id,
          'dropout_warning',
          'إنذار تسرب: ' || r.full_name,
          'الطالب/ة غاب ' || r.absent_days || ' يوماً في الفصل ' || v_sem
          || case when r.grade <= 9
                  then ' — يحق له تقديم العودة بعد 15 يوماً'
                  else ' — يُعدّ منفصلاً نهائياً (الصف ' || r.grade || ')'
             end,
          'students',
          r.student_id
        )
        from public.users u
        where u.school_id = s.id and u.role = 'school_admin';
      end loop;
    end loop;
  end;
  $$ language plpgsql;
  $cron$
);


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 11 — ملخص تغطية الدرجات (Grades Coverage Summary)
--
--  RPC خفيفة للمديرية: كم صفاً، كم مادة، كم إدخال درجات لكل مدرسة.
--  الحكم الفعلي (ناجح/راسب) يُحسب client-side لتجنّب تكرار منطق الشرائح.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_directorate_grades_coverage()
returns table (
  school_id      uuid,
  school_name    text,
  classes_count  bigint,
  subjects_count bigint,
  entries_count  bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_dir  uuid;
  v_year text;
begin
  select u.directorate_id into v_dir
  from public.users u where u.id = auth.uid() and u.role = 'directorate_user';
  if v_dir is null then raise exception 'غير مصرّح'; end if;

  v_year := case
    when extract(month from current_date) >= 9
    then extract(year from current_date)::text || '-'
         || (extract(year from current_date)::int + 1)::text
    else (extract(year from current_date)::int - 1)::text || '-'
         || extract(year from current_date)::text
  end;

  return query
  select
    s.id,
    s.name,
    count(distinct sg.class_id)   as classes_count,
    count(distinct sg.subject_id) as subjects_count,
    count(*)                      as entries_count
  from public.schools s
  left join public.student_grades sg
         on sg.school_id    = s.id
        and sg.academic_year = v_year
  where s.directorate_id = v_dir
  group by s.id, s.name
  order by s.name;
end; $$;

revoke all on function public.get_directorate_grades_coverage() from public, anon;
grant execute on function public.get_directorate_grades_coverage() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 12 — الترفيع السنوي والأرشفة
-- ════════════════════════════════════════════════════════════════════════════

-- 12.1  جدول نتائج نهاية العام (يُكتب client-side قبل استدعاء RPC الترفيع)
create table if not exists public.student_year_results (
  student_id    uuid not null references public.students(id) on delete cascade,
  academic_year text not null,
  result        text not null check (result in ('ناجح','راسب')),
  final_percent numeric(5,2),
  recorded_by   uuid references public.users(id),
  recorded_at   timestamptz not null default now(),
  primary key (student_id, academic_year)
);
alter table public.student_year_results enable row level security;

-- القراءة مقيَّدة بالدور (كانت using(true) تُسرّب نتائج كل الطلاب لأي مستخدم مصادَق
-- بما فيهم أولياء الأمور). نقصر القراءة على: كادر مدرسة الطالب، ومستخدم المديرية
-- التابعة لها المدرسة، ومستخدم الوزارة، وولي الأمر المرتبط بالطالب فقط.
drop policy if exists syr_read on public.student_year_results;
create policy syr_read on public.student_year_results
  for select to authenticated
  using (
    -- كادر مدرسة الطالب (نفس نطاق الكتابة)
    exists (
      select 1 from public.students s
      join public.classes c on c.id = s.class_id
      join public.users   u on u.school_id = c.school_id and u.id = auth.uid()
      where s.id = student_year_results.student_id
    )
    -- مستخدم المديرية: مدارس مديريته فقط
    or exists (
      select 1 from public.students s
      join public.classes c  on c.id  = s.class_id
      join public.schools sc on sc.id = c.school_id
      join public.users   me on me.id = auth.uid()
      where s.id = student_year_results.student_id
        and me.role = 'directorate_user'
        and sc.directorate_id = me.directorate_id
    )
    -- مستخدم الوزارة: على مستوى القطر
    or exists (
      select 1 from public.users me
      where me.id = auth.uid() and me.role = 'ministry_user'
    )
    -- ولي الأمر: أبناؤه المرتبطون فقط
    or (
      public.current_user_is_parent() and exists (
        select 1 from public.parent_links pl
        where pl.user_id = auth.uid() and pl.student_id = student_year_results.student_id
      )
    )
  );

drop policy if exists syr_write on public.student_year_results;
create policy syr_write on public.student_year_results
  for all to authenticated
  using (exists (
    select 1 from public.students s
    join public.classes c on c.id = s.class_id
    join public.users u on u.school_id = c.school_id and u.id = auth.uid()
    where s.id = student_year_results.student_id
  ))
  with check (exists (
    select 1 from public.students s
    join public.classes c on c.id = s.class_id
    join public.users u on u.school_id = c.school_id and u.id = auth.uid()
    where s.id = student_year_results.student_id
  ));

grant select, insert, update on public.student_year_results to authenticated;

-- 12.2  RPC: upsert_year_results — كتابة جماعية للنتائج من المتصفح
create or replace function public.upsert_year_results(
  p_class_id uuid,
  p_results  jsonb   -- [{student_id, academic_year, result, final_percent}]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid;
begin
  select c.school_id into v_school_id from public.classes c where c.id = p_class_id;
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.school_id = v_school_id and u.role = 'school_admin'
  ) then raise exception 'غير مصرّح'; end if;

  insert into public.student_year_results(student_id, academic_year, result, final_percent, recorded_by)
  select
    (r->>'student_id')::uuid,
    r->>'academic_year',
    r->>'result',
    (r->>'final_percent')::numeric,
    auth.uid()
  from jsonb_array_elements(p_results) r
  on conflict (student_id, academic_year) do update set
    result        = excluded.result,
    final_percent = excluded.final_percent,
    recorded_by   = excluded.recorded_by,
    recorded_at   = now();
end; $$;

revoke all on function public.upsert_year_results(uuid, jsonb) from public, anon;
grant execute on function public.upsert_year_results(uuid, jsonb) to authenticated;

-- 12.3  RPC: execute_annual_promotion — ترفيع/إعادة/تخريج لصف واحد
create or replace function public.execute_annual_promotion(p_class_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_grade        int;
  v_section      text;
  v_school_id    uuid;
  v_acad_year    text;
  v_next_year    text;
  v_promoted     int := 0;
  v_repeated     int := 0;
  v_graduated    int := 0;
  v_skipped      int := 0;
  r              record;
  v_target_grade int;
  v_target_cid   uuid;
begin
  select c.grade, c.section, c.school_id, c.academic_year
  into v_grade, v_section, v_school_id, v_acad_year
  from public.classes c where c.id = p_class_id;
  if not found then raise exception 'الصف غير موجود'; end if;

  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.school_id = v_school_id and u.role = 'school_admin'
  ) then raise exception 'غير مصرّح'; end if;

  v_next_year := (split_part(v_acad_year,'-',1)::int + 1)::text
              || '-'
              || (split_part(v_acad_year,'-',1)::int + 2)::text;

  for r in
    select s.id as student_id, s.full_name, yr.result
    from public.students s
    left join public.student_year_results yr
           on yr.student_id = s.id and yr.academic_year = v_acad_year
    where s.class_id = p_class_id and s.is_active = true
  loop
    if r.result is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- الصف 12 + ناجح → تخريج
    if v_grade = 12 and r.result = 'ناجح' then
      update public.students set is_active = false where id = r.student_id;
      insert into public.audit_log(actor_id, school_id, entity, action, changes)
      values (auth.uid(), v_school_id, 'student', 'graduate',
              jsonb_build_object('academic_year', v_acad_year, 'grade', v_grade, 'name', r.full_name));
      v_graduated := v_graduated + 1;
      continue;
    end if;

    v_target_grade := case when r.result = 'ناجح' then v_grade + 1 else v_grade end;

    -- إيجاد أو إنشاء صف العام الجديد
    select id into v_target_cid from public.classes
    where school_id = v_school_id
      and grade = v_target_grade
      and section = v_section
      and academic_year = v_next_year
    limit 1;

    if v_target_cid is null then
      insert into public.classes(id, school_id, grade, section, academic_year, name)
      values (gen_random_uuid(), v_school_id, v_target_grade, v_section, v_next_year,
              'الصف ' || v_target_grade || ' / ' || v_section)
      returning id into v_target_cid;
    end if;

    update public.students set class_id = v_target_cid where id = r.student_id;
    insert into public.audit_log(actor_id, school_id, entity, action, changes)
    values (auth.uid(), v_school_id, 'student', 'promote',
            jsonb_build_object('from_class', p_class_id, 'to_class', v_target_cid,
                               'result', r.result, 'academic_year', v_acad_year, 'name', r.full_name));

    if r.result = 'ناجح' then v_promoted := v_promoted + 1;
    else v_repeated := v_repeated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'promoted',  v_promoted,
    'repeated',  v_repeated,
    'graduated', v_graduated,
    'skipped',   v_skipped
  );
end; $$;

revoke all on function public.execute_annual_promotion(uuid) from public, anon;
grant execute on function public.execute_annual_promotion(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 13 — التقارير الشهرية
-- ════════════════════════════════════════════════════════════════════════════

-- 13.1  جدول التقارير الدورية
create table if not exists public.periodic_reports (
  id          uuid primary key default gen_random_uuid(),
  report_type text not null default 'monthly',
  period      text not null,    -- 'YYYY-MM'
  scope       text not null,    -- 'directorate' | 'national'
  scope_id    uuid,             -- directorate_id (null للوطني)
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
alter table public.periodic_reports enable row level security;

drop policy if exists pr_select on public.periodic_reports;
create policy pr_select on public.periodic_reports
  for select to authenticated
  using (
    exists (
      select 1 from public.users u where u.id = auth.uid() and (
        u.role = 'ministry_user'
        or (u.role = 'directorate_user'
            and scope = 'directorate'
            and u.directorate_id = periodic_reports.scope_id)
      )
    )
  );

grant select on public.periodic_reports to authenticated;
grant insert, update on public.periodic_reports to service_role;

-- 13.2  RPC: get_periodic_reports — قراءة التقارير المتاحة
create or replace function public.get_periodic_reports(p_scope text default 'directorate')
returns table (
  id         uuid,
  period     text,
  scope      text,
  scope_id   uuid,
  data       jsonb,
  created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_dir uuid;
begin
  select u.role, u.directorate_id into v_role, v_dir
  from public.users u where u.id = auth.uid();

  if p_scope = 'national' then
    if v_role <> 'ministry_user' then raise exception 'غير مصرّح'; end if;
    return query
    select pr.id, pr.period, pr.scope, pr.scope_id, pr.data, pr.created_at
    from public.periodic_reports pr
    where pr.scope = 'national'
    order by pr.period desc;
  else
    if v_role not in ('directorate_user','ministry_user') then raise exception 'غير مصرّح'; end if;
    return query
    select pr.id, pr.period, pr.scope, pr.scope_id, pr.data, pr.created_at
    from public.periodic_reports pr
    where pr.scope = 'directorate'
      and (v_role = 'ministry_user' or pr.scope_id = v_dir)
    order by pr.period desc;
  end if;
end; $$;

revoke all on function public.get_periodic_reports(text) from public, anon;
grant execute on function public.get_periodic_reports(text) to authenticated;

-- 13.3  دالة توليد التقارير الشهرية (تُستدعى من pg_cron)
create or replace function public.generate_monthly_reports()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_period      text;
  v_month_start date;
  v_month_end   date;
  d             record;
  v_dir_data    jsonb;
  v_report_id   uuid;
  v_nat_schools int := 0;
  v_nat_present int := 0;
  v_nat_absent  int := 0;
  v_nat_dropout int := 0;
  v_nat_reports int := 0;
begin
  v_period      := to_char(current_date - interval '1 month', 'YYYY-MM');
  v_month_start := date_trunc('month', current_date - interval '1 month')::date;
  v_month_end   := (date_trunc('month', current_date) - interval '1 day')::date;

  for d in select id, name from public.directorates loop
    select jsonb_build_object(
      'directorate_id',    d.id,
      'directorate_name',  d.name,
      'period',            v_period,
      'schools_count',     count(distinct s.id),
      'present_count',     coalesce(sum(case when dsa.status in ('present','late','excused') then 1 else 0 end), 0),
      'absent_count',      coalesce(sum(case when dsa.status = 'absent' then 1 else 0 end), 0),
      'attendance_rate',   case when count(dsa.id) > 0
                           then round(100.0 * sum(case when dsa.status in ('present','late','excused') then 1 else 0 end)
                                      / nullif(count(dsa.id),0), 1)
                           else 0 end,
      'reporting_days',    count(distinct dsa.date),
      'dropout_flagged',   (select count(distinct stu2.id) from public.students stu2
                            join public.schools s2 on s2.id = stu2.school_id
                            where s2.directorate_id = d.id and stu2.dropout_flagged_at is not null),
      'emergency_reports', (select count(*) from public.emergency_reports er2
                            join public.schools s2 on s2.id = er2.school_id
                            where s2.directorate_id = d.id
                              and er2.created_at::date between v_month_start and v_month_end)
    )
    into v_dir_data
    from public.schools s
    left join public.daily_student_attendance dsa
           on dsa.school_id = s.id and dsa.date between v_month_start and v_month_end
    where s.directorate_id = d.id;

    -- حذف التقرير القديم إن وجد ثم إدراج الجديد
    delete from public.periodic_reports where period = v_period and scope = 'directorate' and scope_id = d.id;
    insert into public.periodic_reports(report_type, period, scope, scope_id, data)
    values ('monthly', v_period, 'directorate', d.id, v_dir_data)
    returning id into v_report_id;

    -- إشعار مستخدمي المديرية
    perform public.notify_user(
      u.id, 'periodic_report_ready',
      'التقرير الشهري — ' || v_period,
      'تقرير شهر ' || v_period || ' جاهز للعرض والطباعة',
      'periodic_report', v_report_id
    )
    from public.users u
    where u.directorate_id = d.id and u.role = 'directorate_user';

    v_nat_schools := v_nat_schools + coalesce((v_dir_data->>'schools_count')::int, 0);
    v_nat_present := v_nat_present + coalesce((v_dir_data->>'present_count')::int, 0);
    v_nat_absent  := v_nat_absent  + coalesce((v_dir_data->>'absent_count')::int,  0);
    v_nat_dropout := v_nat_dropout + coalesce((v_dir_data->>'dropout_flagged')::int, 0);
    v_nat_reports := v_nat_reports + coalesce((v_dir_data->>'emergency_reports')::int, 0);
  end loop;

  -- التقرير الوطني
  delete from public.periodic_reports where period = v_period and scope = 'national' and scope_id is null;
  insert into public.periodic_reports(report_type, period, scope, scope_id, data)
  values ('monthly', v_period, 'national', null, jsonb_build_object(
    'period',            v_period,
    'schools_count',     v_nat_schools,
    'present_count',     v_nat_present,
    'absent_count',      v_nat_absent,
    'attendance_rate',   case when (v_nat_present + v_nat_absent) > 0
                         then round(100.0 * v_nat_present / (v_nat_present + v_nat_absent), 1)
                         else 0 end,
    'dropout_flagged',   v_nat_dropout,
    'emergency_reports', v_nat_reports
  ))
  returning id into v_report_id;

  -- إشعار مستخدمي الوزارة
  perform public.notify_user(
    u.id, 'periodic_report_ready',
    'التقرير الشهري الوطني — ' || v_period,
    'التقرير الشهري الوطني لشهر ' || v_period || ' جاهز',
    'periodic_report', v_report_id
  )
  from public.users u where u.role = 'ministry_user';
end; $$;

revoke all on function public.generate_monthly_reports() from public, anon;
grant execute on function public.generate_monthly_reports() to service_role;

-- 13.4  pg_cron: أول كل شهر 09:00 سوريا (06:00 UTC)
select cron.schedule(
  'monthly-report-generator',
  '0 6 1 * *',
  $$ select public.generate_monthly_reports(); $$
);

-- ════════════════════════════════════════════════════════════════════════════
--  14. البيان الشهري الرسمي — سجل الكوادر والقوائم المرجعية
--
--  جداول جديدة:
--    lookup_lists            — قوائم مرجعية مركزية (مدار من المشرف)
--    staff_records           — سجل الكوادر البشرية (حساس - مدير المدرسة فقط)
--    staff_leaves            — الإجازات الشهرية للكوادر
--    monthly_statements      — البيانات الشهرية + سير الموافقة
--    monthly_statement_changes — التعديلات الطارئة الشهرية
--
--  أعمدة جديدة على schools:
--    statistical_number, cycle, rural_curriculum
--
--  Prerequisite: current_user_school_id(), current_user_directorate_id()
--  يجب أن تكون معرَّفتين (§1 أنشأهما). القسم idempotent — آمن لإعادة التشغيل.
-- ════════════════════════════════════════════════════════════════════════════

-- 14.1  أعمدة إضافية على schools لاستكمال بيانات البيان الشهري
alter table public.schools
  add column if not exists statistical_number text,         -- الرقم الإحصائي
  add column if not exists cycle              text,         -- الحلقة: 1|2|3|1+2|2+3|1+2+3
  add column if not exists rural_curriculum  boolean default false; -- منهاج ريفي

-- ────────────────────────────────────────────────────────────────────────────
-- 14.2  القوائم المرجعية المركزية
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.lookup_lists (
  id             uuid        primary key default gen_random_uuid(),
  directorate_id uuid        references public.directorates(id) on delete cascade,
  list_type      text        not null
                 check (list_type in (
                   'admin_role','specialization','certificate','higher_degree',
                   'leave_type','ministerial_doc','support_job','educational_zone'
                 )),
  value          text        not null,   -- النص العربي يُخزَّن كما هو (يُسهّل تصدير Excel)
  sort_order     int         not null default 0,
  active         boolean     not null default true,
  created_at     timestamptz not null default now()
);

-- فهرس فريد: يسمح بنفس القيمة في مديريات مختلفة لكن لا تكرار داخل نفس المديرية/النظامي
create unique index if not exists lookup_lists_uniq
  on public.lookup_lists (
    list_type,
    value,
    coalesce(directorate_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.lookup_lists enable row level security;

drop policy if exists lookup_authenticated_select  on public.lookup_lists;
drop policy if exists lookup_ministry_write        on public.lookup_lists;

create policy lookup_authenticated_select on public.lookup_lists
  for select to authenticated
  using (active = true);

create policy lookup_ministry_write on public.lookup_lists
  for all to authenticated
  using      (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'));

grant select, insert, update, delete on public.lookup_lists to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 14.2b  فهرس المواد المركزي (يُدار من لوحة المشرف / الوزارة)
--   قائمة أسماء المواد على مستوى النظام. مدير المدرسة يختار منها لكل صف، فتُنشأ
--   صفوف public.subjects الخاصة بذلك الصف (بمكوّناتها/درجاتها). نفس نموذج صلاحيات
--   lookup_lists: قراءة لكل مصادَق، وكتابة لمستخدم الوزارة فقط.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.subject_catalog (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null unique,
  is_core_arabic boolean     not null default false,   -- مادة عربية أساسية (عتبة نجاح ٥٠)
  is_core_math   boolean     not null default false,   -- مادة رياضيات أساسية
  sort_order     int         not null default 0,
  active         boolean     not null default true,
  created_at     timestamptz not null default now()
);
alter table public.subject_catalog enable row level security;

drop policy if exists subject_catalog_select on public.subject_catalog;
drop policy if exists subject_catalog_write  on public.subject_catalog;

create policy subject_catalog_select on public.subject_catalog
  for select to authenticated
  using (active = true);

create policy subject_catalog_write on public.subject_catalog
  for all to authenticated
  using      (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'));

grant select, insert, update, delete on public.subject_catalog to authenticated;

-- مكوّنات المادة في الفهرس المركزي (يعرّفها المشرف مرّة، وتُنسخ لمواد الصفوف عند
-- اختيار المدير). نفس صلاحيات subject_catalog.
create table if not exists public.subject_catalog_components (
  id         uuid        primary key default gen_random_uuid(),
  catalog_id uuid        not null references public.subject_catalog(id) on delete cascade,
  name       text        not null,
  max_mark   int         not null default 0,
  sort_order int         not null default 0
);
alter table public.subject_catalog_components enable row level security;

drop policy if exists subject_catalog_comp_select on public.subject_catalog_components;
drop policy if exists subject_catalog_comp_write  on public.subject_catalog_components;

create policy subject_catalog_comp_select on public.subject_catalog_components
  for select to authenticated using (true);

create policy subject_catalog_comp_write on public.subject_catalog_components
  for all to authenticated
  using      (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'));

grant select, insert, update, delete on public.subject_catalog_components to authenticated;

-- قواعد النجاح حسب مجموعة الصفوف (يديرها المشرف) — نفس الاسم بدرجات دنيا مختلفة
-- لكل مجموعة. core_pass للعربي والرياضيات الأساسية، default_pass لبقية المواد.
create table if not exists public.grade_pass_rules (
  id           uuid        primary key default gen_random_uuid(),
  grade_from   int         not null,
  grade_to     int         not null,
  default_pass int         not null default 40,
  core_pass    int         not null default 50,
  sort_order   int         not null default 0
);
alter table public.grade_pass_rules enable row level security;

drop policy if exists grade_pass_rules_select on public.grade_pass_rules;
drop policy if exists grade_pass_rules_write  on public.grade_pass_rules;

create policy grade_pass_rules_select on public.grade_pass_rules
  for select to authenticated using (true);

create policy grade_pass_rules_write on public.grade_pass_rules
  for all to authenticated
  using      (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'));

grant select, insert, update, delete on public.grade_pass_rules to authenticated;

-- البذور الافتراضية وفق النظام الداخلي (تُدرَج مرّة إن كان الجدول فارغاً)
insert into public.grade_pass_rules (grade_from, grade_to, default_pass, core_pass, sort_order)
select * from (values (1, 4, 41, 41, 0), (5, 12, 40, 50, 1)) as v(f, t, d, c, s)
where not exists (select 1 from public.grade_pass_rules);

-- ════════════════════════════════════════════════════════════════════════════
-- 15. درجات المساعدة — اقتراح المعلّم واعتماد المدير + فرض السقوف على الخادم
--   القواعد (النظام الداخلي): ١٠ درجات كحدّ أقصى للمادة، وزمرتا العربية تُعدّان
--   مادة واحدة (≤١٠ مجتمعتين)، و٥٠ درجة كحدّ أقصى في المواد جميعها.
--   ⚠️ student_grace موجود في Supabase مسبقاً (لا CREATE TABLE في المستودع):
--      student_id, class_id, school_id, academic_year, subject_id (null = المجموع),
--      marks, granted_by, granted_at
-- ════════════════════════════════════════════════════════════════════════════

-- 15.1  فهرس فريد يمنع تكرار صفوف المساعدة لنفس (الطالب/الصف/السنة/المادة)
create unique index if not exists student_grace_uniq
  on public.student_grace (
    student_id, class_id, academic_year,
    coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- 15.2  اقتراحات المعلّمين
create table if not exists public.grace_proposals (
  id            uuid        primary key default gen_random_uuid(),
  student_id    uuid        not null references public.students(id) on delete cascade,
  class_id      uuid        not null references public.classes(id)  on delete cascade,
  school_id     uuid        not null references public.schools(id)  on delete cascade,
  academic_year text        not null,
  subject_id    uuid,                       -- null = اقتراح على المجموع
  marks         int         not null check (marks > 0 and marks <= 10),
  reason        text,
  proposed_by   uuid        references auth.users(id),
  status        text        not null default 'pending'
                check (status in ('pending','approved','rejected')),
  decided_by    uuid        references auth.users(id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.grace_proposals enable row level security;
create index if not exists grace_proposals_class_idx
  on public.grace_proposals (class_id, academic_year, status);

drop policy if exists grace_prop_teacher_rw on public.grace_proposals;
drop policy if exists grace_prop_admin_rw   on public.grace_proposals;

-- المعلّم: يقرأ/ينشئ اقتراحاته لصفوف يدرّسها فقط
create policy grace_prop_teacher_rw on public.grace_proposals
  for all to authenticated
  using      (proposed_by = auth.uid() and public.teaches_class(class_id))
  with check (proposed_by = auth.uid() and public.teaches_class(class_id));

-- مدير المدرسة: يقرأ ويقرّر كل اقتراحات مدرسته
create policy grace_prop_admin_rw on public.grace_proposals
  for all to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role = 'school_admin'
              and u.school_id = grace_proposals.school_id)
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role = 'school_admin'
              and u.school_id = grace_proposals.school_id)
  );

grant select, insert, update on public.grace_proposals to authenticated;

-- 15.3  grant_grace — المسار الوحيد للكتابة في student_grace (يفرض السقوف ذرّيّاً)
create or replace function public.grant_grace(
  p_student       uuid,
  p_class         uuid,
  p_academic_year text,
  p_items         jsonb          -- [{subject_id: uuid|null, marks: int}]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school     uuid;
  v_total      int := 0;
  v_arabic     int := 0;
  v_item       jsonb;
  v_marks      int;
  v_subject    uuid;
begin
  -- ١) المستدعي مدير مدرسة الصف
  select c.school_id into v_school from public.classes c where c.id = p_class;
  if v_school is null then raise exception 'صف غير موجود'; end if;
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'school_admin' and u.school_id = v_school
  ) then
    raise exception 'غير مصرّح: درجات المساعدة يمنحها مدير المدرسة';
  end if;

  -- ٢) فرض السقوف: ١٠ لكل مادة، زمرتا العربية ≤١٠ مجتمعتين، والإجمالي ≤٥٠
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_marks   := coalesce((v_item->>'marks')::int, 0);
    v_subject := nullif(v_item->>'subject_id', '')::uuid;
    if v_marks <= 0 then continue; end if;
    if v_marks > 10 then
      raise exception 'الحد الأقصى ١٠ درجات لكل مادة';
    end if;
    v_total := v_total + v_marks;
    if v_subject is not null and exists (
      select 1 from public.subjects s where s.id = v_subject and s.is_core_arabic
    ) then
      v_arabic := v_arabic + v_marks;
    end if;
  end loop;
  if v_arabic > 10 then
    raise exception 'زمرتا اللغة العربية تُعدّان مادة واحدة: الحد ١٠ درجات';
  end if;
  if v_total > 50 then
    raise exception 'الحد الأقصى ٥٠ درجة مساعدة في المواد جميعها';
  end if;

  -- ٣) استبدال ذرّي داخل المعاملة نفسها
  delete from public.student_grace
   where student_id = p_student and class_id = p_class and academic_year = p_academic_year;

  insert into public.student_grace
    (student_id, class_id, school_id, academic_year, subject_id, marks, granted_by, granted_at)
  select p_student, p_class, v_school, p_academic_year,
         nullif(it->>'subject_id', '')::uuid, (it->>'marks')::int, auth.uid(), now()
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it
   where coalesce((it->>'marks')::int, 0) > 0;
end; $$;

revoke all on function public.grant_grace(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.grant_grace(uuid, uuid, text, jsonb) to authenticated;

-- امنع الكتابة المباشرة: كل المنح يمرّ عبر grant_grace
revoke insert, update, delete on public.student_grace from authenticated;

-- 15.4  decide_grace_proposal — اعتماد/رفض اقتراح معلّم (مدير المدرسة فقط)
create or replace function public.decide_grace_proposal(
  p_id       uuid,
  p_decision text                -- approved | rejected
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p       public.grace_proposals;
  v_items   jsonb;
  v_name    text;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'قرار غير صالح';
  end if;
  select * into v_p from public.grace_proposals where id = p_id;
  if v_p.id is null then raise exception 'الاقتراح غير موجود'; end if;
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'school_admin' and u.school_id = v_p.school_id
  ) then
    raise exception 'غير مصرّح';
  end if;

  if p_decision = 'approved' then
    -- ادمج الاقتراح مع المساعدة الحالية: صفّ المادة المقترحة يُستبدل بقيمة
    -- الاقتراح، وبقية الصفوف تبقى كما هي. ثم أعد فرض السقوف عبر grant_grace.
    select coalesce(jsonb_agg(jsonb_build_object('subject_id', sub_id, 'marks', mk)), '[]'::jsonb)
      into v_items
    from (
      select g.subject_id as sub_id, g.marks as mk
        from public.student_grace g
       where g.student_id    = v_p.student_id
         and g.class_id      = v_p.class_id
         and g.academic_year = v_p.academic_year
         and g.subject_id is distinct from v_p.subject_id
      union all
      select v_p.subject_id, v_p.marks
    ) merged(sub_id, mk);

    perform public.grant_grace(v_p.student_id, v_p.class_id, v_p.academic_year, v_items);

    -- أعلِم ولي الأمر (اللائحة: يُعلَم ولي الأمر بدرجات المساعدة)
    select full_name into v_name from public.students where id = v_p.student_id;
    perform public.notify_user(
      pl.user_id, 'grace_granted',
      'درجات مساعدة لـ ' || coalesce(v_name, 'ابنك/ابنتك'),
      'مُنحت ' || v_p.marks || ' درجة مساعدة وفق النظام الداخلي',
      'student_grace', v_p.student_id
    )
    from public.parent_links pl
    where pl.student_id = v_p.student_id;
  end if;

  update public.grace_proposals
     set status = p_decision, decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end; $$;

revoke all on function public.decide_grace_proposal(uuid, text) from public, anon;
grant execute on function public.decide_grace_proposal(uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 14.3  Seed القوائم النظامية (مستخرجة من ورقة «قوائم» في ملف البيان الرسمي)
--       directorate_id = null → قائمة نظامية مشتركة لكل المديريات
-- ────────────────────────────────────────────────────────────────────────────
insert into public.lookup_lists (list_type, value, sort_order) values
  -- العمل المسند (الجهاز الإداري)
  ('admin_role', 'مدير',                   1),
  ('admin_role', 'معاون مدير',             2),
  ('admin_role', 'تسيير أمور (إدارة)',     3),
  ('admin_role', 'توجيه',                  4),
  ('admin_role', 'أمانة سر',              5),
  ('admin_role', 'معاون أمين سر',         6),
  ('admin_role', 'أمانة مكتبة',           7),
  ('admin_role', 'معاون أمين مكتبة',      8),
  ('admin_role', 'أمين مخبر',             9),
  ('admin_role', 'م. أمين مخبر',         10),
  ('admin_role', 'أمين سر حاسوب',        11),
  ('admin_role', 'م. أمين سر حاسوب',    12),
  ('admin_role', 'مشرف جاهزية',          13),
  ('admin_role', 'إشراف صحي',            14),
  ('admin_role', 'إرشاد اجتماعي',        15),
  ('admin_role', 'إرشاد نفسي',           16),
  ('admin_role', 'أمين مشغل',            17),
  ('admin_role', 'أنشطة لاصفية',         18),
  ('admin_role', 'كاتب',                  19),
  -- الاختصاص (جهاز إداري + تدريسي)
  ('specialization', 'معلم صف',            1),
  ('specialization', 'مكتبات',             2),
  ('specialization', 'إرشاد نفسي',        3),
  ('specialization', 'إرشاد اجتماعي',     4),
  ('specialization', 'إدارة وتخطيط',      5),
  ('specialization', 'مناهج',              6),
  ('specialization', 'أهلية تعليم',       7),
  ('specialization', 'ق.38',              8),
  ('specialization', 'تعميق تأهيل',       9),
  ('specialization', 'عربي',             10),
  ('specialization', 'رياضيات',          11),
  ('specialization', 'تجاري مصرفي',     12),
  ('specialization', 'تجارة واقتصاد',   13),
  ('specialization', 'فيزياء+كيمياء',   14),
  ('specialization', 'تاريخ',            15),
  ('specialization', 'جغرافية',          16),
  ('specialization', 'علوم',             17),
  ('specialization', 'معلوماتية',        18),
  ('specialization', 'معهد موسيقا',      19),
  ('specialization', 'رياضة',            20),
  ('specialization', 'فنون',             21),
  ('specialization', 'انكليزي',          22),
  ('specialization', 'فرنسي',            23),
  ('specialization', 'روسي',             24),
  ('specialization', 'إسلامية',          25),
  ('specialization', 'مسيحية',           26),
  ('specialization', 'تربية',            27),
  ('specialization', 'علوم سياسية',      28),
  ('specialization', 'أعمال يدوية',      29),
  ('specialization', 'اقتصاد منزلي',    30),
  ('specialization', 'تربية عسكرية',    31),
  ('specialization', 'تقنيات حاسوب',    32),
  ('specialization', 'حقوق',             33),
  ('specialization', 'فلسفة',            34),
  ('specialization', 'مهندس',            35),
  ('specialization', 'احتياط',           36),
  ('specialization', 'كاتب',             37),
  ('specialization', 'غير محدد',         38),
  -- الشهادة
  ('certificate', 'جامعة',       1),
  ('certificate', 'معهد',        2),
  ('certificate', 'ثانوية',      3),
  ('certificate', 'أهلية تعليم', 4),
  ('certificate', 'إعدادية',    5),
  ('certificate', 'لا يوجد',    6),
  ('certificate', 'أخرى',       7),
  -- شهادات عليا
  ('higher_degree', 'دبلوم',    1),
  ('higher_degree', 'ماجستير',  2),
  ('higher_degree', 'دكتوراه',  3),
  -- نوع الإجازة
  ('leave_type', 'صحية',  1),
  ('leave_type', 'أمومة', 2),
  ('leave_type', 'بلا أجر', 3),
  ('leave_type', 'مأجورة', 4),
  -- الموافقة الوزارية
  ('ministerial_doc', 'محافظة', 1),
  ('ministerial_doc', 'تربية',  2),
  -- العمل المسند (مهني ومستخدم وحارس)
  ('support_job', 'مستخدم', 1),
  ('support_job', 'حارس',   2),
  ('support_job', 'مهني',   3)
  -- educational_zone: لا seed نظامي — يحررها المشرف لكل مديرية
  -- (مثال اللاذقية: الحفة، القرداحة، جبلة، مدينة، منطقة)
on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 14.4  سجل الكوادر البشرية
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_records (
  id               uuid         primary key default gen_random_uuid(),
  school_id        uuid         not null references public.schools(id) on delete cascade,
  staff_type       text         not null
                   check (staff_type in ('admin','teaching','professional','worker','guard')),
  -- بيانات شخصية — حساسة (المدير فقط)
  national_id      text,
  full_name        text         not null,
  mother_name      text,
  birth_date       date,
  -- مؤهلات
  certificate      text,        -- من lookup_lists 'certificate'
  higher_degree    text,        -- من lookup_lists 'higher_degree'
  specialization   text,        -- من lookup_lists 'specialization'
  subject_taught   text,        -- للتدريسيين: المادة المُدرَّسة
  -- وظيفة
  seniority_years  numeric(4,1) default 0,
  job_title        text,        -- من lookup_lists 'admin_role' أو 'support_job'
  start_date       date,
  -- اتصال + سكن — حساسة
  phone            text,
  residential_zone text,        -- المنطقة السكنية (حرة)
  educational_zone text,        -- من lookup_lists 'educational_zone' (تابعة للمديرية)
  -- ملاك
  roster_type      text         not null default 'inside'
                   check (roster_type in ('inside','outside','contract')),
  ministerial_doc  text,        -- من lookup_lists 'ministerial_doc'
  notes            text,
  active           boolean      not null default true,
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

create index if not exists staff_records_school_type
  on public.staff_records (school_id, staff_type)
  where active = true;

alter table public.staff_records enable row level security;

drop policy if exists staff_records_school_admin on public.staff_records;

-- school_admin: كامل CRUD لسجلات مدرسته (البيانات حساسة — لا select للمديرية مباشرة)
create policy staff_records_school_admin on public.staff_records
  for all to authenticated
  using (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  )
  with check (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  );

grant select, insert, update, delete on public.staff_records to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 14.5  RPC: get_school_staff_for_directorate — قراءة منقّحة بدون الحقول الحساسة
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_school_staff_for_directorate(p_school_id uuid)
returns table (
  id               uuid,
  staff_type       text,
  full_name        text,
  certificate      text,
  higher_degree    text,
  specialization   text,
  subject_taught   text,
  seniority_years  numeric,
  job_title        text,
  start_date       date,
  educational_zone text,
  roster_type      text,
  ministerial_doc  text,
  active           boolean
)
language plpgsql security definer
set search_path = public
as $$
begin
  -- تحقق: المستدعي directorate_user وصاحب المدرسة في مديريته
  if not exists (
    select 1 from public.users u
    join public.schools s on s.id = p_school_id
    where u.id = auth.uid()
      and u.role = 'directorate_user'
      and u.directorate_id = s.directorate_id
  ) then
    raise exception 'access denied';
  end if;

  return query
    select
      sr.id, sr.staff_type, sr.full_name, sr.certificate, sr.higher_degree,
      sr.specialization, sr.subject_taught, sr.seniority_years, sr.job_title,
      sr.start_date, sr.educational_zone, sr.roster_type, sr.ministerial_doc, sr.active
    from public.staff_records sr
    where sr.school_id = p_school_id and sr.active = true
    order by sr.staff_type, sr.job_title, sr.full_name;
end;
$$;

revoke all on function public.get_school_staff_for_directorate(uuid) from public, anon;
grant execute on function public.get_school_staff_for_directorate(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 14.6  إجازات الكوادر الشهرية
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_leaves (
  id          uuid        primary key default gen_random_uuid(),
  staff_id    uuid        not null references public.staff_records(id) on delete cascade,
  school_id   uuid        not null references public.schools(id) on delete cascade,
  leave_type  text        not null,  -- من lookup_lists 'leave_type'
  leave_days  int         not null check (leave_days > 0),
  month       smallint    not null check (month between 1 and 12),
  year        smallint    not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists staff_leaves_school_period
  on public.staff_leaves (school_id, year, month);

alter table public.staff_leaves enable row level security;

drop policy if exists staff_leaves_school_admin    on public.staff_leaves;
drop policy if exists staff_leaves_directorate_sel on public.staff_leaves;

create policy staff_leaves_school_admin on public.staff_leaves
  for all to authenticated
  using (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  )
  with check (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  );

-- المديرية: select فقط لمدارس مديريتها (أيام الإجازة غير حساسة — مطلوبة لمراجعة البيان)
create policy staff_leaves_directorate_sel on public.staff_leaves
  for select to authenticated
  using (
    exists (
      select 1 from public.schools s
      where s.id = staff_leaves.school_id
        and s.directorate_id = current_user_directorate_id()
    )
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'directorate_user')
  );

grant select, insert, update, delete on public.staff_leaves to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 14.7  سجل البيانات الشهرية
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_statements (
  id             uuid        primary key default gen_random_uuid(),
  school_id      uuid        not null references public.schools(id) on delete cascade,
  month          smallint    not null check (month between 1 and 12),
  year           smallint    not null,
  status         text        not null default 'draft'
                 check (status in ('draft','submitted','approved','rejected')),
  snapshot_data  jsonb       not null default '{}',  -- لقطة البيان وقت الإرسال
  notes          text,                               -- ملاحظة المديرية (رفض / موافقة)
  submitted_at   timestamptz,
  reviewed_by    uuid        references auth.users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists monthly_statements_school_period
  on public.monthly_statements (school_id, year, month);

alter table public.monthly_statements enable row level security;

drop policy if exists stmt_school_insert     on public.monthly_statements;
drop policy if exists stmt_school_select     on public.monthly_statements;
drop policy if exists stmt_school_update     on public.monthly_statements;
drop policy if exists stmt_dir_select        on public.monthly_statements;
drop policy if exists stmt_dir_update        on public.monthly_statements;

-- school_admin: إنشاء بيان
create policy stmt_school_insert on public.monthly_statements
  for insert to authenticated
  with check (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  );

-- school_admin: قراءة بيانات مدرسته
create policy stmt_school_select on public.monthly_statements
  for select to authenticated
  using (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  );

-- school_admin: تعديل المسودة والمرفوض فقط (لا يلمس المعتمد)
create policy stmt_school_update on public.monthly_statements
  for update to authenticated
  using (
    school_id = current_user_school_id()
    and status in ('draft','rejected')
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  )
  with check (
    school_id = current_user_school_id()
    and status in ('draft','submitted')  -- يحرر مسودة ويرسل، لا يعود للمرفوض مباشرةً
  );

-- directorate_user: قراءة بيانات مدارس مديريته
create policy stmt_dir_select on public.monthly_statements
  for select to authenticated
  using (
    exists (
      select 1 from public.schools s
      where s.id = monthly_statements.school_id
        and s.directorate_id = current_user_directorate_id()
    )
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'directorate_user')
  );

-- directorate_user: مراجعة البيانات المُرسَلة فقط (يوافق أو يرفض)
create policy stmt_dir_update on public.monthly_statements
  for update to authenticated
  using (
    exists (
      select 1 from public.schools s
      where s.id = monthly_statements.school_id
        and s.directorate_id = current_user_directorate_id()
    )
    and status = 'submitted'
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'directorate_user')
  )
  with check (status in ('approved','rejected'));

grant select, insert, update on public.monthly_statements to authenticated;
-- لا delete: البيان الشهري سجل رسمي لا يُحذف

-- ────────────────────────────────────────────────────────────────────────────
-- 14.8  التعديلات الطارئة الشهرية
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_statement_changes (
  id             uuid        primary key default gen_random_uuid(),
  statement_id   uuid        not null references public.monthly_statements(id) on delete cascade,
  school_id      uuid        not null references public.schools(id) on delete cascade,
  change_type    text        not null
                 check (change_type in ('added','removed','modified','leave','transfer')),
  staff_id       uuid        references public.staff_records(id) on delete set null,
  change_data    jsonb       not null default '{}',
  reason         text,
  effective_date date,
  created_at     timestamptz not null default now()
);

create index if not exists stmt_changes_statement
  on public.monthly_statement_changes (statement_id);

alter table public.monthly_statement_changes enable row level security;

drop policy if exists stmt_changes_school_admin on public.monthly_statement_changes;
drop policy if exists stmt_changes_dir_sel      on public.monthly_statement_changes;

create policy stmt_changes_school_admin on public.monthly_statement_changes
  for all to authenticated
  using (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  )
  with check (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  );

create policy stmt_changes_dir_sel on public.monthly_statement_changes
  for select to authenticated
  using (
    exists (
      select 1 from public.schools s
      where s.id = monthly_statement_changes.school_id
        and s.directorate_id = current_user_directorate_id()
    )
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'directorate_user')
  );

grant select, insert, update, delete on public.monthly_statement_changes to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 14.9  سير موافقة البيان الشهري (مدرسة → مديرية)
--   يحاكي review_school_request + _notify_dir_new_request (القسم 6).
-- ────────────────────────────────────────────────────────────────────────────

-- 14.9.1  RPC مراجعة البيان — المديرية توافق/ترفض بياناً مُرسَلاً وتُشعر المدرسة
create or replace function public.review_monthly_statement(
  p_statement_id uuid,
  p_decision     text,
  p_notes        text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dir         uuid;
  v_stmt        public.monthly_statements;
  v_school_name text;
begin
  -- تحقق من الدور
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';
  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'قيمة القرار غير صالحة';
  end if;

  -- جلب البيان وتحقق من الملكية والحالة
  select s.* into v_stmt
  from public.monthly_statements s
  join public.schools sc on sc.id = s.school_id
  where s.id = p_statement_id
    and sc.directorate_id = v_dir
    and s.status = 'submitted';
  if not found then
    raise exception 'البيان غير موجود أو خارج نطاق صلاحيتك أو ليس مُرسَلاً';
  end if;

  -- تحديث الحالة
  update public.monthly_statements set
    status      = p_decision,
    notes       = p_notes,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at  = now()
  where id = p_statement_id;

  select name into v_school_name from public.schools where id = v_stmt.school_id;

  -- إشعار جميع مدراء المدرسة بالنتيجة
  perform public.notify_user(
    u.id,
    case p_decision when 'approved' then 'statement_approved' else 'statement_rejected' end,
    case p_decision when 'approved' then 'اعتُمد البيان الشهري ✓' else 'رُفض البيان الشهري' end,
    coalesce(p_notes,
      case p_decision
        when 'approved' then 'تمت الموافقة على البيان.'
        else                 'رُفض البيان من قبل المديرية.'
      end),
    'monthly_statements',
    p_statement_id
  )
  from public.users u
  where u.school_id = v_stmt.school_id and u.role = 'school_admin';
end; $$;

revoke all on function public.review_monthly_statement(uuid, text, text) from public, anon;
grant execute on function public.review_monthly_statement(uuid, text, text) to authenticated;

-- 14.9.2  Trigger إشعار المديرية عند إرسال بيان جديد (draft/none → submitted)
create or replace function public._notify_dir_statement_submitted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dir         uuid;
  v_school_name text;
begin
  -- يُطلق فقط عند الانتقال إلى حالة submitted (لا عند approved/rejected/draft)
  if NEW.status <> 'submitted' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status = 'submitted' then return NEW; end if;  -- تجنّب التكرار

  select directorate_id, name into v_dir, v_school_name
  from public.schools where id = NEW.school_id;

  perform public.notify_user(
    u.id,
    'statement_submitted',
    'بيان شهري جديد للمراجعة',
    coalesce(v_school_name, 'مدرسة') || ' — ' || NEW.month || '/' || NEW.year,
    'monthly_statements',
    NEW.id
  )
  from public.users u
  where u.directorate_id = v_dir and u.role = 'directorate_user';
  return NEW;
end; $$;

drop trigger if exists trg_notify_dir_statement_submitted on public.monthly_statements;
create trigger trg_notify_dir_statement_submitted
  after insert or update on public.monthly_statements
  for each row execute function public._notify_dir_statement_submitted();


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION P — Parent Portal (بوابة ولي الأمر)
--
--  ⚠️  خطوتان منفصلتان في SQL Editor (PostgreSQL لا يسمح باستخدام قيمة enum
--  جديدة في نفس transaction التي أُضيفت فيها):
--
--  الخطوة 1: شغِّل سطر P.1 وحده → Run → انتظر "Success"
--  الخطوة 2: شغِّل بقية القسم (P.2 فصاعداً) دفعةً واحدة
-- ════════════════════════════════════════════════════════════════════════════

-- P.1 — تمديد enum الأدوار (RUN THIS ALONE FIRST, THEN RUN THE REST SEPARATELY)
alter type public.user_role add value if not exists 'parent';

-- ─── من هنا تبدأ الخطوة 2 (بعد نجاح P.1 أعلاه) ───────────────────────────

-- P.2 — رموز التحقق OTP (تُخزَّن مُجزَّأة، تُدار حصراً من Edge Function)
create table if not exists public.parent_otps (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  attempts    smallint not null default 0,
  created_at  timestamptz default now()
);
alter table public.parent_otps enable row level security;
create index if not exists parent_otps_phone_idx on public.parent_otps(phone, expires_at);

-- لا سياسات مباشرة من المتصفح — Edge Function تكتب بـ service_role فقط
-- المتصفح لا يملك أي صلاحية على هذا الجدول
drop policy if exists parent_otps_no_access on public.parent_otps;
create policy parent_otps_no_access on public.parent_otps
  for all to authenticated using (false);

-- service_role bypasses RLS but still needs object-level GRANT
grant select, insert, update on public.parent_otps to service_role;

-- P.3 — ربط المستخدم (parent) بطلابه المرتبطين
create table if not exists public.parent_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  linked_at   timestamptz default now(),
  unique(user_id, student_id)
);
alter table public.parent_links enable row level security;

drop policy if exists parent_read_own_links on public.parent_links;
create policy parent_read_own_links on public.parent_links
  for select to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.parent_links to service_role;

-- P.4 — عذر الغياب المُقدَّم من ولي الأمر
create table if not exists public.absence_excuses (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students(id),
  school_id       uuid not null references public.schools(id),
  date            date not null,
  reason          text not null,
  photo_url       text,
  status          text not null default 'pending'
                  check (status in ('pending','accepted','rejected')),
  submitted_by    uuid references auth.users(id),
  reviewed_by     uuid references public.users(id),
  review_note     text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(student_id, date)
);
alter table public.absence_excuses enable row level security;
create index if not exists absence_excuses_school_date_idx
  on public.absence_excuses(school_id, date desc);

-- P.5 — دالة مساعدة (تعرّف ولي الأمر من بريده في auth.users — لا تحتاج public.users)
create or replace function public.current_user_is_parent()
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and email like '%@parent.nsams.local'
  )
$$;

-- P.5a — تطبيع الهاتف: يختزل أي صيغة إلى جوهرها الوطني (مثال: 9XXXXXXXX)
-- ‎+963961234567 / 0961234567 / 00963961234567 / 963961234567 / 961234567
-- تعطي جميعها النتيجة نفسها — فيتطابق الربط مهما اختلفت صيغة الإدخال.
create or replace function public._nsams_phone_core(raw text)
returns text
language sql
immutable
as $$
  select case
    when raw is null then null
    else (
      select case
        when d like '00963%' then substr(d, 6)
        when d like '963%'   then substr(d, 4)
        when d like '0%'     then substr(d, 2)
        else d
      end
      from (select regexp_replace(raw, '[^0-9]', '', 'g') as d) t
    )
  end
$$;
grant execute on function public._nsams_phone_core(text) to authenticated;

-- P.5b — ربط ولي الأمر بطلابه عند القراءة (self-healing, محصّن)
-- يستخرج الهاتف من بريد المصادقة {phone}@parent.nsams.local، يختزله إلى جوهره،
-- ثم يطابقه على جوهر contact_phone أو parent_phone لكل طالب نشط ويبني
-- parent_links الناقصة. يُستدعى من الواجهة عند كل فتح فلا يعتمد الربط على لحظة
-- التحقق فقط — ويعمل مع البيانات الموجودة في contact_phone ومع أي صيغة هاتف.
create or replace function public.parent_sync_links()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  myemail text;
  myphone text;
  mycore  text;
  n integer;
begin
  select email into myemail from auth.users where id = auth.uid();
  if myemail is null or myemail not like '%@parent.nsams.local' then
    return 0;
  end if;

  myphone := split_part(myemail, '@', 1);          -- ‎+9639XXXXXXXX
  mycore  := public._nsams_phone_core(myphone);    -- 9XXXXXXXX
  if mycore is null or length(mycore) < 6 then
    return 0;
  end if;

  insert into public.parent_links (user_id, student_id)
  select auth.uid(), s.id
    from public.students s
   where s.is_active = true
     and (
       public._nsams_phone_core(s.parent_phone)  = mycore
       or public._nsams_phone_core(s.contact_phone) = mycore
     )
  on conflict (user_id, student_id) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.parent_sync_links() to authenticated;

-- P.6 — سياسات RLS لقراءة بيانات الطالب من ولي الأمر

-- الطلاب: ولي الأمر يرى أبناءه المرتبطين فقط
drop policy if exists parent_read_linked_students on public.students;
create policy parent_read_linked_students on public.students
  for select to authenticated
  using (
    current_user_is_parent() and exists (
      select 1 from public.parent_links pl
      where pl.user_id = auth.uid() and pl.student_id = students.id
    )
  );

-- الغيابات اليومية: ولي الأمر يرى غيابات أبنائه فقط
drop policy if exists parent_read_linked_attendance on public.daily_student_attendance;
create policy parent_read_linked_attendance on public.daily_student_attendance
  for select to authenticated
  using (
    current_user_is_parent() and exists (
      select 1 from public.parent_links pl
      where pl.user_id = auth.uid() and pl.student_id = daily_student_attendance.student_id
    )
  );

-- الدرجات: ولي الأمر يرى درجات أبنائه فقط
drop policy if exists parent_read_linked_grades on public.student_grades;
create policy parent_read_linked_grades on public.student_grades
  for select to authenticated
  using (
    current_user_is_parent() and exists (
      select 1 from public.parent_links pl
      where pl.user_id = auth.uid() and pl.student_id = student_grades.student_id
    )
  );

-- العطل الرسمية: أي مستخدم أصيل يستطيع القراءة (يشمل ولي الأمر)
drop policy if exists authenticated_read_holidays on public.school_holidays;
create policy authenticated_read_holidays on public.school_holidays
  for select to authenticated using (true);

-- المواد الدراسية: ولي الأمر يرى مواد مدرسة أبنائه (لازمة للـ JOIN في استعلام الدرجات)
drop policy if exists parent_read_subjects on public.subjects;
create policy parent_read_subjects on public.subjects
  for select to authenticated
  using (
    current_user_is_parent() and exists (
      select 1 from public.parent_links pl
      join public.students s on s.id = pl.student_id
      where pl.user_id = auth.uid() and s.school_id = subjects.school_id
    )
  );

-- مكونات المواد: ولي الأمر يرى مكونات مواد أبنائه (لازمة للـ JOIN في استعلام الدرجات)
drop policy if exists parent_read_components on public.subject_components;
create policy parent_read_components on public.subject_components
  for select to authenticated
  using (
    current_user_is_parent() and exists (
      select 1 from public.subjects sub
      join public.parent_links pl on true
      join public.students s on s.id = pl.student_id
      where sub.id = subject_components.subject_id
        and pl.user_id = auth.uid()
        and s.school_id = sub.school_id
    )
  );

-- P.7 — سياسات عذر الغياب

-- ولي الأمر يُدرج/يقرأ أعذار أبنائه المرتبطين فقط
drop policy if exists parent_insert_excuse on public.absence_excuses;
create policy parent_insert_excuse on public.absence_excuses
  for insert to authenticated
  with check (
    current_user_is_parent() and exists (
      select 1 from public.parent_links pl
      where pl.user_id = auth.uid() and pl.student_id = absence_excuses.student_id
    )
  );

drop policy if exists parent_read_own_excuses on public.absence_excuses;
create policy parent_read_own_excuses on public.absence_excuses
  for select to authenticated
  using (
    current_user_is_parent() and exists (
      select 1 from public.parent_links pl
      where pl.user_id = auth.uid() and pl.student_id = absence_excuses.student_id
    )
  );

grant select, insert, update on public.absence_excuses to service_role;

-- مدير المدرسة يرى الأعذار الواردة لمدرسته
drop policy if exists school_admin_read_excuses on public.absence_excuses;
create policy school_admin_read_excuses on public.absence_excuses
  for select to authenticated
  using (
    current_user_role() = 'school_admin'
    and school_id = current_user_school_id()
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 14. بذرة المديريات السورية (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════
-- شغّل هذا في Supabase SQL Editor مرة واحدة.
-- اللاذقية موجودة مسبقاً في معظم البيئات؛ where not exists تمنع التكرار.
insert into public.directorates (id, name, governorate)
select gen_random_uuid(), v.name, v.gov
from (values
  ('مديرية تربية حلب',       'حلب'),
  ('مديرية تربية حمص',       'حمص'),
  ('مديرية تربية حماة',      'حماة'),
  ('مديرية تربية طرطوس',     'طرطوس'),
  ('مديرية تربية إدلب',      'إدلب'),
  ('مديرية تربية الحسكة',    'الحسكة'),
  ('مديرية تربية دمشق',      'دمشق'),
  ('مديرية تربية ريف دمشق',  'ريف دمشق'),
  ('مديرية تربية دير الزور', 'دير الزور'),
  ('مديرية تربية الرقة',     'الرقة'),
  ('مديرية تربية درعا',      'درعا'),
  ('مديرية تربية القنيطرة',  'القنيطرة'),
  ('مديرية تربية السويداء',  'السويداء')
) as v(name, gov)
where not exists (select 1 from public.directorates d where d.name = v.name);


-- ════════════════════════════════════════════════════════════════════════════
--  SECTION 12 — Security hardening (run last, after every function exists)
--
--  Keeps a fresh rebuild aligned with the Supabase Security Advisor:
--    • 0011_function_search_path_mutable
--    • 0028_anon_security_definer_function_executable
--
--  Both blocks are idempotent and skip extension-owned functions (pg_net, …)
--  via the pg_depend deptype = 'e' filter. (PostGIS is intentionally NOT
--  installed by this script.)
-- ════════════════════════════════════════════════════════════════════════════

-- 12.1  Pin search_path on every project-owned function that lacks one.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not (p.proconfig is not null
               and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- 12.2  Remove anon/PUBLIC EXECUTE from anon-reachable SECURITY DEFINER
--       functions; keep authenticated + service_role. Trigger functions fire
--       as the table owner and need no EXECUTE grant.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig,
           (p.prorettype = 'pg_catalog.trigger'::regtype) as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from anon, public', r.sig);
    if not r.is_trigger then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    end if;
  end loop;
end $$;

-- NOTE: an earlier revision added a "Section 12.3" that converted application
-- functions to SECURITY INVOKER to satisfy lint 0029. That was reverted — those
-- functions are SECURITY DEFINER by design (they call the internal notify_user
-- helper and perform privileged cross-tenant writes, neither of which the
-- caller can do directly). Lint 0029 is accepted as informational for them.
-- See supabase/migrations/20260624000300_revert_security_invoker.sql.
