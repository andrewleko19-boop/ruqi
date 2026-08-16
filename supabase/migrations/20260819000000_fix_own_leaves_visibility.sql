-- ════════════════════════════════════════════════════════════════════════════
--  «إجازاتي» لم تكن تصل المعلّم قطّ — والعلّة ليست حيث بدت.
--
--  السياسة staff_leaves_own_read كُتبت هكذا:
--
--    using ( exists ( select 1
--              from public.staff_records sr
--              join public.users u on … u.id = auth.uid() …
--             where sr.id = staff_leaves.staff_id
--               and ar_norm(sr.full_name) = ar_norm(u.full_name) ) )
--
--  وظاهرُها سليم. لكنّ تعبير USING يُنفَّذ بصلاحيات المستدعي، فـRLS جدولِ
--  staff_records يُطبَّق داخله. وسياستُه الوحيدة staff_records_school_admin —
--  لمدير المدرسة وحده. فالمعلّمُ يقرأ من sr صفراً، ويُقيَّم EXISTS كاذباً
--  **دائماً**، مهما تطابق الاسمان.
--
--  أُثبت محلّياً: معلّمٌ واسمُه في السجلّ حرفاً بحرف ⇒ صفر صفوف. والاختبار
--  الذي رافق السياسة فحص ar_norm ولم يفحص القراءة من حساب معلّمٍ حقيقيّ،
--  فمرّت الميزةُ خضراءَ وهي معطَّلة بالكامل.
--
--  الإصلاح مبدأيّ لا ترقيعيّ: النطاق يُشتقّ في دالّةٍ SECURITY DEFINER —
--  النمط نفسه الذي تستعمله teaches_class و may_sync_class — فلا يعود تعبيرُ
--  السياسة يعتمد على ما يقرأه المستدعي من جداولَ أخرى.
--
--  ومعه تمتينُ الربط. مطابقةُ الاسم آخرُ الحيل لا أوّلها: في المخطّط رابطٌ
--  صريح — staff_assignments تحمل staff_id و user_id معاً (تُكتب عند التكليف،
--  وهي مصدرُ شارة «مُزامَن مع صلاحية المعلّم»). فنُقدّمه، ونُبقي الاسمَ
--  احتياطاً لكادرٍ بلا تكليفٍ مسجَّل.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.my_staff_record_ids()
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp as $$
  -- ١) الرابط الصريح: تكليفٌ يحمل معرّفَ السجلّ ومعرّفَ الحساب معاً.
  select sa.staff_id
    from public.staff_assignments sa
   where sa.user_id = auth.uid()
     and sa.staff_id is not null
  union
  -- ٢) الاحتياط: تطابقُ اسمٍ مطبَّع داخل المدرسة نفسها. يخدم كادراً لم
  --    يُسجَّل له تكليفٌ بعد — وهو حالٌ شائعة في أوّل العام.
  select sr.id
    from public.staff_records sr
    join public.users u
      on u.id        = auth.uid()
     and u.school_id = sr.school_id
   where public.ar_norm(sr.full_name) = public.ar_norm(u.full_name)
$$;

alter function public.my_staff_record_ids() owner to postgres;
revoke all on function public.my_staff_record_ids() from public, anon;
grant execute on function public.my_staff_record_ids() to authenticated, service_role;

comment on function public.my_staff_record_ids() is
  'سجلّاتُ الكادر العائدة للمستدعي — بالتكليف أوّلاً ثمّ بمطابقة الاسم. SECURITY DEFINER كي لا يُقيَّد تعبيرُ السياسة بما يقرأه المستدعي من staff_records.';


drop policy if exists staff_leaves_own_read on public.staff_leaves;
create policy staff_leaves_own_read on public.staff_leaves
  for select to authenticated
  using (staff_id in (select public.my_staff_record_ids()));

comment on policy staff_leaves_own_read on public.staff_leaves is
  'صاحبُ الإجازة يقرأ إجازاته. النطاق من دالّةٍ SECURITY DEFINER لا من استعلامٍ داخل التعبير — وإلّا حجبته RLS جدولِ staff_records.';

notify pgrst, 'reload schema';
