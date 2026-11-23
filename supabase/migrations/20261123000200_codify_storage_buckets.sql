-- ═════════════════════════════════════════════════════════════════════════════
--  تثبيت الـbucketين الخاصّين في git. أُنشئا من لوحة التحكّم (20260809000200 تفترض
--  excuse-photos ولا تُنشئه)، فلا يُعاد بناؤهما في بيئةٍ جديدة.
--  الحيّ: كلاهما public=false. لا تُلمس حدودُ الحجم/الأنواع ولا السياسات (المرحلة 3).
--  الحارس: غيابُ storage.buckets (بيئةٌ بلا Storage) = تخطٍّ لا فشل.
-- ═════════════════════════════════════════════════════════════════════════════
do $mig$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets غير موجود — تخطّي';
    return;
  end if;

  insert into storage.buckets (id, name, public) values
    ('excuse-photos', 'excuse-photos', false),
    ('report-photos', 'report-photos', false)
  on conflict (id) do update set public = false;
end
$mig$;
