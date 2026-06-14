-- ════════════════════════════════════════════════════════════════════════════
--  إصلاح جذري لبوابة ولي الأمر — ربط الطلاب بأولياء أمورهم
-- ════════════════════════════════════════════════════════════════════════════
-- المشاكل المعالَجة:
--  1. عمود students.parent_phone لم يكن موجوداً → استعلام parent-auth يفشل
--     بصمت فلا تُبنى parent_links.
--  2. الربط كان يحدث فقط لحظة التحقق من OTP — أي طالب يُضاف لاحقاً، أو أي
--     خلل لحظة التحقق، يترك ولي الأمر بلا ربط ودون وسيلة استرجاع.
--
-- الحل: عمود parent_phone + تعبئته + دالة parent_sync_links() تُعيد بناء
-- الروابط عند كل فتح للتطبيق اعتماداً على هاتف ولي الأمر المستخرَج من بريد
-- المصادقة (المصدر الأوثق).
--
-- شغّل هذا الملف مرة واحدة في: Supabase → SQL Editor → Run
-- آمن للتشغيل أكثر من مرة (idempotent).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. العمود + index
alter table public.students
  add column if not exists parent_phone text;

create index if not exists students_parent_phone_idx
  on public.students (parent_phone)
  where parent_phone is not null;

-- 2. تعبئة parent_phone من contact_phone (بتطبيع الصيغة إلى +9639…)
update public.students s
set parent_phone = v.normalized
from (
  select id,
    case
      when cp ~ '^00963' then '+963' || substr(cp, 6)
      when cp ~ '^0963'  then '+963' || substr(cp, 5)
      when cp ~ '^\+963' then cp
      when cp ~ '^963'   then '+'    || cp
      when cp ~ '^09'    then '+963' || substr(cp, 2)
      else cp
    end as normalized
  from (
    select id,
      regexp_replace(btrim(contact_phone), '[\s\-\(\)]', '', 'g') as cp
    from public.students
    where parent_phone is null
      and contact_phone is not null
      and btrim(contact_phone) <> ''
  ) t
  where cp <> ''
) v
where s.id = v.id;

-- 3. دالة الربط عند القراءة (SECURITY DEFINER)
--    تستخرج هاتف ولي الأمر من بريد المصادقة {phone}@parent.nsams.local
--    وتُطابقه على students.parent_phone (صيغتا +9639… و 09…) ثم تبني الروابط.
create or replace function public.parent_sync_links()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  myemail text;
  myphone text;   -- +9639…
  mylocal text;   -- 09…
  n integer;
begin
  select email into myemail from auth.users where id = auth.uid();
  if myemail is null or myemail not like '%@parent.nsams.local' then
    return 0;
  end if;

  myphone := split_part(myemail, '@', 1);                       -- +9639XXXXXXXX
  mylocal := case when myphone ~ '^\+9639'
                  then '0' || substr(myphone, 5)                -- 09XXXXXXXX
                  else myphone end;

  insert into public.parent_links (user_id, student_id)
  select auth.uid(), s.id
    from public.students s
   where s.is_active = true
     and s.parent_phone is not null
     and (s.parent_phone = myphone or s.parent_phone = mylocal)
  on conflict (user_id, student_id) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.parent_sync_links() to authenticated;

-- 4. تحقق
select
  count(*) filter (where parent_phone is not null) as "طلاب لديهم parent_phone",
  count(*) filter (where parent_phone is null and contact_phone is not null) as "ناقص",
  count(*) filter (where contact_phone is null) as "بلا هاتف"
from public.students
where is_active = true;
