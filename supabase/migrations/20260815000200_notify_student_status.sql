-- ════════════════════════════════════════════════════════════════════════════
--  تغيّرُ حالة قيد الطالب يصل أهله.
--
--  أخطرُ إجراءٍ في النظام — إخراجُ طفلٍ من السجلّ المدرسيّ — كان يمرّ بلا أيّ
--  أثرٍ عند أهله: لا إشعار، ولا حتى قراءةُ الحقل في بوّابتهم. يُرقَّن القيدُ
--  فتظهر البوّابة كما كانت بالضبط.
--
--  والزناد على الجدول لا في الدالّة عمداً: set_student_status **لا يُستدعى من
--  أيّ مكانٍ في التطبيق** (صفرُ نتائج في البحث)، والتغيير يجري بتحديثٍ مباشر
--  من العميل (syncStudentRecord، flagStudentDropout). فالإعلام في الدالّة
--  وحدها يبقى معطّلاً كما هي. الزناد يلتقط الطريقين.
--
--  ولا يُعلَن إلا الانتقال من «نشط» إلى غيره: تصحيحُ حالةٍ خاطئة أو إعادةُ
--  كتابة الصفّ بالقيمة نفسها لا يجوز أن تُطلق إنذاراً على أهلٍ لم يتغيّر شيء
--  في ابنهم.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public._notify_parents_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'active' then return new; end if;   -- العودة للقيد لا تُنذر

  v_label := case new.status
    when 'transferred' then 'نُقل إلى مدرسة أخرى'
    when 'out_of_year' then 'أُخرج من العام الدراسي'
    when 'graduated'   then 'تخرّج'
    when 'struck_off'  then 'رُقّن قيده'
    else new.status
  end;

  perform public.notify_user(
    pl.user_id, 'student_status_changed',
    'تغيّر قيد ' || coalesce(new.full_name, 'ابنك/ابنتك'),
    v_label || case when nullif(btrim(coalesce(new.status_reason, '')), '') is not null
                    then ' — ' || new.status_reason else '' end,
    'student', new.id
  )
  from public.parent_links pl
  where pl.student_id = new.id;

  return new;
end; $$;

alter function public._notify_parents_status_change() owner to postgres;

drop trigger if exists trg_notify_parents_status on public.students;
create trigger trg_notify_parents_status
  after update of status on public.students
  for each row execute function public._notify_parents_status_change();

notify pgrst, 'reload schema';
