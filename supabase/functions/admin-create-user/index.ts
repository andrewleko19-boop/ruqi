// admin-create-user — secure provisioning of school_admin and directorate_user accounts.
//
// Only a ministry_user may call this function. Creating Supabase Auth users with a
// password requires the service-role key, which must never reach the browser.
//
// Actions (POST JSON { action, ... }):
//   create_school_admin    → { email, fullName, password, schoolId }
//   create_directorate_user → { email, fullName, password, directorateId }
//   deactivate             → { userId }  ⇒ ban the auth user
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
  if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SERVICE_KEY) return json({ error: "الخادم غير مهيّأ — SUPABASE_SERVICE_ROLE_KEY مفقود" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "غير مصرّح" }, 401);
    const jwt = authHeader.slice(7);

    // 1) Identify the caller from the JWT.
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(jwt);
    if (userErr || !user) return json({ error: `جلسة غير صالحة: ${userErr?.message ?? "no user"}` }, 401);

    // 2) Verify the caller is a ministry_user via RLS read (user's JWT, not service-role).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: profile, error: profErr } = await userClient
      .from("users").select("role").eq("id", user.id).maybeSingle();
    if (profErr) return json({ error: `تعذّر التحقّق من الصلاحية: ${profErr.message}` }, 500);
    if (!profile || profile.role !== "ministry_user")
      return json({ error: "هذا الإجراء مخصّص لمشرف الوزارة فقط" }, 403);

    // 3) Admin client (service-role) — only used for auth.admin.* and trusted DB writes.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // ── create_school_admin ───────────────────────────────────────────────────
    if (action === "create_school_admin") {
      const email    = String(body.email    ?? "").trim().toLowerCase();
      const fullName = String(body.fullName ?? "").trim();
      const password = String(body.password ?? "");
      const schoolId = String(body.schoolId ?? "").trim();

      if (!email || !email.includes("@"))   return json({ error: "البريد الإلكتروني غير صالح" }, 400);
      if (!fullName)                         return json({ error: "الاسم الكامل مطلوب" }, 400);
      if (password.length < 8)              return json({ error: "كلمة المرور ٨ أحرف على الأقل" }, 400);
      if (!schoolId)                         return json({ error: "يجب تحديد مدرسة" }, 400);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr || !created?.user) {
        const dup = /already|registered|exists|duplicate/i.test(createErr?.message ?? "");
        return json({ error: dup ? "البريد الإلكتروني مُستخدم مسبقاً" : (createErr?.message ?? "تعذّر الإنشاء") },
                    dup ? 409 : 400);
      }
      const newId = created.user.id;

      const { error: uErr } = await admin.from("users").upsert({
        id: newId, role: "school_admin", school_id: schoolId, full_name: fullName,
      }, { onConflict: "id" });
      if (uErr) {
        await admin.auth.admin.deleteUser(newId);
        return json({ error: `تعذّر إنشاء الملف الشخصي: ${uErr.message}` }, 500);
      }
      return json({ ok: true, id: newId });
    }

    // ── create_directorate_user ───────────────────────────────────────────────
    if (action === "create_directorate_user") {
      const email         = String(body.email         ?? "").trim().toLowerCase();
      const fullName      = String(body.fullName      ?? "").trim();
      const password      = String(body.password      ?? "");
      const directorateId = String(body.directorateId ?? "").trim();

      if (!email || !email.includes("@"))   return json({ error: "البريد الإلكتروني غير صالح" }, 400);
      if (!fullName)                         return json({ error: "الاسم الكامل مطلوب" }, 400);
      if (password.length < 8)              return json({ error: "كلمة المرور ٨ أحرف على الأقل" }, 400);
      if (!directorateId)                    return json({ error: "يجب تحديد مديرية" }, 400);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr || !created?.user) {
        const dup = /already|registered|exists|duplicate/i.test(createErr?.message ?? "");
        return json({ error: dup ? "البريد الإلكتروني مُستخدم مسبقاً" : (createErr?.message ?? "تعذّر الإنشاء") },
                    dup ? 409 : 400);
      }
      const newId = created.user.id;

      const { error: uErr } = await admin.from("users").upsert({
        id: newId, role: "directorate_user", directorate_id: directorateId, full_name: fullName,
      }, { onConflict: "id" });
      if (uErr) {
        await admin.auth.admin.deleteUser(newId);
        return json({ error: `تعذّر إنشاء الملف الشخصي: ${uErr.message}` }, 500);
      }
      return json({ ok: true, id: newId });
    }

    // ── deactivate ─────────────────────────────────────────────────────────────
    if (action === "deactivate") {
      const userId = String(body.userId ?? "").trim();
      if (!userId) return json({ error: "معرّف المستخدم مطلوب" }, 400);
      // Prevent deactivating another ministry_user (safety check).
      const { data: target } = await admin.from("users")
        .select("role").eq("id", userId).maybeSingle();
      if (!target) return json({ error: "المستخدم غير موجود" }, 404);
      if (target.role === "ministry_user")
        return json({ error: "لا يمكن تعطيل مستخدم وزارة من هنا" }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
