-- ════════════════════════════════════════════════════════════════════════════
--  تحصينُ سجلّ دوام الكادر: المعلّم يكتب داتَه لا حكمَ مديره.
--
--  في الأساس سياستان لكلّ أمرٍ على staff_attendance: واحدةٌ محكمة على
--  authenticated، وتوأمٌ أرخى على PUBLIC كُتب قبلها ونُسي. وسياساتُ RLS
--  للأمر الواحد تُجمَع بـ OR — فالأرخى هي النافذة، والمحكمةُ زينة:
--
--    sa_teacher_ins  (public)  check = teacher_id = auth.uid()
--    sa_teacher_insert         check = teacher_id = auth.uid() AND source='self'
--                                                               ↑ لم تُطبَّق قطّ
--
--  أُثبتت ثلاثُ ثغراتٍ على قاعدةٍ محلّية بحساب معلّمٍ مصادَق:
--
--   ١) إدراجٌ بـ source='manager' — فتظهر التسجيلةُ في بوّابة المدرسة منسوبةً
--      إلى «مدير» (school/script.js: source==='self' ? 'معلم' : 'مدير').
--      وهي تقع بلا نيّةِ عبثٍ أصلاً: teacherCheckOut لا يُرسل source، فخروجٌ
--      بلا دخولٍ يُدرِج صفّاً افتراضُ عموده 'manager'.
--
--   ٢) إدراجٌ بـ school_id لمدرسةٍ أجنبية — لا سياسةَ تُقيّد المدرسة ألبتّة.
--      الصفُّ يظهر بعدها لمدير تلك المدرسة عبر sa_admin_all (school_id فقط).
--      كتابةٌ عابرةٌ للعزل.
--
--   ٣) [الأشدّ] محوُ حكم المدير. سجّل المديرُ «غائب» بـ adjust_reason و٤٥ دقيقة
--      تأخّر و adjusted_by؛ فحدّثه المعلّمُ إلى present / late_minutes=0 /
--      adjusted_by=null / source='self'. لا سياسةَ تُقيّد الأعمدة، فذهب القرارُ
--      وأثرُه معاً — بل ولا يُشعَر أحد: زناد trg_duty_adjusted يشترط
--      adjusted_by غيرَ فارغ، والمعلّم فرّغه.
--
--  الإصلاح طبقتان، لأنّ RLS وحدَه لا يكفي هنا: WITH CHECK يرى الصفّ الجديد
--  ولا يرى القديم، فلا يستطيع قولَ «هذا العمود لا يُمَسّ».
--   · RLS: يحسم مَن يكتب وفي أيّ مدرسة (شرطٌ تصريحيّ يُرَدّ لا يُصحَّح صامتاً).
--   · زنادٌ BEFORE: يحسم أيَّ عمودٍ يكتب — يُثبّت أعمدةَ المدير على قيمها.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ١) إسقاطُ التوائم الرخوة ────────────────────────────────────────────────
--  الثلاثةُ نسخٌ أضعفُ من نظيراتها على authenticated. إسقاطها لا يفقد صلاحيةً:
--  sa_teacher_select/‏_insert/‏_update تُغطّي المسار المشروع كلَّه.
drop policy if exists "sa_teacher_ins" on public.staff_attendance;
drop policy if exists "sa_teacher_sel" on public.staff_attendance;
drop policy if exists "sa_teacher_upd" on public.staff_attendance;


-- ── ٢) تقييدُ المدرسة في سياستَي المعلّم ────────────────────────────────────
--  المدرسة تُشتقّ من حساب الكاتب، فلا يُقبل معاملُها من العميل.
drop policy if exists "sa_teacher_insert" on public.staff_attendance;
create policy "sa_teacher_insert" on public.staff_attendance
  for insert to authenticated
  with check (
        teacher_id = auth.uid()
    and kind       = 'teacher'
    and school_id  = public.current_user_school_id()
  );

drop policy if exists "sa_teacher_update" on public.staff_attendance;
create policy "sa_teacher_update" on public.staff_attendance
  for update to authenticated
  using      (teacher_id = auth.uid() and school_id = public.current_user_school_id())
  with check (teacher_id = auth.uid() and school_id = public.current_user_school_id());

-- ملاحظة: شرطُ source='self' غادر السياسةَ عمداً إلى الزناد. في السياسة كان
-- يرفض خروجَ معلّمٍ بلا دخول (الافتراض 'manager')؛ وفي الزناد يُحسم المصدرُ
-- من هويّة الكاتب لا من حمولته — وهو أصحّ: القيمةُ لم تعد ادّعاءً يُصدَّق.


-- ── ٣) الزناد: أعمدةُ المدير ليست للمعلّم ──────────────────────────────────
create or replace function public.trg_staff_att_self_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  -- لا سياقَ مصادقة ⇒ service_role أو هجرةٌ أو زناد: يمرّ.
  if v_actor is null then return new; end if;

  -- مديرُ مدرسة الصفّ يملك السجلَّ كلَّه — بمن فيهم نفسُه ككادر.
  if exists (select 1 from public.users u
              where u.id = v_actor
                and u.role = 'school_admin'::public.user_role
                and u.school_id = new.school_id) then
    return new;
  end if;

  -- ما بقي: المعلّم يكتب صفَّ نفسه. (RLS ضمنها، وهذا حزامٌ ثانٍ.)
  if new.teacher_id is distinct from v_actor then
    raise exception 'غير مصرَّح بالكتابة في سجلّ دوام غيرك' using errcode = '42501';
  end if;

  -- تاريخٌ في المستقبل لا يكون تسجيلَ حضور. +١ يوم لأنّ العميل يحسب التاريخ
  -- بتوقيت دمشق (UTC+3) والخادمَ بـ UTC: بعد التاسعة مساءً يسبقه بيوم.
  if new.date > current_date + 1 then
    raise exception 'لا يُسجَّل دوامٌ بتاريخٍ مستقبليّ' using errcode = '22007';
  end if;

  new.kind         := 'teacher';
  new.personnel_id := null;

  if TG_OP = 'INSERT' then
    -- المصدرُ يُحسم من الكاتب لا من حمولته.
    new.source        := 'self';
    new.recorded_by   := v_actor;
    -- أعمدةُ المدير تبدأ فارغةً مهما أُرسل فيها.
    new.adjusted_by       := null;
    new.adjust_reason     := null;
    new.check_in_adjusted := null;
    new.note              := null;
    return new;
  end if;

  -- تحديث: هويّةُ الصفّ ثابتة.
  new.school_id  := old.school_id;
  new.teacher_id := old.teacher_id;
  new.date       := old.date;

  -- أعمدةُ المدير محفوظةٌ على قيمها — هنا يُسدّ محوُ الحكم.
  new.source            := old.source;
  new.recorded_by       := old.recorded_by;
  new.adjusted_by       := old.adjusted_by;
  new.adjust_reason     := old.adjust_reason;
  new.check_in_adjusted := old.check_in_adjusted;
  new.note              := old.note;

  -- وقتُ الدخول الأصليّ داتُ المعلّم، لكنّه يُكتب مرّةً: تسجيلةُ الحضور الأولى
  -- هي السجلّ، وإعادةُ كتابتها تعني تقديمَ وصولٍ متأخّر.
  if old.check_in_original is not null then
    new.check_in_original := old.check_in_original;
  end if;

  -- إن كان المديرُ قد بتّ، فالحالةُ والتأخّرُ حكمُه لا حساب العميل.
  if old.adjusted_by is not null then
    new.status       := old.status;
    new.late_minutes := old.late_minutes;
  end if;

  return new;
end; $$;

alter function public.trg_staff_att_self_guard() owner to postgres;
revoke all on function public.trg_staff_att_self_guard() from public, anon;

comment on function public.trg_staff_att_self_guard() is
  'يمنع المعلّم من كتابة أعمدة المدير في staff_attendance (المصدر، التعديل، الحكم).';

drop trigger if exists t_staff_att_self_guard on public.staff_attendance;
create trigger t_staff_att_self_guard
  before insert or update on public.staff_attendance
  for each row execute function public.trg_staff_att_self_guard();

notify pgrst, 'reload schema';
