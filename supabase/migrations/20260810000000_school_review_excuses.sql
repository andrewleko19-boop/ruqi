-- ════════════════════════════════════════════════════════════════════════════
--  جانبُ المدرسة من عذر الغياب — المراجعة، واسمُ المدرسة عند وليّ الأمر.
--
--  الحالة قبل: وليّ الأمر يرفع تقريراً طبّياً فيستقرّ الصفّ في absence_excuses
--  بحالة 'pending' … إلى الأبد. لا سياسة UPDATE لأحد، ولا واجهةَ مراجعةٍ في أيّ
--  بوّابة. فالميزة كاملةٌ في نصفها المرسِل ومعدومةٌ في نصفها المستقبِل: الوليّ
--  يرى «بانتظار المراجعة» ولا مراجِعَ موجوداً في النظام أصلاً.
--
--  وإضافةً: نستعلم عن اسم مدرسة الطالب ضمن parentGetMyStudents، وليس على
--  schools أيُّ سياسةِ قراءةٍ لوليّ الأمر — فيعود الاسم null صامتاً وتظهر
--  بطاقةُ «المدرسة» فارغةً في البوّابة.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) وليّ الأمر يقرأ مدرسة ابنه ────────────────────────────────────────────
--  محصورٌ بمدارس الأبناء المرتبطين — لا بجدول المدارس كلّه.
drop policy if exists parent_read_linked_school on public.schools;
create policy parent_read_linked_school on public.schools
  for select to authenticated
  using (
    exists (
      select 1
      from   public.parent_links pl
      join   public.students s on s.id = pl.student_id
      where  pl.user_id  = auth.uid()
        and  s.school_id = schools.id
    )
  );

-- ── 2) مراجعةُ العذر ────────────────────────────────────────────────────────
--  دالّةٌ لا سياسةُ UPDATE، للسبب نفسه الموثَّق في هجرة إعادة التقديم: السياسة
--  تحكم أيَّ الصفوف تُحدَّث لا أيَّ الأعمدة. مديرٌ يملك UPDATE «مشروعاً» على
--  أعذار مدرسته يستطيع تغيير date أو reason أو student_id — أي تزوير مستند
--  قدّمه وليّ الأمر. هنا تتغيّر أعمدةُ الحكم وحدها.
--
--  والقرار يُسحب إلى سجلّ الحضور في المعاملة نفسها: عذرٌ مقبولٌ ويومٌ يبقى
--  'absent' في daily_student_attendance يعني أنّ الإحصاءات والإنذارات وحدَّ
--  الغياب تُحتسب على طالبٍ عُذرُه مقبول. القبولُ يقلب اليوم إلى 'excused'،
--  والعدولُ عن قبولٍ سابق يعيده 'absent' — فلا يبقى أثرٌ لقرارٍ مُلغى.
create or replace function public.school_review_excuse(
  p_excuse_id uuid,
  p_decision  text,
  p_note      text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_excuse   public.absence_excuses%rowtype;
  v_prev     text;
begin
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'قرار غير صالح';
  end if;

  -- الرفض بلا سبب يترك وليّ الأمر أمام «مرفوض» مجرّدة لا يعرف كيف يصحّحها،
  -- وهو الطريق المسدود الذي فُتِح أصلاً بإعادة التقديم.
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'سبب الرفض مطلوب';
  end if;

  -- الصلاحية والصفّ في خطوةٍ واحدة: العذر يخصّ مدرسةَ المستدعي وهو مديرها.
  select e.* into v_excuse
  from   public.absence_excuses e
  where  e.id        = p_excuse_id
    and  e.school_id = public.current_user_school_id()
    and  public.current_user_role() = 'school_admin';

  if not found then
    raise exception 'لا يمكن مراجعة هذا العذر';
  end if;

  v_prev := v_excuse.status;

  update public.absence_excuses
  set    status      = p_decision,
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = auth.uid(),
         updated_at  = now()
  where  id = p_excuse_id;

  if p_decision = 'accepted' then
    -- الغياب وحده يُحوَّل. الحاضر والمتأخّر لا يُمَسّان: عذرٌ قُدِّم عن يومٍ
    -- سُجِّل فيه الطالب حاضراً لا يجوز أن يمحو حضوره.
    update public.daily_student_attendance
    set    status = 'excused'
    where  student_id = v_excuse.student_id
      and  date       = v_excuse.date
      and  status     = 'absent';

  elsif v_prev = 'accepted' then
    -- عدولٌ عن قبول: يعود اليوم غياباً غير مبرَّر كما كان قبل القرار.
    update public.daily_student_attendance
    set    status = 'absent'
    where  student_id = v_excuse.student_id
      and  date       = v_excuse.date
      and  status     = 'excused';
  end if;
end;
$$;

revoke all     on function public.school_review_excuse(uuid, text, text) from public, anon;
grant  execute on function public.school_review_excuse(uuid, text, text) to authenticated;
