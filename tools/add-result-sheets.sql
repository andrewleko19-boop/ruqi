-- ════════════════════════════════════════════════════════════════════════════
-- المرحلة 3ب — الجلاءات (result_sheets): لقطة مدرسة←مديرية←إصدار نهائي
-- ════════════════════════════════════════════════════════════════════════════
--  خط اعتماد النتائج النهائية لكل صف/فصل-سنة، يستنسخ نمط monthly_statements:
--    المدرسة تُرسل لقطة الجلاء (من getClassReportCards) → المديرية تعتمد ثم
--    تُصدِر (issued نهائي غير قابل للتعديل) · الرفض يرتدّ إلى draft بملاحظات.
--
--  يُطبَّق يدوياً في محرّر Supabase SQL. كل العبارات idempotent.
-- ════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────
-- 1) جدول الجلاءات
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.result_sheets (
  id             uuid        primary key default gen_random_uuid(),
  school_id      uuid        not null references public.schools(id) on delete cascade,
  class_id       uuid        not null references public.classes(id) on delete cascade,
  academic_year  text        not null,
  term           text        not null check (term in ('s1','s2','year')),
  status         text        not null default 'draft'
                 check (status in ('draft','submitted','approved','issued','rejected')),
  snapshot_data  jsonb       not null default '{}',  -- لقطة getClassReportCards وقت الإرسال
  notes          text,                               -- ملاحظة المديرية (رفض / موافقة)
  submitted_at   timestamptz,
  reviewed_by    uuid        references auth.users(id),
  reviewed_at    timestamptz,
  issued_at      timestamptz,
  issued_by      uuid        references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists result_sheets_class_term
  on public.result_sheets (class_id, academic_year, term);

alter table public.result_sheets enable row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) RLS — خمس سياسات تستنسخ monthly_statements
-- ──────────────────────────────────────────────────────────────────────────
drop policy if exists rs_school_insert on public.result_sheets;
drop policy if exists rs_school_select on public.result_sheets;
drop policy if exists rs_school_update on public.result_sheets;
drop policy if exists rs_dir_select    on public.result_sheets;
drop policy if exists rs_dir_update    on public.result_sheets;
drop policy if exists rs_ministry_select on public.result_sheets;

-- school_admin: إنشاء جلاء
create policy rs_school_insert on public.result_sheets
  for insert to authenticated
  with check (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  );

-- school_admin: قراءة جلاءات مدرسته
create policy rs_school_select on public.result_sheets
  for select to authenticated
  using (
    school_id = current_user_school_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  );

-- school_admin: تعديل المسودة والمرفوض فقط (لا يلمس المعتمد/الصادر)
create policy rs_school_update on public.result_sheets
  for update to authenticated
  using (
    school_id = current_user_school_id()
    and status in ('draft','rejected')
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'school_admin')
  )
  with check (
    school_id = current_user_school_id()
    and status in ('draft','submitted')
  );

-- directorate_user: قراءة جلاءات مدارس مديريته
create policy rs_dir_select on public.result_sheets
  for select to authenticated
  using (
    exists (
      select 1 from public.schools s
      where s.id = result_sheets.school_id
        and s.directorate_id = current_user_directorate_id()
    )
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'directorate_user')
  );

-- directorate_user: مراجعة/إصدار الجلاءات (المُرسَلة أو المعتمدة)
create policy rs_dir_update on public.result_sheets
  for update to authenticated
  using (
    exists (
      select 1 from public.schools s
      where s.id = result_sheets.school_id
        and s.directorate_id = current_user_directorate_id()
    )
    and status in ('submitted','approved')
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'directorate_user')
  )
  with check (status in ('approved','issued','rejected'));

-- ministry_user: إشراف وطني — قراءة فقط للجلاءات الصادرة (issued)
create policy rs_ministry_select on public.result_sheets
  for select to authenticated
  using (
    status = 'issued'
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user')
  );

grant select, insert, update on public.result_sheets to authenticated;
-- لا delete: الجلاء سجل رسمي لا يُحذف

-- ──────────────────────────────────────────────────────────────────────────
-- 3) RPC مراجعة/إصدار الجلاء (يستنسخ review_monthly_statement)
--    p_decision: approved | rejected | issued
--      submitted → approved | rejected
--      approved  → issued    (نهائي غير قابل للتعديل)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.review_result_sheet(
  p_sheet_id uuid,
  p_decision text,
  p_notes    text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dir         uuid;
  v_sheet       public.result_sheets;
  v_school_name text;
  v_notif_type  text;
  v_notif_title text;
  v_notif_body  text;
begin
  -- تحقق من الدور
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';
  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_decision not in ('approved','rejected','issued') then
    raise exception 'قيمة القرار غير صالحة';
  end if;

  -- جلب الجلاء وتحقق من الملكية والحالة المسموح بها لكل قرار
  select rs.* into v_sheet
  from public.result_sheets rs
  join public.schools sc on sc.id = rs.school_id
  where rs.id = p_sheet_id
    and sc.directorate_id = v_dir
    and (
      (p_decision in ('approved','rejected') and rs.status = 'submitted')
      or (p_decision = 'issued' and rs.status = 'approved')
    );
  if not found then
    raise exception 'الجلاء غير موجود أو خارج نطاق صلاحيتك أو حالته لا تسمح بهذا القرار';
  end if;

  -- تحديث الحالة (مع issued_at/by عند الإصدار)
  update public.result_sheets set
    status      = p_decision,
    notes       = case when p_decision = 'rejected' then p_notes else notes end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    issued_at   = case when p_decision = 'issued' then now()       else issued_at end,
    issued_by   = case when p_decision = 'issued' then auth.uid()  else issued_by end,
    updated_at  = now()
  where id = p_sheet_id;

  select name into v_school_name from public.schools where id = v_sheet.school_id;

  -- إشعار مدراء المدرسة بالنتيجة
  v_notif_type := case p_decision
    when 'approved' then 'result_sheet_approved'
    when 'issued'   then 'result_sheet_issued'
    else                 'result_sheet_rejected' end;
  v_notif_title := case p_decision
    when 'approved' then 'اعتُمد الجلاء ✓'
    when 'issued'   then 'صدر الجلاء نهائياً ✓'
    else                 'رُفض الجلاء' end;
  v_notif_body := coalesce(p_notes, case p_decision
    when 'approved' then 'تمت الموافقة على الجلاء بانتظار الإصدار النهائي.'
    when 'issued'   then 'صدر الجلاء بشكل نهائي وغير قابل للتعديل.'
    else                 'رُفض الجلاء من قبل المديرية.' end);

  perform public.notify_user(
    u.id, v_notif_type, v_notif_title, v_notif_body, 'result_sheets', p_sheet_id
  )
  from public.users u
  where u.school_id = v_sheet.school_id and u.role = 'school_admin';
end; $$;

revoke all on function public.review_result_sheet(uuid, text, text) from public, anon;
grant execute on function public.review_result_sheet(uuid, text, text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4) Trigger إشعار المديرية عند إرسال جلاء (→ submitted)
--    (يستنسخ _notify_dir_statement_submitted)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public._notify_dir_result_sheet_submitted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dir         uuid;
  v_school_name text;
  v_class_label text;
begin
  if NEW.status <> 'submitted' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status = 'submitted' then return NEW; end if;

  select directorate_id, name into v_dir, v_school_name
  from public.schools where id = NEW.school_id;

  select 'الصف ' || c.grade || ' / ' || c.section into v_class_label
  from public.classes c where c.id = NEW.class_id;

  perform public.notify_user(
    u.id,
    'result_sheet_submitted',
    'جلاء جديد للمراجعة',
    coalesce(v_school_name, 'مدرسة') || ' — ' || coalesce(v_class_label, '') || ' (' || NEW.term || ')',
    'result_sheets',
    NEW.id
  )
  from public.users u
  where u.directorate_id = v_dir and u.role = 'directorate_user';
  return NEW;
end; $$;

drop trigger if exists trg_notify_dir_result_sheet_submitted on public.result_sheets;
create trigger trg_notify_dir_result_sheet_submitted
  after insert or update on public.result_sheets
  for each row execute function public._notify_dir_result_sheet_submitted();

-- ════════════════════════════════════════════════════════════════════════════
-- ملاحظات التحقق:
--   select class_id, term, status from public.result_sheets order by updated_at desc;
--   -- مدرسة تُرسل → submitted؛ المديرية approved ثم issued (نهائي)؛ الرفض → rejected.
-- ════════════════════════════════════════════════════════════════════════════
