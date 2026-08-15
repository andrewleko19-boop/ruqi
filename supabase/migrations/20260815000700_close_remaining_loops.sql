-- ════════════════════════════════════════════════════════════════════════════
--  ثلاثُ حلقاتٍ باقية: من يُرسل شيئاً يعرف أنّ المستلم عرف.
--
--  تكملةُ ما بدأته 20260815000100. الصنف نفسه: إجراءٌ يقع في طرفٍ ولا أثر له
--  عند الطرف الذي يعنيه — لا خطأ، ولا رسالة، فقط شاشةٌ كما كانت.
--
--  ١) تكليفُ معلّمٍ بشعبة. مدير المدرسة يُسنده، والمعلّم لا يُبلَّغ: تطبيقُ PWA
--     يبقى مفتوحاً أياماً، وقائمةُ صفوفه تُقرأ عند الإقلاع وحده. فيمرّ اليوم
--     الأوّل بلا حضورٍ مُسجَّل — ويُحسب على المدرسة تأخّراً في الالتزام.
--
--  ٢) نتيجةُ العام. أهمُّ خبرٍ يخصّ أسرةً في العام كلِّه — نجح أم رسب — كان
--     يُكتب في student_year_results ولا يقرؤه أحد ولا يصل أحداً.
--
--  ٣) استيرادٌ جماعيّ من المديرية إلى سجلّ مدرسة. عشراتُ الطلاب أو الكادر
--     يدخلون سجلَّ المدرسة، ومديرُها لا يعلم أنّ سجلَّه تغيّر. والزناد على
--     audit_log لا على students عمداً: صفٌّ واحدٌ يُكتب في آخر الاستيراد، فيصل
--     إشعارٌ واحد لا مئةٌ بعدد الأسطر — ولا تُمسّ دالّتا الاستيراد أصلاً.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ١) تكليفُ معلّمٍ بشعبة ───────────────────────────────────────────────────
create or replace function public._notify_teacher_class_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_role  text;
begin
  -- التحديث الذي لا يغيّر المعلّم ولا الشعبة ولا الدور ولا المواد ليس تكليفاً.
  if tg_op = 'UPDATE'
     and new.teacher_id    is not distinct from old.teacher_id
     and new.class_id      is not distinct from old.class_id
     and new.role          is not distinct from old.role
     and new.subject_ids   is not distinct from old.subject_ids
  then return new; end if;

  select 'الصف ' || c.grade || ' / ' || c.section into v_label
    from public.classes c where c.id = new.class_id;

  v_role := case new.role
    when 'homeroom'   then 'مربّي صف'
    when 'supervisor' then 'موجّه'
    else 'مدرّس مادة'
  end;

  perform public.notify_user(
    new.teacher_id, 'class_assigned',
    'تكليفٌ جديد: ' || coalesce(v_label, 'شعبة'),
    v_role || ' — للعام الدراسي ' || new.academic_year,
    'class', new.class_id
  );
  return new;
end; $$;

alter function public._notify_teacher_class_assigned() owner to postgres;

drop trigger if exists trg_notify_teacher_class_assigned on public.class_teacher;
create trigger trg_notify_teacher_class_assigned
  after insert or update on public.class_teacher
  for each row execute function public._notify_teacher_class_assigned();

-- ── ٢) نتيجةُ العام تصل الأهل ────────────────────────────────────────────────
create or replace function public._notify_parents_year_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if tg_op = 'UPDATE'
     and new.result        is not distinct from old.result
     and new.final_percent is not distinct from old.final_percent
  then return new; end if;

  select s.full_name into v_name from public.students s where s.id = new.student_id;

  perform public.notify_user(
    pl.user_id, 'year_result',
    'نتيجة العام ' || new.academic_year || ': ' || new.result,
    coalesce(v_name, 'ابنك/ابنتك')
      || case when new.final_percent is not null
              then ' — النسبة النهائية ' || trim(to_char(new.final_percent, 'FM990.99')) || '٪'
              else '' end,
    'student', new.student_id
  )
  from public.parent_links pl
  where pl.student_id = new.student_id;

  return new;
end; $$;

alter function public._notify_parents_year_result() owner to postgres;

drop trigger if exists trg_notify_parents_year_result on public.student_year_results;
create trigger trg_notify_parents_year_result
  after insert or update on public.student_year_results
  for each row execute function public._notify_parents_year_result();

-- ── ٣) الاستيرادُ الجماعيّ يصل مدير المدرسة ──────────────────────────────────
create or replace function public._notify_school_bulk_import()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_what  text;
begin
  if new.action <> 'directorate_bulk_import' or new.school_id is null then
    return new;
  end if;

  v_count := coalesce((new.changes->>'count')::int, 0);
  if v_count <= 0 then return new; end if;

  v_what := case new.entity when 'students' then 'طالباً' else 'من الكادر' end;

  perform public.notify_user(
    u.id, 'bulk_import',
    'إضافةٌ جماعية من المديرية',
    'أُضيف ' || v_count || ' ' || v_what || ' إلى سجلّ مدرستك.',
    new.entity, null
  )
  from public.users u
  where u.school_id = new.school_id
    and u.role = 'school_admin'::public.user_role
    and u.is_active;

  return new;
end; $$;

alter function public._notify_school_bulk_import() owner to postgres;

drop trigger if exists trg_notify_school_bulk_import on public.audit_log;
create trigger trg_notify_school_bulk_import
  after insert on public.audit_log
  for each row execute function public._notify_school_bulk_import();

notify pgrst, 'reload schema';
