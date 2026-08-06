-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  NSAMS — مرجع قاعدة البيانات الكامل (Database Reference)                    ║
-- ║  نظام رصد الدوام المدرسي الوطني — وزارة التربية السورية                     ║
-- ║                                                                            ║
-- ║  الغرض: ارفع هذا الملف في أي دردشة جديدة. يحتوي على كل ما يحتاجه أي         ║
-- ║  مساعد لفهم بنية قاعدة البيانات قبل تعديل ملفات التطبيق:                    ║
-- ║    • الجداول وأعمدتها وأنواعها        • الـ enums                          ║
-- ║    • القيود (constraints) والفهارس     • دوال RPC والـ helper functions     ║
-- ║    • سياسات RLS                       • إعداد التخزين (Storage)            ║
-- ║                                                                            ║
-- ║  ⚠️  هذا ملف توثيقي/مرجعي. أغلب الكائنات منشأة مسبقاً في قاعدة البيانات.    ║
-- ║      لا تعيد تشغيله كاملاً على الإنتاج بشكل أعمى. استخدمه كمصدر للحقيقة.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════════════
--  ١. ENUMS (الأنواع المعرّفة)
-- ════════════════════════════════════════════════════════════════════════════
-- report_status: حالة بلاغ الطوارئ
--   open | acknowledged | resolved
--
-- report_type: نوع بلاغ الطوارئ
--   security_threat | infrastructure_damage | health_emergency
--   natural_disaster | teacher_shortage | other
--
-- ملاحظة: عمود users.role هو USER-DEFINED enum بالقيم:
--   teacher | school_admin | directorate_user | ministry_user


-- ════════════════════════════════════════════════════════════════════════════
--  ٢. الجداول (TABLES) — البنية كما هي في الإنتاج
-- ════════════════════════════════════════════════════════════════════════════

-- ── users ──────────────────────────────────────────────────────────────────
--   id            uuid        NOT NULL  (= auth.uid())
--   full_name     text        NOT NULL
--   role          enum        NOT NULL  (teacher|school_admin|directorate_user|ministry_user)
--   school_id     uuid        NULL      → schools.id
--   directorate_id uuid       NULL      → directorates.id
--   created_at    timestamptz NOT NULL

-- ── directorates ─────────────────────────────────────────────────────────────
--   id, name, governorate (الأعمدة الأساسية؛ راجع إن لزم التفصيل)

-- ── schools ──────────────────────────────────────────────────────────────────
--   id              uuid   (PK)
--   name            text
--   directorate_id  uuid   → directorates.id
--   total_students  int            ← يُستخدم لحساب نسبة الحضور (عتبة 75%)
--   total_teachers  int
--   school_type     text   NOT NULL default 'primary'   ← §25
--                   'primary' (ابتدائي) | 'preparatory' (إعدادي) | 'secondary' (ثانوي)
--                   يحدّد تسمية واجهة المدير: ابتدائي="معلم" / غيره="موجه"
--                   ⚠ لا يُشتقّ من رقم الصف — صفوف الإعدادي والثانوي مرقّمة ١-٢-٣
--                     محلياً، وstageForGrade في db.js يقرأها خطأً «ابتدائي».
--   education_type  text           عام | خاص | مهني | شرعي  (وصفي، بلا قيد)
--   archived_at     timestamptz    غير فارغ = مؤرشفة، تُخفى من القوائم التشغيلية
--   lat, lng / latitude, longitude ← إحداثيات الخريطة (تأكد من الاسم الفعلي)

-- ── classes ──────────────────────────────────────────────────────────────────
--   id            uuid   (PK)
--   school_id     uuid   → schools.id
--   name          text
--   grade         (رقم الصف)
--   section       text   (الشعبة)
--   created_at    timestamptz
--   academic_year text   (صيغة: '2025-2026')
--   foreign_language text  default 'انكليزي' — check ('انكليزي','فرنسي','روسي')
--   level_track   smallint NULL  (§23) — رقم المستوى 1/2/3 للشعبة الحاملة منهاج
--                 المستوى بعد دمج المديرية؛ null = شعبة نظامية. الشعبة تبقى داخل
--                 صفّها النظامي — لا جدول صفوف استثنائية.
--   ⚠️ لا يوجد عمود teacher_id — الإسناد يتم عبر جدول class_teacher

-- ── class_teacher (إسناد المعلمين للصفوف) ─────────────────────────────────────
--   id            uuid   (PK)
--   class_id      uuid   → classes.id
--   teacher_id    uuid   → users.id
--   academic_year text   ('2025-2026')
--   subject       text   NULL  ← العمود باقٍ، لكن واجهة المدير (v2) لم تعد ترسله:
--                          assignTeacherToClass تمرّر null، وحقل المادة أُزيل من الـ UI
--                          (لجميع أنواع المدارس). بيانات subject القديمة تبقى للعرض فقط.
--   UNIQUE (class_id, teacher_id, academic_year)
--     ← يسمح بعدة معلمين للصف، ويمنع تكرار نفس المعلم بنفس الصف
--     (القيد القديم class_id+academic_year حُذف لأنه منع تعدد المعلمين)

-- ── students ─────────────────────────────────────────────────────────────────
--   (الأعمدة والإلزامية مؤكّدة عبر information_schema هذه الجلسة)
--   id            uuid        NOT NULL (PK)   ← gen_random_uuid()
--   school_id     uuid        NOT NULL → schools.id
--   class_id      uuid        NULL     → classes.id   (nullable)
--   full_name     text        NOT NULL
--   national_id   text        NULL
--   parent_phone  text        NULL
--   gender        text        NULL   ← text حرّ، ليس enum
--   seat_number   smallint    NULL   ← مهم: smallint وليس int (يؤثر على نوع إرجاع RPC)
--   is_active     boolean     NOT NULL   ← لازم تمريره عند الإدراج (ضع true)
--   created_at    timestamptz NOT NULL   ← ضع now() عند الإدراج
--   أقل أعمدة لازمة للإدراج: id, school_id, full_name, is_active, created_at
--   (class_id, seat_number اختياريان تقنياً لكن يُنصح بتعبئتهما)

-- ── daily_student_attendance (حضور الطلاب اليومي) ────────────────────────────
--   id            uuid        (PK)
--   student_id    uuid        NOT NULL → students.id
--   class_id      uuid        NOT NULL → classes.id
--   school_id     uuid        NOT NULL → schools.id
--   date          date        NOT NULL
--   status        text        NOT NULL  (present|late|absent|excused)
--   reason        text        NULL      ← سبب الغياب/التأخير الذي يكتبه المعلم
--   recorded_by   uuid        NULL      → users.id (المعلم الذي سجّل)
--   created_at    timestamptz NOT NULL
--   UNIQUE (student_id, date)   ← يستخدمه الـ upsert (onConflict: student_id,date)

-- ── attendance_submissions (كشوف الحضور المرفوعة من المعلم للمدير) ────────────
--   id, class_id, school_id, date, submitted_by, submitted_at,
--   status (pending|confirmed|rejected), confirmed_by, confirmed_at, notes
--   (راجع الأعمدة الفعلية إن احتجت تفاصيل دقيقة)

-- ── daily_attendance (ملخص الحضور على مستوى المدرسة) ─────────────────────────
--   id              uuid        (PK)
--   school_id       uuid        → schools.id
--   date            date
--   teachers_present int4
--   teachers_absent  int4
--   students_present int4
--   notes           text
--   submitted_by    uuid
--   submitted_at    timestamptz
--   updated_at      timestamptz
--   ⚠️ لا يوجد عمود students_absent (لا ترسله في الـ payload)

-- ── emergency_reports (بلاغات الطوارئ) ────────────────────────────────────────
--   id            uuid          (PK)
--   school_id     uuid          → schools.id
--   submitted_by  uuid          → users.id
--   type          report_type   (enum)
--   description   text
--   severity      int2
--   status        report_status (enum, default 'open')
--   receipt_number text
--   media_urls    text[]        ← روابط صور (Storage) أو data URI (fallback)
--   resolved_by   uuid          NULL → users.id
--   resolved_at   timestamptz   NULL
--   created_at    timestamptz
--   updated_at    timestamptz

-- ── class_attendance (تجميع حضور الصف ضمن ملخّص اليوم) ───────────────────────
--   ⚠️ كان غير موثّق في النسخ السابقة. بنية حقيقية + RLS مفعّل (قد يكون فارغاً).
--   id                  uuid     (PK)
--   daily_attendance_id uuid     → daily_attendance.id   (يربطه بملخّص مدرسة/يوم)
--   class_id            uuid     → classes.id
--   students_present    int
--   students_absent     int
--   teacher_present     boolean
--   created_at          timestamptz

-- ── teacher_daily_attendance (دوام المعلمين اليومي — حضور/تأخير الكادر) ───────
--   ⚠️ كان غير موثّق. ميزة منفصلة عن حضور الطلاب (دوام المعلم نفسه). قد يكون فارغاً.
--   id            uuid     (PK)
--   teacher_id    uuid     → users.id
--   school_id     uuid     → schools.id
--   date          date
--   check_in      time     NULL
--   check_out     time     NULL
--   status        text     (حالة الدوام)
--   late_minutes  smallint
--   notes         text     NULL

-- ── transfer_documents (§23 — وثائق «لا مانع»: نقل طالب بين مدرستين) ──────────
--   ⚠️ أول جدول في النظام طرفاه مدرستان لا مدرسة ومديرية. لا سياسة insert/update
--      عليه إطلاقاً: كل كتابة عبر دوال §23.4 (security definer).
--   id                  uuid        (PK)
--   doc_type            text        NOT NULL default 'regular'
--                                   check ('regular','exceptional')
--                                   regular = يبقى الطالب في صفّه · exceptional = صفّ مختلف
--   ── لقطة الطالب وقت الإصدار (لا تتغيّر بعدها) ──
--   student_id          uuid        NULL → students.id  on delete set null
--   student_national_id text        NOT NULL
--   student_full_name   text        NOT NULL
--   first_name, father_name, grandfather_name, family_name, mother_name  text
--   birth_date          date
--   student_gender      text        check (null | 'male' | 'female')
--                                   → صياغة الورقة: «الطالبة/التلميذة … ابنة السيد»
--   ── المدرسة الحالية (المُرسِلة — صاحبة قرار الموافقة) ──
--   from_school_id      uuid        NOT NULL → schools.id
--   from_school_name, from_grade_label, from_section_label   text (لقطات)
--   ── المدرسة المستقبِلة (المُصدِرة للوثيقة والورقة) ──
--   to_school_id        uuid        NOT NULL → schools.id
--   to_school_name      text
--   to_class_id         uuid        NULL → classes.id  on delete set null
--   to_grade_label, to_section_label  text
--   to_level_track      smallint
--   to_foreign_language text        ← «اللغة: الإنكليزية» على الورقة
--   to_complex_name     text        ← «المجمع التربوي في: …»
--   to_directorate_name text        ← «مديرية التربية والتعليم في: …»
--   ── ترقيم الصادر ──
--   academic_year       text        NOT NULL  (صيغة '2025-2026')
--   outgoing_number     int         NOT NULL  ← «رقم الصادر» على الورقة
--   ── الحالة والتتبّع ──
--   status              text        NOT NULL default 'pending'
--                                   check ('pending','executed','rejected','cancelled')
--   transfer_reason, notes, reject_reason                    text
--   issued_by  uuid NOT NULL → auth.users · issued_by_name  text · issued_at  timestamptz
--   processed_by uuid → auth.users · processed_by_name text · processed_at timestamptz
--   created_at          timestamptz NOT NULL default now()
--   constraint transfer_docs_diff_schools  check (from_school_id <> to_school_id)
--
--   الفهارس:
--     transfer_docs_to_school_idx    (to_school_id, issued_at desc)
--     transfer_docs_from_school_idx  (from_school_id, issued_at desc)
--     transfer_docs_outgoing_uidx    UNIQUE (to_school_id, academic_year, outgoing_number)
--     transfer_docs_pending_uidx     UNIQUE (student_national_id) where status='pending'


-- ════════════════════════════════════════════════════════════════════════════
--  ٣. HELPER FUNCTIONS (دوال مساعدة — SECURITY DEFINER لتجنّب recursion في RLS)
-- ════════════════════════════════════════════════════════════════════════════

-- دور المستخدم الحالي
create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

-- مدرسة المستخدم الحالي
create or replace function public.auth_school_id()
returns uuid language sql stable security definer set search_path = public as $$
  select school_id from public.users where id = auth.uid()
$$;

-- مديرية المستخدم الحالي
create or replace function public.auth_directorate_id()
returns uuid language sql stable security definer set search_path = public as $$
  select directorate_id from public.users where id = auth.uid()
$$;

-- هل يدرّس المستخدم الحالي هذا الصف؟ (يفحص class_teacher)
create or replace function public.teaches_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.class_teacher ct
    where ct.class_id = p_class_id and ct.teacher_id = auth.uid()
  )
$$;

-- هل هذه المدرسة ضمن مديرية المستخدم الحالي؟
create or replace function public.school_in_my_directorate(p_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.schools
    where id = p_school_id and directorate_id = public.auth_directorate_id()
  )
$$;

-- هل هذا الصف ضمن مدرسة المستخدم الحالي؟
create or replace function public.class_in_my_school(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classes
    where id = p_class_id and school_id = public.auth_school_id()
  )
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  ⚠️ مهم: توابع الهوية المعتمدة في السياسات هي current_user_* وليست auth_*
-- ════════════════════════════════════════════════════════════════════════════
-- بعد توحيد RLS (قسم ٨)، كل السياسات تستخدم هذه التوابع (تُرجع نوع enum، type-safe):
--   current_user_role()         → user_role   (SELECT role FROM users WHERE id=auth.uid())
--   current_user_school_id()    → uuid        (SELECT school_id ...)
--   current_user_directorate_id() → uuid      (SELECT directorate_id ...)
--
-- التوابع النصّية أعلاه (auth_role/auth_school_id/auth_directorate_id) لا تزال
-- موجودة في القاعدة لكنها غير مستخدمة في أي سياسة. سبب الكارثة الأصلية: auth_role()
-- تُرجع text، فمقارنة = 'directorate' (بدل 'directorate_user') تُنتج false صامتة.
-- current_user_role() تُرجع enum فترفض القيمة الخاطئة وقت الإنشاء. لا تُرجع السياسات
-- إلى auth_role() — أنشئ أي سياسة جديدة على current_user_role() حصراً.
--
-- class_belongs_to_my_school(uuid) → boolean: مطابقة وظيفياً لـ class_in_my_school.
-- موجودة في القاعدة؛ السياسات الموحّدة تستخدم class_in_my_school.

grant execute on function public.auth_role()                 to authenticated;
grant execute on function public.auth_school_id()            to authenticated;
grant execute on function public.auth_directorate_id()       to authenticated;
grant execute on function public.teaches_class(uuid)         to authenticated;
grant execute on function public.school_in_my_directorate(uuid) to authenticated;
grant execute on function public.class_in_my_school(uuid)    to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  ٤. RPC: سجل الغيابات لكل صف (السنة الدراسية الحالية)
-- ════════════════════════════════════════════════════════════════════════════
-- يُجمّع لكل طالب عدد الغيابات غير المبررة (absent) والمبررة (excused) عبر
-- السنة الدراسية. 'late' لا يُحتسب. يتحقق من أن المستدعي يدرّس الصف.
-- ⚠️ seat_number نوعه smallint (يطابق students.seat_number).

drop function if exists public.get_class_absence_log(uuid);

create function public.get_class_absence_log(p_class_id uuid)
returns table (
  student_id    uuid,
  full_name     text,
  seat_number   smallint,
  absent_count  bigint,
  excused_count bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_month int := extract(month from current_date);
  v_year  int := extract(year  from current_date);
  v_start date;
  v_end   date;
begin
  if not public.teaches_class(p_class_id) then
    raise exception 'not authorized for class %', p_class_id using errcode = '42501';
  end if;

  -- نافذة السنة الدراسية (Sep→Aug) — تطابق getAcademicYear() في db.js
  if v_month >= 9 then
    v_start := make_date(v_year,     9, 1);
    v_end   := make_date(v_year + 1, 8, 31);
  else
    v_start := make_date(v_year - 1, 9, 1);
    v_end   := make_date(v_year,     8, 31);
  end if;

  return query
  select s.id, s.full_name, s.seat_number,
         count(*) filter (where dsa.status = 'absent')  as absent_count,
         count(*) filter (where dsa.status = 'excused') as excused_count
  from public.students s
  join public.daily_student_attendance dsa on dsa.student_id = s.id
  where dsa.class_id = p_class_id
    and dsa.date between v_start and v_end
    and dsa.status in ('absent', 'excused')
  group by s.id, s.full_name, s.seat_number
  having count(*) filter (where dsa.status in ('absent','excused')) > 0
  order by (count(*) filter (where dsa.status = 'absent')) desc,
           s.seat_number nulls last, s.full_name;
end;
$$;

grant execute on function public.get_class_absence_log(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  ٥. سياسات RLS (Row Level Security) — موحّدة على current_user_role()
-- ════════════════════════════════════════════════════════════════════════════
-- المبدأ: كل cross-table lookup يمرّ عبر helper function (SECURITY DEFINER)
-- لتجنّب infinite recursion. الأدوار: teacher | school_admin |
-- directorate_user | ministry_user.
--
-- ✅ توحيد (راجع قسم ٨): كل السياسات الآن على current_user_role() التي تُرجع
--    نوع enum user_role (type-safe). أي مقارنة بقيمة خاطئة = خطأ وقت الإنشاء،
--    لا فشل صامت. الدوال النصّية auth_role()/auth_school_id()/auth_directorate_id()
--    ما عادت مستخدمة في أي سياسة (لكنها باقية في القاعدة احتياطاً — لا تعتمد عليها).
--
-- النمط الموحّد لكل جدول: سياسة قراءة واحدة (SELECT) شاملة لكل الأدوار المخوّلة،
-- + سياسة/سياسات كتابة منفصلة لكل دور يكتب. الوزارة عبر سياسة ALL مستقلة غالباً.
-- كل المقارنات: current_user_role() = '<role>'::user_role

-- ── users ────────────────────────────────────────────────────────────────────
alter table public.users enable row level security;
--   users_select_self        (SELECT): id = auth.uid()
--   users_select_school      (SELECT): school_admin AND school_id = current_user_school_id()
--   users_select_directorate (SELECT): ministry=الكل | directorate AND directorate_id مطابق

-- ── directorates ─────────────────────────────────────────────────────────────
--   directorates_read        (SELECT): ministry=الكل | directorate(مديريته) |
--                                       school_admin(مديرية مدرسته عبر subquery على schools)
--   "ministry: all directorates" (ALL): الوزارة كتابة كاملة

-- ── schools ──────────────────────────────────────────────────────────────────
--   schools_read             (SELECT): ministry=الكل | directorate(مدارسها) |
--                                       (school_admin|teacher)(مدرستهم، id=current_user_school_id())
--   "ministry: all schools"  (ALL): الوزارة كتابة كاملة

-- ── classes ──────────────────────────────────────────────────────────────────
--   classes_read             (SELECT): ministry | directorate(school_in_my_directorate) |
--                                       school_admin(مدرسته) | teacher(teaches_class)
--   classes_admin_write      (ALL):    school_admin AND school_id = current_user_school_id()
--   "ministry: all classes"  (ALL):    الوزارة كتابة كاملة

-- ── class_teacher ────────────────────────────────────────────────────────────
alter table public.class_teacher enable row level security;
--   class_teacher_read        (SELECT): teacher_id=auth.uid() OR (school_admin AND class_in_my_school)
--   class_teacher_admin_write (ALL):    school_admin AND class_in_my_school(class_id)
--     ← تتيح للمدير الإسناد/الإزالة في مدرسته. وحّدنا على class_in_my_school()
--       (كانت تستخدم class_belongs_to_my_school المطابقة لها وظيفياً).

-- ── students ─────────────────────────────────────────────────────────────────
--   students_read            (SELECT): teacher(teaches_class) | school_admin(مدرسته) |
--                                       directorate(مدارسها) | ministry
--   students_admin_write     (ALL):    school_admin AND school_id = current_user_school_id()

-- ── daily_student_attendance (حضور الطلاب — قلب النظام) ──────────────────────
alter table public.daily_student_attendance enable row level security;
-- ✅ سياسة كتابة موحّدة FOR ALL تغطّي INSERT+UPDATE (نصفَي الـ upsert).
--    حلّت 403 التاريخية عند إعادة الإرسال. شرط منع تعديل الكشف بعد التأكيد محفوظ.
--   dsa_teacher_write (ALL):
--     USING:      teacher AND teaches_class(class_id)
--     WITH CHECK: teacher AND teaches_class AND recorded_by=auth.uid()
--                 AND date=CURRENT_DATE
--                 AND NOT EXISTS(submission مؤكّد لنفس الصف/التاريخ)
--   dsa_read (SELECT): teacher(teaches_class) | school_admin(مدرسته) |
--                      directorate(مدارسها) | ministry
--   "ministry: all attendance" (ALL): محفوظة للوزارة

-- ── attendance_submissions (كشوف الحضور المرفوعة) ────────────────────────────
--   subs_teacher_insert (INSERT): teacher AND submitted_by=auth.uid()
--                                  AND date=CURRENT_DATE AND teaches_class(class_id)
--   subs_teacher_update (UPDATE): teacher AND teaches_class AND status<>'confirmed'
--   subs_admin_update   (UPDATE): school_admin AND school_id=current_user_school_id()
--   subs_read           (SELECT): teacher(teaches_class) | school_admin(مدرسته) |
--                                  directorate(مدارسها) | ministry

-- ── daily_attendance (ملخص الحضور المدرسي) ───────────────────────────────────
--   da_admin_write (ALL):    school_admin AND school_id=current_user_school_id()
--   da_read        (SELECT): school_admin(مدرسته) | directorate(مدارسها) | ministry
--                            (المعلم لا يقرأ الملخّص المدرسي — مقصود)
--   "ministry: all attendance" (ALL): محفوظة للوزارة

-- ── emergency_reports (بلاغات الطوارئ) ───────────────────────────────────────
-- ⚠️ سابقاً: سياسة "authenticated can read"=true كانت تسرّب كل البلاغات لأي مستخدم.
--    حُذفت. وكانت reports_directorate_update مكسورة ('directorate' نصّي). أُصلحت.
--   reports_admin_insert (INSERT): school_admin AND school_id=current_user_school_id()
--   reports_read         (SELECT): school_admin(مدرسته) | directorate(مدارسها) | ministry
--   "school_admin: own school reports"        (ALL): المدير على بلاغات مدرسته
--   "directorate_user: reports in directorate"(ALL): المديرية على بلاغات مدارسها
--                                                     (تغطّي التأكيد/الحل — لا UPDATE منفصل)
--   "ministry: all reports"                   (ALL): الوزارة كتابة كاملة

-- ── class_attendance (تجميع حضور الصف) ───────────────────────────────────────
alter table public.class_attendance enable row level security;
-- جدول مبني، قد يكون فارغاً حتى توصّله الواجهة. كل السياسات على current_user_role().
--   ca_teacher_read  (SELECT): teacher AND teaches_class(class_id)
--   ca_teacher_write (ALL):    teacher AND teaches_class(class_id)
--   "school_admin: own school class_attendance" (ALL): عبر daily_attendance_id IN مدرسته
--   "directorate_user: class_attendance in directorate" (SELECT): عبر join على schools
--   "ministry: all class_attendance" (ALL): الوزارة

-- ── teacher_daily_attendance (دوام المعلمين) ─────────────────────────────────
alter table public.teacher_daily_attendance enable row level security;
-- جدول مبني، قد يكون فارغاً. وحّدناه من {public}/auth_role() إلى authenticated/current_user_role().
--   tda_teacher_write (ALL):    teacher_id = auth.uid() (المعلم على دوامه فقط)
--   tda_read          (SELECT): teacher_id=auth.uid() | school_admin(مدرسته) |
--                               directorate(مدارسها) | ministry

-- ── transfer_documents (§23 — وثائق «لا مانع») ───────────────────────────────
alter table public.transfer_documents enable row level security;
--   tdoc_parties_select (SELECT): school_admin AND (from_school_id = مدرستي
--                                 OR to_school_id = مدرستي)
--                                 ⚠️ الشرط الوحيد من نوعه في النظام: طرفان
--                                 مدرستان متكافئتان، لا احتواء مديرية.
--   tdoc_dir_select     (SELECT): directorate_user AND school_in_my_directorate
--                                 على أيٍّ من الطرفين
--   ⚠️ لا سياسة INSERT/UPDATE/DELETE عمداً، و grant select وحده. كل كتابة تمرّ
--      بدوال §23.4 (security definer) التي تتحقّق من الدور والنطاق والحالة.


-- ════════════════════════════════════════════════════════════════════════════
--  ٦. STORAGE (تخزين صور البلاغات)
--
--  الـ bucket خاص (public = false). db.js يرفع الصور ويخزّن المسار فقط (لا
--  public URL). عند العرض تستدعي الواجهة resolveReportPhotos() التي تولّد
--  signed URL (TTL ساعة) لكل مسار. data URIs القديمة تمرّ كما هي.
-- ════════════════════════════════════════════════════════════════════════════

-- P.1: تأكد من أن الـ bucket خاص (إذا سبق إنشاؤه كـ public، عدِّله من Dashboard)
insert into storage.buckets (id, name, public)
values ('report-photos', 'report-photos', false)
on conflict (id) do update set public = false;

-- إزالة السياسة العامة القديمة
drop policy if exists "report photos public read" on storage.objects;

-- قراءة مقيَّدة: مدير المدرسة + مديرية + وزارة فقط
drop policy if exists "report photos staff read" on storage.objects;
create policy "report photos staff read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'report-photos'
    and public.current_user_role() in (
      'school_admin'::public.user_role,
      'directorate_user'::public.user_role,
      'ministry_user'::public.user_role
    )
  );

-- رفع: مدير المدرسة فقط (بقي كما هو)
drop policy if exists "report photos admin upload" on storage.objects;
create policy "report photos admin upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-photos'
    and public.current_user_role() = 'school_admin'::public.user_role
  );


-- ════════════════════════════════════════════════════════════════════════════
--  ٧. استعلامات تشخيص سريعة (Diagnostics) — مفيدة عند ظهور أخطاء
-- ════════════════════════════════════════════════════════════════════════════
-- أعمدة أي جدول:
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema='public' and table_name='<TABLE>' order by ordinal_position;
--
-- قيود جدول:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.<TABLE>'::regclass and contype in ('u','p');
--
-- سياسات جدول:
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname='public' and tablename='<TABLE>';
--
-- قيم enum:
--   select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid
--   where t.typname in ('report_type','report_status') order by t.typname, e.enumsortorder;
--
-- تعريف دالة:
--   select pg_get_functiondef('public.<FN>(<ARGS>)'::regprocedure);
--
-- أدوار المستخدمين:
--   select distinct role from public.users;


-- ════════════════════════════════════════════════════════════════════════════
--  ٨. تحديثات v2 (هذه الجلسة) — Migrations + سلوك الواجهة
-- ════════════════════════════════════════════════════════════════════════════
--
--  ميزة "الموجهين" (إعدادي/ثانوي): واجهة المدير تبدّل تسمية "معلم"↔"موجه"
--  تلقائياً حسب schools.school_type. الموجه = نفس دور 'teacher' في القاعدة؛
--  التغيير في تسمية الواجهة فقط. لا تغيير في أسماء دوال db.js.
--
--  بعد §25 صارت القيم ثلاثاً، والشرط في الواجهة «ليس ابتدائياً» لا «يساوي
--  middle_high» (school/script.js: usesSupervisors()). الإعدادي والثانوي
--  يشتركان في سلوك الموجّه تماماً — الفصل بينهما للتسمية والتقارير فقط.
--
--  • db.js getSchoolById يستخدم select('*') ليجلب school_type دون أن ينكسر
--    لو العمود غير موجود → ترتيب النشر مرن.
--  • التبديل في طبقة المدير فقط (school/). المديرية لم تتأثر.
--  • "الهيئة التدريسية / المعلمون الغائبون" (teachers_present/absent) تبقى "معلم"
--    عمداً — مفهوم كادر المدرسة، لا الموجه المُسنَد للصفوف.

-- ⚠ الهجرة انتقلت إلى docs/database-setup.sql §25 — لا تُشغَّل من هنا.
--   كانت معرَّفة في هذا الملفّ وحده، وهو **مرجع للقراءة لا يُنفَّذ**، فعلى أي
--   نشرٍ جديد لم يكن العمود موجوداً أصلاً. §25 وسّعت القيم إلى ثلاث وحوّلت
--   'middle_high' القديمة إلى 'preparatory'.
--
-- ⚠ الحارس القديم كان يفحص **اسم** القيد (conname) لا تعريفه، فإعادة تشغيله
--   بعد أي توسيع للقيم تتخطّاه بصمت بدل أن تستبدله. §25 تحذف القيد صراحةً
--   قبل إعادة إنشائه — أي تعديل مستقبلي على القيم يلزمه نفس الحذف الصريح.
--
-- تعيين مدرسة كإعدادية أو ثانوية (أو من لوحة المشرف مباشرةً):
--   update public.schools set school_type = 'preparatory' where id = '<SCHOOL_ID>';
--   update public.schools set school_type = 'secondary'   where id = '<SCHOOL_ID>';


-- ── توحيد سياسات RLS (إصلاح أمني كبير) ───────────────────────────────────────
--  ما تم في هذا الإصلاح:
--   ① حذف ثغرتين حرجتين: سياستا "authenticated can read" (qual=true) على
--      daily_attendance و emergency_reports كانتا تسرّبان بيانات كل المدارس لأي
--      مستخدم مسجّل. (كانتا تتجاوزان كل فلترة عبر OR.) → حُذفتا.
--   ② توحيد كل السياسات من auth_role() (نصّي، عرضة لفشل صامت) إلى
--      current_user_role() (enum، type-safe). 45 سياسة مبعثرة → 25 موحّدة.
--   ③ إصلاح reports_directorate_update: كانت 'directorate' نصّية (ميتة، false دائماً).
--   ④ حذف عشرات السياسات المكرّرة (نفس المنطق مكتوب مرتين بنظامين متوازيين).
--   ⑤ توثيق + تأمين جدولين كانا غير موثّقين: class_attendance, teacher_daily_attendance
--      (أُضيف للأول فرع المعلم، ووُحّد الثاني من {public} إلى authenticated).
--
--  القاعدة الذهبية بعد هذا الإصلاح:
--   • أنشئ أي سياسة جديدة على current_user_role() = '<role>'::user_role حصراً.
--   • لا تستخدم auth_role() النصّي (يطابق teacher/school_admin صدفةً فقط، ويكسر
--     directorate_user/ministry_user بصمت). التوابع auth_* باقية للتوافق فقط.
--   • النمط: سياسة SELECT واحدة شاملة + سياسات كتابة منفصلة لكل دور.
--
--  عدد السياسات لكل جدول بعد التوحيد (للتحقق السريع):
--   attendance_submissions=4, class_attendance=5, class_teacher=2, classes=3,
--   daily_attendance=3, daily_student_attendance=3, directorates=2,
--   emergency_reports=5, schools=2, students=2, teacher_daily_attendance=2, users=3
--
--  تحقّق أن التوحيد سليم (يجب أن يُرجع الاستعلامان صفر صفوف):
--   -- لا سياسة على auth_role():
--   select * from pg_policies where schemaname='public'
--     and (qual ilike '%auth_role()%' or with_check ilike '%auth_role()%');
--   -- لا فرع نصّي مكسور:
--   select * from pg_policies where schemaname='public'
--     and (qual ~ '''directorate''[^_]' or qual ~ '''ministry''[^_]');


-- ════════════════════════════════════════════════════════════════════════════
--  ٩. معرّفات معروفة (بيانات اختبار) — مدرسة أبي عبيدة بن الجراح
-- ════════════════════════════════════════════════════════════════════════════
--  المدرسة (school_type = 'preparatory' بعد §25 — كانت 'middle_high'):
--    3cb48602-35ad-4cd3-9095-a06b5188d1c5
--
--  الصفوف (شعبة A):
--    الصف الأول  (grade 1):  a8a5bfe3-d080-4a20-ada5-55ab2f59135d   (30 طالباً)
--    الصف الثاني (grade 2):  c70ef421-de38-4014-9c4f-132b7369044f   (30 طالباً)
--    الصف الثالث (grade 3):  bad57867-c043-4401-b8a1-80b5e942c957   (31 طالباً)
--
--  الموجهون (role='teacher', school_id=المدرسة أعلاه):
--    mahmoud.s@nsams.test : a05ae645-4069-40ed-a3c4-1ccbc76fd838  (محمود إبراهيم سليمان)
--    rana.k@nsams.test    : f560641f-7fff-4ee4-8479-56cf1864d8db  (رنا خالد العلي)
--    samer.h@nsams.test   : 77a7a697-19ce-41be-b2b2-d6519baab1f2  (سامر يوسف حدّاد)
--    كلمة المرور للثلاثة: Nsams@2026
--
--  بيانات اختبار من جلسات سابقة:
--    المعلم أحمد محمد علي : 6f8fb2f9-6b99-4456-8fb8-82fd828ac977 (school_id=22222222-…)
--    السنة الدراسية الحالية: '2025-2026'
--
--  ملاحظات إنشاء الحسابات:
--   • public.users.id يساوي auth.uid() وغالباً مرتبط بقيد أجنبي إلى auth.users،
--     لذا أنشئ المستخدم في Supabase Auth أولاً ثم upsert صفّه في public.users.
--   • لإظهار الموجه في قائمة الإسناد يكفي صف public.users (role='teacher' + school_id)،
--     لكن لتسجيل الدخول وتسجيل الحضور يلزم حساب Auth فعلي.
--   • الإسناد للصف (class_teacher) يتم من واجهة "إدارة الصفوف"، وهو ما يجعل
--     teaches_class() ترجّع true للموجه → يفتح الكتابة والسجل. (لا تُسند يدوياً بـ SQL)


-- ════════════════════════════════════════════════════════════════════════════
--  ٩ب. §14 — البيان الشهري الرسمي (جداول جديدة)
-- ════════════════════════════════════════════════════════════════════════════
--
--  أعمدة أُضيفت على schools:
--    statistical_number text          الرقم الإحصائي للمدرسة
--    cycle              text          الحلقة (1 | 2 | 3 | 1+2 | 2+3 | 1+2+3)
--    rural_curriculum   boolean       منهاج ريفي (true/false)
--
--  lookup_lists  — القوائم المرجعية المركزية
--    id, directorate_id (null=نظامي), list_type, value, sort_order, active
--    list_type values: admin_role | specialization | certificate | higher_degree
--                      leave_type | ministerial_doc | support_job | educational_zone
--    RLS: select = كل authenticated؛ write = ministry_user فقط
--
--  staff_records  — سجل الكوادر البشرية (حساس)
--    staff_type: admin | teaching | professional | worker | guard
--    حقول حساسة: national_id, mother_name, birth_date, phone
--    RLS: school_admin فقط (لا select مباشر للمديرية)
--    للمديرية: استخدم get_school_staff_for_directorate(school_id) — يحذف الحقول الحساسة
--
--  staff_leaves  — إجازات الكوادر الشهرية
--    (staff_id, school_id, leave_type, leave_days, month, year)
--    RLS: school_admin كل عمليات؛ directorate_user select لمدارس مديريته
--
--  monthly_statements  — سجل البيانات الشهرية
--    status: draft → submitted → approved | rejected
--    snapshot_data: jsonb — لقطة البيان عند الإرسال (أرشفة)
--    unique على (school_id, year, month)
--    RLS: school_admin CRUD لمدرسته (draft/rejected فقط قابل للتعديل)؛
--         directorate_user select + update (approved/rejected) لمدارس مديريته
--    لا delete — سجل رسمي
--
--  monthly_statement_changes  — التعديلات الطارئة الشهرية
--    (statement_id, change_type, staff_id, change_data, reason, effective_date)
--    change_type: added | removed | modified | leave | transfer
--
--  سير موافقة البيان (§14.9):
--    review_monthly_statement(p_statement_id, p_decision, p_notes)  — RPC security definer
--      المديرية توافق/ترفض بياناً status='submitted' → approved|rejected
--      تُحدّث reviewed_by/reviewed_at/notes وتُشعر مدراء المدرسة (notify_user)
--    trg_notify_dir_statement_submitted  — after insert/update على monthly_statements
--      عند الانتقال إلى submitted تُشعر directorate_user في مديرية المدرسة
--      (أنواع الإشعار: statement_submitted / statement_approved / statement_rejected)
--
-- ════════════════════════════════════════════════════════════════════════════
--  ٩ج. §20 — إتمام البيان الشهري ليطابق النموذج الرسمي
-- ════════════════════════════════════════════════════════════════════════════
--
--  أعمدة أُضيفت على schools:
--    village, address, phone, shared_with, former_name, educational_zone
--    day_type text  check ('كامل','نصفي')
--      ⚠ محور مستقلّ عن schools.shift ('morning'|'evening'). لا تخلط بينهما:
--        shift = صباحي/مسائي، day_type = كامل/نصفي. خانتان مختلفتان في الورقة.
--
--  school_building — صفّ واحد لكل مدرسة (school_id PK)
--    floors, ownership('حكومي'|'مستأجر'), class_rooms, admin_rooms, unused_rooms,
--    basement, lab, computer_lab, library, secretariat, gym, storage, guidance,
--    health_room, workshop, theater, yard, other_halls
--    RLS: school_admin كامل ضمن مدرسته؛ directorate_user select لمدارس مديريته
--
--  أعمدة أُضيفت على staff_records:
--    landline, teaching_rank('معلم'|'مدرس'|'مدرس مساعد'), teaching_hours,
--    quota_subjects, quota_school_external, assigned_grade, assigned_section
--    teaching_rank يُحسب استنتاجاً مرّة ثم يُخزَّن — لا يُعاد تخمينه كل شهر.
--
--  classes.foreign_language ('انكليزي'|'فرنسي'|'روسي', default 'انكليزي')
--    يؤتمت أعمدة اللغة الأجنبية في جدول طلاب البيان.
--
--  staff_leaves_unique_period — فهرس فريد (staff_id, leave_type, month, year)
--    كان upsertStaffLeave يمرّر onConflict على قيد غير موجود فيفشل.
--
--  أعمدة أُضيفت على monthly_statement_changes:
--    event_type('مباشرة'|'انفكاك'|'وفاة'|'تقاعد'|'نقل'|'أخرى'), staff_group,
--    detected boolean, confirmed_at timestamptz
--    change_type = ما رآه النظام؛ event_type = «لماذا» ويملؤه المدير.
--    اقتراح مكتشَف غير مؤكَّد (confirmed_at is null) يمنع إرسال البيان.
--
--  monthly_statement_rosters — السير الذاتية الكاملة، جدول منفصل محمي
--    (statement_id PK → monthly_statements, school_id, rosters jsonb)
--    ⚠ قرار خصوصية مقصود — لا تنقل هذه الحقول إلى snapshot_data:
--      الرقم الوطني، اسم الأم، تاريخ الولادة، الهاتف، العنوان تذهب هنا وحدها،
--      ولا تقرأها المديرية إلا بعد status in ('submitted','approved') وضمن
--      مديريتها. snapshot_data تُقرأ في شاشات المديرية العامة، فلا تصلح لها.
--      get_school_staff_for_directorate يبقى منقّحاً كما هو للقراءة اليومية.
--
-- ── §21 (إصلاحات ما بعد التشغيل) ─────────────────────────────────────────────
--
--  staff_records.seniority_year int — «القدم الوظيفي» في الورقة الرسمية سنةُ
--    تعيين (1931 / 2015 في عيّنة النموذج) لا مدّةَ خدمة. العمود القديم
--    seniority_years numeric(4,1) لا يتّسع لسنة (ثلاث خانات صحيحة)، ولم يُحوَّل
--    لأن قيمه مُدَدٌ وتحويلها تخمين. يبقى للسجلات القديمة ويُقرأ احتياطاً فقط.
--    ⚠ get_school_staff_for_directorate أُعيد إنشاؤها (drop+create) لأن نوع
--      الإرجاع تغيّر — create or replace لا يغيّر نوع الإرجاع.
--
--  send_attendance_reminder → jsonb {sent, recipients, throttled}
--    كانت تُرجع عدداً، والصفر فيه يعني «محجوب» و«لا حساب مدير» معاً، فتقول
--    الواجهة «أُرسل مسبقاً» لمدرسة لم يصلها شيء قط. والحجب صار مقيَّداً بـ
--    entity_id = school_id بعدما كان (recipient_id, type) فقط — فتذكير الـ cron
--    اليومي كان يحجب التذكير اليدوي لمدرسة أخرى.
--
--  cron 'attendance-daily-reminder' صار يفحص daily_student_attendance
--    (كان daily_attendance) ليتّفق مع لوحة الالتزام على تعريف «المدرسة الصامتة».
--
--  grant update on admin_credentials to service_role — كان ينقص، فيفشل تصفير
--    كلمة المرور الصريحة بعد التدوير ويعود الطلب 200 بتحذير.
--
--  ⚠ staff_records.general_number («الرقم العام») حُذف من واجهة سجلّ الكوادر
--    لأنه ليس عموداً في أي ورقة رسمية. **العمود يبقى في القاعدة**: محفّز القفل
--    ودالة link_staff_to_registry في tools/add-national-registry.sql يكتبانه،
--    وحذفه يُعطّل الربط بالسجلّ الوطني. لا تحذفه ظنّاً أنه مهجور.
--
-- ════════════════════════════════════════════════════════════════════════════
--  ٩ب. §22 — ربط سجلّ الكوادر بكشف الدوام
-- ════════════════════════════════════════════════════════════════════════════
--  school_personnel.staff_record_id → staff_records(id) on delete set null،
--    مع فهرس فريد جزئي (where staff_record_id is not null).
--
--  الاتجاه واحد فقط: الكوادر ← الكادر. حفظ سجلّ كادر غير تدريسي يُنشئ أو يُحدّث
--    صفّ الدوام المقابل (shared/db.js → syncPersonnelFromStaffRecord)، وحذفه
--    يُلغي تفعيل الصفّ. أمّا الإضافة السريعة في تبويب «الكادر» فتبقى لمن لا سجلّ
--    كامل له، وصفوفها staff_record_id = null.
--
--  خريطة الفئات — قيد kind ∈ ('admin','worker') لم يُمسّ:
--    staff_type = 'admin'                        → kind = 'admin'
--    staff_type ∈ (professional, worker, guard)  → kind = 'worker'
--    staff_type = 'teaching'                     → لا مرآة (المعلّمون من users)
--    التمييز بين المهني والمستخدم والحارس يبقى في staff_records وحدها لأن
--    البيان الشهري وحده يحتاجه؛ كشف الدوام لا يفرّق بينهم.
--
--  ⚠ صفوف المرآة لا تُحذف من قائمة «الكادر» — الواجهة تعرض لها شارة «من الكوادر»
--    بلا زرّ إزالة. حذفها من هناك يُخرج الشخص من الدوام ويُبقيه في السجلّ
--    والبيان، أي يُعيد الانفصال الذي جاءت §22 لإنهائه.
--
--  ⚠ «عامل» لم تعد تظهر في نصوص الواجهة — البديل «مستخدم». قيمة kind='worker'
--    في القاعدة لم تتغيّر: التبديل في نصوص العرض وحدها. ولا تُبدَّل «العاملين»
--    في §10 من البيان («ملخّص العاملين»، «مجموع العاملين في المدرسة») فهي
--    عناوين الورقة الرسمية وتعني مجموع الكادر لا فئةً منه.
--
--  ⚠ زرّا «البحث في السجل المركزي» (الكادر بالرقم الذاتي، والطالب بالرقم الوطني)
--    حُذفا من الواجهة: national_staff_registry و national_students_registry بلا
--    grant للدور authenticated فيسقط الاستدعاء بـ «permission denied»، وهما
--    فارغان أصلاً إذ لا شاشة في التطبيق تملؤهما. الجدولان ودالتا الربط
--    (link_staff_to_registry / link_student_to_registry) تبقى كما هي في
--    tools/add-national-registry.sql — الزرّان يعودان في دفعة الاستيراد.
--
-- ════════════════════════════════════════════════════════════════════════════
--  ٩د. §23 — وثائق «لا مانع»: نقل الطالب بين مدرستين
-- ════════════════════════════════════════════════════════════════════════════
--  الدوال الخمس (كلّها security definer + set search_path = public، وكلّها
--  revoke from public, anon ثم grant execute to authenticated):
--
--    ar_norm(text) → text                        تطبيع عربي: أإآٱ→ا، ى→ي، ة→ه
--    lookup_student_for_transfer(id, first, father, family) → table
--    issue_transfer_document(jsonb)              → transfer_documents
--    review_transfer_document(uuid, text, text)  → transfer_documents
--    cancel_transfer_document(uuid)              → transfer_documents
--
--  ⚠ **التنفيذ صفّان لا تحريك صفّ** — لا يُبسَّط لاحقاً بحسن نيّة.
--    عند الموافقة يُوسَم صفّ الطالب في المدرسة القديمة status='transferred'
--    (فيُشتقّ is_active=false بـ t_sync_student_is_active) ويُدرَج **صفّ جديد**
--    في المدرسة المستقبِلة بنفس الهوية. السبب: daily_student_attendance
--    والعلامات والجلاءات كلّها تشير إلى student_id — فتحريك school_id على
--    الصفّ نفسه يجعل سجلّ المدرسة القديمة يشير إلى طالب لم تعد تملك صلاحية
--    قراءته. والفهرس students_natid_school جزئي على is_active فلا يتعارض.
--    ولا يخالف ذلك t_lock_student_registry_mirrors: school_id/class_id/status
--    خارج حقول القفل. والمقعد (seat_number) لا يُنقل — تُسنده المدرسة الجديدة.
--
--  ⚠ **رقم الصادر المسحوب لا يُعاد استعماله**. العدّاد max(outgoing_number)+1
--    لكل (to_school_id, academic_year) تحت pg_advisory_xact_lock، والفهرس
--    الفريد شبكة أمان ثانية. وثيقة ملغاة (cancelled) تُبقي رقمها محجوزاً — كما
--    في دفتر الصادر الورقي، حيث يبقى تسلسل السجلّ صادقاً ولو شُطب سطر.
--
--  ⚠ **الإشعار داخل الدالة لا في trigger**. لا سياسة insert على الجدول، فكل
--    إدراج يمرّ بـ issue_transfer_document حتماً؛ إضافة trigger كانت ستُكرّر
--    الإشعار لا أكثر.
--
--  ⚠ **لقطات الورقة لا تُقرأ حيّة**. from_*/to_* من أسماء ومجمّع ومديرية ولغة
--    وجنس كلّها مخزّنة وقت الإصدار، لسببين: الطرف المُرسِل لا يملك صلاحية قراءة
--    classes/schools عند الطرف الآخر؛ والوثيقة الرسمية تُطبع بعد سنة كما صدرت
--    لا كما صارت الحال.
--
--  ⚠ الفرق بين نوعَي doc_type هو **تجاوز الصف** لا منهاج «الفئة ب»: regular
--    تُبقي الطالب في صفّه (يُفرض خادمياً بمقارنة ar_norm للصفّين)، و
--    exceptional وحدها تُغيّره. أثر دمج المستويات الوحيد هنا هو
--    classes.level_track على الشعبة.
--
--  ⚠ المُبادِر هو المدرسة **المستقبِلة**، والمدرسة الحالية تملك الموافقة/الرفض.
--    وهذا مصدر لبس متكرّر: تطبيق الوزارة يسمّي التبويب بمن أنشأ السجلّ
--    («صادر»)، بينما المستخدم يفكّر باتجاه الطالب — والاتجاهان متعاكسان هنا.
--    لذلك واجهة رُقِيّ تُسمّي بالاتجاه: «طلبات النقل الوافدة» (to_school_id =
--    مدرستي) و«المغادرة» (from_school_id = مدرستي)، ولا تستعمل «صادر/وارد»
--    إلا على الورقة المطبوعة حيث «رقم الصادر» صحيح فعلاً.

-- ════════════════════════════════════════════════════════════════════════════
--  ٩هـ. §24 — الاستيراد الجماعي من لوحة المديرية
-- ════════════════════════════════════════════════════════════════════════════
--  ثلاث دوال، كلّها security definer + set search_path = public، وكلّها
--  revoke from public, anon ثم grant execute to authenticated:
--
--    get_school_classes_for_directorate(uuid) → table
--    directorate_bulk_import_students(uuid school, uuid class, jsonb rows) → jsonb
--    directorate_bulk_import_staff(uuid school, jsonb rows) → jsonb
--
--  ⚠ **لا تُمنَح directorate_user صلاحية RLS مباشرة على students أو
--    staff_records أو classes** — ولا يجوز أن تُمنَح لاحقاً «تبسيطاً». الكتابة
--    من المديرية تمرّ بهذه الدوال وحدها لأنها تحصر الصلاحية بعملية الاستيراد
--    وتتحقّق من النطاق في جسمها؛ منحُ insert مباشر يفتح سطحاً دائماً لكل ميزة
--    مستقبلية في لوحة المديرية. الحارس نفسه حرفياً في الثلاث، ونفس نصّ الخطأ
--    'access denied' المستعمَل في get_school_staff_for_directorate.
--
--  ⚠ **الملخّص المُعاد** بنفس شكل bulkImportStudents في shared/db.js تماماً:
--    {"inserted": n, "duplicate": n, "failed": [{"line","name","error"}]}
--    فتعرضه الواجهة بنفس المنطق. التكرار (national_id موجود ونشط في المدرسة)
--    **يُتخطّى لا يَفشل** — حالة متوقّعة عند إعادة رفع ملفّ مُصحَّح.
--
--  ⚠ **كل سطر داخل begin/exception خاصّ به**: سطر فاسد يدخل failed ولا يُسقط
--    الدفعة. لا تُبسَّط الحلقة بإزالة المعالج.
--
--  ⚠ **staff_type صريح من عمود في الملفّ**، لا استنتاجاً من job_title كما في
--    النموذج الفردي (school/script.js: job_title='مستخدم' → worker). الاستنتاج
--    النصّي مقبول في واجهة يراها إنسان، وخطِر في استيراد صامت. انحراف مقصود.
--
--  ⚠ **مزامنة school_personnel داخل دالة الكادر نفسها** لا بخطوة عميل تالية:
--    كي لا تُمنَح المديرية صلاحية ثانية على جدول آخر، ولتبقى العملية معاملة
--    واحدة. المنطق مطابق لـ syncPersonnelFromStaffRecord: لا مرآة للمعلّمين
--    (هويّتهم في users)، وتبنّي صفٍّ يتيم بنفس الاسم **إن كان وحيداً** وإلا
--    إنشاء صفّ جديد — ربطُ الشخص الخطأ بكشف حضوره أسوأ من تركه غير مربوط.
--
--  ⚠ min(uuid) غير موجودة في Postgres — عدّ اليتامى ثم جلب المعرّف بـ limit 1
--    في استعلامين، لا select count(*), min(id) في واحد.
--
--  ⚠ **مفاتيح p_rows عقد بين الواجهة والدالة**: الدالة تقرأ v_row->>'first_name'
--    وأخواتها، فالواجهة (directorate/script.js: impBuildStudent/impBuildStaff)
--    تبني الحمولة بأسماء أعمدة القاعدة لا بأسماء حقول النموذج. أي تغيير في
--    اسم عمود هنا يلزمه تغيير مقابل هناك — الدالة لا تُخطئ، تكتب null صامتاً.
--
--  ⚠ **الصفّ يأتي وسيطاً (p_class_id) لا حقلاً في السطر**: الواجهة تُجمّع
--    الأسطر حسب الشعبة المُحلَّلة وتستدعي الدالة مرّة لكل شعبة، فيبقى سجلّ
--    التدقيق صفّاً لكل شعبة. تُرجِع الدالة أرقام أسطر داخل دفعتها هي (١، ٢، …)
--    فتُترجمها الواجهة إلى أرقام الأسطر في الملفّ الأصلي (impMergeSummary).

-- ════════════════════════════════════════════════════════════════════════════
--  ١٠. قوالب إدراج جاهزة (طلاب / موجهين)
-- ════════════════════════════════════════════════════════════════════════════
-- إدراج طالب:
--   insert into public.students
--     (id, full_name, class_id, school_id, seat_number, is_active, created_at)
--   values (gen_random_uuid(), 'الاسم', '<CLASS_ID>', '<SCHOOL_ID>', 1, true, now());
--
-- ربط موجه بمدرسة (بعد إنشائه في Auth ونسخ UUID) — upsert آمن:
--   insert into public.users (id, full_name, role, school_id, created_at)
--   values ('<AUTH_UUID>', 'الاسم', 'teacher', '<SCHOOL_ID>', now())
--   on conflict (id) do update
--     set full_name = excluded.full_name, role = excluded.role,
--         school_id = excluded.school_id;
--
-- تحقّق عدد الطلاب لكل صف:
--   select c.name, count(s.id) from public.classes c
--   left join public.students s on s.class_id = c.id
--   where c.school_id = '<SCHOOL_ID>' group by c.name order by c.name;

-- ════════════════════════════════════════════════════════════════════════════
--  ١١. §26 — نظام "الوحدات القابلة للتفعيل" (Module Permissions)
-- ════════════════════════════════════════════════════════════════════════════
-- طبقة عرض (UI rollout) فوق نظام الأدوار، **ليست** طبقة أمان: current_user_role()
-- وكل RLS policy قائمة لم يُلمَسا. إخفاء وحدة = إخفاء عناصرها في الواجهة فقط؛
-- استعلاماتها وRPCs الخاصة بها تبقى تعمل بلا أي تغيير — الغرض تفعيل تدريجي
-- (مدرسة/مديرية/وزارة) دون كسر أي علاقة بيانات.
--
--  جداول جديدة:
--    modules(key, name_ar, description_ar, category, is_core, sort_order)
--      — فهرس 14 وحدة أعمال. is_core=true (attendance-core, student-records,
--      sysadmin-console) محمية بـ trigger (enforce_core_module_enabled) يفرض
--      is_enabled=true دائماً بصرف النظر عمّا تكتبه الواجهة.
--    role_module_permissions(role_key, module_key, is_enabled, updated_by, updated_at)
--      — مصفوفة (دور × وحدة)، مفتاحها المركّب (role_key, module_key). قراءة
--      وكتابة مقصورتان على current_user_role() = 'ministry_user' (نفس شرط
--      الوصول إلى admin/ اليوم — لم يُشدَّد).
--
--  عمود جديد: users.permission_role (نص، اختياري) — مستوى إداري فرعي ضمن نفس
--  role التقني، القيم: teacher | school_admin | directorate_staff |
--  directorate_head | ministry_staff | minister. الحسابات القائمة هُجِّرت إلى
--  المستوى الأعلى (directorate_head / minister) في نفس migration الإضافة، فلا
--  فقدان وصول. الوزارة تُغيّر هذا الحقل لاحقاً من تبويب "المستخدمون" في admin/
--  لتمييز "الوزير" عن "موظف الوزارة"، و"مدير التربية" عن "موظف مديرية".
--
--  ⚠ ولي الأمر (parent) لا صفّ له في users (انظر §الأهل أعلاه) — لذلك
--    current_user_permission_role() يتحقّق أخيراً من وجوده في parent_links
--    قبل أن يُرجِع 'parent'. أي تعديل مستقبلي على مسار مصادقة الأهل (parent-auth)
--    يجب أن يُبقي هذا الافتراض صحيحاً (أن كل جلسة أهل ظاهرة في parent_links).
--
--  دالتان جديدتان (security definer + set search_path، بلا EXECUTE لـ anon):
--    current_user_permission_role() → text  — المستوى الفعّال للمستخدم الحالي.
--    get_my_module_permissions()    → setof text — مفاتيح الوحدات المفعّلة له.
--    كل بوّابة تستدعي الثانية بعد تسجيل الدخول (shared/permissions.js) وتُخفي
--    كل عنصر DOM يحمل data-module لمفتاح غائب عن النتيجة.
--
--  الحزمة الأولى (مفعّلة بحسب ملاءمة الدور): attendance-core, student-records,
--  school-requests, emergency-reports, analytics-dashboards, notifications,
--  sysadmin-console. المراحل التالية (مخفية للجميع في seed §26.8، تُفعَّل من
--  لوحة admin/ دون أي نشر جديد): staff-hr, grades-reportcards,
--  official-statement, year-end-clearance, transfer-noc, parent-portal,
--  national-registry.
