-- ════════════════════════════════════════════════════════════════════════════
--  الترفيع السنويّ: يوجد في المرجع، ولا يوجد في القاعدة.
--
--  زرُّ «تنفيذ الترفيع السنويّ» في بوّابة المدرسة يستدعي upsert_year_results ثمّ
--  execute_annual_promotion. والثانية موجودة في الأساس المُصدَّر من الإنتاج،
--  لكنّها تقرأ جدول student_year_results — وهذا الجدول **غير موجود**، ولا الدالّة
--  الأولى. كلاهما بقي في docs/database-setup.sql وحده، وهو ملفٌّ مرجعيّ لا يُنشر.
--
--  فالنتيجة أنّ أخطر إجراءٍ سنويّ في النظام — ترفيعُ صفٍّ كامل، وتخريجُ الثاني
--  عشر — يسقط عند أوّل ضغطة بـ 42883 ثمّ 42P01. ولا أحد يعلم قبل حزيران، حين
--  تُفتح المدارس على نهاية العام ولا تجد مخرجاً.
--
--  وُجد بـ tools/check-sql-drift.mjs، وهو الآن في CI فلا يتكرّر الصنف.
--
--  المحتوى منقولٌ حرفيّاً عن المرجع (§12.1–12.2) لا مُعاد تصميمه: القصد سدُّ
--  الفجوة لا تغيير السلوك. والجدول والسياسات بصيغة IF NOT EXISTS/DROP IF EXISTS
--  فالهجرة آمنةٌ على قاعدةٍ سبق أن طُبِّق عليها المرجع يدويّاً.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.student_year_results (
  student_id    uuid not null references public.students(id) on delete cascade,
  academic_year text not null,
  result        text not null check (result in ('ناجح','راسب')),
  final_percent numeric(5,2),
  recorded_by   uuid references public.users(id),
  recorded_at   timestamptz not null default now(),
  primary key (student_id, academic_year)
);

alter table public.student_year_results enable row level security;

-- القراءة مقيَّدة بالدور: كادر مدرسة الطالب، ومستخدم المديرية التابعة لها
-- المدرسة، ومستخدم الوزارة، وولي الأمر المرتبط بالطالب وحده. (using(true) كانت
-- تُسرّب نتائج كلّ طلاب القطر لأيّ مستخدمٍ مصادَق، بمن فيهم أولياء الأمور.)
drop policy if exists syr_read on public.student_year_results;
create policy syr_read on public.student_year_results
  for select to authenticated
  using (
    exists (
      select 1 from public.students s
      join public.classes c on c.id = s.class_id
      join public.users   u on u.school_id = c.school_id and u.id = auth.uid()
      where s.id = student_year_results.student_id
    )
    or exists (
      select 1 from public.students s
      join public.classes c  on c.id  = s.class_id
      join public.schools sc on sc.id = c.school_id
      join public.users   me on me.id = auth.uid()
      where s.id = student_year_results.student_id
        and me.role = 'directorate_user'
        and sc.directorate_id = me.directorate_id
    )
    or exists (
      select 1 from public.users me
      where me.id = auth.uid() and me.role = 'ministry_user'
    )
    or (
      public.current_user_is_parent() and exists (
        select 1 from public.parent_links pl
        where pl.user_id = auth.uid() and pl.student_id = student_year_results.student_id
      )
    )
  );

drop policy if exists syr_write on public.student_year_results;
create policy syr_write on public.student_year_results
  for all to authenticated
  using (exists (
    select 1 from public.students s
    join public.classes c on c.id = s.class_id
    join public.users   u on u.school_id = c.school_id and u.id = auth.uid()
    where s.id = student_year_results.student_id
  ))
  with check (exists (
    select 1 from public.students s
    join public.classes c on c.id = s.class_id
    join public.users   u on u.school_id = c.school_id and u.id = auth.uid()
    where s.id = student_year_results.student_id
  ));

grant select, insert, update on public.student_year_results to authenticated;

-- كتابةٌ جماعية للنتائج من المتصفّح. SECURITY DEFINER، فالفحص المكتوب بداخلها
-- هو الحارس الوحيد: مدير المدرسة التي يتبعها الصفّ لا غير.
create or replace function public.upsert_year_results(
  p_class_id uuid,
  p_results  jsonb   -- [{student_id, academic_year, result, final_percent}]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid;
begin
  select c.school_id into v_school_id from public.classes c where c.id = p_class_id;
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.school_id = v_school_id and u.role = 'school_admin'
  ) then raise exception 'غير مصرّح'; end if;

  insert into public.student_year_results(student_id, academic_year, result, final_percent, recorded_by)
  select
    (r->>'student_id')::uuid,
    r->>'academic_year',
    r->>'result',
    (r->>'final_percent')::numeric,
    auth.uid()
  from jsonb_array_elements(p_results) r
  on conflict (student_id, academic_year) do update set
    result        = excluded.result,
    final_percent = excluded.final_percent,
    recorded_by   = excluded.recorded_by,
    recorded_at   = now();
end; $$;

alter function public.upsert_year_results(uuid, jsonb) owner to postgres;

revoke all on function public.upsert_year_results(uuid, jsonb) from public, anon;
grant execute on function public.upsert_year_results(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
