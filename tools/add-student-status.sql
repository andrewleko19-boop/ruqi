-- ════════════════════════════════════════════════════════════════════════════
-- المرحلة 1 من إعادة الهيكلة الوزارية — دورة حياة الطالب (student lifecycle)
-- ════════════════════════════════════════════════════════════════════════════
--  يضيف نوعاً تعدادياً student_status + عمود الحالة على students، ويجعل is_active
--  مشتقاً آلياً من الحالة عبر trigger (شِم التوافق) كي تبقى كل استعلامات
--  .eq('is_active', true) والفهرس الفريد تعمل دون تعديل.
--
--  الحالات: نشط | منقول | خارج السنة | متخرّج | مرقّن القيد
--  مصدر الحقيقة الوحيد للنشاط هو status؛ is_active يُحسب منه دائماً.
--
--  يُطبَّق يدوياً في محرّر Supabase SQL. كل العبارات idempotent وقابلة لإعادة
--  التشغيل. الترتيب مهم: نُعبّئ البيانات أولاً ثم نُلحق المُحفّزات (triggers).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) النوع التعدادي (CREATE TYPE لا يقبل IF NOT EXISTS → نستخدم DO block)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'student_status') then
    create type public.student_status as enum
      ('active','transferred','out_of_year','graduated','struck_off');
  end if;
end$$;

-- 2) أعمدة الحالة (status يُضاف nullable مؤقتاً حتى تكتمل التعبئة الرجعية)
alter table public.students
  add column if not exists status            public.student_status,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_reason     text;

-- 3) التعبئة الرجعية (backfill) — اشتقاق الحالة من is_active / dropout_flagged_at
--    مرقّن القيد (dropout) → struck_off · النشط → active · غير ذلك → منقول
update public.students set status = (case
    when dropout_flagged_at is not null then 'struck_off'
    when is_active                       then 'active'
    else                                      'transferred'
  end)::public.student_status
  where status is null;

-- مزامنة is_active مع الحالة المشتقّة (الطلاب المرقّن قيدهم يغادرون القوائم النشطة)
update public.students
   set is_active = (status = 'active')
   where is_active is distinct from (status = 'active');

-- بعد اكتمال التعبئة: الافتراضي + عدم السماح بالفراغ
alter table public.students alter column status set default 'active';
alter table public.students alter column status set not null;

-- 4) شِم is_active — trigger يبقيه مشتقاً من status على كل إدراج/تحديث
create or replace function public.sync_student_is_active()
returns trigger language plpgsql as $$
begin
  new.is_active := (new.status = 'active');
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end$$;

drop trigger if exists t_sync_student_is_active on public.students;
create trigger t_sync_student_is_active
  before insert or update on public.students
  for each row execute function public.sync_student_is_active();

-- 5) التحقق من شرعية الانتقالات — متخرّج حالة نهائية لا يُغيَّر منها
create or replace function public.validate_student_status_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and old.status = 'graduated' then
    raise exception 'لا يمكن تغيير حالة طالب متخرّج';
  end if;
  return new;
end$$;

drop trigger if exists t_validate_student_status on public.students;
create trigger t_validate_student_status
  before update on public.students
  for each row execute function public.validate_student_status_transition();

-- 6) RPC موثّق لتغيير الحالة (مسار خادمي يتحقق من الصلاحية ويكتب audit_log).
--    db.js يستخدم طابور offline في الوضع العادي، وهذا المسار متاح للاستدعاء
--    المباشر ولأي تكامل مستقبلي يحتاج إنفاذاً خادمياً صريحاً.
drop function if exists public.set_student_status(uuid, public.student_status, text);
create or replace function public.set_student_status(
  p_student_id uuid,
  p_new_status public.student_status,
  p_reason     text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role       text;
  v_school     uuid;
  v_stu_school uuid;
begin
  select u.role, u.school_id into v_role, v_school
  from public.users u where u.id = auth.uid();

  select s.school_id into v_stu_school
  from public.students s where s.id = p_student_id;

  if not (v_role = 'ministry_user'
          or (v_role = 'school_admin' and v_school = v_stu_school)) then
    raise exception 'غير مصرّح';
  end if;

  update public.students
     set status = p_new_status, status_reason = p_reason
   where id = p_student_id;

  insert into public.audit_log
    (school_id, actor_id, entity, entity_id, action, changes, reason)
  values
    (v_stu_school, auth.uid(), 'student', p_student_id, 'status_change',
     jsonb_build_object('status', p_new_status), p_reason);
end$$;

grant execute on function public.set_student_status(uuid, public.student_status, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ملاحظات التحقق:
--   select status, count(*) from public.students group by status;
--   -- يجب ألّا يوجد status = null، وأن is_active = (status='active') لكل صف.
--   select count(*) from public.students where is_active <> (status='active');  -- = 0
-- ════════════════════════════════════════════════════════════════════════════
