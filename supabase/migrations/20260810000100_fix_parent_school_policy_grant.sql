-- ════════════════════════════════════════════════════════════════════════════
--  إصلاح عاجل: سياسة parent_read_linked_school كانت تُعطّل قراءة schools للجميع.
--
--  ما حدث: السياسة المضافة في 20260810000000 تستعلم داخلها عن students،
--  وسياسةُ students تستعلم بدورها عن schools. فنشأت حلقةٌ مغلقة:
--  schools → students → schools. يكشفها Postgres ويرمي
--  «infinite recursion detected in policy for relation "schools"»،
--  فيفشل الاستعلامُ كلُّه لا أن تُحجب صفوفٌ منه.
--
--  ولماذا نجت الوزارة ولوحة المشرف وحدهما: السياسات المسموحة تُجمع بـOR،
--  وفرعُ ministry في schools_read يصدق لهما فيقصر التقييمَ قبل بلوغ السياسة
--  المعطوبة. أمّا المعلّم ومدير المدرسة والمديرية فيبلغونها فتنفجر — فظهرت
--  البوّابات الثلاث «دون اتصال» وهي متّصلة، لأنّ فشل الاستعلام يسقط إلى مسار
--  «لا شبكة» نفسه في الواجهة.
--
--  الإصلاح: نقل الاستعلام إلى دالّة SECURITY DEFINER. تعمل بصلاحيات مالكها
--  وهو مالكُ الجداول، ومالكُ الجدول يتجاوز RLS ما لم يُفرَض FORCE — فلا
--  تُقيَّم سياسةُ students داخلها وتنقطع الحلقة. وهو النمط المتّبع أصلاً في
--  هذا المشروع (current_user_is_parent).
--
--  ⚠️ الدرس: أيّ سياسة RLS تشير إلى جدولٍ تشير سياستُه رجوعاً إلى الجدول
--  الأوّل تُعطّل الجدولَ كلَّه لكلّ دورٍ يبلغها. المرجع الآمن الوحيد من داخل
--  سياسة هو دالّة SECURITY DEFINER.
--
--  (توثيقٌ سابق في هذا الملفّ نسب العطل إلى نقص منحٍ على parent_links؛ ذلك
--   خطأ — الجدول ممنوحٌ لـauthenticated، والسببُ هو التكرار الدوريّ أعلاه.
--   أُعيد إنتاج العطل والإصلاح على نسخةٍ أمينة قبل هذا التصحيح.)
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
