-- ════════════════════════════════════════════════════════════════════════════
--  Close the notify_user() spoofing hole (audit M1).
--
--  public.notify_user() is SECURITY DEFINER and is the ONLY insert path into
--  public.notifications (the table grants authenticated only SELECT/UPDATE, and
--  notif_owner restricts rows to recipient_id = auth.uid()). The Section 12.2
--  hardening block auto-granted EXECUTE to `authenticated` for every
--  anon-reachable DEFINER function — which swept in notify_user. That let ANY
--  logged-in user call:
--      select public.notify_user('<victim-uuid>','x','Fake title','Malicious body');
--  to inject a trusted in-app notification (and a Web Push) into another user's
--  device with fully caller-controlled title/body.
--
--  notify_user is only ever reached internally: from SECURITY DEFINER trigger
--  functions (which fire as the table owner) and from other DEFINER functions via
--  `perform public.notify_user(...)` (which run with the function owner's rights,
--  NOT the caller's). None of those need the `authenticated` EXECUTE grant, so
--  revoking it does not break any legitimate notification flow. service_role
--  (used by the send-push edge function path) keeps its grant.
--
--  Idempotent: revoke is a no-op if the grant is already absent.
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on function
  public.notify_user(uuid, text, text, text, text, uuid)
  from authenticated, public, anon;

-- service_role retains EXECUTE (granted at schema setup); re-assert for clarity.
grant execute on function
  public.notify_user(uuid, text, text, text, text, uuid)
  to service_role;
