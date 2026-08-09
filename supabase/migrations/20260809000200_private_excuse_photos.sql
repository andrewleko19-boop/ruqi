-- ════════════════════════════════════════════════════════════════════════════
--  تحويل صور أعذار الغياب إلى دلوٍ خاصّ بروابط موقّعة.
--
--  الحالة قبل: الدلو excuse-photos معلَّمٌ public=true، والعميل يخزّن ناتج
--  getPublicUrl في absence_excuses.photo_url. فالتقرير الطبّي لأيّ طالب يفتحه
--  أيُّ شخصٍ يملك الرابط بلا تسجيل دخولٍ إطلاقاً — وثيقةٌ صحّية لقاصر. عشوائيّةُ
--  اسم الملفّ «أمنٌ بالغموض» لا حماية: الرابط يُسرَّب بالمشاركة أو سجلّات
--  الوسيط أو زرّ «نسخ الرابط»، وهو صالحٌ إلى الأبد بعدها.
--
--  بعد: الدلو خاصّ، ولا يُقرأ ملفٌّ إلّا عبر رابطٍ موقَّتٍ يولّده الخادم لمن
--  تُثبت سياسةُ RLS حقَّه — وليُّ أمر الطالب صاحب العذر، أو مدير مدرسته.
--
--  ملاحظة جانبية مقصودة: الشرط يربط الملفَّ بصفٍّ في absence_excuses يشير إليه.
--  فحين يُزيل الوليّ الصورة عند إعادة التقديم يصبح الملفّ اليتيم غيرَ مقروءٍ
--  لأحد تلقائياً، بلا حاجة إلى كنسٍ دوريّ.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) توحيد المخزَّن إلى مسارٍ مجرّد ────────────────────────────────────────
--  الصفوف القديمة تحمل رابطاً كاملاً (…/object/public/excuse-photos/excuses/x).
--  السياسات أدناه تقارن بـstorage.objects.name وهو مسارٌ مجرّد، فبلا هذا
--  التوحيد تفشل المطابقة على كلّ صفٍّ قديم وتصير صوره غير مقروءةٍ لأحد.
update public.absence_excuses
set    photo_url = regexp_replace(photo_url, '^.*/excuse-photos/', '')
where  photo_url is not null
  and  photo_url like '%/excuse-photos/%';

-- المطابقة تتمّ لكلّ طلب توقيع، فتستحقّ فهرساً.
create index if not exists absence_excuses_photo_url_idx
  on public.absence_excuses (photo_url)
  where photo_url is not null;

-- ── 2) الدلو يصير خاصّاً ─────────────────────────────────────────────────────
update storage.buckets set public = false where id = 'excuse-photos';

-- ── 3) من يقرأ الملفّ ───────────────────────────────────────────────────────
--  createSignedUrl لا يوقّع إلّا لمن يملك SELECT على الصفّ، فهذه السياسات هي
--  الحارس الفعليّ. الشرط الأوّل bucket_id يقصر الأثر على هذا الدلو وحده.

drop policy if exists parent_read_excuse_photos on storage.objects;
create policy parent_read_excuse_photos on storage.objects
  for select to authenticated
  using (
    bucket_id = 'excuse-photos'
    and exists (
      select 1
      from   public.absence_excuses e
      join   public.parent_links pl on pl.student_id = e.student_id
      where  pl.user_id  = auth.uid()
        and  e.photo_url = storage.objects.name
    )
  );

--  مدير المدرسة يحكم على العذر، فلا معنى لحجب مرفقه عنه. البوّابة لا تعرض
--  الصورة اليوم، لكنّ الصلاحية تتبع المسؤولية لا الواجهة القائمة.
drop policy if exists school_admin_read_excuse_photos on storage.objects;
create policy school_admin_read_excuse_photos on storage.objects
  for select to authenticated
  using (
    bucket_id = 'excuse-photos'
    and public.current_user_role() = 'school_admin'
    and exists (
      select 1
      from   public.absence_excuses e
      where  e.photo_url = storage.objects.name
        and  e.school_id = public.current_user_school_id()
    )
  );
