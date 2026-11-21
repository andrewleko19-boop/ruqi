-- ════════════════════════════════════════════════════════════════════════════
--  اختبارُ نافذة كتابة المعلّم (هجرة 20260819001200) على Postgres حقيقيّ.
--
--  يُشغَّل على قاعدةٍ **مؤقّتة** فيها الجدولان وسياساتُ baseline الأصليّة (انظر
--  "تشغيل" أدناه) — لا على قاعدة الإنتاج. يطبع جدولاً: لكلّ حالةٍ ما كان
--  (قبل الهجرة) وما صار (بعدها) وما يجب أن يكون. يخرج بفشلٍ إن خالف أيُّ صفٍّ توقّعه.
--
--  تشغيل:
--    psql -v ON_ERROR_STOP=1 -d <temp-db> -v phase=before -f supabase/tests/teacher_attendance_window.sql
--    psql -v ON_ERROR_STOP=1 -d <temp-db> -f supabase/migrations/20260819001200_teacher_attendance_backfill_window.sql
--    psql -v ON_ERROR_STOP=1 -d <temp-db> -v phase=after  -f supabase/tests/teacher_attendance_window.sql
--
--  يفترض: current_user_role() وauth.uid() يقرآن app.role وapp.uid (بديلُ JWT)،
--  وteaches_class(c1) صادقة وteaches_class(c2) كاذبة.
-- ════════════════════════════════════════════════════════════════════════════
\set QUIET on
\if :{?phase} \else \set phase after \endif

create or replace function pg_temp.attempt(sql text, who text default 'teacher') returns text
language plpgsql as $f$
begin
  -- كلّ محاولة في نقطة حفظ: فشلُها لا يُفسد الباقي.
  perform set_config('app.uid',  case who when 'teacher' then 'aaaaaaaa-0000-0000-0000-00000000000a'
                                          else 'bbbbbbbb-0000-0000-0000-00000000000b' end, true);
  perform set_config('app.role', case who when 'teacher' then 'teacher' else 'school_admin' end, true);
  set local role authenticated;
  begin
    execute sql;
    reset role;
    return 'ok';
  exception
    when insufficient_privilege then reset role; return 'DENIED';
    when others then reset role; return 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
end $f$;

\set c1 cccccccc-0000-0000-0000-000000000001
\set c2 cccccccc-0000-0000-0000-000000000002
\set me aaaaaaaa-0000-0000-0000-00000000000a
\set other bbbbbbbb-0000-0000-0000-00000000000b

-- قاعدةٌ مؤقّتة: يُفرَّغ الجدولان ليُعاد تشغيل الاختبار بين المرحلتين دون تصادم.
delete from daily_student_attendance;
delete from attendance_submissions;

create temp table results (n serial, label text, got text, want text);
grant all on results to public; grant usage on sequence results_n_seq to public;

-- يوم دمشق الآن، ويوم UTC الآن (يختلفان ٢١:٠٠–٢٤:٠٠ UTC)
select (now() at time zone 'Asia/Damascus')::date as d, current_date as utc_d \gset

-- دالّةُ تسجيل: تُنفّذ المحاولة وتحفظ النتيجة والمتوقّع.
create or replace function pg_temp.t(label text, sql text, want text, who text default 'teacher') returns void
language plpgsql as $f$
begin
  insert into results(label, got, want) values (label, pg_temp.attempt(sql, who), want);
end $f$;

-- ثابتٌ في كلّ مرحلة: العقد القديم والجديد معاً
-- (قبل الهجرة): المقبول = تاريخ UTC اليوم وحده. (بعدها): دمشق−٣ … دمشق.
\if :{?before_only} \else \endif

-- ── صفوف الطلاب ──────────────────────────────────────────────────────────────
-- t(label, insert…, توقّع-بعد)  — والتوقّع «قبل» يُحسب أدناه من تاريخ UTC
select pg_temp.t('dsa: today (Damascus)',      format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c1', :'d'::date,        :'me'), 'ok');
select pg_temp.t('dsa: D-1',                   format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c1', :'d'::date - 1,    :'me'), 'ok');
select pg_temp.t('dsa: D-2',                   format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c1', :'d'::date - 2,    :'me'), 'ok');
select pg_temp.t('dsa: D-3 (Thu→Sun case)',    format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c1', :'d'::date - 3,    :'me'), 'ok');
select pg_temp.t('dsa: D-4 (too old)',         format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c1', :'d'::date - 4,    :'me'), 'DENIED');
select pg_temp.t('dsa: D+1 (future)',          format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c1', :'d'::date + 1,    :'me'), 'DENIED');
select pg_temp.t('dsa: someone else''s id',    format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c1', :'d'::date - 1,    :'other'), 'DENIED');
select pg_temp.t('dsa: class not taught',      format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c2', :'d'::date - 1,    :'me'), 'DENIED');

-- ── صفّ الإرسال ──────────────────────────────────────────────────────────────
select pg_temp.t('sub: D-3',                   format('insert into attendance_submissions(class_id,school_id,date,submitted_by) values (%L,gen_random_uuid(),%L,%L)', :'c1', :'d'::date - 3, :'me'), 'ok');
select pg_temp.t('sub: D-4 (too old)',         format('insert into attendance_submissions(class_id,school_id,date,submitted_by) values (%L,gen_random_uuid(),%L,%L)', :'c1', :'d'::date - 4, :'me'), 'DENIED');
select pg_temp.t('sub: D+1 (future)',          format('insert into attendance_submissions(class_id,school_id,date,submitted_by) values (%L,gen_random_uuid(),%L,%L)', :'c1', :'d'::date + 1, :'me'), 'DENIED');
select pg_temp.t('sub: wrong submitted_by',    format('insert into attendance_submissions(class_id,school_id,date,submitted_by) values (%L,gen_random_uuid(),%L,%L)', :'c1', :'d'::date - 1, :'other'), 'DENIED');

-- ── الحماية: كشفٌ اعتمده المدير لا يُكتب فوقه (replay) ───────────────────────
-- تهيئة (كمشرف قاعدة): كشف D-2 معتمَد، وكشف D-1 معلَّق، مع صفّ طالبٍ موجود لكلٍّ.
insert into attendance_submissions(class_id, school_id, date, submitted_by, status, confirmed_by)
  values (:'c1', gen_random_uuid(), :'d'::date - 2, :'me', 'confirmed', :'other'),
         (:'c1', gen_random_uuid(), :'d'::date - 1, :'me', 'pending',   null);
insert into daily_student_attendance(id, student_id, class_id, school_id, date, status, recorded_by)
  values ('11111111-0000-0000-0000-0000000000d2', '22222222-0000-0000-0000-0000000000d2', :'c1', gen_random_uuid(), :'d'::date - 2, 'present', :'me'),
         ('11111111-0000-0000-0000-0000000000d1', '22222222-0000-0000-0000-0000000000d1', :'c1', gen_random_uuid(), :'d'::date - 1, 'present', :'me');

select pg_temp.t('replay: new row on CONFIRMED day (D-2)',
   format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (gen_random_uuid(),%L,gen_random_uuid(),%L,''absent'',%L)', :'c1', :'d'::date - 2, :'me'), 'DENIED');
select pg_temp.t('replay: UPSERT over existing row on CONFIRMED day',
   format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (''22222222-0000-0000-0000-0000000000d2'',%L,gen_random_uuid(),%L,''absent'',%L) on conflict (student_id,date) do update set status=excluded.status', :'c1', :'d'::date - 2, :'me'), 'DENIED');
select pg_temp.t('replay: UPDATE existing row on CONFIRMED day',
   format('update daily_student_attendance set status=''absent'' where id=''11111111-0000-0000-0000-0000000000d2'''), 'DENIED');
select pg_temp.t('replay: submission UPSERT over CONFIRMED (reset to pending)',
   format('insert into attendance_submissions(class_id,school_id,date,submitted_by,status) values (%L,gen_random_uuid(),%L,%L,''pending'') on conflict (class_id,date) do update set status=excluded.status', :'c1', :'d'::date - 2, :'me'), 'DENIED');
select pg_temp.t('control: UPSERT over PENDING day (D-1) is allowed',
   format('insert into daily_student_attendance(student_id,class_id,school_id,date,status,recorded_by) values (''22222222-0000-0000-0000-0000000000d1'',%L,gen_random_uuid(),%L,''absent'',%L) on conflict (student_id,date) do update set status=excluded.status', :'c1', :'d'::date - 1, :'me'), 'ok');
select pg_temp.t('control: submission UPSERT over PENDING (D-1) is allowed',
   format('insert into attendance_submissions(class_id,school_id,date,submitted_by,status) values (%L,gen_random_uuid(),%L,%L,''pending'') on conflict (class_id,date) do update set submitted_at=now()', :'c1', :'d'::date - 1, :'me'), 'ok');

-- ── المدير لم يتغيّر ─────────────────────────────────────────────────────────
select pg_temp.t('manager: can still confirm a submission',
   format('update attendance_submissions set status=''confirmed'' where class_id=%L and date=%L', :'c1', :'d'::date - 1), 'ok', 'admin');

-- ── المنطقة الزمنية: التعبير نفسه بلحظاتٍ ثابتة (لا تعتمد على ساعة التشغيل) ───
create temp table tz_cases(label text, instant timestamptz, want_damascus date);
insert into tz_cases values
  ('22:30 UTC Nov-21 is already Nov-22 in Damascus (the 3h gap)', '2026-11-21 22:30:00+00', '2026-11-22'),
  ('20:59 UTC Nov-21 is still Nov-21 in Damascus',                '2026-11-21 20:59:00+00', '2026-11-21'),
  ('21:00 UTC is exactly midnight in Damascus',                   '2026-11-21 21:00:00+00', '2026-11-22'),
  ('summer instant: Syria has no DST since 2022 (still +3)',      '2026-07-15 21:30:00+00', '2026-07-16');
insert into results(label, got, want)
  select 'tz: ' || label, ((instant at time zone 'Asia/Damascus')::date)::text, want_damascus::text from tz_cases;

-- ── التقرير ──────────────────────────────────────────────────────────────────
\echo
\echo '──' :phase 'migration — Damascus today =' :d ', UTC today =' :utc_d '──'
\set QUIET off
\pset format aligned
select n, label, got, want,
       case when got = want then 'pass'
            when :'phase' = 'before' and label ~ '^((dsa|sub): D-[123]|control:)' then 'expected-old'   -- القديم يرفض هذه عمداً
            else 'FAIL' end as verdict
  from results order by n;
\set QUIET on
select count(*) filter (where got <> want
                         and not (:'phase' = 'before' and label ~ '^((dsa|sub): D-[123]|control:)')) > 0 as bad
  from results \gset
\if :bad
  \echo 'FAILED: unexpected result(s) above'
  select 1/0 as test_failed;   -- يُنهي psql بخروجٍ غير صفريّ مع ON_ERROR_STOP
\else
  \echo 'all expectations met'
\endif
