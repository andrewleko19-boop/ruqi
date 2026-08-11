-- إزالة مفتاح service_role المضمّن في دالة notify_user واستبداله
-- بقراءة من إعدادات Postgres. يجب ضبط الإعداد مرة واحدة:
--
--   ALTER DATABASE postgres
--     SET app.settings.service_role_key = '<service_role_key>';
--
-- المفتاح موجود في Supabase Dashboard → Settings → API → service_role.

CREATE OR REPLACE FUNCTION "public"."notify_user"(
  "p_recipient_id" "uuid",
  "p_type" "text",
  "p_title" "text",
  "p_body" "text",
  "p_entity" "text" DEFAULT NULL::"text",
  "p_entity_id" "uuid" DEFAULT NULL::"uuid"
) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_notif_id uuid;
  v_url      text;
  v_key      text;
BEGIN
  INSERT INTO public.notifications(recipient_id, type, title, body, entity, entity_id)
  VALUES (p_recipient_id, p_type, p_title, p_body, p_entity, p_entity_id)
  RETURNING id INTO v_notif_id;

  BEGIN
    v_url := 'https://xocrzpjfvizgnsybegwr.supabase.co';
    v_key := current_setting('app.settings.service_role_key', true);
    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      PERFORM net.http_post(
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
    END IF;
  EXCEPTION WHEN others THEN NULL;
  END;
END;
$$;
