-- ════════════════════════════════════════════════════════════════════════════
--  إغلاق حلقاتٍ راجعة مفتوحة: من يُرسل يجب أن يعرف ما جرى لإرساله.
--
--  تدقيقٌ لمسارات العمل العشرة كشف ثلاث حلقاتٍ يُرسل فيها طرفٌ ولا يعود إليه
--  خبر. كلّها ليست أعطالاً تُرى في السجلّ — الشيفرة تعمل، والصفوف تُكتب — بل
--  صمتٌ يفسّره المستخدم بأنّ النظام لا يعمل، فيعود إلى الهاتف والورقة.
--
--  ١) اقتراح درجات الرأفة: المعلّم يُرسل، والمدير يقرّر، ويُعلَم **وليُّ الأمر**
--     وحده — وعلى القبول فقط. أمّا المعلّم صاحب الاقتراح فلا يُخبَر أبداً، لا
--     بقبولٍ ولا برفض. وأسوأ: الرفض بلا سببٍ يُخزَّن، فلا مجال لتفسيره لاحقاً.
--     يُضاف p_reason، ويُعلَم المُقترِح في الحالتين.
--
--  ٢) عذر الغياب: وليُّ الأمر يرفع العذر فلا يعلم به المدير إلا إن فتح التبويب،
--     والمدير يقرّر فلا يعلم وليُّ الأمر إلا إن عاد وفتّش عن ذلك اليوم بعينه.
--     زنادٌ على الإدراج، وإعلامٌ في القرار.
--
--  ٣) كشف الحضور: المدير يؤكّد أو يُعيد كشفَ المعلّم، ولا إشعار البتّة. وقراءةُ
--     المعلّم مثبّتةٌ على «اليوم»، فرفضٌ يقع مساءً لا يراه صاحبه أبداً — يُطلب
--     منه سببُ الإعادة ويُكتب في عمودٍ لا يقرؤه أحد.
-- ════════════════════════════════════════════════════════════════════════════

-- عمودُ سبب القرار — لم يكن موجوداً، فرفضٌ بلا تفسيرٍ لا يُستعاد.
alter table public.grace_proposals add column if not exists decide_note text;

-- ── ١) قرار الرأفة يصل صاحب الاقتراح ───────────────────────────────────────
-- إضافة معاملٍ تُبدّل التوقيع، فتُسقَط الصيغة القديمة صراحةً.
drop function if exists public.decide_grace_proposal(uuid, text);

create function public.decide_grace_proposal(
  p_id       uuid,
  p_decision text,
  p_reason   text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p        public.grace_proposals;
  v_items    jsonb;
  v_name     text;
  v_subject  text;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'قرار غير صالح';
  end if;
  select * into v_p from public.grace_proposals where id = p_id;
  if v_p.id is null then raise exception 'الاقتراح غير موجود'; end if;
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'school_admin' and u.school_id = v_p.school_id
  ) then
    raise exception 'غير مصرّح';
  end if;

  select full_name into v_name    from public.students where id = v_p.student_id;
  select name      into v_subject from public.subjects where id = v_p.subject_id;

  if p_decision = 'approved' then
    -- ادمج الاقتراح مع المساعدة الحالية: صفّ المادة المقترحة يُستبدل بقيمة
    -- الاقتراح، وبقية الصفوف تبقى كما هي. ثم أعد فرض السقوف عبر grant_grace.
    select coalesce(jsonb_agg(jsonb_build_object('subject_id', sub_id, 'marks', mk)), '[]'::jsonb)
      into v_items
    from (
      select g.subject_id as sub_id, g.marks as mk
        from public.student_grace g
       where g.student_id    = v_p.student_id
         and g.class_id      = v_p.class_id
         and g.academic_year = v_p.academic_year
         and g.subject_id is distinct from v_p.subject_id
      union all
      select v_p.subject_id, v_p.marks
    ) merged(sub_id, mk);

    perform public.grant_grace(v_p.student_id, v_p.class_id, v_p.academic_year, v_items);

    -- أعلِم ولي الأمر (اللائحة: يُعلَم ولي الأمر بدرجات المساعدة)
    perform public.notify_user(
      pl.user_id, 'grace_granted',
      'درجات مساعدة لـ ' || coalesce(v_name, 'ابنك/ابنتك'),
      'مُنحت ' || v_p.marks || ' درجة مساعدة وفق النظام الداخلي',
      'student_grace', v_p.student_id
    )
    from public.parent_links pl
    where pl.student_id = v_p.student_id;
  end if;

  update public.grace_proposals
     set status      = p_decision,
         decided_by  = auth.uid(),
         decided_at  = now(),
         decide_note = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id;

  /* صاحبُ الاقتراح يُعلَم في الحالتين. كان يُرسل ثمّ لا يعرف شيئاً: لا قبولاً
     يطمئنّه ولا رفضاً يصحّح له. والرفض يحمل سببَه إن كُتب. */
  perform public.notify_user(
    v_p.proposed_by,
    case when p_decision = 'approved' then 'grace_proposal_approved'
         else 'grace_proposal_rejected' end,
    case when p_decision = 'approved' then 'قُبل اقتراح الرأفة' else 'رُفض اقتراح الرأفة' end,
    coalesce(v_name, 'الطالب') || ' — ' || coalesce(v_subject, 'مادة') ||
    ' (' || v_p.marks || ' درجة)' ||
    case when p_decision = 'rejected' and nullif(btrim(coalesce(p_reason,'')),'') is not null
         then ' — السبب: ' || p_reason else '' end,
    'grace_proposal', v_p.id
  );
end; $$;

alter function public.decide_grace_proposal(uuid, text, text) owner to postgres;
revoke all on function public.decide_grace_proposal(uuid, text, text) from public, anon;
grant execute on function public.decide_grace_proposal(uuid, text, text) to authenticated;

-- ── ٢) عذر الغياب: إعلامٌ في الاتجاهين ─────────────────────────────────────
create or replace function public._notify_school_new_excuse()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from public.students where id = new.student_id;
  perform public.notify_user(
    u.id, 'excuse_submitted',
    'عذر غياب جديد',
    coalesce(v_name, 'طالب') || ' — بتاريخ ' || to_char(new.date, 'YYYY-MM-DD'),
    'absence_excuse', new.id
  )
  from public.users u
  where u.role = 'school_admin' and u.school_id = new.school_id and u.is_active;
  return new;
end; $$;

alter function public._notify_school_new_excuse() owner to postgres;
drop trigger if exists trg_notify_school_new_excuse on public.absence_excuses;
create trigger trg_notify_school_new_excuse
  after insert on public.absence_excuses
  for each row execute function public._notify_school_new_excuse();

/* قرارُ المدرسة يصل وليَّ الأمر. الدالّة تُعاد كاملةً من 20260810000000 مع
   إضافة الإعلام في آخرها — create or replace لا يقبل تعديلاً جزئياً. */
create or replace function public.school_review_excuse(
  p_excuse_id uuid,
  p_decision  text,
  p_note      text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ex   public.absence_excuses;
  v_name text;
begin
  if p_decision not in ('accepted','rejected') then
    raise exception 'قرار غير صالح';
  end if;

  select * into v_ex from public.absence_excuses where id = p_excuse_id;
  if v_ex.id is null then raise exception 'العذر غير موجود'; end if;

  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'school_admin' and u.school_id = v_ex.school_id
  ) then
    raise exception 'غير مصرّح';
  end if;

  if p_decision = 'rejected' and nullif(btrim(coalesce(p_note,'')), '') is null then
    raise exception 'سبب الرفض مطلوب';
  end if;

  update public.absence_excuses
     set status      = p_decision,
         reviewed_by = auth.uid(),
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_excuse_id;

  -- القبول يقلب اليوم إلى «بعذر» في سجلّ الحضور.
  if p_decision = 'accepted' then
    update public.daily_student_attendance
       set status = 'excused'
     where student_id = v_ex.student_id
       and date       = v_ex.date;
  end if;

  /* وليُّ الأمر يُعلَم بالقرار. كان يرفع العذر ثمّ لا يعرف مصيره إلا إن عاد
     وفتّش عن ذلك اليوم بعينه في التقويم — وأكثرُهم لا يعود. */
  select full_name into v_name from public.students where id = v_ex.student_id;
  perform public.notify_user(
    pl.user_id,
    case when p_decision = 'accepted' then 'excuse_accepted' else 'excuse_rejected' end,
    case when p_decision = 'accepted' then 'قُبل عذر الغياب' else 'رُفض عذر الغياب' end,
    coalesce(v_name, 'ابنك/ابنتك') || ' — ' || to_char(v_ex.date, 'YYYY-MM-DD') ||
    case when p_decision = 'rejected' and nullif(btrim(coalesce(p_note,'')),'') is not null
         then ' — السبب: ' || p_note else '' end,
    'absence_excuse', v_ex.id
  )
  from public.parent_links pl
  where pl.student_id = v_ex.student_id;
end; $$;

alter function public.school_review_excuse(uuid, text, text) owner to postgres;
revoke all on function public.school_review_excuse(uuid, text, text) from public, anon;
grant execute on function public.school_review_excuse(uuid, text, text) to authenticated;

-- ── ٣) كشف الحضور: المعلّم يُعلَم بالتأكيد والإعادة ─────────────────────────
create or replace function public._notify_teacher_submission_reviewed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cls text;
begin
  -- الحالة وحدها تُهمّ، والمُراجِع ليس هو المُرسِل.
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('confirmed','rejected') then return new; end if;
  if new.submitted_by is null then return new; end if;

  select coalesce(c.name, 'الصف ' || c.grade || ' / ' || coalesce(c.section, ''))
    into v_cls
    from public.classes c where c.id = new.class_id;

  perform public.notify_user(
    new.submitted_by,
    case when new.status = 'confirmed' then 'attendance_confirmed' else 'attendance_rejected' end,
    case when new.status = 'confirmed' then 'تأكيد كشف الحضور' else 'إعادة كشف الحضور' end,
    coalesce(v_cls, 'صف') || ' — ' || to_char(new.date, 'YYYY-MM-DD') ||
    case when new.status = 'rejected' and nullif(btrim(coalesce(new.notes,'')),'') is not null
         then ' — السبب: ' || new.notes else '' end,
    'attendance_submission', new.id
  );
  return new;
end; $$;

alter function public._notify_teacher_submission_reviewed() owner to postgres;
drop trigger if exists trg_notify_teacher_submission on public.attendance_submissions;
create trigger trg_notify_teacher_submission
  after update of status on public.attendance_submissions
  for each row execute function public._notify_teacher_submission_reviewed();

notify pgrst, 'reload schema';
