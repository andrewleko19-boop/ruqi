-- ═════════════════════════════════════════════════════════════════════════════
--  تثبيت مهام pg_cron الثلاث في git. كانت تعيش في القاعدة الحيّة وحدها (جُدولت يدويّاً؛
--  نسخٌ قديمة في docs/database-setup.sql فقط) فلا تُعاد في أيّ بيئةٍ تُبنى من الهجرات.
--
--  النصوص منقولةٌ من cron.job الحيّ (pg_cron 1.6.4)، ولا JWT فيها.
--  cron.schedule(اسم، جدول، أمر) على اسمٍ موجود **يحدّث المهمّة نفسها** (jobid ثابت وسجلّ
--  التشغيل باقٍ) ← الهجرة idempotent، وأثرها الحيّ إعادةُ تسجيل المهامّ بنفس نصّها.
--
--  الحارس: غيابُ cron.schedule (بيئةٌ محلّيّة/CI بلا pg_cron) = تخطٍّ بإشعار لا فشل،
--  لأنّ هجرةً فاشلة توقف خطّ النشر كلَّه (deploy-migrations.yml).
--
--  وسم $cmd$ للأوامر لأنّ أمر dropout-daily-check نفسه كتلةُ DO $$…$$.
-- ═════════════════════════════════════════════════════════════════════════════

do $mig$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron غير متاح — تخطّي تثبيت المهام';
    return;
  end if;

  -- ── ١) فحصُ التسرّب اليوميّ (06:15 UTC) ──────────────────────────────────
  perform cron.schedule('dropout-daily-check', '15 6 * * *', $cmd$do $$
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
$$ language plpgsql;$cmd$);

  -- ── ٢) توليد التقارير الشهريّة (أوّل كلّ شهر 06:00 UTC) ──────────────────
  perform cron.schedule('monthly-report-generator', '0 6 1 * *', $cmd$select public.generate_monthly_reports();$cmd$);

  -- ── ٣) تذكير إرسال سجلّ الحضور (06:30 UTC) ───────────────────────────────
  perform cron.schedule('attendance-daily-reminder', '30 6 * * *', $cmd$select public.notify_user(
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
  select 1 from public.daily_student_attendance dsa
  where dsa.school_id = s.id and dsa.date = current_date
);$cmd$);
end
$mig$;
