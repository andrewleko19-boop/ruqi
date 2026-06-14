-- ════════════════════════════════════════════════════════════════════════════
--  Fix parent portal: إضافة عمود parent_phone وتعبئته من contact_phone
-- ════════════════════════════════════════════════════════════════════════════
-- المشكلة الجذرية: عمود parent_phone لم يكن موجوداً في جدول students،
-- لذا كانت دالة parent-auth تبحث فيه فتعود بلا نتائج بصمت →
-- لا تُنشأ parent_links → يظهر «لم يُعثر على طلاب مرتبطين بهذا الرقم».
--
-- شغّل هذا السكريبت مرة واحدة في: Supabase → SQL Editor → Run
-- آمن للتشغيل أكثر من مرة (IF NOT EXISTS + WHERE parent_phone IS NULL)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. إضافة العمود إن لم يكن موجوداً
alter table public.students
  add column if not exists parent_phone text;

-- 2. Index لتسريع بحث parent-auth
create index if not exists students_parent_phone_idx
  on public.students (parent_phone)
  where parent_phone is not null;

-- 3. تعبئة parent_phone من contact_phone (بتطبيع الصيغة إلى +9639…)
--    يؤثر فقط على الصفوف التي parent_phone فارغ و contact_phone موجود
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

-- 4. تحقق من النتائج
select
  count(*) filter (where parent_phone is not null) as "طلاب مرتبطون",
  count(*) filter (where parent_phone is null and contact_phone is not null) as "ناقص تطبيع",
  count(*) filter (where contact_phone is null) as "بلا هاتف"
from public.students
where is_active = true;
