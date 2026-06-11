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

-- 5.0b  إعدادات التطبيق في DB (يُعدّلها المستخدم)
-- ⚠️  استبدل القيمتين أدناه
alter database postgres set app.settings.supabase_url        to 'https://xocrzpjfvizgnsybegwr.supabase.co';
alter database postgres set app.settings.service_role_key    to 'YOUR_SERVICE_ROLE_KEY_HERE';

-- 5.1  جدول اشتراكات Web Push
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
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
  recipient_id uuid not null references public.users(id) on delete cascade,
  type         text not null,  -- report_new | report_status | duty_adjusted | attendance_reminder
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
    v_url := current_setting('app.settings.supabase_url',     true);
    v_key := current_setting('app.settings.service_role_key', true);
    if v_url is not null and v_key is not null then
      perform extensions.http_post(
        url     := v_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || v_key
                   ),
        body    := convert_to(
                     jsonb_build_object(
                       'notificationId', v_notif_id,
                       'recipientId',    p_recipient_id
                     )::text,
                     'utf8'
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

