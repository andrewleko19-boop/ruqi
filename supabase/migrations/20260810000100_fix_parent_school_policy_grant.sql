-- ════════════════════════════════════════════════════════════════════════════
--  إصلاح عاجل: سياسة parent_read_linked_school كانت تُعطّل قراءة schools للجميع.
--
--  ما حدث: السياسة المضافة في 20260810000000 تستعلم داخلها عن parent_links،
--  وهذا الجدول لا يحمل منحاً (GRANT) لدور authenticated — منحُه لـservice_role
--  وحده. وتعبيرُ سياسة RLS يُنفَّذ بصلاحيات المستعلِم لا بصلاحيات مُنشئ السياسة،
--  فمجرّد تقييمه يرمي «permission denied for table parent_links» ويُفشل
--  الاستعلام كلَّه — لا يحجب صفوفاً فحسب.
--
--  ولماذا نجت الوزارة ولوحة المشرف وحدهما: السياسات المسموحة تُجمع بـOR،
--  وschools_ministry_select تُرجع true لهما فيقصر المخطِّطُ التقييمَ قبل بلوغ
--  السياسة المعطوبة. أمّا المعلّم ومدير المدرسة والمديرية فلا سياسةَ تسبقها
--  بالصدق، فتُقيَّم فتنفجر — فظهرت البوّابات الثلاث «دون اتصال» وهي متّصلة،
--  لأنّ فشل الاستعلام يسقط إلى مسار «لا شبكة» في الواجهة.
--
--  الإصلاح: نقل الاستعلام إلى دالّة SECURITY DEFINER تعمل بصلاحيات مالكها،
--  فلا تحتاج منحاً على parent_links ولا يُوسَّع وصولُ أحد إلى الجدول. وهو
--  النمط المتّبع أصلاً في هذا المشروع (current_user_is_parent).
--
--  ⚠️ الدرس: أيّ سياسة RLS تشير إلى جدولٍ آخر يجب أن تمرّ بدالّة SECURITY
--  DEFINER أو أن تتأكّد من وجود منحٍ للدور — وإلّا عطّلت الجدولَ كلَّه لا
--  الصفوفَ المحجوبة. راجعتُ سياساتِ أعذار الغياب على storage.objects وهي
--  تشير إلى absence_excuses، فحُوِّلت للنمط نفسه احترازاً في الهجرة التالية.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) نزع السياسة المعطوبة فوراً ───────────────────────────────────────────
drop policy if exists parent_read_linked_school on public.schools;

-- ── 2) الفحص داخل دالّة تعمل بصلاحيات مالكها ────────────────────────────────
create or replace function public.parent_is_linked_to_school(p_school_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from   public.parent_links pl
    join   public.students s on s.id = pl.student_id
    where  pl.user_id  = auth.uid()
      and  s.school_id = p_school_id
  )
$$;

revoke all     on function public.parent_is_linked_to_school(uuid) from public, anon;
grant  execute on function public.parent_is_linked_to_school(uuid) to authenticated;

-- ── 3) إعادة السياسة سليمةً ─────────────────────────────────────────────────
--  current_user_is_parent() أوّلاً: غيرُ الأولياء يخرجون بفحصٍ رخيص، ولا يُدفَع
--  ثمنُ الانضمام على كلّ صفٍّ من schools في كلّ استعلام لكلّ دور.
create policy parent_read_linked_school on public.schools
  for select to authenticated
  using (
    public.current_user_is_parent()
    and public.parent_is_linked_to_school(schools.id)
  );
