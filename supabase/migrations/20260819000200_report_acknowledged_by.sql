-- ════════════════════════════════════════════════════════════════════════════
--  البلاغ الطارئ: «استلمَته المديرية» لا تكفي — مَن استلمه؟
--
--  للبلاغ ثلاثُ حالات: open → acknowledged → resolved. والحلُّ وحده موثَّق
--  (resolved_by و resolved_at)؛ أمّا المراجعةُ فتُبدّل الحالةَ ولا تُبقي أثراً:
--  مَن راجعها؟ متى؟ لا جواب.
--
--  وهذا هو ما اصطدم به المستخدم عملياً. رفع بلاغاً فبقي «مفتوح»، ولمّا راجعته
--  المديريةُ لم يتبدّل في بوّابته إلّا لونُ شارة. أمّا الاسمُ والتاريخ اللذان
--  بُنيا للحلّ فلا يظهران — لأنّ البلاغ لم يُحَلّ بعد. فالحلقةُ نصفُها مبنيّ:
--  آخرُ الطريق موثَّقٌ وأوّلُه مجهول. ومديرُ مدرسةٍ رفع «انهيار سقف» يحتاج أن
--  يعرف أنّ بشراً رآه — قبل أن يعرف أنّه حُلّ بأسابيع.
--
--  ولا يكفي أن يُعاد استعمال resolved_by للمراجعة: العمودان معناهما «مَن أنهى»
--  والخلطُ بينهما يُضيع التمييز بين «رآه» و«أنهاه» — وهو التمييز كلُّه.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.emergency_reports
  add column if not exists acknowledged_by uuid references public.users(id),
  add column if not exists acknowledged_at timestamptz;

comment on column public.emergency_reports.acknowledged_by is
  'مَن راجع البلاغ في المديرية. يبقى محفوظاً بعد الحلّ — أوّلُ الطريق جزءٌ من سجلّه.';
comment on column public.emergency_reports.acknowledged_at is
  'متى رُوجع البلاغ. الفارقُ بينه وبين created_at هو زمنُ الاستجابة.';

/* ختمُ المراجعة يُوضع في القاعدة لا في العميل: العميل قد يُحدّث الحالة من
   مسارين (الجدول والبطاقة)، ونسيانُ الختم في أحدهما لا يُرى. والزنادُ يضمن
   أنّ كلّ انتقالٍ إلى acknowledged موثَّقٌ مهما كان مصدرُه — بما فيها الانتقالُ
   المباشر open → resolved: مَن حلّه فقد رآه، فيُختم الأمران معاً. */
create or replace function public._stamp_report_ack()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status
     and new.status in ('acknowledged', 'resolved')
     and new.acknowledged_at is null then
    new.acknowledged_by := coalesce(new.acknowledged_by, auth.uid());
    new.acknowledged_at := now();
  end if;

  -- العودةُ إلى «مفتوح» تُلغي الختمين معاً: بلاغٌ أُعيد فتحُه لم يُراجَع بعد.
  if new.status = 'open' and old.status is distinct from 'open' then
    new.acknowledged_by := null;
    new.acknowledged_at := null;
  end if;

  return new;
end; $$;

alter function public._stamp_report_ack() owner to postgres;
revoke all on function public._stamp_report_ack() from public, anon;

drop trigger if exists t_report_ack_stamp on public.emergency_reports;
create trigger t_report_ack_stamp
  before update on public.emergency_reports
  for each row execute function public._stamp_report_ack();

notify pgrst, 'reload schema';
