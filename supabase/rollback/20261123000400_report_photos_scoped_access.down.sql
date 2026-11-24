-- عكس 20261123000400 (لا يُنشر؛ يُشغَّل يدوياً في SQL Editor عند الحاجة فقط).
--
-- ⚠️ قبل التشغيل: قارن سياسة الرفع أدناه بالنصّ الحيّ السابق المحفوظ في اللقطة:
--   select definition from ruqi_backup.ddl_snapshot_20261123
--    where kind = 'policy' and identity = 'report photos admin upload';
-- وإن اختلف فاستعمل نصّ اللقطة حرفياً.
--
-- "report photos public read" لم تُمسّ في 20261123000400 فلا تُعاد هنا.

drop policy if exists "report photos staff read" on storage.objects;

drop policy if exists "report photos admin upload" on storage.objects;
create policy "report photos admin upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'report-photos' and public.auth_role() = 'school_admin');

drop function if exists public.can_view_report_photo(text);
