-- ═════════════════════════════════════════════════════════════════════════════
--  إعادةُ تسمية مادّةٍ في الفهرس المركزيّ تصل نُسخَ المدارس غير المُعدَّلة محلّياً.
--
--  العَرَض: الفهرسُ «رياضيات» ← «رياضيات متقدّمة»، فتبقى نسخةُ المدرسة (subjects.name)
--  باسمها القديم، وقائمةُ «أضف من الفهرس» تعرض الجديد → نسخةٌ ثانية في الصفّ نفسه.
--  (حارسُ التكرار في التطبيق صار بالمعرّف؛ هذه الهجرة تُبقي الاسمَ المعروض مواكباً.)
--
--  القاعدة (الأضيق الآمنة): عند تغيّر subject_catalog.name يُحدَّث subjects.name للصفوف
--  المرتبطة بالمعرّف نفسه (catalog_id) **وحدها ما دام اسمُها الحاليّ يساوي اسمَ الفهرس
--  القديم** (بعد btrim). مَن أعادت المدرسةُ تسميةَ نسختها عمداً يبقى اسمُها كما هو.
--
--  لماذا زنادٌ لا دالّةٌ يستدعيها التطبيق: اسمُ الفهرس القديم لا يُعرف إلا لحظةَ التعديل
--  (OLD)، وكتابةُ مستخدم الوزارة على subjects مدارسَ أخرى ممنوعةٌ بـRLS (subjects_write
--  مقيَّدةٌ بمدرسة المستخدم) — فيلزم SECURITY DEFINER.
--
--  ما لا تفعله: لا قيدَ فريد، ولا تنظيفَ لبياناتٍ قائمة. ولا تُصلح فروقاً سابقة
--  (اسمُ الفهرس القديم لم يُسجَّل) — تُعالَج في تنظيفٍ منفصل. ولا تمسّ الدرجات
--  (الربط بالمعرّف في student_grades لا بالاسم).
--
--  idempotent: create or replace + drop trigger if exists.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.propagate_catalog_rename()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.name is distinct from old.name then
    update public.subjects s
       set name = new.name
     where s.catalog_id = new.id
       and btrim(s.name) = btrim(old.name);
  end if;
  return new;
end;
$$;

comment on function public.propagate_catalog_rename() is
  'زنادُ subject_catalog: عند تغيّر الاسم يُحدَّث subjects.name للنسخ المرتبطة (catalog_id) التي ما زال اسمُها يساوي اسمَ الفهرس القديم؛ المُعدَّلةُ محلّياً تبقى.';

revoke all on function public.propagate_catalog_rename() from public, anon, authenticated;

drop trigger if exists trg_catalog_rename_propagate on public.subject_catalog;
create trigger trg_catalog_rename_propagate
  after update of name on public.subject_catalog
  for each row
  when (old.name is distinct from new.name)
  execute function public.propagate_catalog_rename();
