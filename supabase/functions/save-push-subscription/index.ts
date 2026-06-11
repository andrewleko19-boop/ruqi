// save-push-subscription — stores (or refreshes) a Web Push subscription for the
// authenticated user. Called by the browser after navigator.serviceWorker.ready
// .pushManager.subscribe(...) returns a PushSubscription object.
//
// Body: { subscription: PushSubscriptionJSON }
//   subscription.endpoint  — push service URL
//   subscription.keys.p256dh — client public key (base64url)
//   subscription.keys.auth   — client auth secret (base64url)
//
// Env (auto-injected): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST" && req.method !== "DELETE")
    return json({ error: "method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SERVICE_KEY) return json({ error: "الخادم غير مهيّأ" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "غير مصرّح" }, 401);
    const jwt = authHeader.slice(7);

    // Identify caller from JWT.
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(jwt);
    if (userErr || !user) return json({ error: `جلسة غير صالحة: ${userErr?.message ?? "no user"}` }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── DELETE: unsubscribe a specific endpoint ───────────────────────────────
    if (req.method === "DELETE") {
      const { endpoint } = await req.json().catch(() => ({}));
      if (!endpoint) return json({ error: "endpoint مطلوب" }, 400);
      await admin.from("push_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .eq("endpoint", endpoint);
      return json({ ok: true });
    }

    // ── POST: save / refresh subscription ────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const sub  = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth)
      return json({ error: "subscription غير صالح — endpoint و keys.p256dh و keys.auth مطلوبة" }, 400);

    const userAgent = req.headers.get("user-agent") ?? null;

    const { error } = await admin.from("push_subscriptions").upsert({
      user_id:    user.id,
      endpoint:   sub.endpoint,
      p256dh:     sub.keys.p256dh,
      auth_key:   sub.keys.auth,
      user_agent: userAgent,
    }, { onConflict: "endpoint" });

    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    console.error("[save-push-subscription]", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
