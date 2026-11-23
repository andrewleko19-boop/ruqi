-- ═════════════════════════════════════════════════════════════════════════════
--  notify_user: مصدرُ مفتاح الدفع الفوريّ، وتشغيلُ الدفع.
--
--  الانجراف: كلّ نسخةٍ في git (baseline.sql:2179، 20260811000000) تقرأ المفتاح من Vault
--  (vault.decrypted_secrets، اسمه service_role_key). أمّا الدالّة الحيّة فاستُبدلت يدويّاً
--  بنسخةٍ تقرأ current_setting('app.settings.service_role_key') — وهذا الإعداد **غير مضبوط**
--  في المشروع، فكان v_key فارغاً دائماً وتُتخطّى net.http_post بصمت (الخطأ مبتلَع):
--  الإشعارُ يُسجَّل في notifications ويظهر داخل التطبيق، لكنّ الدفع إلى الهاتف لا يُرسَل أبداً
--  (33 اشتراكاً لثمانية مستخدمين لا يصلهم شيء).
--
--  الإصلاح: المفتاح من Vault حصراً (vault.decrypted_secrets، الاسم service_role_key) —
--  كما في 20260811000000. لا قراءة من app.settings ولا مفتاح في الشيفرة. غيابُ المفتاح أو
--  فشلُ الإرسال لا يُسقط الإشعار، لكنّه يُسجَّل الآن بـ raise warning (بلا أيّ قيمة سرّية)
--  فلا يعود الفشلُ صامتاً. التوقيع والافتراضيّات والأمان (SECURITY DEFINER، search_path)
--  والمالك والصلاحيات كما هي (create or replace بنفس التوقيع يُبقيها).
--
--  ⚠️ أثرٌ حيّ مقصود: بعد هذه الهجرة تبدأ كلُّ استدعاءات notify_user بإرسال دفعٍ فعليّ —
--  تذكير الحضور 06:30 UTC، إنذارات التسرّب، غياب الأبناء وحالتهم ونتائجهم، البلاغات الطارئة،
--  المراسلات. (الإشعار داخل التطبيق لا يتغيّر.)
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_user(
  p_recipient_id uuid,
  p_type         text,
  p_title        text,
  p_body         text,
  p_entity       text default null,
  p_entity_id    uuid default null
) returns void
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_notif_id uuid;
  v_url      text;
  v_key      text;
begin
  insert into public.notifications(recipient_id, type, title, body, entity, entity_id)
  values (p_recipient_id, p_type, p_title, p_body, p_entity, p_entity_id)
  returning id into v_notif_id;

  begin
    v_url := 'https://xocrzpjfvizgnsybegwr.supabase.co';

    -- المفتاح من Vault حصراً: لا يُكتب في الشيفرة ولا في الإعدادات.
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if v_key is null or v_key = '' then
      -- لا مفتاح ← لا دفع (الإشعار داخل التطبيق يبقى)، لكنّ الغياب مرئيّ في سجلّ القاعدة.
      raise warning 'notify_user: لا سرّ service_role_key في Vault — لم يُرسَل الدفع (notification %)', v_notif_id;
    else
      perform net.http_post(
        url     := v_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || v_key
                   ),
        body    := jsonb_build_object(
                     'notificationId', v_notif_id,
                     'recipientId',    p_recipient_id
                   ),
        timeout_milliseconds := 3000
      );
    end if;
  exception when others then
    -- الدفع إضافةٌ: فشلُه لا يُسقط الإشعار ولا المعاملة المستدعية. يُسجَّل تحذيراً؛
    -- نصُّ الخطأ يُنقَّى من المفتاح إن وُجد فيه.
    raise warning 'notify_user: فشل إرسال الدفع (notification %): SQLSTATE % — %',
      v_notif_id, sqlstate,
      case when v_key is not null and v_key <> '' then replace(sqlerrm, v_key, '***') else sqlerrm end;
  end;
end;
$$;
