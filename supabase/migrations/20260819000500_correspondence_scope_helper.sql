-- ════════════════════════════════════════════════════════════════════════════
--  الفخُّ نفسه، مرّتين في يومٍ واحد: سياسةٌ تستعلم من جدولٍ لا يقرؤه المستدعي.
--
--  corr_thread_insert تتحقّق أنّ المدرسةَ تتبع المديرية بـ:
--      exists (select 1 from public.schools s where s.id = school_id and …)
--  وتعبيرُ WITH CHECK يُنفَّذ بصلاحيات الكاتب، فيُقيَّد بـRLS جدولِ schools.
--  فمديرُ مدرسةٍ يفتح مراسلةً مع مديريته يُرَدّ: «new row violates row-level
--  security policy» — والشرطُ الذي أسقطه صحيحٌ في نفسه.
--
--  وهي علّةُ staff_leaves_own_read بعينها (أُصلحت في 20260819000000). والفرقُ
--  أنّها ظهرت هنا فوراً لأنّ الضابط الموجب سبق فحصَ المنع في مجموعة التدقيق:
--  لو بدأنا بفحص «هل تُحجب مدرسةٌ جارة؟» لمرّت السياسةُ خضراءَ وهي تمنع
--  الجميع — وهذا بالضبط ما جرى للإجازات فبقيت معطَّلةً بلا أن يُنبِّه حارس.
--
--  الإصلاح: الانتماءُ يُحسم في دالّةٍ SECURITY DEFINER، فلا يبقى في التعبير
--  استعلامٌ من جدولٍ تحكمه سياسةٌ أخرى.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.school_in_directorate(p_school uuid, p_dir uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (select 1 from public.schools s
                  where s.id = p_school and s.directorate_id = p_dir)
$$;

alter function public.school_in_directorate(uuid, uuid) owner to postgres;
revoke all on function public.school_in_directorate(uuid, uuid) from public, anon;
grant execute on function public.school_in_directorate(uuid, uuid) to authenticated, service_role;

comment on function public.school_in_directorate(uuid, uuid) is
  'هل تتبع هذه المدرسةُ تلك المديرية؟ SECURITY DEFINER كي لا تُقيَّد تعابيرُ السياسات بـRLS جدولِ schools.';


drop policy if exists corr_thread_insert on public.correspondence_threads;
create policy corr_thread_insert on public.correspondence_threads
  for insert to authenticated
  with check (
    opened_by = auth.uid()
    and (
      ( opened_side = 'ministry'
        and public.current_user_role() = 'ministry_user'::public.user_role
        and school_id is null )
      or
      ( opened_side = 'directorate'
        and public.current_user_role() = 'directorate_user'::public.user_role
        and directorate_id = public.current_user_directorate_id()
        and ( school_id is null
              or public.school_in_directorate(school_id, directorate_id) ) )
      or
      ( opened_side = 'school'
        and public.current_user_role() = 'school_admin'::public.user_role
        and school_id = public.current_user_school_id()
        and public.school_in_directorate(school_id, directorate_id) )
    )
  );

notify pgrst, 'reload schema';
