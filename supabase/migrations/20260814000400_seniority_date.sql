-- ════════════════════════════════════════════════════════════════════════════
--  القدم الوظيفي: تاريخٌ كامل بدل سنةٍ مجرّدة — بلا كسر البيان الشهريّ.
--
--  seniority_year عمود integer، وهو ما يُطبع في نموذج البيان الشهريّ الرسميّ
--  («القدم الوظيفي (سنة التعيين)») وفي كشوف المديرية وفي الاستيراد الجملي.
--  فتحويلُ نوعه إلى date يكسر كلّ ذلك دفعةً واحدة، ويُفقد معنى عمودٍ تعتمده
--  وثيقةٌ حكومية.
--
--  الحلّ: عمودٌ جديد seniority_date يحمل اليوم والشهر والسنة، وزنادٌ يشتقّ منه
--  seniority_year فيبقى متّسقاً مهما كان الكاتب — الواجهة أو الاستيراد الجملي
--  أو تصحيحٌ يدويّ. فالسجلّات القديمة (سنةٌ بلا تاريخ) تبقى صالحة، والجديدة
--  تحمل التاريخ الكامل، والبيان يقرأ السنة كما كان يقرؤها.
--
--  والاشتقاق باتّجاهٍ واحد عمداً: التاريخ يملي السنة ولا عكس. سنةٌ بلا يومٍ
--  ولا شهر لا تُنتج تاريخاً، ولو اختُرع لها أوّلُ كانون الثاني لبدا يوماً
--  موثَّقاً وهو تخمين.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.staff_records
  add column if not exists seniority_date date;

comment on column public.staff_records.seniority_date is
  'تاريخ التعيين كاملاً (يوم/شهر/سنة). seniority_year يُشتقّ منه بزناد ويبقى مصدرَ البيان الشهريّ.';

create or replace function public.sync_seniority_year()
returns trigger language plpgsql set search_path = public as $$
begin
  -- التاريخ يملي السنة. وإفراغُ التاريخ لا يمحو سنةً أُدخلت وحدها: سجلّات
  -- قديمة كثيرة تحمل السنة فقط، ومحوُها خسارةُ بيانٍ مقابل لا شيء.
  if new.seniority_date is not null then
    new.seniority_year := extract(year from new.seniority_date)::int;
  end if;
  return new;
end; $$;

alter function public.sync_seniority_year() owner to postgres;

drop trigger if exists trg_sync_seniority_year on public.staff_records;
create trigger trg_sync_seniority_year
  before insert or update of seniority_date on public.staff_records
  for each row execute function public.sync_seniority_year();

-- ── تحديث مخبأ مخطّط PostgREST ─────────────────────────────────────────────
--  بدونه يبقى العمود الجديد مجهولاً للـAPI دقائقَ بعد النشر، فتفشل الكتابة
--  التي تذكره بـ«column not found». وهو ما وقع فعلاً بعد تبديل تواقيع الدوال
--  في 20260814000100 و000300: ظهر «تعذّر التحميل» ثمّ زال وحده.
notify pgrst, 'reload schema';
