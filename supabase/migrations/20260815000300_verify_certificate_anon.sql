-- ════════════════════════════════════════════════════════════════════════════
--  صفحةُ التحقّق من الجلاء: تعمل أصلاً، ولا تُفشي أكثر ممّا على الورقة.
--
--  علّتان اجتمعتا في مسارٍ واحد لا يمرّ به أحدٌ منّا يومياً — لأنّه يبدأ بمسح
--  رمزٍ مطبوعٍ على ورقة، لا بضغطة زرٍّ في التطبيق:
--
--  ١) صلاحية التنفيذ ممنوحة لـ authenticated و service_role فقط في هذه الهجرات
--     (docs/database-setup.sql وحده يمنح anon، وهو ليس ما يُنشر). و verify.js
--     يستدعي الدالّة بمفتاح anon بلا جلسة — فكلُّ رمز QR طُبع على كلّ جلاءٍ
--     سُلِّم لولي أمرٍ يردّ 42501 ويعرض «تعذّر إتمام التحقّق». الميزة لم تعمل
--     يوماً في الإنتاج، ولا شكوى: من يمسح الرمز ليس مستخدماً يفتح تذكرة.
--
--  ٢) فرعُ الاحتياط كان يقرأ جدول students مباشرةً بشرط s.id = p_student وحده،
--     بلا أيّ ارتباطٍ بجلاء. فأيُّ حاملٍ لمعرّف طالب — من تصديرٍ قديم، أو رابطٍ
--     أُعيد إرساله، أو معلّمٍ سابق — كان يقرأ بلا تسجيل دخول: اسمَ الطفل الكامل،
--     ومدرستَه الحاليّة، ومديريّتَها، وصفَّه. لا اسمَ الطفل هو السرّ هنا: هو
--     مطبوعٌ على الورقة التي يحملها الماسح. السرّ هو **أين هو الآن** — استعلامٌ
--     يبقى حيّاً بعد انتقال الطفل مدرسةً ومدينة، وهذا تعقُّبُ قاصر لا تحقّقُ
--     وثيقة.
--
--  الإصلاح: لا مسارَ إلى students من غير مسجَّلٍ ألبتّة. الجواب يأتي من لقطة
--  الجلاء نفسها أو لا يأتي. وما لم يصدر رسميّاً لا تُكشف نتيجتُه ولا نسبتُه —
--  «الجلاء موجود ولم يصدر بعد» جوابٌ كافٍ لكشف ورقةٍ مزوّرة أو سابقةٍ لأوانها،
--  ونجاحُ الطالب أو رسوبه قرارٌ لا يُعلَن قبل اعتماد المديرية.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.verify_certificate(
  p_student uuid,
  p_year    text default null
) returns table(
  student_name     text,
  school_name      text,
  directorate_name text,
  class_label      text,
  academic_year    text,
  result           text,
  final_percent    numeric,
  issued           boolean
) language plpgsql stable security definer set search_path = public as $$
declare
  v_year text;
begin
  if p_student is null then return; end if;

  v_year := nullif(btrim(coalesce(p_year, '')), '');

  return query
  select (elem->>'name')::text,
         sc.name::text,
         coalesce(rs.snapshot_data->>'directorate', d.name)::text,
         coalesce(rs.snapshot_data->>'classLabel', '')::text,
         rs.academic_year::text,
         -- النتيجة والنسبة للصادر وحده: ما لم تعتمده المديرية لا يُعلَن.
         case when rs.status = 'issued' then (elem->>'result')::text end,
         case when rs.status = 'issued'
              then nullif(elem->>'finalPercent', '')::numeric end,
         (rs.status = 'issued')
    from public.result_sheets rs
    cross join lateral jsonb_array_elements(
           coalesce(rs.snapshot_data->'students', '[]'::jsonb)) elem
    left join public.schools      sc on sc.id = rs.school_id
    left join public.directorates d  on d.id  = sc.directorate_id
   where rs.deleted_at is null
     and elem->>'studentId' = p_student::text
     and (v_year is null or rs.academic_year = v_year)
   -- الصادر أوّلاً: طالبٌ له جلاءٌ صادر وآخر مُرسَل يُجاب بالصادر.
   order by (rs.status = 'issued') desc,
            rs.academic_year desc,
            rs.issued_at desc nulls last
   limit 1;
end; $$;

alter function public.verify_certificate(uuid, text) owner to postgres;

revoke all on function public.verify_certificate(uuid, text) from public;
grant execute on function public.verify_certificate(uuid, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
