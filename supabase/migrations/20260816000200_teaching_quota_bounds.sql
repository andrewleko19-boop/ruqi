-- ════════════════════════════════════════════════════════════════════════════
--  حدُّ النصاب: رقمان تضبطهما الوزارة، وللمدرسة أن تخالفهما بقرارٍ مكتوب.
--
--  «عدد الساعات» في سجلّ الكادر كان حقلاً مفتوحاً بلا حدٍّ إلا max="40" في
--  الـ HTML — لا يعرف كاتبُه ما المسموح، ولا يمنعه شيءٌ من كتابة ٣ أو ٣٩. ثمّ
--  يُبنى عليه تنبيهُ التجاوز وتقاريرُ المديرية ونصابُ القطر كلِّه.
--
--  والحدّ ليس ثابتاً في الشيفرة عمداً: النصاب القانونيّ يتغيّر بقرارٍ وزاريّ،
--  وتغييرُ رقمٍ في الشيفرة يعني نشراً جديداً لكلّ مدرسة في القطر. فمكانُه قاعدةُ
--  البيانات، على منوال grade_pass_rules الذي سبقه.
--
--  وطبقتان لا واحدة: حدٌّ وطنيٌّ تضبطه الوزارة، وتجاوزٌ اختياريّ لكلّ مدرسة —
--  فمدرسةٌ ذات ظرفٍ خاصّ (نقصُ كادر، شعبتان اثنتان) لا تُجبَر على رقمٍ لا
--  يناسبها ولا تُترك بلا حدٍّ ألبتّة. والفارغ يعني «اتبع الوطنيّ» لا «بلا حدّ».
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.teaching_quota_bounds (
  id         boolean primary key default true,     -- صفٌّ واحدٌ أبداً
  min_hours  integer not null default 12,
  max_hours  integer not null default 24,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  constraint teaching_quota_bounds_single check (id),
  constraint teaching_quota_bounds_range  check (min_hours >= 0 and max_hours >= min_hours)
);

insert into public.teaching_quota_bounds (id) values (true) on conflict (id) do nothing;

alter table public.teaching_quota_bounds enable row level security;

-- الكلّ يقرأ (كلُّ مدرسةٍ تحتاج الحدَّ لتتحقّق من مدخلاتها)، والوزارة وحدها تكتب.
drop policy if exists tqb_read on public.teaching_quota_bounds;
create policy tqb_read on public.teaching_quota_bounds
  for select to authenticated using (true);

drop policy if exists tqb_ministry_write on public.teaching_quota_bounds;
create policy tqb_ministry_write on public.teaching_quota_bounds
  for update to authenticated
  using      (public.current_user_role() = 'ministry_user'::public.user_role)
  with check (public.current_user_role() = 'ministry_user'::public.user_role);

grant select, update on public.teaching_quota_bounds to authenticated;

-- تجاوزُ المدرسة: فارغٌ = اتبع الوطنيّ. لا صفر، ولا نسخٌ للقيمة الوطنية —
-- نسخُها يعني أنّ تغييرَ الوزارة لا يصل مدرسةً نسختْه، وهو ما لا يُرى إلا بعد
-- سنة.
alter table public.schools
  add column if not exists quota_min_hours integer,
  add column if not exists quota_max_hours integer;

do $$ begin
  alter table public.schools
    add constraint schools_quota_range_chk
    check (quota_min_hours is null or quota_max_hours is null
           or quota_max_hours >= quota_min_hours);
exception when duplicate_object then null; end $$;

comment on column public.schools.quota_min_hours is
  'تجاوزٌ اختياريّ للحدّ الأدنى الوطنيّ. فارغ = اتبع teaching_quota_bounds.';
comment on column public.schools.quota_max_hours is
  'تجاوزٌ اختياريّ للحدّ الأعلى الوطنيّ. فارغ = اتبع teaching_quota_bounds.';

notify pgrst, 'reload schema';
