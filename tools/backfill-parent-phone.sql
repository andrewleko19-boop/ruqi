-- ════════════════════════════════════════════════════════════════════════════
--  Backfill students.parent_phone from students.contact_phone
-- ════════════════════════════════════════════════════════════════════════════
-- Why: the school panel historically saved the guardian phone only into
-- contact_phone, but the parent portal (parent-auth edge function) links a
-- student to a parent by matching students.parent_phone. So existing students
-- have parent_phone = NULL and their guardians get
-- "لم يُعثر على طلاب مرتبطين بهذا الرقم" on login.
--
-- This copies contact_phone → parent_phone (normalised to +9639… to match the
-- format parent-auth queries) for every student that still has no parent_phone.
-- Safe to run multiple times (only touches rows where parent_phone IS NULL).
--
-- Run in: Supabase → SQL Editor.

update public.students s
set parent_phone = v.normalized
from (
  select id,
    case
      when cp like '00963%' then '+963' || substr(cp, 6)
      when cp like '0963%'  then '+963' || substr(cp, 5)
      when cp like '+963%'  then cp
      when cp like '963%'   then '+'    || cp
      when cp like '09%'    then '+963' || substr(cp, 2)
      else cp
    end as normalized
  from (
    select id, regexp_replace(btrim(contact_phone), '[\s\-\(\)]', '', 'g') as cp
    from public.students
    where parent_phone is null
      and contact_phone is not null
      and btrim(contact_phone) <> ''
  ) t
) v
where s.id = v.id;

-- Verify the result:
--   select full_name, contact_phone, parent_phone from public.students
--   where parent_phone is not null order by updated_at desc limit 20;
