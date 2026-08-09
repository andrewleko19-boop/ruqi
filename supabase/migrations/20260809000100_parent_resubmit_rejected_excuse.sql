-- ════════════════════════════════════════════════════════════════════════════
--  تمكين وليّ الأمر من تعديل عذرٍ رُفِض وإعادة تقديمه.
--
--  الحالة قبل: على الجدول قيدُ unique(student_id, date)، فمحاولةُ تقديم عذرٍ
--  ثانٍ لليوم نفسه تفشل. ولا سياسة UPDATE لأولياء الأمور إطلاقاً. فوليّ الأمر
--  يرى «مرفوض» — ومنذ الإصلاح الأخير يرى سببَ الرفض أيضاً — بلا أيّ طريقٍ
--  للتصحيح. طريقٌ مسدود بالكامل.
--
--  لماذا دالّةٌ لا سياسة UPDATE: سياسةُ RLS تحكم أيَّ الصفوف تُحدَّث وكيف يبدو
--  الصفّ بعد التحديث، لكنّها لا تُثبّت الأعمدة. فوليّ أمرٍ يملك ابنين يستطيع
--  ضمن UPDATE «مشروع» أن يغيّر date أو student_id فينقل عذراً مقبولاً إلى يومٍ
--  آخر أو إلى ابنه الآخر، وتمرّ WITH CHECK لأنّه يملك الاثنين. الدالّة
--  SECURITY DEFINER تحدّد الأعمدة المتغيّرة حرفياً فيسقط هذا الالتفاف.
--
--  ما يتغيّر: السبب والصورة فقط، مع إعادة الحالة إلى 'pending' ومسح ردّ
--  المراجعة السابق. أمّا student_id وdate وschool_id فلا تُمَسّ إطلاقاً.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.parent_resubmit_excuse(
  p_excuse_id uuid,
  p_reason    text,
  p_photo_url text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب الغياب مطلوب';
  end if;

  -- الملكية والحالة في فحصٍ واحد: الصفّ يخصّ ابناً مرتبطاً بالمستدعي فعلاً،
  -- وحالتُه 'rejected'. المقبول والمعلَّق لا يُعدَّلان — الأوّل حُسِم، والثاني
  -- قيد المراجعة فتغييرُه تحت يد المدير مربك.
  select true into v_allowed
  from   public.absence_excuses e
  join   public.parent_links pl
         on pl.student_id = e.student_id
        and pl.user_id    = auth.uid()
  where  e.id = p_excuse_id
    and  e.status = 'rejected';

  if not coalesce(v_allowed, false) then
    raise exception 'لا يمكن تعديل هذا العذر';
  end if;

  update public.absence_excuses
  set    reason      = p_reason,
         photo_url   = p_photo_url,   -- صريح: null يعني أنّ الوليّ أزال الصورة
         status      = 'pending',
         review_note = null,
         reviewed_by = null,
         updated_at  = now()
  where  id = p_excuse_id;
end;
$$;

-- الدالّة SECURITY DEFINER فتتجاوز RLS — تُمنَح للمسجَّلين وحدهم، ويُسحب أيّ
-- منحٍ ضمنيّ عن public/anon (نفس مبدأ هجرة revoke_notify_user_execute).
revoke all     on function public.parent_resubmit_excuse(uuid, text, text) from public, anon;
grant  execute on function public.parent_resubmit_excuse(uuid, text, text) to authenticated;
