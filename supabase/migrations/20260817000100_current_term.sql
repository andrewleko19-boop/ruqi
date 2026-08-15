-- ════════════════════════════════════════════════════════════════════════════
--  «الفصل الحاليّ»: تختاره الوزارة يدوياً — لا يُشتقّ من التاريخ.
--
--  اليوم يُشتقّ من `month >= 9 ? 's1' : 's2'` في shared/db.js وأكثر من موضع.
--  والسنة الدراسية السورية لا تتّبع هذا القالب حرفياً — بدايةُ العام تتقدّم
--  وتتأخّر أسابيع بقرارٍ وزاريّ، وقد يمتدّ الفصل الثاني إلى تموز، وقد تُضاف
--  دورة تعويضية. فحين يُدخل مديرٌ ترقينَ قيدٍ في نهاية آب يُسجَّل على
--  «الفصل الأول» لأنّ اليوم الحاليّ 30/8، بينما نيّتُه الفصل الثاني المنقضي.
--
--  الحلّ صفٌّ واحدٌ في `app_settings` تضبطه الوزارة، ودالّة `current_term()`
--  تقرأه. المدرسة والمعلّم والمديرية تقرأ منها لا من التاريخ — والمشرف يقلبه
--  حين تُصدر الوزارة قرارَ الفصل الجديد.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.app_settings (
  id           boolean primary key default true,
  current_term text    not null default 's1'
    check (current_term in ('s1', 's2', 'summer')),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.users(id),
  constraint app_settings_single check (id)
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- الكلّ يقرأ (يحتاجه كلُّ من يكتب حقلاً موسوماً بفصل)، والوزارة وحدها تكتب.
drop policy if exists as_read on public.app_settings;
create policy as_read on public.app_settings
  for select to authenticated using (true);

drop policy if exists as_ministry_write on public.app_settings;
create policy as_ministry_write on public.app_settings
  for update to authenticated
  using      (public.current_user_role() = 'ministry_user'::public.user_role)
  with check (public.current_user_role() = 'ministry_user'::public.user_role);

grant select, update on public.app_settings to authenticated;

-- دالّةٌ مساعدة: تُعيد 's1' افتراضاً إن غاب الصفّ (لا ينبغي أن يغيب لكنّها
-- حمايةٌ من الحالات الحدّية بعد استيرادٍ ناقص). SECURITY DEFINER كي تُنادى
-- من دوالٍّ أخرى لا تملك حقّ القراءة (نظرياً كلٌّ يقرأ، لكنّها آمنة أكثر).
create or replace function public.current_term()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select current_term from public.app_settings limit 1),
    's1'
  )
$$;

alter function public.current_term() owner to postgres;
revoke all on function public.current_term() from public, anon;
grant execute on function public.current_term() to authenticated, service_role;

notify pgrst, 'reload schema';
