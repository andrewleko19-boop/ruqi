-- ════════════════════════════════════════════════════════════════════════════
--  نُسخُ المدارس تعرف أصلَها بمعرّفه لا باسمه.
--
--  subjects نسخةٌ لكلّ مدرسةٍ وصفّ من مادّةٍ في الفهرس المركزيّ، ولم يكن بينهما
--  رابطٌ إلا تطابقُ الاسم نصّاً: sync_full_marks_from_catalog تُطابق
--  trim(s.name) = trim(c.name). فيوم تُصحَّح تسميةٌ في الفهرس — «اللغة العربية»
--  ← «اللغة العربية»، أو تُزال «الـ» — تنقطع المزامنة عن كلّ نسخةٍ قائمة بصمت:
--  لا خطأ، ولا صفٌّ يُحدَّث، ولا شيء يقول إنّ الرابط انفصل. والوزارة تظنّ أنّها
--  ضبطت راية «النشاط» لكلّ القطر وهي لم تصل مدرسةً واحدة.
--
--  ولا يقتصر الأمر على الإملاء: ar_norm موجودةٌ في القاعدة لأنّ «إ/أ/آ» و«ى/ي»
--  و«ة/ه» تُكتب على وجوه، فالمطابقة النصّية هشّةٌ بطبعها.
--
--  الحلّ ربطٌ صريح: subjects.catalog_id. يُملأ بالاسم مرّةً واحدةً في هذه
--  الهجرة — بالتطبيع لا بالنصّ الخام لنلتقط ما اختلف رسمُه — ثمّ لا يُقرأ الاسم
--  في المزامنة بعدها أبداً. وإعادةُ التسمية تصير ما ينبغي أن تكون: تغييرَ
--  عنوانٍ لا قطعَ نسب.
--
--  والحذف ON DELETE SET NULL لا CASCADE: حذفُ مادّةٍ من الفهرس المركزيّ لا يجوز
--  أن يمسّ نسخةً في مدرسةٍ ومعها درجاتُ طلابها. تصير النسخة محلّيةً بلا أصل.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.subjects
  add column if not exists catalog_id uuid
    references public.subject_catalog(id) on delete set null;

create index if not exists subjects_catalog_idx
  on public.subjects (catalog_id) where catalog_id is not null;

comment on column public.subjects.catalog_id is
  'أصلُ المادّة في الفهرس المركزيّ. المزامنة تتبعه لا الاسم — فإعادة التسمية لا تقطعها.';

-- التعبئة لمرّةٍ واحدة: أقربُ ما يمكن للمطابقة النصّية القديمة، مع التطبيع
-- العربيّ لنلتقط ما اختلف رسمُه وحده. وما لم يُطابق يبقى null — نسخةٌ محلّية
-- أنشأتها المدرسة بيدها، ولا يصحّ أن نُلحقها بأصلٍ لم تختره.
update public.subjects s
   set catalog_id = c.id
  from public.subject_catalog c
 where s.catalog_id is null
   and public.ar_norm(s.name) = public.ar_norm(c.name);

-- ── المزامنة تتبع المعرّف ────────────────────────────────────────────────────
-- وتُرجع الآن ما لم يُربط كذلك: رقمٌ يقول للوزارة «هذه النسخ لا أصل لها في
-- الفهرس» بدل صمتٍ يُقرأ نجاحاً.
drop function if exists public.sync_full_marks_from_catalog();

create or replace function public.sync_full_marks_from_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_synced   int;
  v_unlinked int;
begin
  if not exists (
    select 1 from public.users u where u.id = auth.uid() and u.role = 'ministry_user'
  ) then
    raise exception 'غير مصرّح';
  end if;

  -- التقاطُ ما نشأ بعد آخر مزامنة: مدرسةٌ أنشأت نسخةً باسمٍ مطابق تُربط الآن،
  -- فلا تبقى خارج المزامنة إلى الأبد لمجرّد أنّها تأخّرت.
  update public.subjects s
     set catalog_id = c.id
    from public.subject_catalog c
   where s.catalog_id is null
     and public.ar_norm(s.name) = public.ar_norm(c.name);

  update public.subjects s
     set allow_full_marks = c.allow_full_marks
    from public.subject_catalog c
   where s.catalog_id = c.id
     and s.allow_full_marks is distinct from c.allow_full_marks;

  get diagnostics v_synced = row_count;

  select count(*)::int into v_unlinked
    from public.subjects s where s.catalog_id is null;

  return jsonb_build_object('synced', v_synced, 'unlinked', v_unlinked);
end; $$;

alter function public.sync_full_marks_from_catalog() owner to postgres;

revoke all on function public.sync_full_marks_from_catalog() from public, anon;
grant execute on function public.sync_full_marks_from_catalog() to authenticated, service_role;

notify pgrst, 'reload schema';
