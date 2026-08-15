-- ════════════════════════════════════════════════════════════════════════════
--  ثلاثُ حلقاتٍ راجعة إضافية اكتشفها استكشافٌ للفجوات في هذه الجولة.
--
--  ١) staff_leaves تُدخَل على معلّم فتُنقص أيّامه (والراتب لاحقاً) دون علمه —
--     لا سياسةَ RLS تسمح له بقراءتها، ولا شاشةَ في بوّابة المعلّم. تسجيل
--     إجازةٍ كاذبةٍ على موظّف ثغرةُ حوكمة لا مجرّد عمود لا يُقرأ. الحلّ يعتمد
--     على مطابقةٍ بالاسم بين staff_records وحساب المعلّم في users (لا رابطَ
--     مباشر أنشأناه للتوّ) — نُبقي المطابقة في هذه الهجرة على `full_name`
--     مع نفس المدرسة، وهي مطابقةٌ آمنةٌ في السياق: الأسماء في مدرسةٍ واحدةٍ لا
--     تتكرّر عملياً، وحتى لو تكرّرت لا يزيد الأثر على أن يقرأ متشابهُ الاسم
--     إجازةً ليست له — لا كتابة.
--
--  ٢) cancel_transfer_document لا يُبلَّغ المدرسةَ المُصدِرة التي تلقّت
--     `transfer_doc_new` سابقاً وقد فتحت التبويب لتبتّ فيه.
--
--  ٣) emergency_reports بعد `acknowledged/resolved` لا يعلمها مدير المدرسة
--     الذي رفع البلاغ. فيتصل هاتفياً ويخترع مسارات موازية للطارئ.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ١) المعلّم يقرأ إجازاته المسجَّلة عليه ────────────────────────────────────
drop policy if exists staff_leaves_own_read on public.staff_leaves;
create policy staff_leaves_own_read on public.staff_leaves
  for select to authenticated using (
    exists (
      select 1
        from public.staff_records sr
        join public.users u
          on u.school_id = sr.school_id
         and u.id        = auth.uid()
         and u.role      = 'teacher'::public.user_role
       where sr.id        = staff_leaves.staff_id
         and public.ar_norm(sr.full_name) = public.ar_norm(u.full_name)
    )
  );

comment on policy staff_leaves_own_read on public.staff_leaves is
  'المعلّم يقرأ إجازاته المسجَّلة عليه — مطابقةٌ باسم كاملٍ مطبَّع داخل مدرسةٍ واحدة، فلا رابطَ مباشر بين staff_records.id و users.id في المخطّط.';


-- ── ٢) إلغاء طلب النقل يُبلَّغ المدرسة المصدِرة ───────────────────────────────
create or replace function public.cancel_transfer_document(p_doc_id uuid)
returns public.transfer_documents
language plpgsql security definer set search_path = public as $$
declare
  v_out public.transfer_documents;
begin
  if public.current_user_role() is distinct from 'school_admin'::public.user_role then
    raise exception 'غير مصرّح: سحب الوثائق لمدراء المدارس فقط';
  end if;

  update public.transfer_documents set
    status       = 'cancelled',
    processed_at = now()
  where id = p_doc_id
    and to_school_id = public.current_user_school_id()
    and status = 'pending'
  returning * into v_out;

  if not found then
    raise exception 'الوثيقة غير موجودة أو ليست من إصدار مدرستك أو بُتَّ فيها سابقاً';
  end if;

  -- الجديد: تُبلَّغ المدرسة المُصدِرة (from_school_id) — كانت قد تلقّت
  -- `transfer_doc_new` وقد فتحت التبويب لتبتّ فيه، فلا تُصدَم لاحقاً بأنّ
  -- الطلب سُحب صامتاً.
  perform public.notify_user(
    u.id, 'transfer_doc_cancelled',
    'أُلغي طلب نقل: ' || coalesce(v_out.student_full_name, '—'),
    'المدرسة الطالبة (' || coalesce(v_out.to_school_name, 'مدرسة') ||
      ') سحبت طلبَها — لا فعلَ مطلوباً منك.',
    'transfer_doc', v_out.id
  )
  from public.users u
  where u.school_id = v_out.from_school_id
    and u.role      = 'school_admin'::public.user_role
    and u.is_active;

  return v_out;
end; $$;

alter function public.cancel_transfer_document(uuid) owner to postgres;
revoke all on function public.cancel_transfer_document(uuid) from public, anon;
grant execute on function public.cancel_transfer_document(uuid)
  to authenticated, service_role;


-- ملاحظة عن بلاغ الطوارئ: تبيّن بالفحص المباشر على قاعدةٍ محلّية أنّ زناد
-- trg_report_status موجودٌ في baseline ويُبلّغ المدرسة عند «acknowledged» و
-- «resolved» — الحلقةُ مغلقةٌ فعلاً. إضافةُ زنادٍ ثانٍ يُضاعف الإشعار، فتُركت.

notify pgrst, 'reload schema';
