-- عكس 20261123000300: إعادة نسخة الحيّ السابقة (تقرأ app.settings فقط، فتُوقف الدفع عملياً).
-- المصدر: ruqi_backup.ddl_snapshot_20261123 (kind='function', object_name='notify_user').
create or replace function public.notify_user(
  p_recipient_id uuid, p_type text, p_title text, p_body text,
  p_entity text default null, p_entity_id uuid default null
) returns void language plpgsql security definer set search_path to 'public', 'pg_temp'
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
    v_key := current_setting('app.settings.service_role_key', true);
    if v_url is not null and v_key is not null then
      perform net.http_post(
        url     := v_url || '/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body    := jsonb_build_object('notificationId', v_notif_id, 'recipientId', p_recipient_id),
        timeout_milliseconds := 3000
      );
    end if;
  exception when others then null;
  end;
end;
$$;
