-- ════════════════════════════════════════════════════════════════════════════
--  إصلاح جذري لبوابة ولي الأمر — ربط الطلاب بأولياء أمورهم (نسخة محصّنة)
-- ════════════════════════════════════════════════════════════════════════════
-- لماذا كانت بوابة ولي الأمر تُظهر «لم يُعثر على طلاب» رغم تسجيل الطالب؟
--
--  ① الربط كان يطابق عمود students.parent_phone فقط — وهو عمود جديد قد يكون
--     فارغاً للطلاب المُضافين سابقاً. أما هاتف ولي الأمر فكان دائماً يُحفظ في
--     students.contact_phone (الموجود منذ البداية والمملوء فعلاً).
--
--  ② الربط كان يطابق نصّياً حرفياً (=)، فأي اختلاف بسيط في الصيغة
--     (مسافات، 00963…، أو رقم بلا صفر بادئ) يُفشل التطابق.
--
-- الحل: تطبيع رقمي ذكي يختزل أي صيغة هاتف إلى جوهرها الوطني (9XXXXXXXX)،
-- ثم مطابقته على كلا العمودين contact_phone و parent_phone. النتيجة:
--   • يعمل مع البيانات الموجودة فعلاً (contact_phone) دون أي ترحيل.
--   • لا يبالي بصيغة الإدخال (‎+963 / 0963 / 00963 / 09 / 9…).
--   • يُصلح نفسه عند كل فتح للتطبيق (الواجهة تستدعي parent_sync_links تلقائياً).
--
-- شغّل هذا الملف مرة واحدة في: Supabase → SQL Editor → Run
-- آمن للتشغيل أكثر من مرة (idempotent).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. ضمان وجود عمود parent_phone (اختياري — للسرعة المستقبلية فقط) + index
alter table public.students
  add column if not exists parent_phone text;

create index if not exists students_parent_phone_idx
  on public.students (parent_phone)
  where parent_phone is not null;

-- 2. ضمان وجود قيد التفرّد على parent_links (يلزمه ON CONFLICT أدناه)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'parent_links_user_id_student_id_key'
  ) and not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'parent_links_user_student_uniq'
  ) then
    create unique index parent_links_user_student_uniq
      on public.parent_links (user_id, student_id);
  end if;
end $$;

-- 3. دالة التطبيع: تختزل أي صيغة هاتف إلى جوهرها الوطني (مثال: 9XXXXXXXX)
--    +963961234567 / 0961234567 / 00963961234567 / 963961234567 / 961234567
--    تعطي جميعها النتيجة نفسها: 961234567
create or replace function public._nsams_phone_core(raw text)
returns text
language sql
immutable
as $$
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

grant execute on function public._nsams_phone_core(text) to authenticated;

-- 4. (تحسين) تعبئة parent_phone من contact_phone للطلاب الناقصين — اختياري
update public.students s
set parent_phone = btrim(s.contact_phone)
where s.parent_phone is null
  and s.contact_phone is not null
  and btrim(s.contact_phone) <> '';

-- 5. الدالة المحصّنة: تربط ولي الأمر بطلابه عند كل فتح للتطبيق (self-healing)
--    تستخرج الهاتف من بريد المصادقة {phone}@parent.nsams.local، تختزله إلى
--    جوهره، ثم تطابقه على جوهر contact_phone أو parent_phone لكل طالب نشط.
create or replace function public.parent_sync_links()
returns integer
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.parent_sync_links() to authenticated;

-- 6. سياسات RLS — ولي الأمر يقرأ روابطه وطلابه فقط
--    يُصلح حالة "لم يُعثر على طلاب" الناتجة عن غياب السياسة أو خطئها.
--    آمن للتشغيل أكثر من مرة (يحذف القديمة ويُنشئ الصحيحة).

-- 6a. parent_links: كل مستخدم يقرأ سطوره فقط
drop policy if exists parent_read_own_links on public.parent_links;
create policy parent_read_own_links
  on public.parent_links
  for select
  to authenticated
  using (user_id = auth.uid());

-- 6b. students: ولي الأمر يقرأ الطلاب المرتبطين به (بدون current_user_is_parent
--     لأن أولياء الأمور غير موجودين في public.users بسبب قيد chk_role_school)
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

-- 7. تحقق — كم طالباً سيُطابَق لرقم معيّن؟ (بدّل الرقم لاختبار يدوي)
--    select count(*) from public.students
--    where is_active = true
--      and public._nsams_phone_core(contact_phone) = public._nsams_phone_core('0961234567');

select
  count(*) filter (where parent_phone  is not null) as "لديهم parent_phone",
  count(*) filter (where contact_phone is not null) as "لديهم contact_phone",
  count(*) filter (where contact_phone is null and parent_phone is null) as "بلا هاتف"
from public.students
where is_active = true;
