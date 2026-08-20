-- ════════════════════════════════════════════════════════════════════════════
--  قواعدُ النجاح: من أرقامٍ صمّاءَ في المتصفّح إلى لائحةٍ يضبطها المشرف.
--
--  الحالُ قبل هذه الهجرة — وهي أسوأُ ممّا تبدو:
--
--   ١) جدولُ grade_pass_rules، وهو ما تعدّله نافذةُ «قواعد النجاح» في لوحة
--      المشرف، **لا يحكم شيئاً**. يُقرأ في مسارٍ واحدٍ يتيم
--      (applyCatalogSubjectsToGrades) ليزرع subjects.pass_mark لحظةَ نسخ موادّ
--      الفهرس إلى مدرسة، ثمّ لا يُقرأ أبداً. فالمشرفُ يعدّل ويحفظ ويرى «تمّ»،
--      والنتيجةُ لا تتغيّر.
--
--   ٢) الحكمُ الحقيقيّ في computeYearResult بـ shared/db.js، كلُّ عتباته
--      حرفيّةٌ في الشيفرة، وفيه خمسُ مخالفاتٍ للّائحة السورية:
--
--      · الرياضياتُ تأخذ عتبةَ العربية (٥٠٪) في **كلّ** الصفوف. واللائحةُ
--        تجعلها أساسيةً في الصفوف ١–٤ وحدها؛ ومن الخامس حدُّها ٤٠٪ كسائر
--        المواد، والعربيةُ وحدها ٥٠٪.
--      · شرطُ «المجموع ≥ ٥٠٪» لازمٌ للنجاح — **ولا وجودَ له في اللائحة**.
--        طالبٌ نجح في كلّ مادّةٍ بـ٤٥٪ يرسب اليوم ظلماً.
--      · «حتى مادّتين دون ٤٠٪ تمرّان دائماً» — واللائحةُ تقول: مادّةٌ واحدة
--        تُتجاوَز بلا شرط، ومادّتان **بشرط الربع** (مجموعُ درجتيهما ≥ ٢٥٪ من
--        مجموع نهايتيهما العظميين)، وثلاثٌ رسوبٌ حتميّ. فشرطُ الربع ساقطٌ كلّياً.
--      · الصفوف ١–٤: عتبةُ سطر المادة ٤١ وعتبةُ الحكم النهائيّ ٥٠ — رقمان
--        متناقضان على البطاقة الواحدة.
--      · «السلوك ≥ ٦٠٪» شرطٌ لازمٌ للصفّ السابع فأعلى — ليس في اللائحة.
--
--      وناقصٌ كلّياً: شرطُ اللغة الأجنبية للعاشر والحادي عشر.
--
--  هذه الهجرة تبني النموذجَ الذي يستطيع أن يحمل اللائحة، والمحرّكُ في db.js
--  يستهلكه. المبدأ: **كلُّ عتبةٍ لها صاحبٌ يضبطها، ولا رقمَ محشوٌّ في شيفرة.**
-- ════════════════════════════════════════════════════════════════════════════

-- ── ١) core_pass اسمٌ يكذب على استعماله ─────────────────────────────────────
--  كان يعني «العربي/الرياضيات» معاً، وهو تعميمٌ خاطئ أصلاً. صار عتبةَ العربية
--  وحدها، ودخولُ الرياضيات يُقرَّر برايةٍ مستقلّة. إعادةُ التسمية على نمط
--  teaching_hours → weekly_lessons: الاسمُ يقول ما يفعله.
do $ruqi_rename$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'grade_pass_rules'
      and column_name = 'core_pass'
  ) then
    alter table public.grade_pass_rules rename column core_pass to arabic_pass;
  end if;
end
$ruqi_rename$;

-- ── ٢) أعمدةُ اللائحة ───────────────────────────────────────────────────────
alter table public.grade_pass_rules
  -- الرياضياتُ أساسيةٌ (تأخذ عتبةَ العربية وتدخل قاعدةَ الأساسيات): ١–٤ فقط.
  add column if not exists math_is_core             boolean not null default false,
  -- كم مادّةً يُتجاوَز الرسوبُ فيها بلا أيّ شرط.
  add column if not exists free_fails               integer not null default 1,
  -- وحتى كم مادّةً يُتجاوَز بشرط الربع. ما فوقها رسوبٌ حتميّ.
  add column if not exists quarter_fails            integer not null default 2,
  -- نسبةُ «شرط الربع» من مجموع النهايات العظمى للموادّ الراسبة.
  add column if not exists quarter_pct              integer not null default 25,
  -- العاشر والحادي عشر: يجب النجاحُ بلغةٍ أجنبيةٍ واحدة على الأقلّ.
  add column if not exists require_foreign_language boolean not null default false,
  -- الفارغُ يعني «لا شرط» لا صفراً. على مبدأ 20260819000100: لا رقمَ بلا صاحب،
  -- ورقمٌ مفترَضٌ هنا يُرسِب طالباً باسم قاعدةٍ لم يضعها أحد.
  add column if not exists conduct_min              integer,
  add column if not exists total_min                integer;

comment on column public.grade_pass_rules.arabic_pass is
  'عتبةُ نجاح اللغة العربية (٪ من النهاية العظمى). ٥٠٪ في اللائحة السورية.';
comment on column public.grade_pass_rules.default_pass is
  'عتبةُ نجاح المادّة العادية (٪ من النهاية العظمى). ٤٠٪ من الصفّ الخامس فأعلى.';
comment on column public.grade_pass_rules.math_is_core is
  'الرياضياتُ أساسيةٌ في هذا النطاق (تأخذ عتبةَ العربية). صحيحٌ في الصفوف ١–٤ وحدها.';
comment on column public.grade_pass_rules.quarter_pct is
  'شرطُ الربع: يُتجاوَز الرسوبُ بمادّتين إن كان مجموعُ درجتيهما ≥ هذه النسبة من مجموع نهايتيهما.';
comment on column public.grade_pass_rules.conduct_min is
  'أدنى نسبةِ سلوكٍ للنجاح. فارغ = لا شرط — وهو الوضعُ في اللائحة.';
comment on column public.grade_pass_rules.total_min is
  'أدنى نسبةِ مجموعٍ للنجاح. فارغ = لا شرط — واللائحةُ لا تشترط مجموعاً.';

-- ── ٣) قيودٌ حقيقية ─────────────────────────────────────────────────────────
--  الجدولُ كان بلا قيدٍ إطلاقاً: نطاقٌ مقلوب، أو نطاقان متداخلان، ودالّةُ الحلّ
--  تأخذ أوّلَ مطابقٍ بـ.find() — فيصير الحكمُ رهنَ ترتيب الصفوف لا القاعدة.
alter table public.grade_pass_rules
  drop constraint if exists grade_pass_rules_range_chk;
alter table public.grade_pass_rules
  add  constraint grade_pass_rules_range_chk check (
    grade_from between 1 and 12
    and grade_to between grade_from and 12
    and default_pass between 0 and 100
    and arabic_pass  between 0 and 100
    and free_fails    >= 0
    and quarter_fails >= free_fails
    and quarter_pct   between 0 and 100
  );

-- منعُ التداخل يحتاج btree_gist للمزج بين = و&& — والامتدادُ قياسيّ في Supabase.
create extension if not exists btree_gist;
alter table public.grade_pass_rules
  drop constraint if exists grade_pass_rules_no_overlap;
alter table public.grade_pass_rules
  add  constraint grade_pass_rules_no_overlap
  exclude using gist (int4range(grade_from, grade_to, '[]') with &&);

-- ── ٤) رايةُ «مادةٌ لغةٌ أجنبية» ────────────────────────────────────────────
--  is_core_arabic و is_core_math عمودان منطقيّان قائمان، وهذه ثالثتُهما. بلا
--  رايةٍ صريحة لا سبيلَ إلى تطبيق شرط اللغة الأجنبية إلّا بمطابقة الأسماء
--  نصّاً — وهي العلّةُ التي هجرها هذا المستودع مرّةً في 20260816000000.
alter table public.subjects
  add column if not exists is_foreign_language boolean not null default false;
alter table public.subject_catalog
  add column if not exists is_foreign_language boolean not null default false;

comment on column public.subjects.is_foreign_language is
  'مادّةُ لغةٍ أجنبية. الصفّان العاشر والحادي عشر: يجب النجاحُ بواحدةٍ منها على الأقلّ.';

-- ── ٥) زرعُ اللائحة الوطنية ─────────────────────────────────────────────────
--  ثلاثةُ نطاقاتٍ لا اثنان. تُستبدل الصفوفُ القائمة بالكامل: النطاقان القديمان
--  (١–٤ و ٥–١٢) لا يمكن ترقيتُهما لأنّ ٥–١٢ يخلط الحلقةَ الثانية بالثانويّ،
--  وهما يفترقان في شرط اللغة الأجنبية.
delete from public.grade_pass_rules;

insert into public.grade_pass_rules
  (grade_from, grade_to, default_pass, arabic_pass, math_is_core,
   free_fails, quarter_fails, quarter_pct, require_foreign_language,
   conduct_min, total_min, sort_order)
values
  -- الحلقة الأولى: تقديراتٌ لا درجات. الأساسياتُ الثلاث (شفويّ عربي، كتابيّ
  -- عربي، رياضيات) — يرسب بأكثر من «ضعيف» واحدٍ فيها. لا قاعدةَ تجاوزٍ هنا.
  (1,  4, 41, 41, true,  0, 0, 0,  false, null, null, 0),
  -- الحلقة الثانية وشهادةُ التعليم الأساسي.
  (5,  9, 40, 50, false, 1, 2, 25, false, null, null, 1),
  -- الثانويّ الانتقاليّ والبكالوريا: يُضاف شرطُ اللغة الأجنبية.
  (10, 12, 40, 50, false, 1, 2, 25, true,  null, null, 2);

-- ── ٥ب) تنزيلُ اللائحة على الموادّ القائمة فوراً ────────────────────────────
--  الموادُّ المنشأةُ قبل اليوم تحمل عتباتٍ زُرعت بالقاعدة القديمة — وأشهرُها
--  رياضياتُ الصفّ التاسع بعتبة ٥٠٪ وحدُّها النظاميّ ٤٠٪. تصحيحُ القاعدة وحده
--  لا يمسّها، فتُصحَّح هنا مرّةً واحدة. وما بعدها تتكفّل به
--  sync_pass_marks_from_rules عند كلّ حفظٍ من لوحة المشرف.
do $ruqi_sync$
declare
  v_fixed integer;
begin
  update public.subjects s
     set pass_mark = case
           when s.is_core_arabic then r.arabic_pass
           when s.is_core_math and r.math_is_core then r.arabic_pass
           else r.default_pass
         end
    from public.grade_pass_rules r
   where s.grade between r.grade_from and r.grade_to
     and s.pass_mark is distinct from (case
           when s.is_core_arabic then r.arabic_pass
           when s.is_core_math and r.math_is_core then r.arabic_pass
           else r.default_pass
         end);

  get diagnostics v_fixed = row_count;
  raise notice 'موادُّ صُحّحت عتباتُها: %', v_fixed;
end
$ruqi_sync$;

-- ── ٦) الحفظُ عمليةٌ ذرّية ──────────────────────────────────────────────────
--  كان في db.js: حذفٌ شاملٌ ثمّ إدراج، بنداءَين منفصلين وبلا معاملة. فشلُ
--  الإدراج بعد نجاح الحذف يترك الجدولَ **فارغاً** — أي بلا قواعدِ نجاحٍ للقُطر
--  كلِّه، ولا سبيلَ إلى معرفة ذلك إلّا بفتح النافذة.
create or replace function public.set_grade_pass_rules(p_rules jsonb)
returns setof public.grade_pass_rules
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.is_active
      and u.role = 'ministry_user'::public.user_role
  ) then
    raise exception 'غير مصرّح: ضبطُ قواعد النجاح للوزارة وحدها';
  end if;

  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then
    raise exception 'قواعد النجاح لا يجوز أن تكون فارغة';
  end if;

  -- الحذفُ والإدراج في جسم دالّةٍ واحدة: معاملةٌ ضمنية، فإمّا أن تتمّ كلُّها
  -- أو يبقى الجدولُ على حاله. والقيدُ يرفض التداخل قبل أن يُكتب شيء.
  delete from public.grade_pass_rules;

  insert into public.grade_pass_rules (
    grade_from, grade_to, default_pass, arabic_pass, math_is_core,
    free_fails, quarter_fails, quarter_pct, require_foreign_language,
    conduct_min, total_min, sort_order
  )
  select
    (r->>'grade_from')::int,
    (r->>'grade_to')::int,
    coalesce((r->>'default_pass')::int, 40),
    coalesce((r->>'arabic_pass')::int, 50),
    coalesce((r->>'math_is_core')::boolean, false),
    coalesce((r->>'free_fails')::int, 1),
    coalesce((r->>'quarter_fails')::int, 2),
    coalesce((r->>'quarter_pct')::int, 25),
    coalesce((r->>'require_foreign_language')::boolean, false),
    nullif(r->>'conduct_min', '')::int,
    nullif(r->>'total_min', '')::int,
    (ord - 1)::int
  from jsonb_array_elements(p_rules) with ordinality as t(r, ord);

  return query select * from public.grade_pass_rules order by sort_order, grade_from;
end; $$;

alter function public.set_grade_pass_rules(jsonb) owner to postgres;
revoke all on function public.set_grade_pass_rules(jsonb) from public, anon;
grant execute on function public.set_grade_pass_rules(jsonb) to authenticated;
comment on function public.set_grade_pass_rules(jsonb) is
  'استبدالٌ ذرّيّ لقواعد النجاح كلِّها. للوزارة وحدها. الفشلُ يُبقي القديمَ سليماً.';

-- ── ٧) القواعدُ تصل الموادّ القائمة ─────────────────────────────────────────
--  بلا هذه الدالّة يبقى تعديلُ القواعد بلا أثرٍ على مدرسةٍ أنشأت موادَّها
--  سابقاً — تحمل عتباتٍ من عهدٍ مضى إلى الأبد. النظيرُ القائم:
--  sync_full_marks_from_catalog.
create or replace function public.sync_pass_marks_from_rules()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_synced int;
begin
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.is_active
      and u.role = 'ministry_user'::public.user_role
  ) then
    raise exception 'غير مصرّح';
  end if;

  update public.subjects s
     set pass_mark = case
           when s.is_core_arabic then r.arabic_pass
           when s.is_core_math and r.math_is_core then r.arabic_pass
           else r.default_pass
         end
    from public.grade_pass_rules r
   where s.grade between r.grade_from and r.grade_to
     and s.pass_mark is distinct from (case
           when s.is_core_arabic then r.arabic_pass
           when s.is_core_math and r.math_is_core then r.arabic_pass
           else r.default_pass
         end);

  get diagnostics v_synced = row_count;
  return jsonb_build_object('synced', v_synced);
end; $$;

alter function public.sync_pass_marks_from_rules() owner to postgres;
revoke all on function public.sync_pass_marks_from_rules() from public, anon;
grant execute on function public.sync_pass_marks_from_rules() to authenticated;
comment on function public.sync_pass_marks_from_rules() is
  'تنزيلُ عتبات القواعد على subjects.pass_mark القائمة. بدونها يبقى التعديلُ حبراً على الجدول.';
