-- ════════════════════════════════════════════════════════════════════════════
--  غيابُ الكادر: أسماءٌ تُكتب كلَّ يوم ثمّ تُرمى.
--
--  في البيان اليوميّ حقلٌ حرّ «اسم المعلم الغائب» يُضاف منه اسمٌ بعد اسم. ثمّ
--  يُرسَل البيان فلا يُحفظ من ذلك حرفٌ واحد: daily_attendance فيها
--  teachers_absent (عدد) وليس فيها مَن. فالمدير يكتب الأسماء كلَّ صباحٍ طولَ
--  العام، ولا يستطيع أحدٌ أن يسأل: «كم يوماً غاب فلان؟» — لا هو، ولا المديرية،
--  ولا المعلّمُ نفسه. عملٌ يوميّ يُبذل ويُمحى.
--
--  وأثرُ ذلك أبعد من تقرير: الغيابُ أساسُ الحسم والمساءلة، فبقاؤه بلا سجلّ
--  يعني إمّا ألّا يُحاسَب أحد، أو أن يُحاسَب بذاكرةٍ لا بوثيقة.
--
--  والحقلُ الحرّ نفسه علّةٌ ثانية: «سناء وليو» و«سناء مصطفى وليو» و«سناء
--  مصطفي وليو» ثلاثةُ أشخاصٍ في أيّ عدٍّ لاحق. فالاسمُ يُختار من سجلّ الكادر
--  لا يُكتب، ويُحفظ معه معرّفُه — والاسمُ النصّيّ لقطةٌ للعرض لا مفتاحٌ للعدّ.
--
--  ومن الاختيار يُشتقّ التصنيف: staff_records.staff_type يقول أهو تدريسيٌّ أم
--  إداريٌّ أم عامل، فيُملأ العدّادُ الصحيح تلقائياً بدل أن يعدَّ المديرُ بيده
--  ثمّ يخطئ.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.daily_absent_staff (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  date       date not null,
  staff_id   uuid references public.staff_records(id) on delete set null,
  -- لقطةُ الاسم: تبقى مقروءةً لو حُذف سجلّ الكادر لاحقاً. سجلُّ غيابٍ يفقد
  -- أسماءه بحذف موظّفٍ ليس سجلّاً.
  staff_name text not null,
  -- الفئة كما كانت يومَ الغياب: نقلُ موظّفٍ من الإدارة إلى التدريس لا يُعيد
  -- كتابة تاريخِ غيابه.
  kind       text not null check (kind in ('teaching', 'admin', 'worker')),
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

-- شخصٌ واحدٌ لا يغيب مرّتين في يوم. جزئيٌّ لأنّ staff_id قد يكون فارغاً
-- (اسمٌ حرّ لكادرٍ لم يُسجَّل بعد) فلا يجوز أن يمنع الفارغُ الفارغَ.
create unique index if not exists daily_absent_staff_unique
  on public.daily_absent_staff (school_id, date, staff_id)
  where staff_id is not null;

create index if not exists idx_daily_absent_school_date
  on public.daily_absent_staff (school_id, date);
create index if not exists idx_daily_absent_staff
  on public.daily_absent_staff (staff_id, date);

alter table public.daily_absent_staff enable row level security;

-- مديرُ المدرسة يكتب ويقرأ في مدرسته.
drop policy if exists das_school_admin on public.daily_absent_staff;
create policy das_school_admin on public.daily_absent_staff
  for all to authenticated
  using      (school_id = public.current_user_school_id()
              and public.current_user_role() = 'school_admin'::public.user_role)
  with check (school_id = public.current_user_school_id()
              and public.current_user_role() = 'school_admin'::public.user_role);

-- المديرية تقرأ مدارسها، والوزارة الكلّ. القراءة فقط: الغيابُ واقعةٌ تسجّلها
-- المدرسة، ولا يُملى عليها من فوق.
drop policy if exists das_oversight_read on public.daily_absent_staff;
create policy das_oversight_read on public.daily_absent_staff
  for select to authenticated using (
    exists (
      select 1 from public.schools s
       where s.id = daily_absent_staff.school_id
         and ( public.current_user_role() = 'ministry_user'::public.user_role
            or ( public.current_user_role() = 'directorate_user'::public.user_role
                 and s.directorate_id = public.current_user_directorate_id() ) )
    )
  );

/* وصاحبُ الغياب يقرأ غيابَه. النطاق من my_staff_record_ids() — الدالّة نفسها
   التي أصلحت «إجازاتي»: تعبيرُ USING لا يجوز أن يستعلم من staff_records،
   فسياستُه لمدير المدرسة وحده فيُقيَّم كاذباً دائماً. */
drop policy if exists das_own_read on public.daily_absent_staff;
create policy das_own_read on public.daily_absent_staff
  for select to authenticated
  using (staff_id in (select public.my_staff_record_ids()));

grant select, insert, update, delete on public.daily_absent_staff to authenticated;

comment on table public.daily_absent_staff is
  'مَن غاب من الكادر في كلّ يوم. كان يُكتب في البيان اليوميّ ولا يُحفظ إلّا عدداً.';


-- ── سجلّ الغياب: صفٌّ لكلّ شخصٍ بعدد أيّامه ─────────────────────────────────
create or replace function public.get_staff_absence_register(
  p_school_id uuid default null,
  p_month     smallint default null,
  p_year      smallint default null
)
returns table (
  staff_id   uuid,
  staff_name text,
  kind       text,
  days       integer,
  last_date  date
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role   text;
  v_school uuid;
  v_dir    uuid;
begin
  select u.role::text, u.school_id, u.directorate_id
    into v_role, v_school, v_dir
  from public.users u where u.id = auth.uid() and u.is_active;

  if v_role not in ('school_admin', 'directorate_user', 'ministry_user') then
    raise exception 'غير مصرّح: سجلّ الغياب للمدرسة أو المديرية أو الوزارة';
  end if;

  return query
  select d.staff_id,
         -- أحدثُ لقطةِ اسمٍ للشخص: تصحيحُ إملاءٍ لاحق يظهر في السجلّ كلِّه.
         (array_agg(d.staff_name order by d.date desc))[1] as staff_name,
         (array_agg(d.kind       order by d.date desc))[1] as kind,
         count(*)::int  as days,
         max(d.date)    as last_date
    from public.daily_absent_staff d
    join public.schools s on s.id = d.school_id
   where (p_month is null or extract(month from d.date) = p_month)
     and (p_year  is null or extract(year  from d.date) = p_year)
     -- النطاق من الدور لا من المعامل: تمريرُ مدرسةٍ أجنبية يُفرغ لا يوسّع.
     and case v_role
           when 'school_admin'     then d.school_id = v_school
           when 'directorate_user' then s.directorate_id = v_dir
           else true
         end
     and (p_school_id is null or d.school_id = p_school_id)
   group by d.staff_id
   order by count(*) desc, 2;
end; $$;

alter function public.get_staff_absence_register(uuid, smallint, smallint) owner to postgres;
revoke all on function public.get_staff_absence_register(uuid, smallint, smallint) from public, anon;
grant execute on function public.get_staff_absence_register(uuid, smallint, smallint)
  to authenticated, service_role;

comment on function public.get_staff_absence_register(uuid, smallint, smallint) is
  'كم يوماً غاب كلُّ فردٍ من الكادر. النطاق يُشتقّ من دور المستدعي.';

notify pgrst, 'reload schema';
