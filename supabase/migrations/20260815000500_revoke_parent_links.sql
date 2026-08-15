-- ════════════════════════════════════════════════════════════════════════════
--  ربطُ وليّ الأمر يُسحب حين يتغيّر الرقم — لا يبقى أبداً.
--
--  كلُّ مسارات الربط في النظام إدراجٌ فقط: parent_sync_links تُدرج ولا تحذف،
--  ودالّة الحافة parent-auth تُدرج بـ upsert. فلا يوجد في النظام كلِّه سطرٌ
--  واحدٌ يسحب ربطاً.
--
--  والوصول مشتقٌّ من رقمٍ يتغيّر: تُصحَّح غلطةٌ في رقم أُدخل خطأً، أو تُبدّل
--  الأسرة رقمها، أو تنتقل الحضانة. فمن كان رقمه مسجَّلاً لحظةَ التسجيل يبقى له
--  وصولٌ دائم إلى سجلّ الطفل — علاماتُه ودوامُه وحالة قيده — وتصلُه إشعاراتُه.
--  والمدرسة التي صحّحت الرقم تظنّ أنّها أغلقت الباب، وليس في الشاشة ما يقول
--  إنّ الباب ما زال مفتوحاً، ولا سجلٌّ يُراجَع.
--
--  حارسان لا واحد:
--   ١) زنادٌ على students عند تغيّر الرقم — السحبُ فوريّ عند مصدر التغيير، لا
--      ينتظر أن يفتح أحدٌ التطبيق. ولو لم يفتح صاحبُ الرقم القديم التطبيق أبداً
--      فالربط مسحوبٌ أصلاً.
--   ٢) تنظيفٌ داخل parent_sync_links لروابط المُنادي نفسه — يلتقط ما نشأ قبل
--      هذه الهجرة، ولا يمسّ روابط أحدٍ غيره.
--
--  والمطابقة بـ _nsams_phone_core لا بالنصّ الخام: الرقم نفسه مخزَّنٌ بصيغٍ
--  شتّى (+963… و0… و00963…)، ومقارنةٌ نصّية تسحب ربطاً سليماً لمجرّد اختلاف
--  صيغة — وهذا خطأٌ أقسى من العلّة نفسها: أبٌ يفقد سجلّ ابنه بلا سبب.
-- ════════════════════════════════════════════════════════════════════════════

-- حساباتُ أولياء الأمور وحدها بريدُها ‎<هاتف>@parent.nsams.local. أيُّ ربطٍ
-- لمستخدمٍ خارج هذا النمط لا نمسّه: لا نعرف من أين جاء، والحذفُ بالظنّ أسوأ.
create or replace function public._parent_link_phone_core(p_user uuid)
returns text language sql stable security definer set search_path = public, auth as $$
  select case when au.email like '%@parent.nsams.local'
              then public._nsams_phone_core(split_part(au.email, '@', 1)) end
    from auth.users au
   where au.id = p_user
$$;

alter function public._parent_link_phone_core(uuid) owner to postgres;
revoke all on function public._parent_link_phone_core(uuid) from public, anon, authenticated;

create or replace function public._revoke_parent_links_on_phone_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- تغييرُ صيغة الرقم لا مضمونه ليس تغييراً: «0912…» ← «+963912…» الشخص نفسه.
  if public._nsams_phone_core(new.parent_phone)
       is not distinct from public._nsams_phone_core(old.parent_phone)
   and public._nsams_phone_core(new.contact_phone)
       is not distinct from public._nsams_phone_core(old.contact_phone)
  then return new; end if;

  delete from public.parent_links pl
   where pl.student_id = new.id
     and public._parent_link_phone_core(pl.user_id) is not null
     and public._parent_link_phone_core(pl.user_id)
           is distinct from public._nsams_phone_core(new.parent_phone)
     and public._parent_link_phone_core(pl.user_id)
           is distinct from public._nsams_phone_core(new.contact_phone);

  return new;
end; $$;

alter function public._revoke_parent_links_on_phone_change() owner to postgres;

drop trigger if exists trg_revoke_parent_links on public.students;
create trigger trg_revoke_parent_links
  after update of parent_phone, contact_phone on public.students
  for each row execute function public._revoke_parent_links_on_phone_change();

-- ── الحارس الثاني: parent_sync_links تُنظّف روابط مُناديها ───────────────────
--  كانت تُدرج وحدها. الآن تُوازن: تُدرج ما طابق، وتحذف ما لم يعد يطابق — لهذا
--  المستخدم وحده (auth.uid())، فلا يمسّ مستخدمٌ روابط غيره ولو حاول.
--  والعائد يبقى «عدد ما أُضيف» كما كان: بوّابة الأهل تطبعه في سجلّ التشخيص.
create or replace function public.parent_sync_links() returns integer
    language plpgsql security definer set search_path = public as $$
declare
  myemail text;
  myphone text;
  mycore  text;
  n integer;
begin
  select email into myemail from auth.users where id = auth.uid();
  if myemail is null or myemail not like '%@parent.nsams.local' then
    return 0;
  end if;

  myphone := split_part(myemail, '@', 1);          -- ‎+9639XXXXXXXX
  mycore  := public._nsams_phone_core(myphone);    -- 9XXXXXXXX
  if mycore is null or length(mycore) < 6 then
    return 0;
  end if;

  insert into public.parent_links (user_id, student_id)
  select auth.uid(), s.id
    from public.students s
   where s.is_active = true
     and (
       public._nsams_phone_core(s.parent_phone)  = mycore
       or public._nsams_phone_core(s.contact_phone) = mycore
     )
  on conflict (user_id, student_id) do nothing;

  get diagnostics n = row_count;

  -- ما لم يعد رقمُه مطابقاً يُسحب. والطالب المؤرشَف (is_active = false) يبقى
  -- مرئياً لأهله ما دام الرقم مطابقاً: أرشفةُ سجلٍّ ليست سحبَ حقٍّ في تاريخه.
  delete from public.parent_links pl
   where pl.user_id = auth.uid()
     and not exists (
       select 1 from public.students s
        where s.id = pl.student_id
          and (public._nsams_phone_core(s.parent_phone)  = mycore
            or public._nsams_phone_core(s.contact_phone) = mycore)
     );

  return n;
end; $$;

alter function public.parent_sync_links() owner to postgres;

notify pgrst, 'reload schema';
