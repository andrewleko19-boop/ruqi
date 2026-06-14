-- ════════════════════════════════════════════════════════════════════════════
--  إصلاح شامل لبوابة ولي الأمر — RLS + سياسات الدرجات والأعذار والعطل
-- ════════════════════════════════════════════════════════════════════════════
--
-- المشكلة الجذرية:
--   current_user_is_parent() كانت تقرأ الدور من public.users — وأولياء الأمور
--   غير موجودين هناك (قيد chk_role_school يمنعهم)، فتُعيد false دائماً
--   وتحجب الدرجات والغيابات والأعذار والعطل عن ولي الأمر تماماً.
--
-- الحل الجذري:
--   إعادة تعريف current_user_is_parent() لتعتمد على بريد auth.users
--   (النمط: {phone}@parent.nsams.local) بدلاً من public.users.
--   هذا وحده يُصلح جميع السياسات المعتمدة عليها دفعةً واحدة.
--
-- يُضاف أيضاً:
--   • سياسات قراءة subjects + subject_components (للـ JOIN في استعلام الدرجات)
--   • ضمان وجود authenticated_read_holidays على school_holidays
--   • ضمان وجود دلو excuse-photos مع سياسة رفع الصور
--
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّل في: Supabase → SQL Editor → Run
-- ════════════════════════════════════════════════════════════════════════════

-- 1. إعادة تعريف current_user_is_parent() بالنمط الصحيح
create or replace function public.current_user_is_parent()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and email like '%@parent.nsams.local'
  )
$$;

grant execute on function public.current_user_is_parent() to authenticated;

-- 2. سياسات parent_links و students (تطابق ما طُبّق سابقاً — idempotent)
drop policy if exists parent_read_own_links on public.parent_links;
create policy parent_read_own_links
  on public.parent_links
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists parent_read_linked_students on public.students;
create policy parent_read_linked_students
  on public.students
  for select
  to authenticated
  using (
    exists (
      select 1 from public.parent_links pl
      where pl.student_id = students.id
        and pl.user_id    = auth.uid()
    )
  );

-- 3. سياسات subjects و subject_components (لازمة لـ JOIN في استعلام الدرجات)
drop policy if exists parent_read_subjects on public.subjects;
create policy parent_read_subjects
  on public.subjects
  for select
  to authenticated
  using (
    current_user_is_parent()
    and exists (
      select 1
        from public.parent_links pl
        join public.students s on s.id = pl.student_id
       where pl.user_id    = auth.uid()
         and s.school_id   = subjects.school_id
    )
  );

drop policy if exists parent_read_components on public.subject_components;
create policy parent_read_components
  on public.subject_components
  for select
  to authenticated
  using (
    current_user_is_parent()
    and exists (
      select 1
        from public.subjects sub
        join public.parent_links pl on true
        join public.students s on s.id = pl.student_id
       where sub.id          = subject_components.subject_id
         and pl.user_id      = auth.uid()
         and s.school_id     = sub.school_id
    )
  );

-- 4. العطل الرسمية — ضمان وجود السياسة
drop policy if exists authenticated_read_holidays on public.school_holidays;
create policy authenticated_read_holidays
  on public.school_holidays
  for select
  to authenticated
  using (true);

-- 5. دلو الصور — ضمان الوجود والسياسات
insert into storage.buckets (id, name, public)
values ('excuse-photos', 'excuse-photos', true)
on conflict (id) do update set public = true;

drop policy if exists parent_upload_excuse_photos on storage.objects;
create policy parent_upload_excuse_photos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'excuse-photos'
    and current_user_is_parent()
  );

-- 6. تحقق — يجب أن تُعيد هذه السياسات صفوفاً لولي الأمر عند التشغيل
--    (تُشغَّل منفصلة مع begin/set/rollback في التشخيص اليدوي)
select
  polname,
  polcmd,
  polroles::text
from pg_policy
where polrelid in (
  'public.parent_links'::regclass,
  'public.students'::regclass,
  'public.subjects'::regclass,
  'public.subject_components'::regclass,
  'public.school_holidays'::regclass
)
order by polrelid::text, polname;
