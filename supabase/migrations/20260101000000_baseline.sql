
-- البنية الأساسية الكاملة — صُدّرت من القاعدة الحيّة بتاريخ 2026-08-11.
--
-- هذا الملف يُنشئ كلّ شيء من الصفر: الأنواع، الجداول، الفهارس، القيود،
-- الدوال، المشغّلات (triggers)، سياسات RLS، والصلاحيات. الهجرات اللاحقة
-- ترقيعية وكلّها idempotent فتعمل فوق هذه البنية بلا تعارض.
--
-- قاعدة البيانات الحيّة:
--   هذه الهجرة لا تُطبَّق عليها (مسجّلة مسبقاً). إن لم تكن مسجّلة:
--   INSERT INTO supabase_migrations.schema_migrations (version)
--   VALUES ('20260101000000');

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";








ALTER SCHEMA "public" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






DO $ruqi_idem$ BEGIN
CREATE TYPE "public"."report_status" AS ENUM (
    'open',
    'acknowledged',
    'resolved'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $ruqi_idem$;


ALTER TYPE "public"."report_status" OWNER TO "postgres";


DO $ruqi_idem$ BEGIN
CREATE TYPE "public"."report_type" AS ENUM (
    'security_threat',
    'infrastructure_damage',
    'health_emergency',
    'natural_disaster',
    'teacher_shortage',
    'other'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $ruqi_idem$;


ALTER TYPE "public"."report_type" OWNER TO "postgres";


DO $ruqi_idem$ BEGIN
CREATE TYPE "public"."student_status" AS ENUM (
    'active',
    'transferred',
    'out_of_year',
    'graduated',
    'struck_off'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $ruqi_idem$;


ALTER TYPE "public"."student_status" OWNER TO "postgres";


DO $ruqi_idem$ BEGIN
CREATE TYPE "public"."user_role" AS ENUM (
    'school_admin',
    'directorate_user',
    'ministry_user',
    'teacher',
    'parent'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $ruqi_idem$;


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_notify_dir_new_request"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."_notify_dir_new_request"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_notify_dir_result_sheet_submitted"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_dir         uuid;
  v_school_name text;
  v_class_label text;
begin
  if NEW.status <> 'submitted' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status = 'submitted' then return NEW; end if;

  select directorate_id, name into v_dir, v_school_name
  from public.schools where id = NEW.school_id;

  select 'الصف ' || c.grade || ' / ' || c.section into v_class_label
  from public.classes c where c.id = NEW.class_id;

  perform public.notify_user(
    u.id,
    'result_sheet_submitted',
    'جلاء جديد للمراجعة',
    coalesce(v_school_name, 'مدرسة') || ' — ' || coalesce(v_class_label, '') || ' (' || NEW.term || ')',
    'result_sheets',
    NEW.id
  )
  from public.users u
  where u.directorate_id = v_dir and u.role = 'directorate_user';
  return NEW;
end; $$;


ALTER FUNCTION "public"."_notify_dir_result_sheet_submitted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_notify_dir_statement_submitted"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."_notify_dir_statement_submitted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_notify_parents_absent"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text;
begin
  -- 'absent' وحدها تُشعِر: التأخّر والغياب المبرَّر ليسا حدثاً يستدعي إزعاج الأهل.
  if new.status is distinct from 'absent'      then return new; end if;
  -- منعُ التكرار: حفظُ الكشف مرّةً أخرى يُحدّث صفوف الطلاب كلَّها (upsert على
  -- student_id,date)، فبلا هذا الشرط يصل الأهلَ إشعارٌ جديد مع كلّ تصحيحٍ
  -- يجريه المعلّم على أيّ طالبٍ آخر في الشعبة.
  if old.status is not distinct from 'absent'  then return new; end if;

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


ALTER FUNCTION "public"."_notify_parents_absent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_nsams_phone_core"("raw" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."_nsams_phone_core"("raw" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ar_norm"("p" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select btrim(regexp_replace(
           translate(coalesce(p, ''), 'أإآٱىة', 'اااايه'),
           '\s+', ' ', 'g'))
$$;


ALTER FUNCTION "public"."ar_norm"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_directorate_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select directorate_id from public.users where id = auth.uid()
$$;


ALTER FUNCTION "public"."auth_directorate_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.users where id = auth.uid()
$$;


ALTER FUNCTION "public"."auth_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_school_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select school_id from public.users where id = auth.uid()
$$;


ALTER FUNCTION "public"."auth_school_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bump_row_version"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at  := now();
  new.row_version := coalesce(old.row_version, 0) + 1;
  return new;
end;
$$;


ALTER FUNCTION "public"."bump_row_version"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."transfer_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_type" "text" DEFAULT 'regular'::"text" NOT NULL,
    "student_id" "uuid",
    "student_national_id" "text" NOT NULL,
    "student_full_name" "text" NOT NULL,
    "first_name" "text",
    "father_name" "text",
    "grandfather_name" "text",
    "family_name" "text",
    "mother_name" "text",
    "birth_date" "date",
    "student_gender" "text",
    "from_school_id" "uuid" NOT NULL,
    "from_school_name" "text",
    "from_grade_label" "text",
    "from_section_label" "text",
    "to_school_id" "uuid" NOT NULL,
    "to_school_name" "text",
    "to_class_id" "uuid",
    "to_grade_label" "text",
    "to_section_label" "text",
    "to_level_track" smallint,
    "to_foreign_language" "text",
    "to_complex_name" "text",
    "to_directorate_name" "text",
    "academic_year" "text" NOT NULL,
    "outgoing_number" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "transfer_reason" "text",
    "notes" "text",
    "reject_reason" "text",
    "issued_by" "uuid" NOT NULL,
    "issued_by_name" "text",
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_by" "uuid",
    "processed_by_name" "text",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transfer_docs_diff_schools" CHECK (("from_school_id" <> "to_school_id")),
    CONSTRAINT "transfer_documents_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['regular'::"text", 'exceptional'::"text"]))),
    CONSTRAINT "transfer_documents_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'executed'::"text", 'rejected'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "transfer_documents_student_gender_check" CHECK ((("student_gender" IS NULL) OR ("student_gender" = ANY (ARRAY['male'::"text", 'female'::"text"]))))
);


ALTER TABLE "public"."transfer_documents" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_transfer_document"("p_doc_id" "uuid") RETURNS "public"."transfer_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_out public.transfer_documents;
begin
  if public.current_user_role() is distinct from 'school_admin'::public.user_role then
    raise exception 'غير مصرّح: سحب الوثائق لمدراء المدارس فقط';
  end if;

  update public.transfer_documents set
    status       = 'cancelled',
    processed_at = now()
  where id = p_doc_id
    and to_school_id = public.current_user_school_id()
    and status = 'pending'
  returning * into v_out;

  if not found then
    raise exception 'الوثيقة غير موجودة أو ليست من إصدار مدرستك أو بُتَّ فيها سابقاً';
  end if;

  return v_out;
end; $$;


ALTER FUNCTION "public"."cancel_transfer_document"("p_doc_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."class_belongs_to_my_school"("p_class_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM classes c
    JOIN users u ON u.id = auth.uid()
    WHERE c.id = p_class_id
      AND c.school_id = u.school_id
  );
$$;


ALTER FUNCTION "public"."class_belongs_to_my_school"("p_class_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."class_in_my_school"("p_class_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.classes
    where id = p_class_id
      and school_id = public.auth_school_id()
  )
$$;


ALTER FUNCTION "public"."class_in_my_school"("p_class_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_directorate_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
              SELECT directorate_id FROM users WHERE id = auth.uid();
              $$;


ALTER FUNCTION "public"."current_user_directorate_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_is_parent"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and email like '%@parent.nsams.local'
  )
$$;


ALTER FUNCTION "public"."current_user_is_parent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_permission_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select u.permission_role from public.users u where u.id = auth.uid()),
    (select u.role::text      from public.users u where u.id = auth.uid()),
    case when exists (select 1 from public.parent_links pl where pl.user_id = auth.uid())
         then 'parent' end
  );
$$;


ALTER FUNCTION "public"."current_user_permission_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
          SELECT role FROM users WHERE id = auth.uid();
          $$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_school_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
            SELECT school_id FROM users WHERE id = auth.uid();
            $$;


ALTER FUNCTION "public"."current_user_school_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_grace_proposal"("p_id" "uuid", "p_decision" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."decide_grace_proposal"("p_id" "uuid", "p_decision" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."directorate_bulk_import_staff"("p_school_id" "uuid", "p_rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row       jsonb;
  v_i         int  := 0;
  v_inserted  int  := 0;
  v_duplicate int  := 0;
  v_failed    jsonb := '[]'::jsonb;
  v_name      text;
  v_type      text;
  v_gender    text;
  v_natid     text;
  v_kind      text;
  v_staff_id  uuid;
  v_orphan    uuid;
  v_orphan_n  int;
begin
  if not exists (
    select 1 from public.users u
    join public.schools s on s.id = p_school_id
    where u.id = auth.uid()
      and u.role = 'directorate_user'
      and u.directorate_id = s.directorate_id
  ) then
    raise exception 'access denied';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'صيغة البيانات غير صالحة';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      v_name   := nullif(btrim(coalesce(v_row->>'full_name',   '')), '');
      v_type   := nullif(btrim(coalesce(v_row->>'staff_type',  '')), '');
      v_gender := nullif(btrim(coalesce(v_row->>'gender',      '')), '');
      v_natid  := nullif(btrim(coalesce(v_row->>'national_id', '')), '');

      if v_name is null then
        raise exception 'الاسم مطلوب';
      end if;
      if v_type is null or v_type not in ('admin','teaching','professional','worker','guard') then
        raise exception 'فئة الكادر غير صالحة';
      end if;
      if v_gender is null or v_gender not in ('male','female') then
        raise exception 'الجنس مطلوب';
      end if;

      if v_natid is not null and exists (
        select 1 from public.staff_records sr
        where sr.school_id = p_school_id and sr.national_id = v_natid and sr.active
      ) then
        v_duplicate := v_duplicate + 1;
        continue;
      end if;

      insert into public.staff_records (
        school_id, staff_type, full_name, national_id, mother_name, birth_date,
        gender, job_title, specialization, subject_taught, certificate,
        higher_degree, seniority_year, phone, residential_zone, educational_zone,
        roster_type, notes, active
      ) values (
        p_school_id, v_type, v_name, v_natid,
        nullif(btrim(coalesce(v_row->>'mother_name', '')), ''),
        nullif(btrim(coalesce(v_row->>'birth_date', '')), '')::date,
        v_gender,
        nullif(btrim(coalesce(v_row->>'job_title',       '')), ''),
        nullif(btrim(coalesce(v_row->>'specialization',  '')), ''),
        case when v_type = 'teaching'
             then nullif(btrim(coalesce(v_row->>'subject_taught', '')), '') end,
        nullif(btrim(coalesce(v_row->>'certificate',      '')), ''),
        nullif(btrim(coalesce(v_row->>'higher_degree',    '')), ''),
        nullif(btrim(coalesce(v_row->>'seniority_year',   '')), '')::int,
        nullif(btrim(coalesce(v_row->>'phone',            '')), ''),
        nullif(btrim(coalesce(v_row->>'residential_zone', '')), ''),
        nullif(btrim(coalesce(v_row->>'educational_zone', '')), ''),
        coalesce(nullif(btrim(coalesce(v_row->>'roster_type', '')), ''), 'inside'),
        nullif(btrim(coalesce(v_row->>'notes',            '')), ''),
        true
      ) returning id into v_staff_id;

      -- مرآة الدوام: المعلّمون هويّتهم في users لا في school_personnel، فلا
      -- مرآة لهم. الترتيب مطابق لـ syncPersonnelFromStaffRecord في db.js:
      -- تبنّي صفٍّ يتيم بنفس الاسم إن كان **وحيداً** لا لبس فيه، وإلا إنشاء
      -- صفّ جديد — ربطُ الشخص الخطأ بكشف حضوره أسوأ من تركه غير مربوط.
      if v_type <> 'teaching' then
        v_kind := case when v_type = 'admin' then 'admin' else 'worker' end;

        -- min(uuid) غير موجودة في Postgres — العدّ والمعرّف يُجلبان منفصلَين.
        select count(*) into v_orphan_n
        from public.school_personnel sp
        where sp.school_id = p_school_id
          and sp.staff_record_id is null
          and sp.is_active
          and sp.full_name = v_name;

        if v_orphan_n = 1 then
          select sp.id into v_orphan
          from public.school_personnel sp
          where sp.school_id = p_school_id
            and sp.staff_record_id is null
            and sp.is_active
            and sp.full_name = v_name
          limit 1;
        end if;

        if v_orphan_n = 1 then
          update public.school_personnel
             set staff_record_id = v_staff_id,
                 kind            = v_kind,
                 national_id     = coalesce(national_id, v_natid)
           where id = v_orphan;
        else
          insert into public.school_personnel
            (school_id, full_name, kind, national_id, is_active, staff_record_id)
          values (p_school_id, v_name, v_kind, v_natid, true, v_staff_id);
        end if;
      end if;

      v_inserted := v_inserted + 1;

    exception when others then
      v_failed := v_failed || jsonb_build_object(
        'line', v_i, 'name', coalesce(v_name, '—'), 'error', sqlerrm);
    end;
  end loop;

  if v_inserted > 0 then
    insert into public.audit_log (school_id, actor_id, entity, entity_id, action, changes)
    values (p_school_id, auth.uid(), 'staff_records', null, 'directorate_bulk_import',
            jsonb_build_object('count', v_inserted));
  end if;

  return jsonb_build_object(
    'inserted', v_inserted, 'duplicate', v_duplicate, 'failed', v_failed);
end;
$$;


ALTER FUNCTION "public"."directorate_bulk_import_staff"("p_school_id" "uuid", "p_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."directorate_bulk_import_students"("p_school_id" "uuid", "p_class_id" "uuid", "p_rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row        jsonb;
  v_i          int  := 0;
  v_inserted   int  := 0;
  v_duplicate  int  := 0;
  v_failed     jsonb := '[]'::jsonb;
  v_first      text;
  v_father     text;
  v_family     text;
  v_full       text;
  v_natid      text;
  v_gender     text;
  v_birth      date;
begin
  if not exists (
    select 1 from public.users u
    join public.schools s on s.id = p_school_id
    where u.id = auth.uid()
      and u.role = 'directorate_user'
      and u.directorate_id = s.directorate_id
  ) then
    raise exception 'access denied';
  end if;

  -- الشعبة تخصّ المدرسة المستهدفة فعلاً — يمنع كتابة طلاب في شعبة مدرسة أخرى
  -- لو أُرسل معرّف شعبة خاطئ من الواجهة.
  if not exists (
    select 1 from public.classes c
    where c.id = p_class_id and c.school_id = p_school_id
  ) then
    raise exception 'الشعبة المحدّدة لا تنتمي إلى هذه المدرسة';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'صيغة البيانات غير صالحة';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      v_first  := nullif(btrim(coalesce(v_row->>'first_name',  '')), '');
      v_father := nullif(btrim(coalesce(v_row->>'father_name', '')), '');
      v_family := nullif(btrim(coalesce(v_row->>'family_name', '')), '');
      v_natid  := nullif(btrim(coalesce(v_row->>'national_id', '')), '');
      v_gender := nullif(btrim(coalesce(v_row->>'gender',      '')), '');

      v_full := btrim(concat_ws(' ', v_first, v_father, v_family));
      if v_full = '' then
        raise exception 'الاسم مطلوب';
      end if;
      if v_gender is not null and v_gender not in ('male', 'female') then
        raise exception 'قيمة الجنس غير صالحة';
      end if;

      v_birth := nullif(btrim(coalesce(v_row->>'birth_date', '')), '')::date;

      -- تخطٍّ لا فشل: التكرار حالة متوقّعة عند إعادة رفع ملفّ مُصحَّح.
      if v_natid is not null and exists (
        select 1 from public.students s
        where s.school_id = p_school_id and s.national_id = v_natid and s.is_active
      ) then
        v_duplicate := v_duplicate + 1;
        continue;
      end if;

      -- is_active مشتقّ بمُشغِّل t_sync_student_is_active من status — لا يُكتب.
      insert into public.students (
        id, school_id, class_id, first_name, father_name, family_name,
        full_name, gender, birth_date, national_id, status
      ) values (
        gen_random_uuid(), p_school_id, p_class_id, v_first, v_father, v_family,
        v_full, v_gender, v_birth, v_natid, 'active'
      );
      v_inserted := v_inserted + 1;

    exception when others then
      v_failed := v_failed || jsonb_build_object(
        'line',  v_i,
        'name',  coalesce(nullif(v_full, ''), v_first, '—'),
        'error', sqlerrm
      );
    end;
  end loop;

  if v_inserted > 0 then
    insert into public.audit_log (school_id, actor_id, entity, entity_id, action, changes)
    values (p_school_id, auth.uid(), 'students', null, 'directorate_bulk_import',
            jsonb_build_object('class_id', p_class_id, 'count', v_inserted));
  end if;

  return jsonb_build_object(
    'inserted', v_inserted, 'duplicate', v_duplicate, 'failed', v_failed);
end;
$$;


ALTER FUNCTION "public"."directorate_bulk_import_students"("p_school_id" "uuid", "p_class_id" "uuid", "p_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."end_staff_assignment"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_school uuid;
  v_asn    public.staff_assignments;
begin
  select u.school_id into v_school
  from public.users u where u.id = auth.uid() and u.role = 'school_admin';
  if v_school is null then
    raise exception 'غير مصرّح: هذه الدالة لمدير المدرسة فقط';
  end if;

  select * into v_asn from public.staff_assignments
  where id = p_id and school_id = v_school;
  if not found then raise exception 'التكليف غير موجود أو خارج نطاقك'; end if;

  update public.staff_assignments set active = false, updated_at = now()
  where id = p_id;

  -- إزالة جسر الصلاحية المُزامَن (إن وُجد)
  if v_asn.assignment_kind = 'technical'
     and v_asn.class_id is not null and v_asn.user_id is not null then
    delete from public.class_teacher
    where class_id = v_asn.class_id
      and teacher_id = v_asn.user_id
      and academic_year = v_asn.academic_year;
  end if;
end; $$;


ALTER FUNCTION "public"."end_staff_assignment"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_core_module_enabled"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if exists (select 1 from public.modules m where m.key = new.module_key and m.is_core) then
    new.is_enabled := true;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_core_module_enabled"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."execute_annual_promotion"("p_class_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

    -- الصف 12 + ناجح → تخريج (status='graduated'؛ الشِم يضبط is_active=false)
    if v_grade = 12 and r.result = 'ناجح' then
      update public.students
         set status = 'graduated', status_reason = 'تخريج آلي'
       where id = r.student_id;
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


ALTER FUNCTION "public"."execute_annual_promotion"("p_class_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_monthly_reports"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."generate_monthly_reports"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_academic_year"("p_date" "date" DEFAULT CURRENT_DATE) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM p_date) >= 9
    THEN EXTRACT(YEAR FROM p_date)::TEXT || '-' || (EXTRACT(YEAR FROM p_date) + 1)::TEXT
    ELSE (EXTRACT(YEAR FROM p_date) - 1)::TEXT || '-' || EXTRACT(YEAR FROM p_date)::TEXT
  END;
$$;


ALTER FUNCTION "public"."get_academic_year"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_class_absence_log"("p_class_id" "uuid") RETURNS TABLE("student_id" "uuid", "full_name" "text", "seat_number" smallint, "absent_count" bigint, "excused_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_month int := extract(month from current_date);
  v_year  int := extract(year  from current_date);
  v_start date;
  v_end   date;
begin
  if not public.teaches_class(p_class_id) then
    raise exception 'not authorized for class %', p_class_id
      using errcode = '42501';
  end if;

  if v_month >= 9 then
    v_start := make_date(v_year,     9, 1);
    v_end   := make_date(v_year + 1, 8, 31);
  else
    v_start := make_date(v_year - 1, 9, 1);
    v_end   := make_date(v_year,     8, 31);
  end if;

  return query
  select
    s.id,
    s.full_name,
    s.seat_number,
    count(*) filter (where dsa.status = 'absent')  as absent_count,
    count(*) filter (where dsa.status = 'excused') as excused_count
  from public.students s
  join public.daily_student_attendance dsa
    on dsa.student_id = s.id
  where dsa.class_id = p_class_id
    and dsa.date between v_start and v_end
    and dsa.status in ('absent', 'excused')
  group by s.id, s.full_name, s.seat_number
  having count(*) filter (where dsa.status in ('absent','excused')) > 0
  order by
    (count(*) filter (where dsa.status = 'absent')) desc,
    s.seat_number nulls last,
    s.full_name;
end;
$$;


ALTER FUNCTION "public"."get_class_absence_log"("p_class_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_directorate_compliance"("p_days" integer DEFAULT 30) RETURNS TABLE("school_id" "uuid", "days_reported" integer, "reported_today" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_directorate_compliance"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_directorate_dropout_summary"() RETURNS TABLE("school_id" "uuid", "school_name" "text", "at_risk_count" bigint, "flagged_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_directorate_dropout_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_directorate_grades_coverage"() RETURNS TABLE("school_id" "uuid", "school_name" "text", "classes_count" bigint, "subjects_count" bigint, "entries_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_directorate_grades_coverage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_directorate_trend"("p_days" integer DEFAULT 14) RETURNS TABLE("day" "date", "present" integer, "late" integer, "absent" integer, "excused" integer, "schools_reported" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_directorate_trend"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dropout_risk_students"("p_school_id" "uuid") RETURNS TABLE("student_id" "uuid", "full_name" "text", "grade" "text", "class_id" "uuid", "class_name" "text", "absent_days" bigint, "threshold" integer, "semester" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_dropout_risk_students"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ministry_trend"("p_days" integer DEFAULT 14) RETURNS TABLE("day" "date", "present" integer, "late" integer, "absent" integer, "excused" integer, "schools_reported" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_ministry_trend"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_module_permissions"() RETURNS SETOF "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select rmp.module_key
  from public.role_module_permissions rmp
  where rmp.role_key = public.current_user_permission_role()
    and rmp.is_enabled = true;
$$;


ALTER FUNCTION "public"."get_my_module_permissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_periodic_reports"("p_scope" "text" DEFAULT 'directorate'::"text") RETURNS TABLE("id" "uuid", "period" "text", "scope" "text", "scope_id" "uuid", "data" "jsonb", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_periodic_reports"("p_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_school_assignments_for_directorate"("p_school_id" "uuid") RETURNS TABLE("id" "uuid", "assignment_kind" "text", "job_title" "text", "class_id" "uuid", "section" "text", "subject_ids" "uuid"[], "lesson_count" integer, "academic_year" "text", "active" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
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
    select sa.id, sa.assignment_kind, sa.job_title, sa.class_id, sa.section,
           sa.subject_ids, sa.lesson_count, sa.academic_year, sa.active
    from public.staff_assignments sa
    where sa.school_id = p_school_id and sa.active = true
    order by sa.assignment_kind, sa.job_title;
end; $$;


ALTER FUNCTION "public"."get_school_assignments_for_directorate"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_school_classes_for_directorate"("p_school_id" "uuid") RETURNS TABLE("id" "uuid", "grade" "text", "section" "text", "name" "text", "academic_year" "text", "foreign_language" "text", "level_track" smallint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
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
    select c.id, c.grade::text, c.section, c.name,
           c.academic_year, c.foreign_language, c.level_track
    from public.classes c
    where c.school_id = p_school_id
    order by c.grade, c.section;
end;
$$;


ALTER FUNCTION "public"."get_school_classes_for_directorate"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_school_staff_for_directorate"("p_school_id" "uuid") RETURNS TABLE("id" "uuid", "staff_type" "text", "full_name" "text", "certificate" "text", "higher_degree" "text", "specialization" "text", "subject_taught" "text", "seniority_year" integer, "job_title" "text", "start_date" "date", "educational_zone" "text", "roster_type" "text", "ministerial_doc" "text", "active" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
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
      sr.specialization, sr.subject_taught, sr.seniority_year, sr.job_title,
      sr.start_date, sr.educational_zone, sr.roster_type, sr.ministerial_doc, sr.active
    from public.staff_records sr
    where sr.school_id = p_school_id and sr.active = true
    order by sr.staff_type, sr.job_title, sr.full_name;
end;
$$;


ALTER FUNCTION "public"."get_school_staff_for_directorate"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_school_trend"("p_school_id" "uuid", "p_days" integer DEFAULT 30) RETURNS TABLE("day" "date", "present" integer, "late" integer, "absent" integer, "excused" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_school_trend"("p_school_id" "uuid", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sync_state"("p_device_id" "text", "p_table_name" "text") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select last_pulled_at from public.sync_state
     where user_id    = auth.uid()
       and device_id  = p_device_id
       and table_name = p_table_name),
    '1970-01-01'::timestamptz);
$$;


ALTER FUNCTION "public"."get_sync_state"("p_device_id" "text", "p_table_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."grant_grace"("p_student" "uuid", "p_class" "uuid", "p_academic_year" "text", "p_items" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."grant_grace"("p_student" "uuid", "p_class" "uuid", "p_academic_year" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_principal_in_my_directorate"("p_school_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from   public.schools s
    where  s.id             = p_school_id
      and  s.directorate_id  = (select directorate_id from public.users where id = auth.uid())
      and  s.directorate_id is not null
  );
$$;


ALTER FUNCTION "public"."is_principal_in_my_directorate"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_school_day"("p_date" "date") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select extract(isodow from p_date) not in (5, 6)
     and not exists (select 1 from public.school_holidays h where h.date = p_date);
$$;


ALTER FUNCTION "public"."is_school_day"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_transfer_document"("p" "jsonb") RETURNS "public"."transfer_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_my_school uuid;
  v_my_name   text;
  v_doc_type  text := coalesce(p->>'doc_type', 'regular');
  v_stu       record;
  v_to_class  public.classes;
  v_sch       record;
  v_year      text;
  v_outgoing  int;
  v_out       public.transfer_documents;
begin
  if public.current_user_role() is distinct from 'school_admin'::public.user_role then
    raise exception 'غير مصرّح: إصدار الوثائق لمدراء المدارس فقط';
  end if;

  v_my_school := public.current_user_school_id();
  if v_my_school is null then
    raise exception 'حسابك غير مرتبط بمدرسة';
  end if;

  if v_doc_type not in ('regular', 'exceptional') then
    raise exception 'نوع الوثيقة غير صالح';
  end if;

  -- إعادة التحقّق كاملاً على الخادم (نفس الحُرّاس ونفس الرسائل)
  select * into v_stu from public.lookup_student_for_transfer(
    p->>'national_id', p->>'first_name', p->>'father_name', p->>'family_name');
  if v_stu.student_id is null then
    raise exception 'تعذّر التحقّق من بيانات الطالب';
  end if;

  -- الشعبة المستقبِلة يجب أن تكون في مدرسة المُصدِر
  select c.* into v_to_class
  from public.classes c
  where c.id = (p->>'to_class_id')::uuid and c.school_id = v_my_school;
  if not found then
    raise exception 'الشعبة المستقبِلة غير موجودة في مدرستك';
  end if;

  -- فرق النوعين: العادية تُبقي الصف، والاستثنائية وحدها تُغيّره
  if v_doc_type = 'regular' then
    if v_stu.grade_label is null then
      raise exception 'الطالب غير مُسند إلى صفّ في مدرسته الحالية — استخدم الوثيقة الاستثنائية';
    end if;
    if public.ar_norm(v_to_class.grade::text) is distinct from public.ar_norm(v_stu.grade_label) then
      raise exception 'الوثيقة العادية تُبقي الطالب في صفّه الحالي — استخدم الوثيقة الاستثنائية لتغيير الصف';
    end if;
  end if;

  -- الورقة تقول «مديرية التربية والتعليم في: ‹اللاذقية›» — أي المحافظة، لا اسم
  -- المديرية. استعمال d.name يُخرج «… في: مديرية تربية اللاذقية» وهو تكرار.
  select s.name, s.complex_name, coalesce(d.governorate, d.name) as dir_name
    into v_sch
  from public.schools s
  left join public.directorates d on d.id = s.directorate_id
  where s.id = v_my_school;

  select u.full_name into v_my_name from public.users u where u.id = auth.uid();

  -- رقم الصادر: عدّاد لكل مدرسة في كل عام دراسي، كسجلّ الصادر الورقي.
  -- القفل الاستشاري يمنع نافذتين متزامنتين من حجز الرقم نفسه (والفهرس الفريد
  -- شبكة أمان ثانية لو فشل القفل).
  v_year := coalesce(
    nullif(btrim(coalesce(v_to_class.academic_year, '')), ''),
    case when extract(month from now())::int >= 9
         then (extract(year from now())::int)::text || '-' || (extract(year from now())::int + 1)::text
         else (extract(year from now())::int - 1)::text || '-' || (extract(year from now())::int)::text
    end);

  perform pg_advisory_xact_lock(hashtext(v_my_school::text || ':' || v_year));

  select coalesce(max(td.outgoing_number), 0) + 1 into v_outgoing
  from public.transfer_documents td
  where td.to_school_id = v_my_school and td.academic_year = v_year;

  insert into public.transfer_documents (
    doc_type, student_id, student_national_id, student_full_name,
    first_name, father_name, grandfather_name, family_name, mother_name,
    birth_date, student_gender,
    from_school_id, from_school_name, from_grade_label, from_section_label,
    to_school_id, to_school_name, to_class_id, to_grade_label, to_section_label,
    to_level_track, to_foreign_language, to_complex_name, to_directorate_name,
    academic_year, outgoing_number,
    transfer_reason, notes, issued_by, issued_by_name
  ) values (
    v_doc_type, v_stu.student_id, v_stu.national_id, v_stu.full_name,
    v_stu.first_name, v_stu.father_name, v_stu.grandfather_name, v_stu.family_name,
    v_stu.mother_name, v_stu.birth_date, v_stu.gender,
    v_stu.school_id, v_stu.school_name, v_stu.grade_label, v_stu.section_label,
    v_my_school, v_sch.name, v_to_class.id, v_to_class.grade::text, v_to_class.section,
    v_to_class.level_track, v_to_class.foreign_language, v_sch.complex_name, v_sch.dir_name,
    v_year, v_outgoing,
    nullif(btrim(coalesce(p->>'transfer_reason', '')), ''),
    nullif(btrim(coalesce(p->>'notes', '')), ''),
    auth.uid(), v_my_name
  ) returning * into v_out;

  -- إشعار مدراء المدرسة الحالية — القرار عندهم.
  -- الإشعار هنا لا في trigger: كل إدراج يمرّ بهذه الدالة حتماً (لا سياسة insert
  -- على الجدول)، فالـtrigger كان سيُكرّر الإشعار لا أكثر.
  perform public.notify_user(
    u.id, 'transfer_doc_new', 'طلب نقل وارد — وثيقة لا مانع',
    coalesce(v_sch.name, 'مدرسة') || ' تطلب نقل الطالب ' ||
      coalesce(v_out.student_full_name, ''),
    'transfer_documents', v_out.id
  )
  from public.users u
  where u.school_id = v_stu.school_id and u.role = 'school_admin';

  return v_out;
end; $$;


ALTER FUNCTION "public"."issue_transfer_document"("p" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_staff_to_registry"("p_staff_id" "uuid", "p_self_number" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_caller_id     uuid;
  v_caller_role   text;
  v_caller_school uuid;
  v_staff_school  uuid;
  v_staff_name_norm text;
  v_reg_name_norm   text;
  v_registry      public.national_staff_registry%rowtype;
begin
  v_caller_id := auth.uid();
  select role, school_id
    into v_caller_role, v_caller_school
    from public.users
   where id = v_caller_id;

  select school_id, public.ar_norm(coalesce(full_name,''))
    into v_staff_school, v_staff_name_norm
    from public.staff_records
   where id = p_staff_id;

  if not found then
    raise exception 'سجلّ الكادر غير موجود';
  end if;

  if not (
    v_caller_role = 'ministry_user'
    or (v_caller_role = 'school_admin' and v_caller_school = v_staff_school)
  ) then
    raise exception 'غير مصرّح بتنفيذ هذه العملية';
  end if;

  select * into v_registry
    from public.national_staff_registry
   where self_number = p_self_number;

  if not found then
    raise exception 'الرقم الذاتي % غير موجود في السجلّ الوطني للكادر', p_self_number;
  end if;

  -- Identity gate (staff registry carries only full_name → two-way containment).
  v_reg_name_norm := public.ar_norm(coalesce(v_registry.full_name,''));
  if coalesce(v_staff_name_norm,'') = ''
     or (position(v_staff_name_norm in v_reg_name_norm) = 0
         and position(v_reg_name_norm in v_staff_name_norm) = 0) then
    raise exception 'اسم الكادر لا يطابق السجلّ الوطني لهذا الرقم — تحقّق من الرقم الذاتي والاسم';
  end if;

  set local nsams.skip_registry_lock = 'true';

  update public.staff_records set
    registry_self_number = v_registry.self_number,
    self_number          = v_registry.self_number,
    general_number       = v_registry.general_number,
    full_name            = v_registry.full_name,
    national_id          = v_registry.national_id,
    mother_name          = v_registry.mother_name,
    birth_date           = v_registry.birth_date,
    gender               = v_registry.gender
  where id = p_staff_id;

  insert into public.audit_log
    (school_id, actor_id, entity, entity_id, action, changes, reason)
  values
    (v_staff_school, v_caller_id, 'staff', p_staff_id,
     'link_to_registry',
     jsonb_build_object(
       'registry_self_number', v_registry.self_number,
       'full_name',            v_registry.full_name,
       'national_id',          v_registry.national_id
     ),
     'ربط بالسجلّ الذاتي للكادر');

  return to_jsonb(v_registry);
end$$;


ALTER FUNCTION "public"."link_staff_to_registry"("p_staff_id" "uuid", "p_self_number" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."link_staff_to_registry"("p_staff_id" "uuid", "p_self_number" "text") IS 'تربط فرداً من الكادر بالسجلّ الذاتي الوطني وتنسخ حقول هويته منه. تتطلب دور school_admin لمدرسة الكادر أو ministry_user.';



CREATE OR REPLACE FUNCTION "public"."link_student_to_registry"("p_student_id" "uuid", "p_national_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_caller_id   uuid;
  v_caller_role text;
  v_caller_school uuid;
  v_stu_school  uuid;
  v_stu_name_norm text;
  v_registry    public.national_students_registry%rowtype;
begin
  v_caller_id := auth.uid();
  select role, school_id
    into v_caller_role, v_caller_school
    from public.users
   where id = v_caller_id;

  select school_id,
         public.ar_norm(coalesce(full_name,'')   || ' ' || coalesce(first_name,'')  || ' ' ||
                        coalesce(father_name,'')  || ' ' || coalesce(family_name,''))
    into v_stu_school, v_stu_name_norm
    from public.students
   where id = p_student_id;

  if not found then
    raise exception 'الطالب غير موجود';
  end if;

  if not (
    v_caller_role = 'ministry_user'
    or (v_caller_role = 'school_admin' and v_caller_school = v_stu_school)
  ) then
    raise exception 'غير مصرّح بتنفيذ هذه العملية';
  end if;

  select * into v_registry
    from public.national_students_registry
   where national_id = p_national_id;

  if not found then
    raise exception 'الرقم الوطني % غير موجود في السجلّ الوطني', p_national_id;
  end if;

  -- Identity gate: the caller's existing student name must match the registry row,
  -- else the number alone would expose an arbitrary citizen's identity.
  if position(public.ar_norm(coalesce(v_registry.first_name,''))  in v_stu_name_norm) = 0
     or position(public.ar_norm(coalesce(v_registry.father_name,'')) in v_stu_name_norm) = 0
     or position(public.ar_norm(coalesce(v_registry.family_name,'')) in v_stu_name_norm) = 0 then
    raise exception 'اسم الطالب لا يطابق السجلّ الوطني لهذا الرقم — تحقّق من الرقم الوطني والاسم';
  end if;

  set local nsams.skip_registry_lock = 'true';

  update public.students set
    registry_national_id = v_registry.national_id,
    national_id          = v_registry.national_id,
    first_name           = v_registry.first_name,
    father_name          = v_registry.father_name,
    family_name          = v_registry.family_name,
    full_name            = v_registry.full_name,
    gender               = v_registry.gender,
    birth_date           = v_registry.birth_date,
    mother_name          = v_registry.mother_name,
    mother_family        = v_registry.mother_family,
    grandfather_name     = v_registry.grandfather_name,
    card_number          = v_registry.card_number,
    birth_place          = v_registry.birth_place
  where id = p_student_id;

  insert into public.audit_log
    (school_id, actor_id, entity, entity_id, action, changes, reason)
  values
    (v_stu_school, v_caller_id, 'student', p_student_id,
     'link_to_registry',
     jsonb_build_object(
       'registry_national_id', v_registry.national_id,
       'full_name',            v_registry.full_name
     ),
     'ربط بالسجلّ الوطني');

  return to_jsonb(v_registry);
end$$;


ALTER FUNCTION "public"."link_student_to_registry"("p_student_id" "uuid", "p_national_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."link_student_to_registry"("p_student_id" "uuid", "p_national_id" "text") IS 'تربط طالباً بالسجلّ الوطني وتنسخ حقول هويته منه. تتطلب دور school_admin لمدرسة الطالب أو ministry_user.';



CREATE OR REPLACE FUNCTION "public"."lock_staff_registry_mirrors"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- السماح بالتجاوز من داخل RPC الربط
  if current_setting('nsams.skip_registry_lock', true) = 'true' then
    return new;
  end if;

  -- القفل فعّال فقط عندما يكون الكادر مرتبطاً بالسجلّ الذاتي
  if new.registry_self_number is not null then
    if (
      new.full_name      is distinct from old.full_name      or
      new.national_id    is distinct from old.national_id    or
      new.mother_name    is distinct from old.mother_name    or
      new.birth_date     is distinct from old.birth_date     or
      new.gender         is distinct from old.gender         or
      new.self_number    is distinct from old.self_number    or
      new.general_number is distinct from old.general_number
    ) then
      raise exception 'لا يمكن تعديل حقل مرتبط بالسجل الذاتي للكادر';
    end if;
  end if;

  return new;
end$$;


ALTER FUNCTION "public"."lock_staff_registry_mirrors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_student_registry_mirrors"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- السماح بالتجاوز من داخل RPC الربط
  if current_setting('nsams.skip_registry_lock', true) = 'true' then
    return new;
  end if;

  -- القفل فعّال فقط عندما يكون الطالب مرتبطاً بالسجلّ الوطني
  if new.registry_national_id is not null then
    if (
      new.first_name       is distinct from old.first_name       or
      new.father_name      is distinct from old.father_name      or
      new.family_name      is distinct from old.family_name      or
      new.full_name        is distinct from old.full_name        or
      new.gender           is distinct from old.gender           or
      new.birth_date       is distinct from old.birth_date       or
      new.national_id      is distinct from old.national_id      or
      new.mother_name      is distinct from old.mother_name      or
      new.mother_family    is distinct from old.mother_family    or
      new.grandfather_name is distinct from old.grandfather_name or
      new.card_number      is distinct from old.card_number      or
      new.birth_place      is distinct from old.birth_place
    ) then
      raise exception 'لا يمكن تعديل حقل مرتبط بالسجل الوطني للطالب';
    end if;
  end if;

  return new;
end$$;


ALTER FUNCTION "public"."lock_student_registry_mirrors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_student_for_transfer"("p_national_id" "text", "p_first_name" "text", "p_father_name" "text", "p_family_name" "text") RETURNS TABLE("student_id" "uuid", "full_name" "text", "first_name" "text", "father_name" "text", "grandfather_name" "text", "family_name" "text", "mother_name" "text", "birth_date" "date", "gender" "text", "national_id" "text", "school_id" "uuid", "school_name" "text", "class_id" "uuid", "grade_label" "text", "section_label" "text", "level_track" smallint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_my_school uuid;
  v_stu_id    uuid;
  v_composite text;
begin
  if public.current_user_role() is distinct from 'school_admin'::public.user_role then
    raise exception 'غير مصرّح: هذه الدالة لمدراء المدارس فقط';
  end if;

  v_my_school := public.current_user_school_id();
  if v_my_school is null then
    raise exception 'حسابك غير مرتبط بمدرسة';
  end if;

  if coalesce(btrim(p_national_id), '') = '' then
    raise exception 'الرقم التعريفي للطالب مطلوب';
  end if;

  select s.id into v_stu_id
  from public.students s
  where s.national_id = btrim(p_national_id) and s.is_active
  limit 1;

  if v_stu_id is null then
    raise exception 'لم يُعثر على طالب بهذا الرقم في رُقِيّ';
  end if;

  -- الطالب عندي أصلاً: لا معنى لوثيقة نقل إلى مدرسته نفسها
  if exists (select 1 from public.students s
             where s.id = v_stu_id and s.school_id = v_my_school) then
    raise exception 'الطالب مسجَّل في مدرستك أصلاً';
  end if;

  select public.ar_norm(
           coalesce(s.full_name, '')   || ' ' || coalesce(s.first_name, '')       || ' ' ||
           coalesce(s.father_name, '') || ' ' || coalesce(s.grandfather_name, '') || ' ' ||
           coalesce(s.family_name, ''))
    into v_composite
  from public.students s where s.id = v_stu_id;

  if position(public.ar_norm(p_first_name)  in v_composite) = 0
     or position(public.ar_norm(p_father_name) in v_composite) = 0
     or position(public.ar_norm(p_family_name) in v_composite) = 0 then
    raise exception 'الاسم لا يطابق الرقم التعريفي — تأكّد من الاسم واسم الأب والكنية';
  end if;

  if exists (select 1 from public.transfer_documents td
             where td.student_national_id = btrim(p_national_id)
               and td.status = 'pending') then
    raise exception 'للطالب وثيقة لا مانع معلّقة بالفعل — لا يمكن إصدار وثيقة ثانية قبل البتّ فيها';
  end if;

  return query
  select s.id, s.full_name, s.first_name, s.father_name, s.grandfather_name,
         s.family_name, s.mother_name, s.birth_date, s.gender, s.national_id,
         s.school_id, sc.name, s.class_id, c.grade::text, c.section, c.level_track
  from public.students s
  join public.schools sc on sc.id = s.school_id
  left join public.classes c on c.id = s.class_id
  where s.id = v_stu_id;
end; $$;


ALTER FUNCTION "public"."lookup_student_for_transfer"("p_national_id" "text", "p_first_name" "text", "p_father_name" "text", "p_family_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_user"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_entity" "text" DEFAULT NULL::"text", "p_entity_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_notif_id uuid;
  v_url      text;
  v_key      text;
BEGIN
  INSERT INTO public.notifications(recipient_id, type, title, body, entity, entity_id)
  VALUES (p_recipient_id, p_type, p_title, p_body, p_entity, p_entity_id)
  RETURNING id INTO v_notif_id;

  BEGIN
    v_url := 'https://xocrzpjfvizgnsybegwr.supabase.co';
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets
     WHERE name = 'service_role_key'
     LIMIT 1;
    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      PERFORM net.http_post(
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
    END IF;
  EXCEPTION WHEN others THEN NULL;
  END;
END;
$$;


ALTER FUNCTION "public"."notify_user"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_entity" "text", "p_entity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."parent_is_linked_to_school"("p_school_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from   public.parent_links pl
    join   public.students s on s.id = pl.student_id
    where  pl.user_id  = auth.uid()
      and  s.school_id = p_school_id
  )
$$;


ALTER FUNCTION "public"."parent_is_linked_to_school"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."parent_resubmit_excuse"("p_excuse_id" "uuid", "p_reason" "text", "p_photo_url" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_allowed boolean;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب الغياب مطلوب';
  end if;

  -- الملكية والحالة في فحصٍ واحد: الصفّ يخصّ ابناً مرتبطاً بالمستدعي فعلاً،
  -- وحالتُه 'rejected'. المقبول والمعلَّق لا يُعدَّلان — الأوّل حُسِم، والثاني
  -- قيد المراجعة فتغييرُه تحت يد المدير مربك.
  select true into v_allowed
  from   public.absence_excuses e
  join   public.parent_links pl
         on pl.student_id = e.student_id
        and pl.user_id    = auth.uid()
  where  e.id = p_excuse_id
    and  e.status = 'rejected';

  if not coalesce(v_allowed, false) then
    raise exception 'لا يمكن تعديل هذا العذر';
  end if;

  update public.absence_excuses
  set    reason      = p_reason,
         photo_url   = p_photo_url,   -- صريح: null يعني أنّ الوليّ أزال الصورة
         status      = 'pending',
         review_note = null,
         reviewed_by = null,
         updated_at  = now()
  where  id = p_excuse_id;
end;
$$;


ALTER FUNCTION "public"."parent_resubmit_excuse"("p_excuse_id" "uuid", "p_reason" "text", "p_photo_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."parent_sync_links"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."parent_sync_links"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_student_attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "status" "text" NOT NULL,
    "reason" "text",
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "daily_student_attendance_status_check" CHECK (("status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'late'::"text", 'excused'::"text"])))
);


ALTER TABLE "public"."daily_student_attendance" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pull_attendance_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) RETURNS SETOF "public"."daily_student_attendance"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select da.*
  from public.daily_student_attendance da
  join public.students s on s.id = da.student_id
  where s.class_id = p_class_id
    and da.updated_at > p_since
  order by da.updated_at;
$$;


ALTER FUNCTION "public"."pull_attendance_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_conduct" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "academic_year" "text" NOT NULL,
    "mark" integer NOT NULL,
    "recorded_by" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "student_conduct_mark_check" CHECK ((("mark" >= 0) AND ("mark" <= 100)))
);


ALTER TABLE "public"."student_conduct" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pull_conduct_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) RETURNS SETOF "public"."student_conduct"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select sc.*
  from public.student_conduct sc
  join public.students s on s.id = sc.student_id
  where s.class_id = p_class_id
    and sc.updated_at > p_since
  order by sc.updated_at;
$$;


ALTER FUNCTION "public"."pull_conduct_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_grades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "component_id" "uuid" NOT NULL,
    "semester" smallint NOT NULL,
    "academic_year" "text" NOT NULL,
    "mark" numeric NOT NULL,
    "recorded_by" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "student_grades_semester_check" CHECK (("semester" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."student_grades" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pull_grades_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) RETURNS SETOF "public"."student_grades"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select sg.*
  from public.student_grades sg
  join public.students s on s.id = sg.student_id
  where s.class_id = p_class_id
    and sg.updated_at > p_since
  order by sg.updated_at;
$$;


ALTER FUNCTION "public"."pull_grades_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "class_id" "uuid",
    "full_name" "text" NOT NULL,
    "national_id" "text",
    "parent_phone" "text",
    "gender" "text",
    "seat_number" smallint,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_name" "text",
    "father_name" "text",
    "family_name" "text",
    "birth_date" "date",
    "mother_name" "text",
    "mother_family" "text",
    "grandfather_name" "text",
    "card_number" "text",
    "birth_place" "text",
    "contact_phone" "text",
    "res_governorate" "text",
    "res_region" "text",
    "res_subdistrict" "text",
    "res_town" "text",
    "res_sector" "text",
    "res_block" "text",
    "res_record" "text",
    "recorded_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "dropout_flagged_at" timestamp with time zone,
    "dropout_semester" "text",
    "dropout_grade" integer,
    "dropout_return_at" "date",
    "status" "public"."student_status" DEFAULT 'active'::"public"."student_status" NOT NULL,
    "status_changed_at" timestamp with time zone,
    "status_reason" "text",
    "registry_national_id" "text",
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "students_dropout_semester_check" CHECK (("dropout_semester" = ANY (ARRAY['1'::"text", '2'::"text"]))),
    CONSTRAINT "students_full_name_check" CHECK (("length"(TRIM(BOTH FROM "full_name")) >= 2)),
    CONSTRAINT "students_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text"])))
);


ALTER TABLE "public"."students" OWNER TO "postgres";


COMMENT ON COLUMN "public"."students"."registry_national_id" IS 'ربط الطالب بالسجلّ الوطني — عند الربط تُقفل حقول الهوية المرآتية';



CREATE OR REPLACE FUNCTION "public"."pull_students_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) RETURNS SETOF "public"."students"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select * from public.students
  where class_id = p_class_id
    and updated_at > p_since
  order by updated_at;
$$;


ALTER FUNCTION "public"."pull_students_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reports_set_receipt"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    NEW.receipt_number := 'RPT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                          UPPER(SUBSTR(MD5(NEW.id::TEXT), 1, 6));
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."reports_set_receipt"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_monthly_statement"("p_statement_id" "uuid", "p_decision" "text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."review_monthly_statement"("p_statement_id" "uuid", "p_decision" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_result_sheet"("p_sheet_id" "uuid", "p_decision" "text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_dir         uuid;
  v_sheet       public.result_sheets;
  v_school_name text;
  v_notif_type  text;
  v_notif_title text;
  v_notif_body  text;
begin
  -- تحقق من الدور
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';
  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_decision not in ('approved','rejected','issued') then
    raise exception 'قيمة القرار غير صالحة';
  end if;

  -- جلب الجلاء وتحقق من الملكية والحالة المسموح بها لكل قرار
  select rs.* into v_sheet
  from public.result_sheets rs
  join public.schools sc on sc.id = rs.school_id
  where rs.id = p_sheet_id
    and sc.directorate_id = v_dir
    and (
      (p_decision in ('approved','rejected') and rs.status = 'submitted')
      or (p_decision = 'issued' and rs.status = 'approved')
    );
  if not found then
    raise exception 'الجلاء غير موجود أو خارج نطاق صلاحيتك أو حالته لا تسمح بهذا القرار';
  end if;

  -- تحديث الحالة (مع issued_at/by عند الإصدار)
  update public.result_sheets set
    status      = p_decision,
    notes       = case when p_decision = 'rejected' then p_notes else notes end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    issued_at   = case when p_decision = 'issued' then now()       else issued_at end,
    issued_by   = case when p_decision = 'issued' then auth.uid()  else issued_by end,
    updated_at  = now()
  where id = p_sheet_id;

  select name into v_school_name from public.schools where id = v_sheet.school_id;

  -- إشعار مدراء المدرسة بالنتيجة
  v_notif_type := case p_decision
    when 'approved' then 'result_sheet_approved'
    when 'issued'   then 'result_sheet_issued'
    else                 'result_sheet_rejected' end;
  v_notif_title := case p_decision
    when 'approved' then 'اعتُمد الجلاء ✓'
    when 'issued'   then 'صدر الجلاء نهائياً ✓'
    else                 'رُفض الجلاء' end;
  v_notif_body := coalesce(p_notes, case p_decision
    when 'approved' then 'تمت الموافقة على الجلاء بانتظار الإصدار النهائي.'
    when 'issued'   then 'صدر الجلاء بشكل نهائي وغير قابل للتعديل.'
    else                 'رُفض الجلاء من قبل المديرية.' end);

  perform public.notify_user(
    u.id, v_notif_type, v_notif_title, v_notif_body, 'result_sheets', p_sheet_id
  )
  from public.users u
  where u.school_id = v_sheet.school_id and u.role = 'school_admin';
end; $$;


ALTER FUNCTION "public"."review_result_sheet"("p_sheet_id" "uuid", "p_decision" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_school_request"("p_request_id" "uuid", "p_decision" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
      -- tools/add-national-registry.sql (Phase 2, applied separately) adds a
      -- trigger that locks first_name/father_name/family_name/national_id/
      -- birth_date once a student is linked to the national registry — so a
      -- plain UPDATE here raises P0001 for any linked student, blocking even
      -- a legitimate typo fix. The directorate's approval of this request IS
      -- the governance gate the lock exists to enforce (the same role the
      -- lock already grants an escape hatch to via link_student_to_registry),
      -- so it is lifted for the duration of this one correction. `set local`
      -- is transaction-scoped and never leaks past this call. Deliberately
      -- NOT propagated to national_students_registry — that table is meant to
      -- be authoritative from the ministry's own import, and silently writing
      -- into it here could be undone by the next import batch with no
      -- signal to anyone.
      set local nsams.skip_registry_lock = 'true';

      update public.students set
        first_name  = coalesce(nullif(trim(v_payload->>'first_name'), ''),  first_name),
        father_name = coalesce(nullif(trim(v_payload->>'father_name'),''), father_name),
        family_name = coalesce(nullif(trim(v_payload->>'family_name'),''), family_name),
        birth_date  = coalesce(nullif(v_payload->>'birth_date','')::date,   birth_date),
        national_id = coalesce(nullif(trim(v_payload->>'national_id'),''),  national_id),
        -- full_name is what report cards, rosters, and certificates actually
        -- display; recomputed here or a name correction would silently never
        -- appear anywhere despite the underlying columns being fixed.
        full_name   = trim(concat_ws(' ',
                        coalesce(nullif(trim(v_payload->>'first_name'), ''),  first_name),
                        coalesce(nullif(trim(v_payload->>'father_name'),''), father_name),
                        coalesce(nullif(trim(v_payload->>'family_name'),''), family_name))),
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


ALTER FUNCTION "public"."review_school_request"("p_request_id" "uuid", "p_decision" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_transfer_document"("p_doc_id" "uuid", "p_action" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."transfer_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_my_school uuid;
  v_my_name   text;
  v_doc       public.transfer_documents;
  v_stu       public.students;
  v_new_id    uuid;
  v_out       public.transfer_documents;
begin
  if public.current_user_role() is distinct from 'school_admin'::public.user_role then
    raise exception 'غير مصرّح: البتّ في الوثائق لمدراء المدارس فقط';
  end if;

  v_my_school := public.current_user_school_id();
  if p_action not in ('approve', 'reject') then
    raise exception 'قيمة القرار غير صالحة';
  end if;

  -- الوثيقة لمدرستي بصفتها **المدرسة الحالية** ولم يُبتّ فيها بعد
  select td.* into v_doc
  from public.transfer_documents td
  where td.id = p_doc_id
    and td.from_school_id = v_my_school
    and td.status = 'pending';
  if not found then
    raise exception 'الوثيقة غير موجودة أو خارج نطاق صلاحيتك أو بُتَّ فيها سابقاً';
  end if;

  select u.full_name into v_my_name from public.users u where u.id = auth.uid();

  if p_action = 'reject' then
    update public.transfer_documents set
      status            = 'rejected',
      reject_reason     = nullif(btrim(coalesce(p_reason, '')), ''),
      processed_by      = auth.uid(),
      processed_by_name = v_my_name,
      processed_at      = now()
    where id = p_doc_id
    returning * into v_out;

  else
    -- الطالب ما زال عندي ونشطاً؟ (قد يكون نُقل بمسار آخر بين الإصدار والبتّ)
    select s.* into v_stu
    from public.students s
    where s.id = v_doc.student_id and s.school_id = v_my_school and s.is_active;
    if not found then
      raise exception 'الطالب لم يعد مسجّلاً ونشطاً في مدرستك — لا يمكن تنفيذ النقل';
    end if;

    -- ١) الصفّ القديم: وسمٌ لا حذف. سجلّ المدرسة القديمة (حضور/علامات/جلاءات)
    --    يشير إلى student_id فيبقى سليماً وقابلاً للقراءة عندها.
    --    is_active يُشتقّ آلياً بـ t_sync_student_is_active — لا يُكتب هنا.
    update public.students set
      status        = 'transferred'::public.student_status,
      status_reason = 'نقل إلى ' || coalesce(v_doc.to_school_name, 'مدرسة أخرى'),
      updated_at    = now()
    where id = v_doc.student_id;

    -- ٢) صفٌّ جديد في المدرسة المستقبِلة بنفس الهوية.
    --    بلا seat_number — المقعد تُسنده المدرسة الجديدة في شعبتها.
    insert into public.students (
      school_id, class_id, full_name, first_name, father_name, family_name,
      grandfather_name, mother_name, mother_family, birth_date, birth_place,
      card_number, national_id, registry_national_id, gender, parent_phone,
      contact_phone, res_governorate, res_region, res_subdistrict, res_town,
      res_sector, res_block, res_record, status
    ) values (
      v_doc.to_school_id, v_doc.to_class_id, v_stu.full_name, v_stu.first_name,
      v_stu.father_name, v_stu.family_name, v_stu.grandfather_name, v_stu.mother_name,
      v_stu.mother_family, v_stu.birth_date, v_stu.birth_place, v_stu.card_number,
      v_stu.national_id, v_stu.registry_national_id, v_stu.gender, v_stu.parent_phone,
      v_stu.contact_phone, v_stu.res_governorate, v_stu.res_region, v_stu.res_subdistrict,
      v_stu.res_town, v_stu.res_sector, v_stu.res_block, v_stu.res_record, 'active'
    ) returning id into v_new_id;

    update public.transfer_documents set
      status            = 'executed',
      processed_by      = auth.uid(),
      processed_by_name = v_my_name,
      processed_at      = now()
    where id = p_doc_id
    returning * into v_out;

    -- أثرٌ في سجلّ كل مدرسة على حدة (audit_log مُقسَّم بـ school_id)
    insert into public.audit_log (school_id, actor_id, entity, entity_id, action, reason)
    values
      (v_doc.from_school_id, auth.uid(), 'students', v_doc.student_id, 'transfer_out',
       'وثيقة لا مانع رقم ' || v_doc.outgoing_number || ' — إلى ' || coalesce(v_doc.to_school_name, '')),
      (v_doc.to_school_id,   auth.uid(), 'students', v_new_id,        'transfer_in',
       'وثيقة لا مانع رقم ' || v_doc.outgoing_number || ' — من ' || coalesce(v_doc.from_school_name, ''));
  end if;

  -- إشعار المدرسة المُصدِرة بالنتيجة
  perform public.notify_user(
    u.id,
    case p_action when 'approve' then 'transfer_doc_executed' else 'transfer_doc_rejected' end,
    case p_action when 'approve' then 'نُفِّذ طلب النقل ✓'      else 'رُفض طلب النقل' end,
    coalesce(v_out.student_full_name, '') || ' — ' ||
      coalesce(v_out.from_school_name, 'المدرسة الحالية') ||
      coalesce(' · ' || nullif(btrim(coalesce(p_reason, '')), ''), ''),
    'transfer_documents', v_out.id
  )
  from public.users u
  where u.school_id = v_doc.to_school_id and u.role = 'school_admin';

  return v_out;
end; $$;


ALTER FUNCTION "public"."review_transfer_document"("p_doc_id" "uuid", "p_action" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."school_in_my_directorate"("p_school_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.schools
    where id = p_school_id
      and directorate_id = public.auth_directorate_id()
  )
$$;


ALTER FUNCTION "public"."school_in_my_directorate"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."school_review_excuse"("p_excuse_id" "uuid", "p_decision" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_excuse   public.absence_excuses%rowtype;
  v_prev     text;
begin
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'قرار غير صالح';
  end if;

  -- الرفض بلا سبب يترك وليّ الأمر أمام «مرفوض» مجرّدة لا يعرف كيف يصحّحها،
  -- وهو الطريق المسدود الذي فُتِح أصلاً بإعادة التقديم.
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'سبب الرفض مطلوب';
  end if;

  -- الصلاحية والصفّ في خطوةٍ واحدة: العذر يخصّ مدرسةَ المستدعي وهو مديرها.
  select e.* into v_excuse
  from   public.absence_excuses e
  where  e.id        = p_excuse_id
    and  e.school_id = public.current_user_school_id()
    and  public.current_user_role() = 'school_admin';

  if not found then
    raise exception 'لا يمكن مراجعة هذا العذر';
  end if;

  v_prev := v_excuse.status;

  update public.absence_excuses
  set    status      = p_decision,
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = auth.uid(),
         updated_at  = now()
  where  id = p_excuse_id;

  if p_decision = 'accepted' then
    -- الغياب وحده يُحوَّل. الحاضر والمتأخّر لا يُمَسّان: عذرٌ قُدِّم عن يومٍ
    -- سُجِّل فيه الطالب حاضراً لا يجوز أن يمحو حضوره.
    update public.daily_student_attendance
    set    status = 'excused'
    where  student_id = v_excuse.student_id
      and  date       = v_excuse.date
      and  status     = 'absent';

  elsif v_prev = 'accepted' then
    -- عدولٌ عن قبول: يعود اليوم غياباً غير مبرَّر كما كان قبل القرار.
    update public.daily_student_attendance
    set    status = 'absent'
    where  student_id = v_excuse.student_id
      and  date       = v_excuse.date
      and  status     = 'excused';
  end if;
end;
$$;


ALTER FUNCTION "public"."school_review_excuse"("p_excuse_id" "uuid", "p_decision" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_attendance_reminder"("p_school_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_dir         uuid;
  v_school_name text;
  v_school_dir  uuid;
  v_sent        integer := 0;
  v_recipients  integer := 0;
  v_throttled   integer := 0;
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
  loop
    v_recipients := v_recipients + 1;

    if exists (
      select 1 from public.notifications n
      where n.recipient_id = r.id
        and n.type = 'attendance_reminder'
        and n.entity_id = p_school_id          -- الحجب لهذه المدرسة وحدها
        and n.created_at > now() - interval '30 minutes'
    ) then
      v_throttled := v_throttled + 1;
      continue;
    end if;

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

  return jsonb_build_object(
    'sent',       v_sent,
    'recipients', v_recipients,   -- 0 يعني: لا حساب مدير لهذه المدرسة
    'throttled',  v_throttled
  );
end; $$;


ALTER FUNCTION "public"."send_attendance_reminder"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_student_status"("p_student_id" "uuid", "p_new_status" "public"."student_status", "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."set_student_status"("p_student_id" "uuid", "p_new_status" "public"."student_status", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_full_marks_from_catalog"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count int;
begin
  if not exists (
    select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'
  ) then
    raise exception 'غير مصرّح';
  end if;

  update public.subjects s
     set allow_full_marks = c.allow_full_marks
    from public.subject_catalog c
   where trim(s.name) = trim(c.name)
     and s.allow_full_marks is distinct from c.allow_full_marks;

  get diagnostics v_count = row_count;
  return v_count;
end; $$;


ALTER FUNCTION "public"."sync_full_marks_from_catalog"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_student_is_active"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.is_active := (new.status = 'active');
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end$$;


ALTER FUNCTION "public"."sync_student_is_active"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."teaches_class"("p_class_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.class_teacher ct
    where ct.class_id = p_class_id and ct.teacher_id = auth.uid()
  )
$$;


ALTER FUNCTION "public"."teaches_class"("p_class_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_role_module_permission"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_role_module_permission"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_duty_adjusted"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_status_ar text;
begin
  if new.teacher_id is null then return new; end if;
  if new.adjusted_by is null or new.adjusted_by = new.teacher_id then return new; end if;
  if TG_OP = 'UPDATE'
    and old.status            is not distinct from new.status
    and old.check_in_adjusted is not distinct from new.check_in_adjusted
    and old.check_out         is not distinct from new.check_out
  then return new; end if;

  v_status_ar := case new.status
    when 'present' then 'حاضر'
    when 'absent'  then 'غائب'
    when 'late'    then 'متأخر'
    when 'leave'   then 'إجازة'
    else new.status
  end;

  perform public.notify_user(
    new.teacher_id, 'duty_adjusted', 'تعديل سجل دوامك',
    'قام المدير بتعديل دوامك ليوم ' || new.date::text || ' — الحالة: ' || v_status_ar,
    'staff_attendance', new.id
  );
  return new;
end; $$;


ALTER FUNCTION "public"."trg_duty_adjusted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_grace_proposal_new"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_student text;
  v_subject text;
  v_teacher text;
  v_class   text;
begin
  select s.full_name into v_student from public.students s where s.id = new.student_id;
  select sub.name    into v_subject from public.subjects sub where sub.id = new.subject_id;
  select u.full_name into v_teacher from public.users    u   where u.id  = new.proposed_by;
  select coalesce(c.name, 'الصف ' || c.grade::text) into v_class
    from public.classes c where c.id = new.class_id;

  perform public.notify_user(
    u.id,
    'grace_proposed',
    'اقتراح درجات مساعدة',
    coalesce(v_teacher, 'معلّم') || ' يقترح ' || new.marks || ' درجة لـ '
      || coalesce(v_student, 'طالب')
      || ' في ' || coalesce(v_subject, 'المجموع')
      || ' — ' || coalesce(v_class, ''),
    'grace_proposals',
    new.id
  )
  from public.users u
  where u.role = 'school_admin'
    and u.school_id = new.school_id;

  return new;
end; $$;


ALTER FUNCTION "public"."trg_grace_proposal_new"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_report_new"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_school_name text;
  v_dir_id      uuid;
begin
  select s.name, s.directorate_id into v_school_name, v_dir_id
  from   public.schools s where s.id = new.school_id;

  perform public.notify_user(
    u.id, 'report_new',
    'بلاغ جديد من ' || coalesce(v_school_name, 'مدرسة'),
    coalesce(left(new.description, 120), ''),
    'emergency_reports', new.id
  )
  from public.users u
  where u.role = 'directorate_user' and u.directorate_id = v_dir_id;

  return new;
end; $$;


ALTER FUNCTION "public"."trg_report_new"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_report_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
    u.id, 'report_status', v_title,
    'رقم البلاغ: ' || coalesce(new.receipt_number, new.id::text),
    'emergency_reports', new.id
  )
  from public.users u
  where u.role = 'school_admin' and u.school_id = new.school_id;

  return new;
end; $$;


ALTER FUNCTION "public"."trg_report_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_staff_assignment"("p" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_school   uuid;
  v_id       uuid;
  v_year     text;
  v_kind     text;
  v_class    uuid;
  v_user     uuid;
  v_subjects uuid[];
begin
  -- صلاحية المستدعي
  select u.school_id into v_school
  from public.users u where u.id = auth.uid() and u.role = 'school_admin';
  if v_school is null then
    raise exception 'غير مصرّح: هذه الدالة لمدير المدرسة فقط';
  end if;

  v_id       := nullif(p->>'id','')::uuid;
  v_year     := coalesce(nullif(p->>'academic_year',''), '');
  v_kind     := p->>'assignment_kind';
  v_class    := nullif(p->>'class_id','')::uuid;
  v_user     := nullif(p->>'user_id','')::uuid;
  v_subjects := coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p->'subject_ids','[]'::jsonb))),
    '{}'::uuid[]);

  if v_kind not in ('technical','administrative') then
    raise exception 'نوع التكليف غير صالح';
  end if;

  if v_id is null then
    insert into public.staff_assignments (
      school_id, staff_id, user_id, assignment_kind, job_title, class_id, section,
      subject_ids, lesson_count, start_date, commence_date, assignment_date,
      execution_start, academic_year, active)
    values (
      v_school,
      nullif(p->>'staff_id','')::uuid,
      v_user, v_kind, p->>'job_title', v_class, nullif(p->>'section',''),
      v_subjects,
      nullif(p->>'lesson_count','')::int,
      nullif(p->>'start_date','')::date,
      nullif(p->>'commence_date','')::date,
      nullif(p->>'assignment_date','')::date,
      nullif(p->>'execution_start','')::date,
      v_year, true)
    returning id into v_id;
  else
    update public.staff_assignments set
      staff_id        = nullif(p->>'staff_id','')::uuid,
      user_id         = v_user,
      assignment_kind = v_kind,
      job_title       = p->>'job_title',
      class_id        = v_class,
      section         = nullif(p->>'section',''),
      subject_ids     = v_subjects,
      lesson_count    = nullif(p->>'lesson_count','')::int,
      start_date      = nullif(p->>'start_date','')::date,
      commence_date   = nullif(p->>'commence_date','')::date,
      assignment_date = nullif(p->>'assignment_date','')::date,
      execution_start = nullif(p->>'execution_start','')::date,
      academic_year   = v_year,
      updated_at      = now()
    where id = v_id and school_id = v_school;
    if not found then raise exception 'التكليف غير موجود أو خارج نطاقك'; end if;
  end if;

  -- مزامنة class_teacher: تكليف فني صفّي تدريسي بحساب دخول → جسر صلاحية المعلّم
  if v_kind = 'technical' and v_class is not null and v_user is not null and v_year <> '' then
    -- class_teacher هو ما تقرأه teaches_class() لتخويل المعلّم على الحضور والدرجات
    -- والسلوك. الصف والمعلّم يأتيان من payload المتصفح، فبدون هذا التحقق يستطيع
    -- مدير مدرسة ربط معلّم بأي صفّ في مدرسة أخرى (منح صلاحية عابر للنطاق).
    if not exists (select 1 from public.classes c where c.id = v_class and c.school_id = v_school) then
      raise exception 'الصف المحدّد لا يتبع مدرستك';
    end if;
    if not exists (select 1 from public.users u where u.id = v_user and u.school_id = v_school) then
      raise exception 'المعلّم المحدّد لا يتبع مدرستك';
    end if;
    insert into public.class_teacher (class_id, teacher_id, academic_year, role, subject_ids)
    values (v_class, v_user, v_year,
            case when array_length(v_subjects,1) is null then 'homeroom' else 'subject' end,
            v_subjects)
    on conflict (class_id, teacher_id, academic_year)
    do update set role = excluded.role, subject_ids = excluded.subject_ids;
  end if;

  return v_id;
end; $$;


ALTER FUNCTION "public"."upsert_staff_assignment"("p" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_sync_state"("p_device_id" "text", "p_table_name" "text", "p_pulled_at" timestamp with time zone) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  insert into public.sync_state (user_id, device_id, table_name, last_pulled_at)
  values (auth.uid(), p_device_id, p_table_name, p_pulled_at)
  on conflict (user_id, device_id, table_name)
  do update set last_pulled_at = excluded.last_pulled_at,
                updated_at     = now();
$$;


ALTER FUNCTION "public"."upsert_sync_state"("p_device_id" "text", "p_table_name" "text", "p_pulled_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_student_status_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and old.status = 'graduated' then
    raise exception 'لا يمكن تغيير حالة طالب متخرّج';
  end if;
  return new;
end$$;


ALTER FUNCTION "public"."validate_student_status_transition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_certificate"("p_student" "uuid", "p_year" "text" DEFAULT NULL::"text") RETURNS TABLE("student_name" "text", "school_name" "text", "directorate_name" "text", "class_label" "text", "academic_year" "text", "result" "text", "final_percent" numeric, "issued" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_year text;
begin
  if p_student is null then return; end if;

  v_year := nullif(trim(coalesce(p_year, '')), '');

  return query
  select (elem->>'name')::text,
         sc.name::text,
         coalesce(rs.snapshot_data->>'directorate', d.name)::text,
         coalesce(rs.snapshot_data->>'classLabel', '')::text,
         rs.academic_year::text,
         (elem->>'result')::text,
         nullif(elem->>'finalPercent', '')::numeric,
         true
    from public.result_sheets rs
    cross join lateral jsonb_array_elements(
           coalesce(rs.snapshot_data->'students', '[]'::jsonb)) elem
    left join public.schools      sc on sc.id = rs.school_id
    left join public.directorates d  on d.id  = sc.directorate_id
   where rs.status = 'issued'
     and elem->>'studentId' = p_student::text
     and (v_year is null or rs.academic_year = v_year)
   order by rs.academic_year desc
   limit 1;

  if found then return; end if;

  return query
  select s.full_name::text,
         sc.name::text,
         d.name::text,
         ('الصف ' || coalesce(c.grade::text, '')
                  || ' / ' || coalesce(c.section::text, ''))::text,
         coalesce(v_year, c.academic_year)::text,
         null::text,
         null::numeric,
         false
    from public.students s
    left join public.classes      c  on c.id  = s.class_id
    left join public.schools      sc on sc.id = s.school_id
    left join public.directorates d  on d.id  = sc.directorate_id
   where s.id = p_student
   limit 1;
end; $$;


ALTER FUNCTION "public"."verify_certificate"("p_student" "uuid", "p_year" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."absence_excuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "reason" "text" NOT NULL,
    "photo_url" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "submitted_by" "uuid",
    "reviewed_by" "uuid",
    "review_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "absence_excuses_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."absence_excuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "password" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."admin_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "submitted_by" "uuid",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_by" "uuid",
    "confirmed_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "attendance_submissions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."attendance_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "actor_id" "uuid",
    "entity" "text" NOT NULL,
    "entity_id" "uuid",
    "action" "text" NOT NULL,
    "changes" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_attendance" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "daily_attendance_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "students_present" integer DEFAULT 0 NOT NULL,
    "students_absent" integer DEFAULT 0 NOT NULL,
    "teacher_present" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."class_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_teacher" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "academic_year" "text" DEFAULT "public"."get_academic_year"() NOT NULL,
    "subject" "text",
    "role" "text" DEFAULT 'homeroom'::"text" NOT NULL,
    "subject_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    CONSTRAINT "class_teacher_role_check" CHECK (("role" = ANY (ARRAY['homeroom'::"text", 'supervisor'::"text", 'subject'::"text"])))
);


ALTER TABLE "public"."class_teacher" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "grade" "text" NOT NULL,
    "section" "text" DEFAULT 'A'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "academic_year" "text" DEFAULT "public"."get_academic_year"() NOT NULL,
    "foreign_language" "text" DEFAULT 'انكليزي'::"text",
    "level_track" smallint,
    CONSTRAINT "classes_foreign_language_chk" CHECK ((("foreign_language" IS NULL) OR ("foreign_language" = ANY (ARRAY['انكليزي'::"text", 'فرنسي'::"text", 'روسي'::"text"])))),
    CONSTRAINT "classes_level_track_chk" CHECK ((("level_track" IS NULL) OR (("level_track" >= 1) AND ("level_track" <= 3))))
);


ALTER TABLE "public"."classes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."classes"."level_track" IS 'رقم المستوى (1/2/3) للشعبة الحاملة منهاج المستوى بعد دمج المديرية؛ null = شعبة نظامية';



CREATE TABLE IF NOT EXISTS "public"."daily_attendance" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "teachers_present" integer DEFAULT 0 NOT NULL,
    "teachers_absent" integer DEFAULT 0 NOT NULL,
    "students_present" integer DEFAULT 0 NOT NULL,
    "students_absent" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "submitted_by" "uuid",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "admins_present" integer DEFAULT 0 NOT NULL,
    "admins_absent" integer DEFAULT 0 NOT NULL,
    "workers_present" integer DEFAULT 0 NOT NULL,
    "workers_absent" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."daily_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."directorates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "governorate" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."directorates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."emergency_reports" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "submitted_by" "uuid",
    "type" "public"."report_type" NOT NULL,
    "description" "text" NOT NULL,
    "severity" smallint DEFAULT 1 NOT NULL,
    "status" "public"."report_status" DEFAULT 'open'::"public"."report_status" NOT NULL,
    "receipt_number" "text" NOT NULL,
    "media_urls" "text"[],
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "emergency_reports_severity_check" CHECK ((("severity" >= 1) AND ("severity" <= 5)))
);


ALTER TABLE "public"."emergency_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."grace_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "academic_year" "text" NOT NULL,
    "subject_id" "uuid",
    "marks" integer NOT NULL,
    "reason" "text",
    "proposed_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "grace_proposals_marks_check" CHECK ((("marks" > 0) AND ("marks" <= 10))),
    CONSTRAINT "grace_proposals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."grace_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."grade_pass_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "grade_from" integer NOT NULL,
    "grade_to" integer NOT NULL,
    "default_pass" integer DEFAULT 40 NOT NULL,
    "core_pass" integer DEFAULT 50 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."grade_pass_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "directorate_id" "uuid",
    "list_type" "text" NOT NULL,
    "value" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lookup_lists_list_type_check" CHECK (("list_type" = ANY (ARRAY['admin_role'::"text", 'specialization'::"text", 'certificate'::"text", 'higher_degree'::"text", 'leave_type'::"text", 'ministerial_doc'::"text", 'support_job'::"text", 'educational_zone'::"text", 'job_title'::"text", 'school_admin_role'::"text"])))
);


ALTER TABLE "public"."lookup_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modules" (
    "key" "text" NOT NULL,
    "name_ar" "text" NOT NULL,
    "description_ar" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT 'عام'::"text" NOT NULL,
    "is_core" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_statement_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "statement_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "change_type" "text" NOT NULL,
    "staff_id" "uuid",
    "change_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "reason" "text",
    "effective_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_type" "text",
    "staff_group" "text",
    "detected" boolean DEFAULT false NOT NULL,
    "confirmed_at" timestamp with time zone,
    CONSTRAINT "monthly_statement_changes_change_type_check" CHECK (("change_type" = ANY (ARRAY['added'::"text", 'removed'::"text", 'modified'::"text", 'leave'::"text", 'transfer'::"text"]))),
    CONSTRAINT "stmt_changes_event_type_chk" CHECK ((("event_type" IS NULL) OR ("event_type" = ANY (ARRAY['مباشرة'::"text", 'انفكاك'::"text", 'وفاة'::"text", 'تقاعد'::"text", 'نقل'::"text", 'أخرى'::"text"]))))
);


ALTER TABLE "public"."monthly_statement_changes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_statement_rosters" (
    "statement_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "rosters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."monthly_statement_rosters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_statements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "month" smallint NOT NULL,
    "year" smallint NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "snapshot_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "submitted_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monthly_statements_month_check" CHECK ((("month" >= 1) AND ("month" <= 12))),
    CONSTRAINT "monthly_statements_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."monthly_statements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."national_staff_registry" (
    "self_number" "text" NOT NULL,
    "general_number" "text",
    "national_id" "text",
    "full_name" "text" NOT NULL,
    "mother_name" "text",
    "gender" "text",
    "birth_date" "date",
    "birth_place" "text",
    "certificate" "text",
    "higher_degree" "text",
    "specialization" "text",
    "source" "text" DEFAULT 'central_import'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "national_staff_registry_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text"])))
);


ALTER TABLE "public"."national_staff_registry" OWNER TO "postgres";


COMMENT ON TABLE "public"."national_staff_registry" IS 'السجلّ الوطني المركزي للكادر التعليمي — المصدر الموثوق لبيانات الهوية';



COMMENT ON COLUMN "public"."national_staff_registry"."self_number" IS 'الرقم الذاتي — المفتاح الأساسي';



COMMENT ON COLUMN "public"."national_staff_registry"."general_number" IS 'الرقم العام';



CREATE TABLE IF NOT EXISTS "public"."national_students_registry" (
    "national_id" "text" NOT NULL,
    "first_name" "text" NOT NULL,
    "father_name" "text",
    "family_name" "text",
    "full_name" "text" NOT NULL,
    "mother_name" "text",
    "mother_family" "text",
    "grandfather_name" "text",
    "gender" "text",
    "birth_date" "date",
    "birth_place" "text",
    "card_number" "text",
    "res_governorate" "text",
    "res_region" "text",
    "res_subdistrict" "text",
    "res_town" "text",
    "res_sector" "text",
    "res_block" "text",
    "res_record" "text",
    "source" "text" DEFAULT 'central_import'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "national_students_registry_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text"])))
);


ALTER TABLE "public"."national_students_registry" OWNER TO "postgres";


COMMENT ON TABLE "public"."national_students_registry" IS 'السجلّ الوطني المركزي للطلاب — المصدر الموثوق لبيانات هوية الطالب';



COMMENT ON COLUMN "public"."national_students_registry"."national_id" IS 'الرقم الوطني — المفتاح الأساسي';



COMMENT ON COLUMN "public"."national_students_registry"."source" IS 'مصدر السجلّ: central_import | manual_ministry | auto_seeded';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "entity" "text",
    "entity_id" "uuid",
    "read_at" timestamp with time zone,
    "push_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parent_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "linked_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."parent_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parent_otps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "code_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "attempts" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ip_hash" "text"
);


ALTER TABLE "public"."parent_otps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."periodic_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_type" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "period" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "scope_id" "uuid",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."periodic_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth_key" "text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."registry_lookup_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "lookup_id" "text" NOT NULL,
    "found" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "registry_lookup_audit_kind_check" CHECK (("kind" = ANY (ARRAY['student'::"text", 'staff'::"text"])))
);


ALTER TABLE "public"."registry_lookup_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."result_sheets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "academic_year" "text" NOT NULL,
    "term" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "snapshot_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "submitted_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "issued_at" timestamp with time zone,
    "issued_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "result_sheets_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'approved'::"text", 'issued'::"text", 'rejected'::"text"]))),
    CONSTRAINT "result_sheets_term_check" CHECK (("term" = ANY (ARRAY['s1'::"text", 's2'::"text", 'year'::"text"])))
);


ALTER TABLE "public"."result_sheets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_module_permissions" (
    "role_key" "text" NOT NULL,
    "module_key" "text" NOT NULL,
    "is_enabled" boolean DEFAULT false NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "role_module_permissions_role_key_check" CHECK (("role_key" = ANY (ARRAY['teacher'::"text", 'school_admin'::"text", 'directorate_staff'::"text", 'directorate_head'::"text", 'ministry_staff'::"text", 'minister'::"text", 'parent'::"text"])))
);


ALTER TABLE "public"."role_module_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."school_building" (
    "school_id" "uuid" NOT NULL,
    "floors" integer,
    "ownership" "text",
    "class_rooms" integer,
    "admin_rooms" integer,
    "unused_rooms" integer,
    "basement" integer,
    "lab" integer,
    "computer_lab" integer,
    "library" integer,
    "secretariat" integer,
    "gym" integer,
    "storage" integer,
    "guidance" integer,
    "health_room" integer,
    "workshop" integer,
    "theater" integer,
    "yard" integer,
    "other_halls" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "school_building_ownership_check" CHECK ((("ownership" IS NULL) OR ("ownership" = ANY (ARRAY['حكومي'::"text", 'مستأجر'::"text"]))))
);


ALTER TABLE "public"."school_building" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."school_holidays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."school_holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."school_personnel" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "national_id" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "staff_record_id" "uuid",
    CONSTRAINT "school_personnel_kind_check" CHECK (("kind" = ANY (ARRAY['admin'::"text", 'worker'::"text"])))
);


ALTER TABLE "public"."school_personnel" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."school_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "directorate_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "reviewed_by" "uuid",
    "review_reason" "text",
    "applied_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "school_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "school_requests_type_check" CHECK (("type" = ANY (ARRAY['add_class'::"text", 'add_student'::"text", 'correct_student'::"text"])))
);


ALTER TABLE "public"."school_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schools" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "directorate_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "lat" numeric(10,7),
    "lng" numeric(10,7),
    "total_teachers" integer DEFAULT 0,
    "total_students" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "school_type" "text" DEFAULT 'primary'::"text" NOT NULL,
    "min_attendance_pct" integer DEFAULT 75 NOT NULL,
    "work_start_time" time without time zone,
    "complex_name" "text",
    "classification" "text",
    "education_type" "text",
    "shift" "text",
    "student_type" "text",
    "dropout_threshold_days" integer DEFAULT 16 NOT NULL,
    "statistical_number" "text",
    "cycle" "text",
    "rural_curriculum" boolean DEFAULT false,
    "village" "text",
    "phone" "text",
    "shared_with" "text",
    "former_name" "text",
    "educational_zone" "text",
    "day_type" "text",
    "archived_at" timestamp with time zone,
    CONSTRAINT "schools_day_type_chk" CHECK ((("day_type" IS NULL) OR ("day_type" = ANY (ARRAY['كامل'::"text", 'نصفي'::"text"])))),
    CONSTRAINT "schools_school_type_chk" CHECK (("school_type" = ANY (ARRAY['primary'::"text", 'preparatory'::"text", 'secondary'::"text"])))
);


ALTER TABLE "public"."schools" OWNER TO "postgres";


COMMENT ON COLUMN "public"."schools"."school_type" IS 'primary=ابتدائي (معلّم صف) | preparatory=إعدادي | secondary=ثانوي (كلاهما موجّه). لا يُشتقّ من رقم الصف: صفوف الإعدادي والثانوي مرقّمة ١-٢-٣ محلياً.';



COMMENT ON COLUMN "public"."schools"."archived_at" IS 'غير فارغ = مؤرشفة: تُخفى من قوائم المدارس التشغيلية (المديرية والوزارة ومنتقي الاستيراد) وتبقى مرئية في لوحة المشرف تحت مرشّح صريح.';



CREATE TABLE IF NOT EXISTS "public"."staff_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "staff_id" "uuid",
    "user_id" "uuid",
    "assignment_kind" "text" NOT NULL,
    "job_title" "text" NOT NULL,
    "class_id" "uuid",
    "section" "text",
    "subject_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "lesson_count" integer,
    "start_date" "date",
    "commence_date" "date",
    "assignment_date" "date",
    "execution_start" "date",
    "academic_year" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "staff_assignments_assignment_kind_check" CHECK (("assignment_kind" = ANY (ARRAY['technical'::"text", 'administrative'::"text"])))
);


ALTER TABLE "public"."staff_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "kind" "text" NOT NULL,
    "teacher_id" "uuid",
    "personnel_id" "uuid",
    "status" "text" DEFAULT 'present'::"text" NOT NULL,
    "check_in_original" timestamp with time zone,
    "check_in_adjusted" timestamp with time zone,
    "check_out" timestamp with time zone,
    "late_minutes" integer,
    "source" "text" DEFAULT 'manager'::"text" NOT NULL,
    "adjusted_by" "uuid",
    "adjust_reason" "text",
    "note" "text",
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "chk_staff_ref" CHECK (((("kind" = 'teacher'::"text") AND ("teacher_id" IS NOT NULL) AND ("personnel_id" IS NULL)) OR (("kind" = ANY (ARRAY['admin'::"text", 'worker'::"text"])) AND ("personnel_id" IS NOT NULL) AND ("teacher_id" IS NULL)))),
    CONSTRAINT "staff_attendance_kind_check" CHECK (("kind" = ANY (ARRAY['teacher'::"text", 'admin'::"text", 'worker'::"text"]))),
    CONSTRAINT "staff_attendance_source_check" CHECK (("source" = ANY (ARRAY['self'::"text", 'manager'::"text"]))),
    CONSTRAINT "staff_attendance_status_check" CHECK (("status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'leave'::"text", 'late'::"text"])))
);


ALTER TABLE "public"."staff_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "password" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."staff_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_leaves" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "leave_type" "text" NOT NULL,
    "leave_days" integer NOT NULL,
    "month" smallint NOT NULL,
    "year" smallint NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_leaves_leave_days_check" CHECK (("leave_days" > 0)),
    CONSTRAINT "staff_leaves_month_check" CHECK ((("month" >= 1) AND ("month" <= 12)))
);


ALTER TABLE "public"."staff_leaves" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "staff_type" "text" NOT NULL,
    "national_id" "text",
    "full_name" "text" NOT NULL,
    "mother_name" "text",
    "birth_date" "date",
    "certificate" "text",
    "higher_degree" "text",
    "specialization" "text",
    "subject_taught" "text",
    "seniority_years" numeric(4,1) DEFAULT 0,
    "job_title" "text",
    "start_date" "date",
    "phone" "text",
    "residential_zone" "text",
    "educational_zone" "text",
    "roster_type" "text" DEFAULT 'inside'::"text" NOT NULL,
    "ministerial_doc" "text",
    "notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "registry_self_number" "text",
    "self_number" "text",
    "general_number" "text",
    "gender" "text",
    "row_version" integer DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    "landline" "text",
    "teaching_rank" "text",
    "teaching_hours" integer,
    "quota_subjects" "text",
    "quota_school_external" "text",
    "assigned_grade" "text",
    "assigned_section" "text",
    "seniority_year" integer,
    CONSTRAINT "staff_records_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text"]))),
    CONSTRAINT "staff_records_roster_type_check" CHECK (("roster_type" = ANY (ARRAY['inside'::"text", 'outside'::"text", 'contract'::"text"]))),
    CONSTRAINT "staff_records_seniority_year_chk" CHECK ((("seniority_year" IS NULL) OR (("seniority_year" >= 1940) AND ("seniority_year" <= ((EXTRACT(year FROM "now"()))::integer + 1))))),
    CONSTRAINT "staff_records_staff_type_check" CHECK (("staff_type" = ANY (ARRAY['admin'::"text", 'teaching'::"text", 'professional'::"text", 'worker'::"text", 'guard'::"text"]))),
    CONSTRAINT "staff_records_teaching_rank_chk" CHECK ((("teaching_rank" IS NULL) OR ("teaching_rank" = ANY (ARRAY['معلم'::"text", 'مدرس'::"text", 'مدرس مساعد'::"text"]))))
);


ALTER TABLE "public"."staff_records" OWNER TO "postgres";


COMMENT ON COLUMN "public"."staff_records"."seniority_years" IS 'مهجور: مدّة الخدمة بالسنوات. استُبدل بـ seniority_year. يبقى للسجلات القديمة.';



COMMENT ON COLUMN "public"."staff_records"."registry_self_number" IS 'ربط الكادر بالسجلّ الذاتي — عند الربط تُقفل حقول الهوية المرآتية';



COMMENT ON COLUMN "public"."staff_records"."self_number" IS 'الرقم الذاتي المرآتي (مرجع محلي، قد يكون بلا ربط بالسجلّ)';



COMMENT ON COLUMN "public"."staff_records"."general_number" IS 'الرقم العام المرآتي';



COMMENT ON COLUMN "public"."staff_records"."seniority_year" IS 'القدم الوظيفي — سنة التعيين (مثال: 1978)';



CREATE TABLE IF NOT EXISTS "public"."student_grace" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "class_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "academic_year" "text" NOT NULL,
    "subject_id" "uuid",
    "marks" numeric NOT NULL,
    "granted_by" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."student_grace" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subject_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "is_core_arabic" boolean DEFAULT false NOT NULL,
    "is_core_math" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "allow_full_marks" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."subject_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subject_catalog_components" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "catalog_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "max_mark" integer DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."subject_catalog_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subject_components" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "max_mark" numeric DEFAULT 0 NOT NULL,
    "sort_order" integer
);


ALTER TABLE "public"."subject_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subjects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "grade" integer NOT NULL,
    "name" "text" NOT NULL,
    "max_total" numeric DEFAULT 100 NOT NULL,
    "pass_mark" numeric DEFAULT 40 NOT NULL,
    "is_core_arabic" boolean DEFAULT false NOT NULL,
    "sort_order" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_core_math" boolean DEFAULT false NOT NULL,
    "allow_full_marks" boolean DEFAULT false NOT NULL,
    CONSTRAINT "subjects_grade_check" CHECK ((("grade" >= 1) AND ("grade" <= 12)))
);


ALTER TABLE "public"."subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "table_name" "text" NOT NULL,
    "last_pulled_at" timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sync_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_daily_attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "check_in" time without time zone,
    "check_out" time without time zone,
    "status" "text" DEFAULT 'present'::"text" NOT NULL,
    "late_minutes" smallint DEFAULT 0 NOT NULL,
    "notes" "text",
    CONSTRAINT "teacher_daily_attendance_status_check" CHECK (("status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'late'::"text", 'leave'::"text"])))
);


ALTER TABLE "public"."teacher_daily_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "public"."user_role" NOT NULL,
    "school_id" "uuid",
    "directorate_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "permission_role" "text",
    CONSTRAINT "chk_role_school" CHECK (((("role" = 'school_admin'::"public"."user_role") AND ("school_id" IS NOT NULL)) OR (("role" = 'directorate_user'::"public"."user_role") AND ("directorate_id" IS NOT NULL)) OR ("role" = 'ministry_user'::"public"."user_role") OR (("role" = 'teacher'::"public"."user_role") AND ("school_id" IS NOT NULL)))),
    CONSTRAINT "users_permission_role_check" CHECK (("permission_role" = ANY (ARRAY['teacher'::"text", 'school_admin'::"text", 'directorate_staff'::"text", 'directorate_head'::"text", 'ministry_staff'::"text", 'minister'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_class_daily_summary" AS
 SELECT "c"."id" AS "class_id",
    "c"."school_id",
    "c"."grade",
    "c"."section",
    "c"."academic_year",
    "ct"."teacher_id",
    "u"."full_name" AS "teacher_name",
    "sub"."date",
    "sub"."status" AS "submission_status",
    "sub"."submitted_at",
    "count"("a"."id") AS "total_marked",
    "sum"(
        CASE
            WHEN ("a"."status" = 'present'::"text") THEN 1
            ELSE 0
        END) AS "cnt_present",
    "sum"(
        CASE
            WHEN ("a"."status" = 'absent'::"text") THEN 1
            ELSE 0
        END) AS "cnt_absent",
    "sum"(
        CASE
            WHEN ("a"."status" = 'late'::"text") THEN 1
            ELSE 0
        END) AS "cnt_late",
    "sum"(
        CASE
            WHEN ("a"."status" = 'excused'::"text") THEN 1
            ELSE 0
        END) AS "cnt_excused"
   FROM (((("public"."classes" "c"
     LEFT JOIN "public"."class_teacher" "ct" ON ((("ct"."class_id" = "c"."id") AND ("ct"."academic_year" = "public"."get_academic_year"()))))
     LEFT JOIN "public"."users" "u" ON (("u"."id" = "ct"."teacher_id")))
     LEFT JOIN "public"."attendance_submissions" "sub" ON (("sub"."class_id" = "c"."id")))
     LEFT JOIN "public"."daily_student_attendance" "a" ON ((("a"."class_id" = "c"."id") AND ("a"."date" = "sub"."date"))))
  GROUP BY "c"."id", "c"."school_id", "c"."grade", "c"."section", "c"."academic_year", "ct"."teacher_id", "u"."full_name", "sub"."date", "sub"."status", "sub"."submitted_at";


ALTER VIEW "public"."v_class_daily_summary" OWNER TO "postgres";


DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."absence_excuses"
    ADD CONSTRAINT "absence_excuses_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."absence_excuses"
    ADD CONSTRAINT "absence_excuses_student_id_date_key" UNIQUE ("student_id", "date");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."admin_credentials"
    ADD CONSTRAINT "admin_credentials_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_class_id_date_key" UNIQUE ("class_id", "date");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."class_attendance"
    ADD CONSTRAINT "class_attendance_daily_attendance_id_class_id_key" UNIQUE ("daily_attendance_id", "class_id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."class_attendance"
    ADD CONSTRAINT "class_attendance_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."class_teacher"
    ADD CONSTRAINT "class_teacher_class_teacher_year_key" UNIQUE ("class_id", "teacher_id", "academic_year");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."class_teacher"
    ADD CONSTRAINT "class_teacher_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_school_id_grade_section_academic_year_key" UNIQUE ("school_id", "grade", "section", "academic_year");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_school_id_grade_section_key" UNIQUE ("school_id", "grade", "section");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_attendance"
    ADD CONSTRAINT "daily_attendance_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_attendance"
    ADD CONSTRAINT "daily_attendance_school_id_date_key" UNIQUE ("school_id", "date");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_student_attendance"
    ADD CONSTRAINT "daily_student_attendance_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_student_attendance"
    ADD CONSTRAINT "daily_student_attendance_student_id_date_key" UNIQUE ("student_id", "date");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."directorates"
    ADD CONSTRAINT "directorates_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."emergency_reports"
    ADD CONSTRAINT "emergency_reports_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."emergency_reports"
    ADD CONSTRAINT "emergency_reports_receipt_number_key" UNIQUE ("receipt_number");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."grace_proposals"
    ADD CONSTRAINT "grace_proposals_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."grade_pass_rules"
    ADD CONSTRAINT "grade_pass_rules_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."lookup_lists"
    ADD CONSTRAINT "lookup_lists_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."modules"
    ADD CONSTRAINT "modules_pkey" PRIMARY KEY ("key");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statement_changes"
    ADD CONSTRAINT "monthly_statement_changes_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statement_rosters"
    ADD CONSTRAINT "monthly_statement_rosters_pkey" PRIMARY KEY ("statement_id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statements"
    ADD CONSTRAINT "monthly_statements_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."national_staff_registry"
    ADD CONSTRAINT "national_staff_registry_national_id_key" UNIQUE ("national_id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."national_staff_registry"
    ADD CONSTRAINT "national_staff_registry_pkey" PRIMARY KEY ("self_number");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."national_students_registry"
    ADD CONSTRAINT "national_students_registry_pkey" PRIMARY KEY ("national_id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."parent_links"
    ADD CONSTRAINT "parent_links_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."parent_links"
    ADD CONSTRAINT "parent_links_user_id_student_id_key" UNIQUE ("user_id", "student_id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."parent_otps"
    ADD CONSTRAINT "parent_otps_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."periodic_reports"
    ADD CONSTRAINT "periodic_reports_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."registry_lookup_audit"
    ADD CONSTRAINT "registry_lookup_audit_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."result_sheets"
    ADD CONSTRAINT "result_sheets_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."role_module_permissions"
    ADD CONSTRAINT "role_module_permissions_pkey" PRIMARY KEY ("role_key", "module_key");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_building"
    ADD CONSTRAINT "school_building_pkey" PRIMARY KEY ("school_id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_holidays"
    ADD CONSTRAINT "school_holidays_date_key" UNIQUE ("date");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_holidays"
    ADD CONSTRAINT "school_holidays_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_personnel"
    ADD CONSTRAINT "school_personnel_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_requests"
    ADD CONSTRAINT "school_requests_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."schools"
    ADD CONSTRAINT "schools_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_credentials"
    ADD CONSTRAINT "staff_credentials_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_credentials"
    ADD CONSTRAINT "staff_credentials_username_key" UNIQUE ("username");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_leaves"
    ADD CONSTRAINT "staff_leaves_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_records"
    ADD CONSTRAINT "staff_records_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_conduct"
    ADD CONSTRAINT "student_conduct_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_conduct"
    ADD CONSTRAINT "student_conduct_student_id_academic_year_key" UNIQUE ("student_id", "academic_year");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grace"
    ADD CONSTRAINT "student_grace_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grades"
    ADD CONSTRAINT "student_grades_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grades"
    ADD CONSTRAINT "student_grades_student_id_component_id_semester_academic_ye_key" UNIQUE ("student_id", "component_id", "semester", "academic_year");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."subject_catalog_components"
    ADD CONSTRAINT "subject_catalog_components_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."subject_catalog"
    ADD CONSTRAINT "subject_catalog_name_key" UNIQUE ("name");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."subject_catalog"
    ADD CONSTRAINT "subject_catalog_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."subject_components"
    ADD CONSTRAINT "subject_components_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."sync_state"
    ADD CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."sync_state"
    ADD CONSTRAINT "sync_state_user_id_device_id_table_name_key" UNIQUE ("user_id", "device_id", "table_name");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."teacher_daily_attendance"
    ADD CONSTRAINT "teacher_daily_attendance_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."teacher_daily_attendance"
    ADD CONSTRAINT "teacher_daily_attendance_teacher_id_date_key" UNIQUE ("teacher_id", "date");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."transfer_documents"
    ADD CONSTRAINT "transfer_documents_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
CREATE INDEX IF NOT EXISTS "absence_excuses_photo_url_idx" ON "public"."absence_excuses" USING "btree" ("photo_url") WHERE ("photo_url" IS NOT NULL);



CREATE INDEX IF NOT EXISTS "absence_excuses_school_date_idx" ON "public"."absence_excuses" USING "btree" ("school_id", "date" DESC);



CREATE INDEX IF NOT EXISTS "grace_proposals_class_idx" ON "public"."grace_proposals" USING "btree" ("class_id", "academic_year", "status");



CREATE INDEX IF NOT EXISTS "idx_att_sub_updated" ON "public"."attendance_submissions" USING "btree" ("updated_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX IF NOT EXISTS "idx_class_attendance_daily" ON "public"."class_attendance" USING "btree" ("daily_attendance_id");



CREATE INDEX IF NOT EXISTS "idx_ct_teacher" ON "public"."class_teacher" USING "btree" ("teacher_id");



CREATE INDEX IF NOT EXISTS "idx_daily_attendance_school" ON "public"."daily_attendance" USING "btree" ("school_id", "date" DESC);



CREATE INDEX IF NOT EXISTS "idx_dsa_class_date" ON "public"."daily_student_attendance" USING "btree" ("class_id", "date");



CREATE INDEX IF NOT EXISTS "idx_dsa_school_date" ON "public"."daily_student_attendance" USING "btree" ("school_id", "date");



CREATE INDEX IF NOT EXISTS "idx_dsa_updated" ON "public"."daily_student_attendance" USING "btree" ("updated_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX IF NOT EXISTS "idx_reports_school" ON "public"."emergency_reports" USING "btree" ("school_id", "created_at" DESC);



CREATE INDEX IF NOT EXISTS "idx_reports_status" ON "public"."emergency_reports" USING "btree" ("status");



CREATE INDEX IF NOT EXISTS "idx_school_req_dir_status" ON "public"."school_requests" USING "btree" ("directorate_id", "status", "created_at" DESC);



CREATE INDEX IF NOT EXISTS "idx_school_req_school" ON "public"."school_requests" USING "btree" ("school_id", "created_at" DESC);



CREATE INDEX IF NOT EXISTS "idx_schools_directorate" ON "public"."schools" USING "btree" ("directorate_id");



CREATE INDEX IF NOT EXISTS "idx_staff_att_updated" ON "public"."staff_attendance" USING "btree" ("updated_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX IF NOT EXISTS "idx_student_conduct_updated" ON "public"."student_conduct" USING "btree" ("updated_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX IF NOT EXISTS "idx_student_grades_updated" ON "public"."student_grades" USING "btree" ("updated_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX IF NOT EXISTS "idx_students_class" ON "public"."students" USING "btree" ("class_id");



CREATE INDEX IF NOT EXISTS "idx_students_school" ON "public"."students" USING "btree" ("school_id");



CREATE INDEX IF NOT EXISTS "idx_students_updated" ON "public"."students" USING "btree" ("updated_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX IF NOT EXISTS "idx_sub_school_date" ON "public"."attendance_submissions" USING "btree" ("school_id", "date");



CREATE INDEX IF NOT EXISTS "idx_users_directorate" ON "public"."users" USING "btree" ("directorate_id");



CREATE INDEX IF NOT EXISTS "idx_users_role" ON "public"."users" USING "btree" ("role");



CREATE INDEX IF NOT EXISTS "idx_users_school" ON "public"."users" USING "btree" ("school_id");



CREATE UNIQUE INDEX IF NOT EXISTS "lookup_lists_uniq" ON "public"."lookup_lists" USING "btree" ("list_type", "value", COALESCE("directorate_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE UNIQUE INDEX IF NOT EXISTS "monthly_statements_school_period" ON "public"."monthly_statements" USING "btree" ("school_id", "year", "month");



CREATE INDEX IF NOT EXISTS "parent_otps_ip_time_idx" ON "public"."parent_otps" USING "btree" ("ip_hash", "created_at");



CREATE INDEX IF NOT EXISTS "parent_otps_phone_idx" ON "public"."parent_otps" USING "btree" ("phone", "expires_at");



CREATE INDEX IF NOT EXISTS "registry_lookup_audit_user_time_idx" ON "public"."registry_lookup_audit" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX IF NOT EXISTS "result_sheets_class_term" ON "public"."result_sheets" USING "btree" ("class_id", "academic_year", "term");



CREATE INDEX IF NOT EXISTS "school_personnel_school_active_idx" ON "public"."school_personnel" USING "btree" ("school_id", "is_active");



CREATE UNIQUE INDEX IF NOT EXISTS "school_personnel_staff_record_uidx" ON "public"."school_personnel" USING "btree" ("staff_record_id") WHERE ("staff_record_id" IS NOT NULL);



CREATE INDEX IF NOT EXISTS "schools_active_idx" ON "public"."schools" USING "btree" ("directorate_id") WHERE ("archived_at" IS NULL);



CREATE INDEX IF NOT EXISTS "staff_assignments_school" ON "public"."staff_assignments" USING "btree" ("school_id", "academic_year") WHERE ("active" = true);



CREATE UNIQUE INDEX IF NOT EXISTS "staff_att_personnel_date" ON "public"."staff_attendance" USING "btree" ("personnel_id", "date");



CREATE UNIQUE INDEX IF NOT EXISTS "staff_att_teacher_date" ON "public"."staff_attendance" USING "btree" ("teacher_id", "date");



CREATE INDEX IF NOT EXISTS "staff_leaves_school_period" ON "public"."staff_leaves" USING "btree" ("school_id", "year", "month");



CREATE UNIQUE INDEX IF NOT EXISTS "staff_leaves_unique_period" ON "public"."staff_leaves" USING "btree" ("staff_id", "leave_type", "month", "year");



CREATE INDEX IF NOT EXISTS "staff_records_school_type" ON "public"."staff_records" USING "btree" ("school_id", "staff_type") WHERE ("active" = true);



CREATE INDEX IF NOT EXISTS "stmt_changes_statement" ON "public"."monthly_statement_changes" USING "btree" ("statement_id");



CREATE INDEX IF NOT EXISTS "stmt_rosters_school" ON "public"."monthly_statement_rosters" USING "btree" ("school_id");



CREATE UNIQUE INDEX IF NOT EXISTS "student_conduct_uniq" ON "public"."student_conduct" USING "btree" ("student_id", "academic_year");



CREATE UNIQUE INDEX IF NOT EXISTS "student_grace_uniq" ON "public"."student_grace" USING "btree" ("student_id", "class_id", "academic_year", COALESCE("subject_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE INDEX IF NOT EXISTS "student_grades_class_idx" ON "public"."student_grades" USING "btree" ("class_id", "academic_year");



CREATE UNIQUE INDEX IF NOT EXISTS "students_natid_school" ON "public"."students" USING "btree" ("school_id", "national_id") WHERE (("national_id" IS NOT NULL) AND "is_active");



CREATE INDEX IF NOT EXISTS "students_parent_phone_idx" ON "public"."students" USING "btree" ("parent_phone") WHERE ("parent_phone" IS NOT NULL);



CREATE INDEX IF NOT EXISTS "subject_components_subject_idx" ON "public"."subject_components" USING "btree" ("subject_id");



CREATE INDEX IF NOT EXISTS "subjects_school_grade_idx" ON "public"."subjects" USING "btree" ("school_id", "grade");



CREATE INDEX IF NOT EXISTS "transfer_docs_from_school_idx" ON "public"."transfer_documents" USING "btree" ("from_school_id", "issued_at" DESC);



CREATE UNIQUE INDEX IF NOT EXISTS "transfer_docs_outgoing_uidx" ON "public"."transfer_documents" USING "btree" ("to_school_id", "academic_year", "outgoing_number");



CREATE UNIQUE INDEX IF NOT EXISTS "transfer_docs_pending_uidx" ON "public"."transfer_documents" USING "btree" ("student_national_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX IF NOT EXISTS "transfer_docs_to_school_idx" ON "public"."transfer_documents" USING "btree" ("to_school_id", "issued_at" DESC);



CREATE OR REPLACE TRIGGER "role_module_permissions_core_guard" BEFORE INSERT OR UPDATE ON "public"."role_module_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_core_module_enabled"();



CREATE OR REPLACE TRIGGER "role_module_permissions_touch" BEFORE INSERT OR UPDATE ON "public"."role_module_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."touch_role_module_permission"();



CREATE OR REPLACE TRIGGER "t_bump_row_version" BEFORE UPDATE ON "public"."attendance_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."bump_row_version"();



CREATE OR REPLACE TRIGGER "t_bump_row_version" BEFORE UPDATE ON "public"."daily_student_attendance" FOR EACH ROW EXECUTE FUNCTION "public"."bump_row_version"();



CREATE OR REPLACE TRIGGER "t_bump_row_version" BEFORE UPDATE ON "public"."staff_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."bump_row_version"();



CREATE OR REPLACE TRIGGER "t_bump_row_version" BEFORE UPDATE ON "public"."staff_attendance" FOR EACH ROW EXECUTE FUNCTION "public"."bump_row_version"();



CREATE OR REPLACE TRIGGER "t_bump_row_version" BEFORE UPDATE ON "public"."staff_records" FOR EACH ROW EXECUTE FUNCTION "public"."bump_row_version"();



CREATE OR REPLACE TRIGGER "t_bump_row_version" BEFORE UPDATE ON "public"."student_conduct" FOR EACH ROW EXECUTE FUNCTION "public"."bump_row_version"();



CREATE OR REPLACE TRIGGER "t_bump_row_version" BEFORE UPDATE ON "public"."student_grades" FOR EACH ROW EXECUTE FUNCTION "public"."bump_row_version"();



CREATE OR REPLACE TRIGGER "t_bump_row_version" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."bump_row_version"();



CREATE OR REPLACE TRIGGER "t_duty_adjusted" AFTER INSERT OR UPDATE ON "public"."staff_attendance" FOR EACH ROW EXECUTE FUNCTION "public"."trg_duty_adjusted"();



CREATE OR REPLACE TRIGGER "t_grace_proposal_new" AFTER INSERT ON "public"."grace_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."trg_grace_proposal_new"();



CREATE OR REPLACE TRIGGER "t_lock_staff_registry_mirrors" BEFORE UPDATE ON "public"."staff_records" FOR EACH ROW EXECUTE FUNCTION "public"."lock_staff_registry_mirrors"();



CREATE OR REPLACE TRIGGER "t_lock_student_registry_mirrors" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."lock_student_registry_mirrors"();



CREATE OR REPLACE TRIGGER "t_notify_parents_absent" AFTER INSERT OR UPDATE ON "public"."daily_student_attendance" FOR EACH ROW EXECUTE FUNCTION "public"."_notify_parents_absent"();



CREATE OR REPLACE TRIGGER "t_report_new" AFTER INSERT ON "public"."emergency_reports" FOR EACH ROW EXECUTE FUNCTION "public"."trg_report_new"();



CREATE OR REPLACE TRIGGER "t_report_status" AFTER UPDATE ON "public"."emergency_reports" FOR EACH ROW EXECUTE FUNCTION "public"."trg_report_status"();



CREATE OR REPLACE TRIGGER "t_sync_student_is_active" BEFORE INSERT OR UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."sync_student_is_active"();



CREATE OR REPLACE TRIGGER "t_validate_student_status" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."validate_student_status_transition"();



CREATE OR REPLACE TRIGGER "trg_daily_attendance_updated" BEFORE UPDATE ON "public"."daily_attendance" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notify_dir_new_request" AFTER INSERT ON "public"."school_requests" FOR EACH ROW EXECUTE FUNCTION "public"."_notify_dir_new_request"();



CREATE OR REPLACE TRIGGER "trg_notify_dir_result_sheet_submitted" AFTER INSERT OR UPDATE ON "public"."result_sheets" FOR EACH ROW EXECUTE FUNCTION "public"."_notify_dir_result_sheet_submitted"();



CREATE OR REPLACE TRIGGER "trg_notify_dir_statement_submitted" AFTER INSERT OR UPDATE ON "public"."monthly_statements" FOR EACH ROW EXECUTE FUNCTION "public"."_notify_dir_statement_submitted"();



CREATE OR REPLACE TRIGGER "trg_reports_set_receipt" BEFORE INSERT ON "public"."emergency_reports" FOR EACH ROW EXECUTE FUNCTION "public"."reports_set_receipt"();



CREATE OR REPLACE TRIGGER "trg_reports_updated" BEFORE UPDATE ON "public"."emergency_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."absence_excuses"
    ADD CONSTRAINT "absence_excuses_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."absence_excuses"
    ADD CONSTRAINT "absence_excuses_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."absence_excuses"
    ADD CONSTRAINT "absence_excuses_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."absence_excuses"
    ADD CONSTRAINT "absence_excuses_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."admin_credentials"
    ADD CONSTRAINT "admin_credentials_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."admin_credentials"
    ADD CONSTRAINT "admin_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."class_attendance"
    ADD CONSTRAINT "class_attendance_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."class_attendance"
    ADD CONSTRAINT "class_attendance_daily_attendance_id_fkey" FOREIGN KEY ("daily_attendance_id") REFERENCES "public"."daily_attendance"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."class_teacher"
    ADD CONSTRAINT "class_teacher_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."class_teacher"
    ADD CONSTRAINT "class_teacher_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_attendance"
    ADD CONSTRAINT "daily_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_attendance"
    ADD CONSTRAINT "daily_attendance_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_student_attendance"
    ADD CONSTRAINT "daily_student_attendance_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_student_attendance"
    ADD CONSTRAINT "daily_student_attendance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_student_attendance"
    ADD CONSTRAINT "daily_student_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."daily_student_attendance"
    ADD CONSTRAINT "daily_student_attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."emergency_reports"
    ADD CONSTRAINT "emergency_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."emergency_reports"
    ADD CONSTRAINT "emergency_reports_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."emergency_reports"
    ADD CONSTRAINT "emergency_reports_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."grace_proposals"
    ADD CONSTRAINT "grace_proposals_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."grace_proposals"
    ADD CONSTRAINT "grace_proposals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."grace_proposals"
    ADD CONSTRAINT "grace_proposals_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."grace_proposals"
    ADD CONSTRAINT "grace_proposals_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."grace_proposals"
    ADD CONSTRAINT "grace_proposals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."lookup_lists"
    ADD CONSTRAINT "lookup_lists_directorate_id_fkey" FOREIGN KEY ("directorate_id") REFERENCES "public"."directorates"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statement_changes"
    ADD CONSTRAINT "monthly_statement_changes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statement_changes"
    ADD CONSTRAINT "monthly_statement_changes_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statement_changes"
    ADD CONSTRAINT "monthly_statement_changes_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "public"."monthly_statements"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statement_rosters"
    ADD CONSTRAINT "monthly_statement_rosters_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statement_rosters"
    ADD CONSTRAINT "monthly_statement_rosters_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "public"."monthly_statements"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statements"
    ADD CONSTRAINT "monthly_statements_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."monthly_statements"
    ADD CONSTRAINT "monthly_statements_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."parent_links"
    ADD CONSTRAINT "parent_links_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."parent_links"
    ADD CONSTRAINT "parent_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."registry_lookup_audit"
    ADD CONSTRAINT "registry_lookup_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."result_sheets"
    ADD CONSTRAINT "result_sheets_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."result_sheets"
    ADD CONSTRAINT "result_sheets_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."result_sheets"
    ADD CONSTRAINT "result_sheets_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."result_sheets"
    ADD CONSTRAINT "result_sheets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."role_module_permissions"
    ADD CONSTRAINT "role_module_permissions_module_key_fkey" FOREIGN KEY ("module_key") REFERENCES "public"."modules"("key") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_building"
    ADD CONSTRAINT "school_building_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_holidays"
    ADD CONSTRAINT "school_holidays_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_personnel"
    ADD CONSTRAINT "school_personnel_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_personnel"
    ADD CONSTRAINT "school_personnel_staff_record_id_fkey" FOREIGN KEY ("staff_record_id") REFERENCES "public"."staff_records"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_requests"
    ADD CONSTRAINT "school_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_requests"
    ADD CONSTRAINT "school_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."school_requests"
    ADD CONSTRAINT "school_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."schools"
    ADD CONSTRAINT "schools_directorate_id_fkey" FOREIGN KEY ("directorate_id") REFERENCES "public"."directorates"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_assignments"
    ADD CONSTRAINT "staff_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_adjusted_by_fkey" FOREIGN KEY ("adjusted_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "public"."school_personnel"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_credentials"
    ADD CONSTRAINT "staff_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_leaves"
    ADD CONSTRAINT "staff_leaves_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_leaves"
    ADD CONSTRAINT "staff_leaves_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_records"
    ADD CONSTRAINT "staff_records_registry_self_number_fkey" FOREIGN KEY ("registry_self_number") REFERENCES "public"."national_staff_registry"("self_number") ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."staff_records"
    ADD CONSTRAINT "staff_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_conduct"
    ADD CONSTRAINT "student_conduct_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_conduct"
    ADD CONSTRAINT "student_conduct_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_conduct"
    ADD CONSTRAINT "student_conduct_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grace"
    ADD CONSTRAINT "student_grace_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grace"
    ADD CONSTRAINT "student_grace_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grace"
    ADD CONSTRAINT "student_grace_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grace"
    ADD CONSTRAINT "student_grace_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grades"
    ADD CONSTRAINT "student_grades_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grades"
    ADD CONSTRAINT "student_grades_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "public"."subject_components"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grades"
    ADD CONSTRAINT "student_grades_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grades"
    ADD CONSTRAINT "student_grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."student_grades"
    ADD CONSTRAINT "student_grades_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_registry_national_id_fkey" FOREIGN KEY ("registry_national_id") REFERENCES "public"."national_students_registry"("national_id") ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."subject_catalog_components"
    ADD CONSTRAINT "subject_catalog_components_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "public"."subject_catalog"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."subject_components"
    ADD CONSTRAINT "subject_components_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."sync_state"
    ADD CONSTRAINT "sync_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."teacher_daily_attendance"
    ADD CONSTRAINT "teacher_daily_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."teacher_daily_attendance"
    ADD CONSTRAINT "teacher_daily_attendance_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."transfer_documents"
    ADD CONSTRAINT "transfer_documents_from_school_id_fkey" FOREIGN KEY ("from_school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."transfer_documents"
    ADD CONSTRAINT "transfer_documents_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."transfer_documents"
    ADD CONSTRAINT "transfer_documents_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "auth"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."transfer_documents"
    ADD CONSTRAINT "transfer_documents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."transfer_documents"
    ADD CONSTRAINT "transfer_documents_to_class_id_fkey" FOREIGN KEY ("to_class_id") REFERENCES "public"."classes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."transfer_documents"
    ADD CONSTRAINT "transfer_documents_to_school_id_fkey" FOREIGN KEY ("to_school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_directorate_id_fkey" FOREIGN KEY ("directorate_id") REFERENCES "public"."directorates"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
DO $ruqi_idem$ BEGIN
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $ruqi_idem$;
ALTER TABLE "public"."absence_excuses" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "admin_cred_directorate_select" ON "public"."admin_credentials";
CREATE POLICY "admin_cred_directorate_select" ON "public"."admin_credentials" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."users" "target"
     JOIN "public"."schools" "s" ON (("s"."id" = "target"."school_id")))
     JOIN "public"."users" "me" ON (("me"."id" = "auth"."uid"())))
  WHERE (("target"."id" = "admin_credentials"."user_id") AND ("me"."role" = 'directorate_user'::"public"."user_role") AND ("s"."directorate_id" = "me"."directorate_id")))));



DROP POLICY IF EXISTS "admin_cred_ministry_select" ON "public"."admin_credentials";
CREATE POLICY "admin_cred_ministry_select" ON "public"."admin_credentials" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



ALTER TABLE "public"."admin_credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "audit_log_insert" ON "public"."audit_log";
CREATE POLICY "audit_log_insert" ON "public"."audit_log" FOR INSERT TO "authenticated" WITH CHECK (("school_id" = "public"."current_user_school_id"()));



DROP POLICY IF EXISTS "audit_log_ministry_select" ON "public"."audit_log";
CREATE POLICY "audit_log_ministry_select" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



DROP POLICY IF EXISTS "audit_log_select" ON "public"."audit_log";
CREATE POLICY "audit_log_select" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "authenticated_read_holidays" ON "public"."school_holidays";
CREATE POLICY "authenticated_read_holidays" ON "public"."school_holidays" FOR SELECT TO "authenticated" USING (true);



DROP POLICY IF EXISTS "ca_teacher_read" ON "public"."class_attendance";
CREATE POLICY "ca_teacher_read" ON "public"."class_attendance" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id")));



DROP POLICY IF EXISTS "ca_teacher_write" ON "public"."class_attendance";
CREATE POLICY "ca_teacher_write" ON "public"."class_attendance" TO "authenticated" USING ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id"))) WITH CHECK ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id")));



ALTER TABLE "public"."class_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."class_teacher" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "class_teacher_admin_write" ON "public"."class_teacher";
CREATE POLICY "class_teacher_admin_write" ON "public"."class_teacher" TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND "public"."class_in_my_school"("class_id"))) WITH CHECK ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND "public"."class_in_my_school"("class_id")));



DROP POLICY IF EXISTS "class_teacher_read" ON "public"."class_teacher";
CREATE POLICY "class_teacher_read" ON "public"."class_teacher" FOR SELECT TO "authenticated" USING ((("teacher_id" = "auth"."uid"()) OR (("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND "public"."class_in_my_school"("class_id"))));



ALTER TABLE "public"."classes" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "classes_admin_write" ON "public"."classes";
CREATE POLICY "classes_admin_write" ON "public"."classes" TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"()))) WITH CHECK ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())));



DROP POLICY IF EXISTS "classes_read" ON "public"."classes";
CREATE POLICY "classes_read" ON "public"."classes" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'ministry_user'::"public"."user_role") OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND "public"."school_in_my_directorate"("school_id")) OR (("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())) OR (("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("id"))));



DROP POLICY IF EXISTS "conduct_admin_read" ON "public"."student_conduct";
CREATE POLICY "conduct_admin_read" ON "public"."student_conduct" FOR SELECT TO "authenticated" USING (("school_id" = "public"."current_user_school_id"()));



DROP POLICY IF EXISTS "conduct_read" ON "public"."student_conduct";
CREATE POLICY "conduct_read" ON "public"."student_conduct" FOR SELECT TO "authenticated" USING (((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id")) OR (("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())) OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND "public"."school_in_my_directorate"("school_id")) OR ("public"."current_user_role"() = 'ministry_user'::"public"."user_role")));



DROP POLICY IF EXISTS "conduct_teacher_write" ON "public"."student_conduct";
CREATE POLICY "conduct_teacher_write" ON "public"."student_conduct" TO "authenticated" USING ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id"))) WITH CHECK ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id") AND ("recorded_by" = "auth"."uid"())));



DROP POLICY IF EXISTS "da_admin_write" ON "public"."daily_attendance";
CREATE POLICY "da_admin_write" ON "public"."daily_attendance" TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"()))) WITH CHECK ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())));



DROP POLICY IF EXISTS "da_read" ON "public"."daily_attendance";
CREATE POLICY "da_read" ON "public"."daily_attendance" FOR SELECT TO "authenticated" USING (((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())) OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("school_id" IN ( SELECT "school"."id"
   FROM "public"."schools" "school"
  WHERE ("school"."directorate_id" = "public"."current_user_directorate_id"())))) OR ("public"."current_user_role"() = 'ministry_user'::"public"."user_role")));



ALTER TABLE "public"."daily_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_student_attendance" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "directorate_user: class_attendance in directorate" ON "public"."class_attendance";
CREATE POLICY "directorate_user: class_attendance in directorate" ON "public"."class_attendance" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("daily_attendance_id" IN ( SELECT "da"."id"
   FROM ("public"."daily_attendance" "da"
     JOIN "public"."schools" "s" ON (("s"."id" = "da"."school_id")))
  WHERE ("s"."directorate_id" = "public"."current_user_directorate_id"())))));



DROP POLICY IF EXISTS "directorate_user: reports in directorate" ON "public"."emergency_reports";
CREATE POLICY "directorate_user: reports in directorate" ON "public"."emergency_reports" TO "authenticated" USING ((("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("school_id" IN ( SELECT "schools"."id"
   FROM "public"."schools"
  WHERE ("schools"."directorate_id" = "public"."current_user_directorate_id"())))));



ALTER TABLE "public"."directorates" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "directorates_read" ON "public"."directorates";
CREATE POLICY "directorates_read" ON "public"."directorates" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'ministry_user'::"public"."user_role") OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("id" = "public"."current_user_directorate_id"())) OR (("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("id" = ( SELECT "school"."directorate_id"
   FROM "public"."schools" "school"
  WHERE ("school"."id" = "public"."current_user_school_id"()))))));



DROP POLICY IF EXISTS "dsa_read" ON "public"."daily_student_attendance";
CREATE POLICY "dsa_read" ON "public"."daily_student_attendance" FOR SELECT TO "authenticated" USING (((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id")) OR (("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())) OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("school_id" IN ( SELECT "school"."id"
   FROM "public"."schools" "school"
  WHERE ("school"."directorate_id" = "public"."current_user_directorate_id"())))) OR ("public"."current_user_role"() = 'ministry_user'::"public"."user_role")));



DROP POLICY IF EXISTS "dsa_teacher_write" ON "public"."daily_student_attendance";
CREATE POLICY "dsa_teacher_write" ON "public"."daily_student_attendance" TO "authenticated" USING ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id"))) WITH CHECK ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id") AND ("recorded_by" = "auth"."uid"()) AND ("date" = CURRENT_DATE) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."attendance_submissions" "s"
  WHERE (("s"."class_id" = "daily_student_attendance"."class_id") AND ("s"."date" = "daily_student_attendance"."date") AND ("s"."status" = 'confirmed'::"text")))))));



ALTER TABLE "public"."emergency_reports" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "grace_admin_all" ON "public"."student_grace";
CREATE POLICY "grace_admin_all" ON "public"."student_grace" TO "authenticated" USING (("school_id" = "public"."current_user_school_id"())) WITH CHECK (("school_id" = "public"."current_user_school_id"()));



DROP POLICY IF EXISTS "grace_prop_admin_rw" ON "public"."grace_proposals";
CREATE POLICY "grace_prop_admin_rw" ON "public"."grace_proposals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role") AND ("u"."school_id" = "grace_proposals"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role") AND ("u"."school_id" = "grace_proposals"."school_id")))));



DROP POLICY IF EXISTS "grace_prop_teacher_rw" ON "public"."grace_proposals";
CREATE POLICY "grace_prop_teacher_rw" ON "public"."grace_proposals" TO "authenticated" USING ((("proposed_by" = "auth"."uid"()) AND "public"."teaches_class"("class_id"))) WITH CHECK ((("proposed_by" = "auth"."uid"()) AND "public"."teaches_class"("class_id")));



ALTER TABLE "public"."grace_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."grade_pass_rules" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "grade_pass_rules_select" ON "public"."grade_pass_rules";
CREATE POLICY "grade_pass_rules_select" ON "public"."grade_pass_rules" FOR SELECT TO "authenticated" USING (true);



DROP POLICY IF EXISTS "grade_pass_rules_write" ON "public"."grade_pass_rules";
CREATE POLICY "grade_pass_rules_write" ON "public"."grade_pass_rules" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



DROP POLICY IF EXISTS "holidays_ministry_write" ON "public"."school_holidays";
CREATE POLICY "holidays_ministry_write" ON "public"."school_holidays" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



DROP POLICY IF EXISTS "holidays_read" ON "public"."school_holidays";
CREATE POLICY "holidays_read" ON "public"."school_holidays" FOR SELECT TO "authenticated" USING (true);



DROP POLICY IF EXISTS "lookup_authenticated_select" ON "public"."lookup_lists";
CREATE POLICY "lookup_authenticated_select" ON "public"."lookup_lists" FOR SELECT TO "authenticated" USING (("active" = true));



ALTER TABLE "public"."lookup_lists" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "lookup_ministry_write" ON "public"."lookup_lists";
CREATE POLICY "lookup_ministry_write" ON "public"."lookup_lists" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



DROP POLICY IF EXISTS "ministry: all attendance" ON "public"."daily_attendance";
CREATE POLICY "ministry: all attendance" ON "public"."daily_attendance" TO "authenticated" USING (("public"."current_user_role"() = 'ministry_user'::"public"."user_role"));



DROP POLICY IF EXISTS "ministry: all class_attendance" ON "public"."class_attendance";
CREATE POLICY "ministry: all class_attendance" ON "public"."class_attendance" TO "authenticated" USING (("public"."current_user_role"() = 'ministry_user'::"public"."user_role"));



DROP POLICY IF EXISTS "ministry: all classes" ON "public"."classes";
CREATE POLICY "ministry: all classes" ON "public"."classes" TO "authenticated" USING (("public"."current_user_role"() = 'ministry_user'::"public"."user_role"));



DROP POLICY IF EXISTS "ministry: all directorates" ON "public"."directorates";
CREATE POLICY "ministry: all directorates" ON "public"."directorates" TO "authenticated" USING (("public"."current_user_role"() = 'ministry_user'::"public"."user_role"));



DROP POLICY IF EXISTS "ministry: all reports" ON "public"."emergency_reports";
CREATE POLICY "ministry: all reports" ON "public"."emergency_reports" TO "authenticated" USING (("public"."current_user_role"() = 'ministry_user'::"public"."user_role"));



DROP POLICY IF EXISTS "ministry: all schools" ON "public"."schools";
CREATE POLICY "ministry: all schools" ON "public"."schools" TO "authenticated" USING (("public"."current_user_role"() = 'ministry_user'::"public"."user_role"));



DROP POLICY IF EXISTS "ministry_users_all_staff_registry" ON "public"."national_staff_registry";
CREATE POLICY "ministry_users_all_staff_registry" ON "public"."national_staff_registry" TO "authenticated" USING ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'ministry_user'::"public"."user_role")) WITH CHECK ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'ministry_user'::"public"."user_role"));



DROP POLICY IF EXISTS "ministry_users_all_students_registry" ON "public"."national_students_registry";
CREATE POLICY "ministry_users_all_students_registry" ON "public"."national_students_registry" TO "authenticated" USING ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'ministry_user'::"public"."user_role")) WITH CHECK ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'ministry_user'::"public"."user_role"));



ALTER TABLE "public"."modules" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "modules_ministry_all" ON "public"."modules";
CREATE POLICY "modules_ministry_all" ON "public"."modules" TO "authenticated" USING (("public"."current_user_role"() = 'ministry_user'::"public"."user_role")) WITH CHECK (("public"."current_user_role"() = 'ministry_user'::"public"."user_role"));



ALTER TABLE "public"."monthly_statement_changes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_statement_rosters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_statements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."national_staff_registry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."national_students_registry" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "no_direct_access_staff_registry" ON "public"."national_staff_registry";
CREATE POLICY "no_direct_access_staff_registry" ON "public"."national_staff_registry" FOR SELECT TO "authenticated" USING (false);



DROP POLICY IF EXISTS "no_direct_access_students_registry" ON "public"."national_students_registry";
CREATE POLICY "no_direct_access_students_registry" ON "public"."national_students_registry" FOR SELECT TO "authenticated" USING (false);



DROP POLICY IF EXISTS "notif_owner" ON "public"."notifications";
CREATE POLICY "notif_owner" ON "public"."notifications" TO "authenticated" USING (("recipient_id" = "auth"."uid"())) WITH CHECK (("recipient_id" = "auth"."uid"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "parent_insert_excuse" ON "public"."absence_excuses";
CREATE POLICY "parent_insert_excuse" ON "public"."absence_excuses" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_user_is_parent"() AND (EXISTS ( SELECT 1
   FROM "public"."parent_links" "pl"
  WHERE (("pl"."user_id" = "auth"."uid"()) AND ("pl"."student_id" = "absence_excuses"."student_id"))))));



ALTER TABLE "public"."parent_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parent_otps" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "parent_otps_no_access" ON "public"."parent_otps";
CREATE POLICY "parent_otps_no_access" ON "public"."parent_otps" TO "authenticated" USING (false);



DROP POLICY IF EXISTS "parent_read_components" ON "public"."subject_components";
CREATE POLICY "parent_read_components" ON "public"."subject_components" FOR SELECT TO "authenticated" USING (("public"."current_user_is_parent"() AND (EXISTS ( SELECT 1
   FROM (("public"."subjects" "sub"
     JOIN "public"."parent_links" "pl" ON (true))
     JOIN "public"."students" "s" ON (("s"."id" = "pl"."student_id")))
  WHERE (("sub"."id" = "subject_components"."subject_id") AND ("pl"."user_id" = "auth"."uid"()) AND ("s"."school_id" = "sub"."school_id"))))));



DROP POLICY IF EXISTS "parent_read_linked_attendance" ON "public"."daily_student_attendance";
CREATE POLICY "parent_read_linked_attendance" ON "public"."daily_student_attendance" FOR SELECT TO "authenticated" USING (("public"."current_user_is_parent"() AND (EXISTS ( SELECT 1
   FROM "public"."parent_links" "pl"
  WHERE (("pl"."user_id" = "auth"."uid"()) AND ("pl"."student_id" = "daily_student_attendance"."student_id"))))));



DROP POLICY IF EXISTS "parent_read_linked_conduct" ON "public"."student_conduct";
CREATE POLICY "parent_read_linked_conduct" ON "public"."student_conduct" FOR SELECT TO "authenticated" USING (("public"."current_user_is_parent"() AND (EXISTS ( SELECT 1
   FROM "public"."parent_links" "pl"
  WHERE (("pl"."user_id" = "auth"."uid"()) AND ("pl"."student_id" = "student_conduct"."student_id"))))));



DROP POLICY IF EXISTS "parent_read_linked_grades" ON "public"."student_grades";
CREATE POLICY "parent_read_linked_grades" ON "public"."student_grades" FOR SELECT TO "authenticated" USING (("public"."current_user_is_parent"() AND (EXISTS ( SELECT 1
   FROM "public"."parent_links" "pl"
  WHERE (("pl"."user_id" = "auth"."uid"()) AND ("pl"."student_id" = "student_grades"."student_id"))))));



DROP POLICY IF EXISTS "parent_read_linked_school" ON "public"."schools";
CREATE POLICY "parent_read_linked_school" ON "public"."schools" FOR SELECT TO "authenticated" USING (("public"."current_user_is_parent"() AND "public"."parent_is_linked_to_school"("id")));



DROP POLICY IF EXISTS "parent_read_linked_students" ON "public"."students";
CREATE POLICY "parent_read_linked_students" ON "public"."students" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."parent_links" "pl"
  WHERE (("pl"."student_id" = "students"."id") AND ("pl"."user_id" = "auth"."uid"())))));



DROP POLICY IF EXISTS "parent_read_own_excuses" ON "public"."absence_excuses";
CREATE POLICY "parent_read_own_excuses" ON "public"."absence_excuses" FOR SELECT TO "authenticated" USING (("public"."current_user_is_parent"() AND (EXISTS ( SELECT 1
   FROM "public"."parent_links" "pl"
  WHERE (("pl"."user_id" = "auth"."uid"()) AND ("pl"."student_id" = "absence_excuses"."student_id"))))));



DROP POLICY IF EXISTS "parent_read_own_links" ON "public"."parent_links";
CREATE POLICY "parent_read_own_links" ON "public"."parent_links" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



DROP POLICY IF EXISTS "parent_read_subjects" ON "public"."subjects";
CREATE POLICY "parent_read_subjects" ON "public"."subjects" FOR SELECT TO "authenticated" USING (("public"."current_user_is_parent"() AND (EXISTS ( SELECT 1
   FROM ("public"."parent_links" "pl"
     JOIN "public"."students" "s" ON (("s"."id" = "pl"."student_id")))
  WHERE (("pl"."user_id" = "auth"."uid"()) AND ("s"."school_id" = "subjects"."school_id"))))));



ALTER TABLE "public"."periodic_reports" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "pr_select" ON "public"."periodic_reports";
CREATE POLICY "pr_select" ON "public"."periodic_reports" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND (("u"."role" = 'ministry_user'::"public"."user_role") OR (("u"."role" = 'directorate_user'::"public"."user_role") AND ("periodic_reports"."scope" = 'directorate'::"text") AND ("u"."directorate_id" = "periodic_reports"."scope_id")))))));



DROP POLICY IF EXISTS "ps_owner" ON "public"."push_subscriptions";
CREATE POLICY "ps_owner" ON "public"."push_subscriptions" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."registry_lookup_audit" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "registry_lookup_audit_ministry_select" ON "public"."registry_lookup_audit";
CREATE POLICY "registry_lookup_audit_ministry_select" ON "public"."registry_lookup_audit" FOR SELECT TO "authenticated" USING ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'ministry_user'::"public"."user_role"));



DROP POLICY IF EXISTS "reports_admin_insert" ON "public"."emergency_reports";
CREATE POLICY "reports_admin_insert" ON "public"."emergency_reports" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())));



DROP POLICY IF EXISTS "reports_read" ON "public"."emergency_reports";
CREATE POLICY "reports_read" ON "public"."emergency_reports" FOR SELECT TO "authenticated" USING (((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())) OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("school_id" IN ( SELECT "school"."id"
   FROM "public"."schools" "school"
  WHERE ("school"."directorate_id" = "public"."current_user_directorate_id"())))) OR ("public"."current_user_role"() = 'ministry_user'::"public"."user_role")));



ALTER TABLE "public"."result_sheets" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "rmp_ministry_all" ON "public"."role_module_permissions";
CREATE POLICY "rmp_ministry_all" ON "public"."role_module_permissions" TO "authenticated" USING (("public"."current_user_role"() = 'ministry_user'::"public"."user_role")) WITH CHECK (("public"."current_user_role"() = 'ministry_user'::"public"."user_role"));



ALTER TABLE "public"."role_module_permissions" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "rs_dir_select" ON "public"."result_sheets";
CREATE POLICY "rs_dir_select" ON "public"."result_sheets" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."schools" "s"
  WHERE (("s"."id" = "result_sheets"."school_id") AND ("s"."directorate_id" = "public"."current_user_directorate_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "rs_dir_update" ON "public"."result_sheets";
CREATE POLICY "rs_dir_update" ON "public"."result_sheets" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."schools" "s"
  WHERE (("s"."id" = "result_sheets"."school_id") AND ("s"."directorate_id" = "public"."current_user_directorate_id"())))) AND ("status" = ANY (ARRAY['submitted'::"text", 'approved'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'directorate_user'::"public"."user_role")))))) WITH CHECK (("status" = ANY (ARRAY['approved'::"text", 'issued'::"text", 'rejected'::"text"])));



DROP POLICY IF EXISTS "rs_ministry_select" ON "public"."result_sheets";
CREATE POLICY "rs_ministry_select" ON "public"."result_sheets" FOR SELECT TO "authenticated" USING ((("status" = 'issued'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "rs_school_insert" ON "public"."result_sheets";
CREATE POLICY "rs_school_insert" ON "public"."result_sheets" FOR INSERT TO "authenticated" WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "rs_school_select" ON "public"."result_sheets";
CREATE POLICY "rs_school_select" ON "public"."result_sheets" FOR SELECT TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "rs_school_update" ON "public"."result_sheets";
CREATE POLICY "rs_school_update" ON "public"."result_sheets" FOR UPDATE TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND ("status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND ("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text"]))));



DROP POLICY IF EXISTS "sa_admin_all" ON "public"."staff_attendance";
CREATE POLICY "sa_admin_all" ON "public"."staff_attendance" TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "sa_teacher_ins" ON "public"."staff_attendance";
CREATE POLICY "sa_teacher_ins" ON "public"."staff_attendance" FOR INSERT WITH CHECK (("teacher_id" = "auth"."uid"()));



DROP POLICY IF EXISTS "sa_teacher_insert" ON "public"."staff_attendance";
CREATE POLICY "sa_teacher_insert" ON "public"."staff_attendance" FOR INSERT TO "authenticated" WITH CHECK ((("teacher_id" = "auth"."uid"()) AND ("source" = 'self'::"text")));



DROP POLICY IF EXISTS "sa_teacher_sel" ON "public"."staff_attendance";
CREATE POLICY "sa_teacher_sel" ON "public"."staff_attendance" FOR SELECT USING (("teacher_id" = "auth"."uid"()));



DROP POLICY IF EXISTS "sa_teacher_select" ON "public"."staff_attendance";
CREATE POLICY "sa_teacher_select" ON "public"."staff_attendance" FOR SELECT TO "authenticated" USING (("teacher_id" = "auth"."uid"()));



DROP POLICY IF EXISTS "sa_teacher_upd" ON "public"."staff_attendance";
CREATE POLICY "sa_teacher_upd" ON "public"."staff_attendance" FOR UPDATE USING (("teacher_id" = "auth"."uid"())) WITH CHECK (("teacher_id" = "auth"."uid"()));



DROP POLICY IF EXISTS "sa_teacher_update" ON "public"."staff_attendance";
CREATE POLICY "sa_teacher_update" ON "public"."staff_attendance" FOR UPDATE TO "authenticated" USING (("teacher_id" = "auth"."uid"())) WITH CHECK (("teacher_id" = "auth"."uid"()));



DROP POLICY IF EXISTS "school_admin: own school class_attendance" ON "public"."class_attendance";
CREATE POLICY "school_admin: own school class_attendance" ON "public"."class_attendance" TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("daily_attendance_id" IN ( SELECT "daily_attendance"."id"
   FROM "public"."daily_attendance"
  WHERE ("daily_attendance"."school_id" = "public"."current_user_school_id"())))));



DROP POLICY IF EXISTS "school_admin: own school reports" ON "public"."emergency_reports";
CREATE POLICY "school_admin: own school reports" ON "public"."emergency_reports" TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())));



DROP POLICY IF EXISTS "school_admin_read_excuses" ON "public"."absence_excuses";
CREATE POLICY "school_admin_read_excuses" ON "public"."absence_excuses" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())));



ALTER TABLE "public"."school_building" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "school_building_dir_sel" ON "public"."school_building";
CREATE POLICY "school_building_dir_sel" ON "public"."school_building" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."schools" "s"
  WHERE (("s"."id" = "school_building"."school_id") AND ("s"."directorate_id" = "public"."current_user_directorate_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "school_building_school_admin" ON "public"."school_building";
CREATE POLICY "school_building_school_admin" ON "public"."school_building" TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



ALTER TABLE "public"."school_holidays" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."school_personnel" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "school_req_admin_insert" ON "public"."school_requests";
CREATE POLICY "school_req_admin_insert" ON "public"."school_requests" FOR INSERT TO "authenticated" WITH CHECK (("school_id" = "public"."current_user_school_id"()));



DROP POLICY IF EXISTS "school_req_admin_select" ON "public"."school_requests";
CREATE POLICY "school_req_admin_select" ON "public"."school_requests" FOR SELECT TO "authenticated" USING (("school_id" = "public"."current_user_school_id"()));



DROP POLICY IF EXISTS "school_req_dir_select" ON "public"."school_requests";
CREATE POLICY "school_req_dir_select" ON "public"."school_requests" FOR SELECT TO "authenticated" USING (("directorate_id" = "public"."current_user_directorate_id"()));



DROP POLICY IF EXISTS "school_req_dir_update" ON "public"."school_requests";
CREATE POLICY "school_req_dir_update" ON "public"."school_requests" FOR UPDATE TO "authenticated" USING (("directorate_id" = "public"."current_user_directorate_id"()));



ALTER TABLE "public"."school_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."schools" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "schools_admin_update" ON "public"."schools";
CREATE POLICY "schools_admin_update" ON "public"."schools" FOR UPDATE TO "authenticated" USING (("id" = "public"."current_user_school_id"())) WITH CHECK (("id" = "public"."current_user_school_id"()));



DROP POLICY IF EXISTS "schools_directorate_insert" ON "public"."schools";
CREATE POLICY "schools_directorate_insert" ON "public"."schools" FOR INSERT TO "authenticated" WITH CHECK ((("directorate_id" = ( SELECT "users"."directorate_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "schools_directorate_select" ON "public"."schools";
CREATE POLICY "schools_directorate_select" ON "public"."schools" FOR SELECT TO "authenticated" USING ((("directorate_id" = ( SELECT "users"."directorate_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "schools_directorate_update" ON "public"."schools";
CREATE POLICY "schools_directorate_update" ON "public"."schools" FOR UPDATE TO "authenticated" USING ((("directorate_id" = ( SELECT "users"."directorate_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'directorate_user'::"public"."user_role")))))) WITH CHECK ((("directorate_id" = ( SELECT "users"."directorate_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "schools_ministry_insert" ON "public"."schools";
CREATE POLICY "schools_ministry_insert" ON "public"."schools" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



DROP POLICY IF EXISTS "schools_ministry_select" ON "public"."schools";
CREATE POLICY "schools_ministry_select" ON "public"."schools" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



DROP POLICY IF EXISTS "schools_ministry_update" ON "public"."schools";
CREATE POLICY "schools_ministry_update" ON "public"."schools" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



DROP POLICY IF EXISTS "schools_read" ON "public"."schools";
CREATE POLICY "schools_read" ON "public"."schools" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'ministry_user'::"public"."user_role") OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("directorate_id" = "public"."current_user_directorate_id"())) OR (("public"."current_user_role"() = ANY (ARRAY['school_admin'::"public"."user_role", 'teacher'::"public"."user_role"])) AND ("id" = "public"."current_user_school_id"()))));



DROP POLICY IF EXISTS "sg_teacher_read" ON "public"."student_grades";
CREATE POLICY "sg_teacher_read" ON "public"."student_grades" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."class_teacher" "ct"
  WHERE (("ct"."teacher_id" = "auth"."uid"()) AND ("ct"."class_id" = "student_grades"."class_id") AND ("ct"."role" = ANY (ARRAY['homeroom'::"text", 'subject'::"text"]))))));



DROP POLICY IF EXISTS "sg_teacher_write" ON "public"."student_grades";
CREATE POLICY "sg_teacher_write" ON "public"."student_grades" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."class_teacher" "ct"
  WHERE (("ct"."teacher_id" = "auth"."uid"()) AND ("ct"."class_id" = "student_grades"."class_id") AND ("ct"."role" = ANY (ARRAY['homeroom'::"text", 'subject'::"text"])) AND ("student_grades"."subject_id" = ANY ("ct"."subject_ids")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."class_teacher" "ct"
  WHERE (("ct"."teacher_id" = "auth"."uid"()) AND ("ct"."class_id" = "student_grades"."class_id") AND ("ct"."role" = ANY (ARRAY['homeroom'::"text", 'subject'::"text"])) AND ("student_grades"."subject_id" = ANY ("ct"."subject_ids"))))));



DROP POLICY IF EXISTS "sp_admin_all" ON "public"."school_personnel";
CREATE POLICY "sp_admin_all" ON "public"."school_personnel" TO "authenticated" USING (("school_id" = "public"."current_user_school_id"())) WITH CHECK (("school_id" = "public"."current_user_school_id"()));



ALTER TABLE "public"."staff_assignments" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "staff_assignments_school_admin" ON "public"."staff_assignments";
CREATE POLICY "staff_assignments_school_admin" ON "public"."staff_assignments" TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



ALTER TABLE "public"."staff_attendance" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "staff_cred_admin" ON "public"."staff_credentials";
CREATE POLICY "staff_cred_admin" ON "public"."staff_credentials" TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



ALTER TABLE "public"."staff_credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_leaves" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "staff_leaves_directorate_sel" ON "public"."staff_leaves";
CREATE POLICY "staff_leaves_directorate_sel" ON "public"."staff_leaves" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."schools" "s"
  WHERE (("s"."id" = "staff_leaves"."school_id") AND ("s"."directorate_id" = "public"."current_user_directorate_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "staff_leaves_school_admin" ON "public"."staff_leaves";
CREATE POLICY "staff_leaves_school_admin" ON "public"."staff_leaves" TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



ALTER TABLE "public"."staff_records" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "staff_records_school_admin" ON "public"."staff_records";
CREATE POLICY "staff_records_school_admin" ON "public"."staff_records" TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "stmt_changes_dir_sel" ON "public"."monthly_statement_changes";
CREATE POLICY "stmt_changes_dir_sel" ON "public"."monthly_statement_changes" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."schools" "s"
  WHERE (("s"."id" = "monthly_statement_changes"."school_id") AND ("s"."directorate_id" = "public"."current_user_directorate_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "stmt_changes_school_admin" ON "public"."monthly_statement_changes";
CREATE POLICY "stmt_changes_school_admin" ON "public"."monthly_statement_changes" TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "stmt_dir_select" ON "public"."monthly_statements";
CREATE POLICY "stmt_dir_select" ON "public"."monthly_statements" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."schools" "s"
  WHERE (("s"."id" = "monthly_statements"."school_id") AND ("s"."directorate_id" = "public"."current_user_directorate_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "stmt_dir_update" ON "public"."monthly_statements";
CREATE POLICY "stmt_dir_update" ON "public"."monthly_statements" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."schools" "s"
  WHERE (("s"."id" = "monthly_statements"."school_id") AND ("s"."directorate_id" = "public"."current_user_directorate_id"())))) AND ("status" = 'submitted'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'directorate_user'::"public"."user_role")))))) WITH CHECK (("status" = ANY (ARRAY['approved'::"text", 'rejected'::"text"])));



DROP POLICY IF EXISTS "stmt_rosters_dir_sel" ON "public"."monthly_statement_rosters";
CREATE POLICY "stmt_rosters_dir_sel" ON "public"."monthly_statement_rosters" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM ("public"."monthly_statements" "ms"
     JOIN "public"."schools" "s" ON (("s"."id" = "ms"."school_id")))
  WHERE (("ms"."id" = "monthly_statement_rosters"."statement_id") AND ("ms"."status" = ANY (ARRAY['submitted'::"text", 'approved'::"text"])) AND ("s"."directorate_id" = "public"."current_user_directorate_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'directorate_user'::"public"."user_role"))))));



DROP POLICY IF EXISTS "stmt_rosters_school_admin" ON "public"."monthly_statement_rosters";
CREATE POLICY "stmt_rosters_school_admin" ON "public"."monthly_statement_rosters" TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "stmt_school_insert" ON "public"."monthly_statements";
CREATE POLICY "stmt_school_insert" ON "public"."monthly_statements" FOR INSERT TO "authenticated" WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "stmt_school_select" ON "public"."monthly_statements";
CREATE POLICY "stmt_school_select" ON "public"."monthly_statements" FOR SELECT TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "stmt_school_update" ON "public"."monthly_statements";
CREATE POLICY "stmt_school_update" ON "public"."monthly_statements" FOR UPDATE TO "authenticated" USING ((("school_id" = "public"."current_user_school_id"()) AND ("status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND ("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text"]))));



ALTER TABLE "public"."student_conduct" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_grace" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_grades" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "student_grades_read" ON "public"."student_grades";
CREATE POLICY "student_grades_read" ON "public"."student_grades" FOR SELECT USING (("school_id" = "public"."current_user_school_id"()));



DROP POLICY IF EXISTS "student_grades_teacher_write" ON "public"."student_grades";
CREATE POLICY "student_grades_teacher_write" ON "public"."student_grades" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."class_teacher" "ct"
  WHERE (("ct"."class_id" = "student_grades"."class_id") AND ("ct"."teacher_id" = "auth"."uid"())))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."class_teacher" "ct"
  WHERE (("ct"."class_id" = "student_grades"."class_id") AND ("ct"."teacher_id" = "auth"."uid"()))))));



ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "students_admin_write" ON "public"."students";
CREATE POLICY "students_admin_write" ON "public"."students" TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"()))) WITH CHECK ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())));



DROP POLICY IF EXISTS "students_read" ON "public"."students";
CREATE POLICY "students_read" ON "public"."students" FOR SELECT TO "authenticated" USING (((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id")) OR (("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())) OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("school_id" IN ( SELECT "school"."id"
   FROM "public"."schools" "school"
  WHERE ("school"."directorate_id" = "public"."current_user_directorate_id"())))) OR ("public"."current_user_role"() = 'ministry_user'::"public"."user_role")));



ALTER TABLE "public"."subject_catalog" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "subject_catalog_comp_select" ON "public"."subject_catalog_components";
CREATE POLICY "subject_catalog_comp_select" ON "public"."subject_catalog_components" FOR SELECT TO "authenticated" USING (true);



DROP POLICY IF EXISTS "subject_catalog_comp_write" ON "public"."subject_catalog_components";
CREATE POLICY "subject_catalog_comp_write" ON "public"."subject_catalog_components" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



ALTER TABLE "public"."subject_catalog_components" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "subject_catalog_select" ON "public"."subject_catalog";
CREATE POLICY "subject_catalog_select" ON "public"."subject_catalog" FOR SELECT TO "authenticated" USING (("active" = true));



DROP POLICY IF EXISTS "subject_catalog_write" ON "public"."subject_catalog";
CREATE POLICY "subject_catalog_write" ON "public"."subject_catalog" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'ministry_user'::"public"."user_role")))));



ALTER TABLE "public"."subject_components" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "subject_components_read" ON "public"."subject_components";
CREATE POLICY "subject_components_read" ON "public"."subject_components" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."subjects" "s"
  WHERE (("s"."id" = "subject_components"."subject_id") AND ("s"."school_id" = "public"."current_user_school_id"())))));



DROP POLICY IF EXISTS "subject_components_write" ON "public"."subject_components";
CREATE POLICY "subject_components_write" ON "public"."subject_components" USING (((EXISTS ( SELECT 1
   FROM "public"."subjects" "s"
  WHERE (("s"."id" = "subject_components"."subject_id") AND ("s"."school_id" = "public"."current_user_school_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."subjects" "s"
  WHERE (("s"."id" = "subject_components"."subject_id") AND ("s"."school_id" = "public"."current_user_school_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



ALTER TABLE "public"."subjects" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "subjects_read" ON "public"."subjects";
CREATE POLICY "subjects_read" ON "public"."subjects" FOR SELECT USING (("school_id" = "public"."current_user_school_id"()));



DROP POLICY IF EXISTS "subjects_write" ON "public"."subjects";
CREATE POLICY "subjects_write" ON "public"."subjects" USING ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role")))))) WITH CHECK ((("school_id" = "public"."current_user_school_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'school_admin'::"public"."user_role"))))));



DROP POLICY IF EXISTS "subs_admin_update" ON "public"."attendance_submissions";
CREATE POLICY "subs_admin_update" ON "public"."attendance_submissions" FOR UPDATE TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"()))) WITH CHECK ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())));



DROP POLICY IF EXISTS "subs_read" ON "public"."attendance_submissions";
CREATE POLICY "subs_read" ON "public"."attendance_submissions" FOR SELECT TO "authenticated" USING (((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id")) OR (("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())) OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("school_id" IN ( SELECT "school"."id"
   FROM "public"."schools" "school"
  WHERE ("school"."directorate_id" = "public"."current_user_directorate_id"())))) OR ("public"."current_user_role"() = 'ministry_user'::"public"."user_role")));



DROP POLICY IF EXISTS "subs_teacher_insert" ON "public"."attendance_submissions";
CREATE POLICY "subs_teacher_insert" ON "public"."attendance_submissions" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND ("submitted_by" = "auth"."uid"()) AND ("date" = CURRENT_DATE) AND "public"."teaches_class"("class_id")));



DROP POLICY IF EXISTS "subs_teacher_update" ON "public"."attendance_submissions";
CREATE POLICY "subs_teacher_update" ON "public"."attendance_submissions" FOR UPDATE TO "authenticated" USING ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id") AND ("status" <> 'confirmed'::"text"))) WITH CHECK ((("public"."current_user_role"() = 'teacher'::"public"."user_role") AND "public"."teaches_class"("class_id")));



ALTER TABLE "public"."sync_state" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "sync_state_self" ON "public"."sync_state";
CREATE POLICY "sync_state_self" ON "public"."sync_state" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



DROP POLICY IF EXISTS "tda_read" ON "public"."teacher_daily_attendance";
CREATE POLICY "tda_read" ON "public"."teacher_daily_attendance" FOR SELECT TO "authenticated" USING ((("teacher_id" = "auth"."uid"()) OR (("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())) OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("school_id" IN ( SELECT "school"."id"
   FROM "public"."schools" "school"
  WHERE ("school"."directorate_id" = "public"."current_user_directorate_id"())))) OR ("public"."current_user_role"() = 'ministry_user'::"public"."user_role")));



DROP POLICY IF EXISTS "tda_teacher_write" ON "public"."teacher_daily_attendance";
CREATE POLICY "tda_teacher_write" ON "public"."teacher_daily_attendance" TO "authenticated" USING (("teacher_id" = "auth"."uid"())) WITH CHECK (("teacher_id" = "auth"."uid"()));



DROP POLICY IF EXISTS "tdoc_dir_select" ON "public"."transfer_documents";
CREATE POLICY "tdoc_dir_select" ON "public"."transfer_documents" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("public"."school_in_my_directorate"("from_school_id") OR "public"."school_in_my_directorate"("to_school_id"))));



DROP POLICY IF EXISTS "tdoc_parties_select" ON "public"."transfer_documents";
CREATE POLICY "tdoc_parties_select" ON "public"."transfer_documents" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND (("from_school_id" = "public"."current_user_school_id"()) OR ("to_school_id" = "public"."current_user_school_id"()))));



ALTER TABLE "public"."teacher_daily_attendance" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "teacher_select_att" ON "public"."daily_student_attendance";
CREATE POLICY "teacher_select_att" ON "public"."daily_student_attendance" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."class_teacher" "ct"
  WHERE (("ct"."class_id" = "daily_student_attendance"."class_id") AND ("ct"."teacher_id" = "auth"."uid"())))));



ALTER TABLE "public"."transfer_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "users_directorate_select_principals" ON "public"."users";
CREATE POLICY "users_directorate_select_principals" ON "public"."users" FOR SELECT TO "authenticated" USING ((("role" = 'school_admin'::"public"."user_role") AND "public"."is_principal_in_my_directorate"("school_id")));



DROP POLICY IF EXISTS "users_select_directorate" ON "public"."users";
CREATE POLICY "users_select_directorate" ON "public"."users" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'ministry_user'::"public"."user_role") OR (("public"."current_user_role"() = 'directorate_user'::"public"."user_role") AND ("directorate_id" = "public"."current_user_directorate_id"()))));



DROP POLICY IF EXISTS "users_select_school" ON "public"."users";
CREATE POLICY "users_select_school" ON "public"."users" FOR SELECT TO "authenticated" USING ((("public"."current_user_role"() = 'school_admin'::"public"."user_role") AND ("school_id" = "public"."current_user_school_id"())));



DROP POLICY IF EXISTS "users_select_self" ON "public"."users";
CREATE POLICY "users_select_self" ON "public"."users" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."daily_attendance";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."daily_student_attendance";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";









REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT ALL ON SCHEMA "public" TO PUBLIC;











































































































































































REVOKE ALL ON FUNCTION "public"."_notify_dir_new_request"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_notify_dir_result_sheet_submitted"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_notify_dir_statement_submitted"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_notify_parents_absent"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."_nsams_phone_core"("raw" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."ar_norm"("p" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ar_norm"("p" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."auth_directorate_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auth_directorate_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_directorate_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auth_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auth_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auth_school_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auth_school_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_school_id"() TO "service_role";



GRANT SELECT ON TABLE "public"."transfer_documents" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_transfer_document"("p_doc_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_transfer_document"("p_doc_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."class_belongs_to_my_school"("p_class_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."class_belongs_to_my_school"("p_class_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."class_belongs_to_my_school"("p_class_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."class_in_my_school"("p_class_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."class_in_my_school"("p_class_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."class_in_my_school"("p_class_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_directorate_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_directorate_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_directorate_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_is_parent"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_is_parent"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_parent"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_permission_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_permission_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_school_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_school_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_school_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."decide_grace_proposal"("p_id" "uuid", "p_decision" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_grace_proposal"("p_id" "uuid", "p_decision" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."directorate_bulk_import_staff"("p_school_id" "uuid", "p_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."directorate_bulk_import_staff"("p_school_id" "uuid", "p_rows" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."directorate_bulk_import_students"("p_school_id" "uuid", "p_class_id" "uuid", "p_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."directorate_bulk_import_students"("p_school_id" "uuid", "p_class_id" "uuid", "p_rows" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."end_staff_assignment"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."end_staff_assignment"("p_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."execute_annual_promotion"("p_class_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."execute_annual_promotion"("p_class_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."generate_monthly_reports"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_monthly_reports"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_class_absence_log"("p_class_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_class_absence_log"("p_class_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_class_absence_log"("p_class_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_directorate_compliance"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_directorate_compliance"("p_days" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_directorate_dropout_summary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_directorate_dropout_summary"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_directorate_grades_coverage"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_directorate_grades_coverage"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_directorate_trend"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_directorate_trend"("p_days" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_dropout_risk_students"("p_school_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dropout_risk_students"("p_school_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_ministry_trend"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_ministry_trend"("p_days" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_module_permissions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_module_permissions"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_periodic_reports"("p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_periodic_reports"("p_scope" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_school_assignments_for_directorate"("p_school_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_school_assignments_for_directorate"("p_school_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_school_classes_for_directorate"("p_school_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_school_classes_for_directorate"("p_school_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_school_staff_for_directorate"("p_school_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_school_staff_for_directorate"("p_school_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_school_trend"("p_school_id" "uuid", "p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_school_trend"("p_school_id" "uuid", "p_days" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_sync_state"("p_device_id" "text", "p_table_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sync_state"("p_device_id" "text", "p_table_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sync_state"("p_device_id" "text", "p_table_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."grant_grace"("p_student" "uuid", "p_class" "uuid", "p_academic_year" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_grace"("p_student" "uuid", "p_class" "uuid", "p_academic_year" "text", "p_items" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_principal_in_my_directorate"("p_school_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_principal_in_my_directorate"("p_school_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_principal_in_my_directorate"("p_school_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_school_day"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_school_day"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_school_day"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."issue_transfer_document"("p" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_transfer_document"("p" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."link_staff_to_registry"("p_staff_id" "uuid", "p_self_number" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."link_staff_to_registry"("p_staff_id" "uuid", "p_self_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."link_staff_to_registry"("p_staff_id" "uuid", "p_self_number" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."link_student_to_registry"("p_student_id" "uuid", "p_national_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."link_student_to_registry"("p_student_id" "uuid", "p_national_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."link_student_to_registry"("p_student_id" "uuid", "p_national_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_student_for_transfer"("p_national_id" "text", "p_first_name" "text", "p_father_name" "text", "p_family_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_student_for_transfer"("p_national_id" "text", "p_first_name" "text", "p_father_name" "text", "p_family_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."notify_user"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_entity" "text", "p_entity_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_user"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_entity" "text", "p_entity_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."parent_is_linked_to_school"("p_school_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."parent_is_linked_to_school"("p_school_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."parent_resubmit_excuse"("p_excuse_id" "uuid", "p_reason" "text", "p_photo_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."parent_resubmit_excuse"("p_excuse_id" "uuid", "p_reason" "text", "p_photo_url" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."parent_sync_links"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."parent_sync_links"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."parent_sync_links"() TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."daily_student_attendance" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."pull_attendance_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pull_attendance_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pull_attendance_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."student_conduct" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."pull_conduct_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pull_conduct_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pull_conduct_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."student_grades" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."pull_grades_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pull_grades_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pull_grades_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."students" TO "authenticated";
GRANT SELECT ON TABLE "public"."students" TO "service_role";



REVOKE ALL ON FUNCTION "public"."pull_students_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pull_students_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pull_students_delta"("p_class_id" "uuid", "p_since" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_monthly_statement"("p_statement_id" "uuid", "p_decision" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_monthly_statement"("p_statement_id" "uuid", "p_decision" "text", "p_notes" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."review_result_sheet"("p_sheet_id" "uuid", "p_decision" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_result_sheet"("p_sheet_id" "uuid", "p_decision" "text", "p_notes" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."review_school_request"("p_request_id" "uuid", "p_decision" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_school_request"("p_request_id" "uuid", "p_decision" "text", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."review_transfer_document"("p_doc_id" "uuid", "p_action" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_transfer_document"("p_doc_id" "uuid", "p_action" "text", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."school_in_my_directorate"("p_school_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."school_in_my_directorate"("p_school_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."school_in_my_directorate"("p_school_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."school_review_excuse"("p_excuse_id" "uuid", "p_decision" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."school_review_excuse"("p_excuse_id" "uuid", "p_decision" "text", "p_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."send_attendance_reminder"("p_school_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_attendance_reminder"("p_school_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_student_status"("p_student_id" "uuid", "p_new_status" "public"."student_status", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_student_status"("p_student_id" "uuid", "p_new_status" "public"."student_status", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_student_status"("p_student_id" "uuid", "p_new_status" "public"."student_status", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_full_marks_from_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_full_marks_from_catalog"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."teaches_class"("p_class_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."teaches_class"("p_class_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."teaches_class"("p_class_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_duty_adjusted"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."trg_grace_proposal_new"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."trg_report_new"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."trg_report_status"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."upsert_staff_assignment"("p" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_staff_assignment"("p" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."upsert_sync_state"("p_device_id" "text", "p_table_name" "text", "p_pulled_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_sync_state"("p_device_id" "text", "p_table_name" "text", "p_pulled_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_sync_state"("p_device_id" "text", "p_table_name" "text", "p_pulled_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_certificate"("p_student" "uuid", "p_year" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_certificate"("p_student" "uuid", "p_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_certificate"("p_student" "uuid", "p_year" "text") TO "service_role";
























GRANT SELECT,INSERT,UPDATE ON TABLE "public"."absence_excuses" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."absence_excuses" TO "authenticated";



GRANT SELECT ON TABLE "public"."admin_credentials" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."admin_credentials" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."attendance_submissions" TO "authenticated";



GRANT SELECT,INSERT ON TABLE "public"."audit_log" TO "authenticated";



GRANT ALL ON TABLE "public"."class_attendance" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."class_teacher" TO "authenticated";
GRANT SELECT,DELETE ON TABLE "public"."class_teacher" TO "service_role";



GRANT ALL ON TABLE "public"."classes" TO "authenticated";



GRANT ALL ON TABLE "public"."daily_attendance" TO "authenticated";



GRANT SELECT ON TABLE "public"."directorates" TO "anon";
GRANT SELECT ON TABLE "public"."directorates" TO "authenticated";



GRANT ALL ON TABLE "public"."emergency_reports" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."grace_proposals" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."grade_pass_rules" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."lookup_lists" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."modules" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."monthly_statement_changes" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."monthly_statement_rosters" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."monthly_statements" TO "authenticated";



GRANT SELECT ON TABLE "public"."national_staff_registry" TO "service_role";



GRANT SELECT ON TABLE "public"."national_students_registry" TO "service_role";



GRANT SELECT,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."notifications" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."parent_links" TO "service_role";
GRANT SELECT ON TABLE "public"."parent_links" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."parent_otps" TO "service_role";



GRANT SELECT ON TABLE "public"."periodic_reports" TO "authenticated";
GRANT INSERT,UPDATE ON TABLE "public"."periodic_reports" TO "service_role";



GRANT SELECT,INSERT,DELETE ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT SELECT ON TABLE "public"."registry_lookup_audit" TO "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."registry_lookup_audit" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."result_sheets" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."role_module_permissions" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."school_building" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."school_holidays" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."school_personnel" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."school_requests" TO "authenticated";



GRANT SELECT ON TABLE "public"."schools" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."schools" TO "authenticated";
GRANT SELECT ON TABLE "public"."schools" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."staff_assignments" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."staff_attendance" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."staff_credentials" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."staff_credentials" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."staff_leaves" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."staff_records" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."subject_catalog" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."subject_catalog_components" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."subject_components" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."subjects" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."teacher_daily_attendance" TO "authenticated";



GRANT SELECT ON TABLE "public"."users" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."users" TO "authenticated";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."users" TO "service_role";


































