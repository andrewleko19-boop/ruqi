// registry-lookup — secure national registry lookup for school admins and ministry users.
//
// Allows an authenticated caller to look up a student or staff record in the
// national registry by their unique identifier. The lookup bypasses RLS by
// using the service-role key, since registry tables are blocked for direct
// access by non-ministry users. Only authenticated users (any role) may call
// this function.
//
// POST JSON { kind: 'student' | 'staff', id: string }
//   kind='student' → looks up national_students_registry by national_id (11 digits)
//   kind='staff'   → looks up national_staff_registry by self_number (any non-empty string)
//
// Returns:
//   200 { ok: true,  data: { ...registry row } }  if found
//   404 { ok: false, error: 'لم يُعثر على السجل' }  if not found
//   400 { ok: false, error: '...' }                   on validation failure
//   401 { ok: false, error: '...' }                   on auth failure
//   500 { ok: false, error: '...' }                   on server error
//
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "الطريقة غير مدعومة" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SERVICE_KEY) return json({ ok: false, error: "الخادم غير مهيّأ — SUPABASE_SERVICE_ROLE_KEY مفقود" }, 500);

    // 1) Authenticate the caller via their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "غير مصرّح" }, 401);
    const jwt = authHeader.slice(7);

    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(jwt);
    if (userErr || !user) return json({ ok: false, error: `جلسة غير صالحة: ${userErr?.message ?? "no user"}` }, 401);

    // 1b) Role check — only staff roles that legitimately need the registry.
    const { data: callerRow } = await createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    }).from("users").select("role").eq("id", user.id).single();
    const ALLOWED = new Set(["school_admin", "directorate_user", "ministry_user"]);
    if (!callerRow || !ALLOWED.has(callerRow.role)) {
      return json({ ok: false, error: "غير مخوّل للوصول للسجل الوطني" }, 403);
    }

    // 2) Parse and validate the request body.
    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind ?? "").trim();
    const id   = String(body.id   ?? "").trim();

    if (kind !== "student" && kind !== "staff") {
      return json({ ok: false, error: "قيمة kind غير صالحة — يجب أن تكون 'student' أو 'staff'" }, 400);
    }
    if (!id) {
      return json({ ok: false, error: "الحقل id مطلوب" }, 400);
    }

    // Student national IDs must be exactly 11 digits.
    if (kind === "student" && !/^\d{11}$/.test(id)) {
      return json({ ok: false, error: "الرقم الوطني للطالب يجب أن يتكوّن من 11 رقماً" }, 400);
    }

    // 3) Perform the lookup using the service-role client (bypasses RLS on registry tables).
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Anti-enumeration: a single account must not silently scrape the registry.
    // Cap lookups per caller per hour and record every lookup for audit. The
    // number→identity lookup is a legitimate enrollment step, so we make it
    // accountable and rate-limited rather than blocking it.
    const HOURLY_LOOKUP_CAP = 60;
    const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentLookups } = await admin
      .from("registry_lookup_audit")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gt("created_at", sinceHour);
    if ((recentLookups ?? 0) >= HOURLY_LOOKUP_CAP) {
      return json({ ok: false, error: "تجاوزت الحد المسموح لعمليات الاستعلام عن السجل، حاول لاحقاً" }, 429);
    }

    const table  = kind === "student" ? "national_students_registry" : "national_staff_registry";
    const column = kind === "student" ? "national_id" : "self_number";
    const { data, error } = await admin
      .from(table)
      .select("*")
      .eq(column, id)
      .maybeSingle();

    // Record the attempt (found or not) before responding — fire-and-forget so a
    // logging hiccup never blocks a legitimate lookup, but the row is normally
    // written so ministry can audit who accessed which record.
    await admin.from("registry_lookup_audit")
      .insert({ user_id: user.id, kind, lookup_id: id, found: !!data })
      .then(() => {}, () => {});

    if (error) return json({ ok: false, error: `خطأ في قاعدة البيانات: ${error.message}` }, 500);
    if (!data) return json({ ok: false, error: "لم يُعثر على السجل" }, 404);
    return json({ ok: true, data });

  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
