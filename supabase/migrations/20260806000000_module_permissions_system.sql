-- ════════════════════════════════════════════════════════════════════════════
--  نظام "الوحدات القابلة للتفعيل" (Module Permissions) — تفعيل تدريجي بالدور.
--
--  هذا Migration إضافي بالكامل: لا يعدّل أي RLS policy قائمة، ولا يحذف/يغيّر أي
--  عمود أو دالة أو صلاحية موجودة. الهدف طبقة عرض (UI rollout) فقط — الأمن
--  الحقيقي (current_user_role() + RLS) لا يتغيّر إطلاقاً. إخفاء وحدة يعني إخفاء
--  زرّها/تبويبها في الواجهة، لا حجب استعلاماتها أو RPCs الخاصة بها في الخلفية.
--
--  الجداول الجديدة:
--    modules                 — فهرس "وحدات الأعمال" القابلة للتفعيل/الإخفاء.
--    role_module_permissions — مصفوفة (دور × وحدة) تحدّد ما يظهر لكل دور.
--
--  العمود الجديد:
--    users.permission_role   — مستوى إداري فرعي اختياري ضمن نفس الدور التقني
--                              (RLS)، يفصل مثلاً "الوزير" عن "موظف الوزارة" ضمن
--                              ministry_user، أو "مدير التربية" عن "موظف مديرية"
--                              ضمن directorate_user. الحسابات الحالية تُهجَّر
--                              تلقائياً إلى المستوى الأعلى (minister/
--                              directorate_head) كي لا يفقد أحد وصولاً كان يملكه.
--
--  الدوال الجديدة (SECURITY DEFINER، بنمط current_user_role() القائم):
--    current_user_permission_role() — يحلّ المستوى الفعّال للمستخدم الحالي،
--                                      بما فيهم ولي الأمر (لا صف له في users).
--    get_my_module_permissions()    — يُرجع مفاتيح الوحدات المفعّلة له فقط.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. فهرس الوحدات ──────────────────────────────────────────────────────────
create table if not exists public.modules (
  key           text primary key,
  name_ar       text not null,
  description_ar text not null default '',
  category      text not null default 'عام',
  is_core       boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.modules enable row level security;

drop policy if exists modules_ministry_all on public.modules;
create policy modules_ministry_all on public.modules
  for all to authenticated
  using      (public.current_user_role() = 'ministry_user'::public.user_role)
  with check (public.current_user_role() = 'ministry_user'::public.user_role);

grant select, insert, update, delete on public.modules to authenticated;

-- ── 2. مصفوفة الأدوار × الوحدات ──────────────────────────────────────────────
create table if not exists public.role_module_permissions (
  role_key    text not null
    check (role_key in (
      'teacher', 'school_admin', 'directorate_staff', 'directorate_head',
      'ministry_staff', 'minister', 'parent'
    )),
  module_key  text not null references public.modules(key) on delete cascade,
  is_enabled  boolean not null default false,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (role_key, module_key)
);

alter table public.role_module_permissions enable row level security;

drop policy if exists rmp_ministry_all on public.role_module_permissions;
create policy rmp_ministry_all on public.role_module_permissions
  for all to authenticated
  using      (public.current_user_role() = 'ministry_user'::public.user_role)
  with check (public.current_user_role() = 'ministry_user'::public.user_role);

grant select, insert, update, delete on public.role_module_permissions to authenticated;

-- وحدة أساسية (is_core) لا يجوز تعطيلها لأي دور مسجَّل لها — يفرضها حتى لو
-- أرسلت الواجهة is_enabled=false (مثلاً بسبب خلل في لوحة التحكم).
create or replace function public.enforce_core_module_enabled()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.modules m where m.key = new.module_key and m.is_core) then
    new.is_enabled := true;
  end if;
  return new;
end;
$$;

drop trigger if exists role_module_permissions_core_guard on public.role_module_permissions;
create trigger role_module_permissions_core_guard
  before insert or update on public.role_module_permissions
  for each row execute function public.enforce_core_module_enabled();

-- ── 3. عمود المستوى الإداري الفرعي ───────────────────────────────────────────
alter table public.users add column if not exists permission_role text
  check (permission_role in (
    'teacher', 'school_admin', 'directorate_staff', 'directorate_head',
    'ministry_staff', 'minister'
  ));

-- تهجير الحسابات القائمة إلى المستوى الأعلى (لا فقدان وصول فور الترحيل).
update public.users set permission_role = 'teacher'
  where role = 'teacher'::public.user_role and permission_role is null;
update public.users set permission_role = 'school_admin'
  where role = 'school_admin'::public.user_role and permission_role is null;
update public.users set permission_role = 'directorate_head'
  where role = 'directorate_user'::public.user_role and permission_role is null;
update public.users set permission_role = 'minister'
  where role = 'ministry_user'::public.user_role and permission_role is null;

-- ── 4. دالة حلّ المستوى الفعّال (تُعالج ولي الأمر خصيصاً — لا صف له في users) ──
create or replace function public.current_user_permission_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.permission_role from public.users u where u.id = auth.uid()),
    (select u.role::text      from public.users u where u.id = auth.uid()),
    case when exists (select 1 from public.parent_links pl where pl.user_id = auth.uid())
         then 'parent' end
  );
$$;

revoke all on function public.current_user_permission_role() from public, anon;
grant execute on function public.current_user_permission_role() to authenticated;

-- ── 5. دالة الوحدات المفعّلة للمستخدم الحالي ─────────────────────────────────
create or replace function public.get_my_module_permissions()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rmp.module_key
  from public.role_module_permissions rmp
  where rmp.role_key = public.current_user_permission_role()
    and rmp.is_enabled = true;
$$;

revoke all on function public.get_my_module_permissions() from public, anon;
grant execute on function public.get_my_module_permissions() to authenticated;

-- ── 6. تحديث updated_by/updated_at تلقائياً عند كل تبديل من لوحة التحكم ──────
create or replace function public.touch_role_module_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists role_module_permissions_touch on public.role_module_permissions;
create trigger role_module_permissions_touch
  before insert or update on public.role_module_permissions
  for each row execute function public.touch_role_module_permission();

-- ── 7. تعبئة فهرس الوحدات (14 وحدة أعمال) ────────────────────────────────────
insert into public.modules (key, name_ar, description_ar, category, is_core, sort_order) values
  ('attendance-core',      'الحضور والغياب اليومي',        'إدخال حضور المعلمين والطلاب وعرضه — الميزة الأساسية للنظام.', 'التشغيل اليومي', true,  1),
  ('student-records',      'السجل المدرسي (الطلاب والصفوف)', 'إدارة الطلاب والصفوف والتوزيع، ومؤشر التسرّب المبكر.',          'التشغيل اليومي', true,  2),
  ('school-requests',      'الطلبات الإدارية (مدرسة↔مديرية)', 'طلبات إضافة صفّ/طالب أو تصحيح بيانات وموافقات المديرية.',      'التشغيل اليومي', false, 3),
  ('emergency-reports',    'البلاغات والحالات الطارئة',     'رفع بلاغ طارئ من المدرسة ومتابعته من المديرية.',                'التشغيل اليومي', false, 4),
  ('analytics-dashboards', 'التقارير والتحليلات',           'لوحات الاتجاهات والالتزام والترتيب على مستوى المديرية والوزارة.', 'التقارير',      false, 5),
  ('notifications',        'الإشعارات',                     'تذكيرات الحضور وتنبيهات الدفع (Push).',                        'التقارير',       false, 6),
  ('staff-hr',             'الكادر والسجل الوظيفي',         'دوام الكادر، سجلّات الموارد البشرية، الإجازات والتكليفات.',      'الموارد البشرية', false, 7),
  ('grades-reportcards',   'الدرجات وبطاقات التقييم',       'فهرس المواد، الدرجات، السلوك، درجات الرأفة، بطاقات النجاح.',     'الشؤون الأكاديمية', false, 8),
  ('official-statement',   'البيان الشهري الرسمي',          'البيان الشهري الحكومي بأقسامه العشرة، من المدرسة حتى الوزارة.',  'الشؤون الرسمية', false, 9),
  ('year-end-clearance',   'الجلاءات (نهاية العام)',        'مسار جلاء نهاية العام: مدرسة → مديرية → وزارة.',                'الشؤون الرسمية', false, 10),
  ('transfer-noc',         'وثائق النقل و"لا مانع"',        'إصدار وثائق نقل الطلاب بين المدارس والتحقق العام منها.',        'الشؤون الرسمية', false, 11),
  ('parent-portal',        'بوابة ولي الأمر',               'تفعيل بوابة ولي الأمر كاملة (الحضور، الدرجات، التقويم).',       'بوابات المستخدمين', false, 12),
  ('national-registry',    'الربط بالسجل الوطني',           'ربط الطلاب والكادر بالسجل الوطني الموحّد (ميزة خلفية بانتظار التفعيل).', 'الشؤون الرسمية', false, 13),
  ('sysadmin-console',     'لوحة الإدارة المركزية',         'إدارة المدارس والمستخدمين والمرجعيات وسجل التدقيق (هذه اللوحة نفسها).', 'النظام', true, 14)
on conflict (key) do nothing;

-- ── 8. تعبئة مصفوفة الأدوار × الوحدات ────────────────────────────────────────
-- الحزمة الأولى (attendance-core .. sysadmin-console بحسب الملاءمة): مفعّلة.
-- المراحل التالية (staff-hr .. national-registry): مخفية للجميع افتراضياً — أي
-- دور مذكور هنا "غير مفعَّل الآن" يمكن أن تفعِّله الوزارة فوراً من لوحة التحكم
-- دون أي نشر جديد؛ الصفوف موجودة مسبقاً (dense seed) لتكون المصفوفة شفافة
-- وقابلة للمراجعة بالكامل من اليوم الأول.
insert into public.role_module_permissions (role_key, module_key, is_enabled) values
  -- attendance-core: الكل (بما فيهم ولي الأمر تحضيراً لتفعيل بوابته لاحقاً)
  ('teacher',            'attendance-core', true),
  ('school_admin',       'attendance-core', true),
  ('directorate_staff',  'attendance-core', true),
  ('directorate_head',   'attendance-core', true),
  ('ministry_staff',     'attendance-core', true),
  ('minister',           'attendance-core', true),
  ('parent',             'attendance-core', true),

  -- student-records: الجميع إلا ولي الأمر (له عرضه الخاص بالطفل، لا حاجة لوحدة الإدارة)
  ('teacher',            'student-records', true),
  ('school_admin',       'student-records', true),
  ('directorate_staff',  'student-records', true),
  ('directorate_head',   'student-records', true),
  ('ministry_staff',     'student-records', true),
  ('minister',           'student-records', true),
  ('parent',             'student-records', false),

  -- school-requests: مدرسة ومديرية فقط
  ('teacher',            'school-requests', false),
  ('school_admin',       'school-requests', true),
  ('directorate_staff',  'school-requests', true),
  ('directorate_head',   'school-requests', true),
  ('ministry_staff',     'school-requests', false),
  ('minister',           'school-requests', false),
  ('parent',             'school-requests', false),

  -- emergency-reports: مدرسة/مديرية/وزارة (لا معلم، لا ولي أمر)
  ('teacher',            'emergency-reports', false),
  ('school_admin',       'emergency-reports', true),
  ('directorate_staff',  'emergency-reports', true),
  ('directorate_head',   'emergency-reports', true),
  ('ministry_staff',     'emergency-reports', true),
  ('minister',           'emergency-reports', true),
  ('parent',             'emergency-reports', false),

  -- analytics-dashboards: مدرسة/مديرية/وزارة
  ('teacher',            'analytics-dashboards', false),
  ('school_admin',       'analytics-dashboards', true),
  ('directorate_staff',  'analytics-dashboards', true),
  ('directorate_head',   'analytics-dashboards', true),
  ('ministry_staff',     'analytics-dashboards', true),
  ('minister',           'analytics-dashboards', true),
  ('parent',             'analytics-dashboards', false),

  -- notifications: الجميع
  ('teacher',            'notifications', true),
  ('school_admin',       'notifications', true),
  ('directorate_staff',  'notifications', true),
  ('directorate_head',   'notifications', true),
  ('ministry_staff',     'notifications', true),
  ('minister',           'notifications', true),
  ('parent',             'notifications', true),

  -- sysadmin-console: مستخدمو الوزارة فقط (دخول /admin/ نفسه لم يتغيّر: لا يزال ministry_user)
  ('teacher',            'sysadmin-console', false),
  ('school_admin',       'sysadmin-console', false),
  ('directorate_staff',  'sysadmin-console', false),
  ('directorate_head',   'sysadmin-console', false),
  ('ministry_staff',     'sysadmin-console', true),
  ('minister',           'sysadmin-console', true),
  ('parent',             'sysadmin-console', false),

  -- ── المراحل التالية: مخفية للجميع افتراضياً ──────────────────────────────
  ('teacher',            'staff-hr', false),
  ('school_admin',       'staff-hr', false),
  ('directorate_staff',  'staff-hr', false),
  ('directorate_head',   'staff-hr', false),
  ('ministry_staff',     'staff-hr', false),
  ('minister',           'staff-hr', false),
  ('parent',             'staff-hr', false),

  ('teacher',            'grades-reportcards', false),
  ('school_admin',       'grades-reportcards', false),
  ('directorate_staff',  'grades-reportcards', false),
  ('directorate_head',   'grades-reportcards', false),
  ('ministry_staff',     'grades-reportcards', false),
  ('minister',           'grades-reportcards', false),
  ('parent',             'grades-reportcards', false),

  ('teacher',            'official-statement', false),
  ('school_admin',       'official-statement', false),
  ('directorate_staff',  'official-statement', false),
  ('directorate_head',   'official-statement', false),
  ('ministry_staff',     'official-statement', false),
  ('minister',           'official-statement', false),
  ('parent',             'official-statement', false),

  ('teacher',            'year-end-clearance', false),
  ('school_admin',       'year-end-clearance', false),
  ('directorate_staff',  'year-end-clearance', false),
  ('directorate_head',   'year-end-clearance', false),
  ('ministry_staff',     'year-end-clearance', false),
  ('minister',           'year-end-clearance', false),
  ('parent',             'year-end-clearance', false),

  ('teacher',            'transfer-noc', false),
  ('school_admin',       'transfer-noc', false),
  ('directorate_staff',  'transfer-noc', false),
  ('directorate_head',   'transfer-noc', false),
  ('ministry_staff',     'transfer-noc', false),
  ('minister',           'transfer-noc', false),
  ('parent',             'transfer-noc', false),

  ('teacher',            'parent-portal', false),
  ('school_admin',       'parent-portal', false),
  ('directorate_staff',  'parent-portal', false),
  ('directorate_head',   'parent-portal', false),
  ('ministry_staff',     'parent-portal', false),
  ('minister',           'parent-portal', false),
  ('parent',             'parent-portal', false),

  ('teacher',            'national-registry', false),
  ('school_admin',       'national-registry', false),
  ('directorate_staff',  'national-registry', false),
  ('directorate_head',   'national-registry', false),
  ('ministry_staff',     'national-registry', false),
  ('minister',           'national-registry', false),
  ('parent',             'national-registry', false)
on conflict (role_key, module_key) do nothing;
