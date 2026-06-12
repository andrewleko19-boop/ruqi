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
    -- ⚠️ استبدل القيمة الثانية بمفتاح secret من Settings → API قبل التشغيل
    --    (لا تحفظ المفتاح الحقيقي في المستودع — GitHub يحظر دفعه)
    v_url := 'https://xocrzpjfvizgnsybegwr.supabase.co';
    v_key := 'YOUR_SB_SECRET_KEY_HERE';
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
                 extract(year from now())::text),
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
