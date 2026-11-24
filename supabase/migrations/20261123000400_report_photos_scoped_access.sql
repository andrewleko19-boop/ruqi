-- ═════════════════════════════════════════════════════════════════════════════
--  صور البلاغات الطارئة (bucket report-photos): قراءةٌ مقيَّدة + سياسة رفعٍ حديثة.
--
--  المشكلة: السياسة الحيّة "report photos public read" (TO public، بلا شرط دور) تسمح لأيّ
--  حاملٍ لمفتاح anon العلنيّ بسرد ملفّات الـbucket وتوقيع روابطها رغم أنّ public=false.
--
--  هذه الهجرة (3أ + 3ب) **تُضيف** سياسة قراءةٍ مقيَّدة ولا تحذف العامّة بعد:
--    · public.can_view_report_photo(name): مَن يرى البلاغ يرى صوره — بالمنطق نفسه لسياسة
--      reports_read على emergency_reports (مدير المدرسة: مدرسته؛ المديرية: مدارسها؛ الوزارة:
--      الكلّ؛ المعلّم وولي الأمر وanon: لا شيء). صور البلاغ المحذوف ناعماً (deleted_at) تبقى
--      مرئيّةً للأدوار نفسها — كما أنّ reports_read لا يُخفي البلاغ المحذوف ناعماً (قرار المالك).
--      والملفّ الذي لا يذكره أيّ بلاغ (يتيم) لا يراه أحد.
--    · "report photos staff read": SELECT TO authenticated على report-photos بهذا المساعد.
--    · "report photos admin upload": INSERT لمدير المدرسة — current_user_role() بدل auth_role()
--      القديمة (تمهيداً لإزالة مساعدات auth_* في المرحلة 4).
--  حذفُ "report photos public read" خطوةٌ منفصلة (3ج) بعد التحقّق الحيّ.
--
--  المسار المخزَّن في emergency_reports.media_urls هو storage.objects.name نفسه
--  ('reports/<ts>_<rand>.<ext>' — shared/db.js uploadDataUri).
--  الرفع يسبق إدراج البلاغ (materialisePhotos)، فسياسة الرفع لا تشترط وجود البلاغ؛ وupload
--  بلا upsert يحتاج INSERT وحده.
--
--  idempotent: create or replace + drop policy if exists. محروسةٌ بوجود storage.objects.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.can_view_report_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from public.emergency_reports r
      join public.schools s on s.id = r.school_id
     where p_name = any (r.media_urls)
       and case public.current_user_role()
             when 'ministry_user'    then true
             when 'directorate_user' then s.directorate_id = public.current_user_directorate_id()
             when 'school_admin'     then r.school_id      = public.current_user_school_id()
             else false
           end
  );
$$;

comment on function public.can_view_report_photo(text) is
  'هل يرى المستخدم الحاليّ صورة البلاغ ذات المسار p_name؟ مَن يرى البلاغ (reports_read) يرى صوره، والمحذوف ناعماً كذلك؛ الملفّ اليتيم (لا يذكره بلاغ) لا يراه أحد.';

revoke all on function public.can_view_report_photo(text) from public;
grant execute on function public.can_view_report_photo(text) to authenticated;
grant execute on function public.can_view_report_photo(text) to service_role;

do $mig$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects غير موجود — تخطّي سياسات report-photos';
    return;
  end if;

  execute 'drop policy if exists "report photos staff read" on storage.objects';
  execute $p$
    create policy "report photos staff read" on storage.objects
      for select to authenticated
      using (bucket_id = 'report-photos' and public.can_view_report_photo(name))
  $p$;

  execute 'drop policy if exists "report photos admin upload" on storage.objects';
  execute $p$
    create policy "report photos admin upload" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'report-photos'
                  and public.current_user_role() = 'school_admin'::public.user_role)
  $p$;
end
$mig$;
