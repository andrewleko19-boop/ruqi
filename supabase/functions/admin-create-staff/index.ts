// admin-create-staff — secure central provisioning of teacher accounts.
//
// The principal (school_admin) creates each teacher's login (username + password)
// from the school portal. Creating an auth user WITH a password requires the
// service-role key, which must never reach the browser — so it lives here, in a
// server-side Edge Function. The caller's role and school are verified from the
// database (NOT from the request body) to prevent privilege escalation.
//
// Actions (POST JSON { action, ... }):
//   create     → { fullName, username, password }  ⇒ new auth user + users row + staff_credentials row
//   update     → { userId, password?, fullName? }   ⇒ reset password / rename (same school only)
//   deactivate → { userId }                         ⇒ ban the auth user (same school only)
//
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Synthetic email domain — teachers log in with a username, mapped to this.
const STAFF_EMAIL_DOMAIN = "staff.nsams.local";

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
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "غير مصرّح" }, 401);

    // 1) Identify the caller from their JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "جلسة غير صالحة" }, 401);

    // 2) Verify the caller is a school_admin and read their school FROM THE DB.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profErr } = await admin
      .from("users").select("role, school_id").eq("id", user.id).maybeSingle();
    if (profErr)  return json({ error: "تعذّر التحقّق من الصلاحية" }, 500);
    if (!profile || profile.role !== "school_admin")
      return json({ error: "هذا الإجراء مخصّص لمدير المدرسة فقط" }, 403);
    const schoolId = profile.school_id;

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "create";

    // ── create ────────────────────────────────────────────────────────────────
    if (action === "create") {
      const fullName = String(body.fullName ?? "").trim();
      const username = String(body.username ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!fullName)                          return json({ error: "الاسم الكامل مطلوب" }, 400);
      if (!/^[a-z0-9._-]{3,40}$/.test(username))
        return json({ error: "اسم المستخدم: أحرف لاتينية/أرقام (٣–٤٠) بدون فراغات" }, 400);
      if (password.length < 6)                return json({ error: "كلمة المرور ٦ أحرف على الأقل" }, 400);

      const email = `${username}@${STAFF_EMAIL_DOMAIN}`;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: fullName, username },
      });
      if (createErr || !created?.user) {
        const dup = /already|registered|exists|duplicate/i.test(createErr?.message ?? "");
        return json({ error: dup ? "اسم المستخدم مُستخدم مسبقاً" : (createErr?.message ?? "تعذّر الإنشاء") },
                    dup ? 409 : 400);
      }
      const newId = created.user.id;

      const { error: uErr } = await admin.from("users").insert({
        id: newId, role: "teacher", school_id: schoolId, full_name: fullName,
      });
      if (uErr) {
        await admin.auth.admin.deleteUser(newId);   // rollback — no orphan auth user
        return json({ error: "تعذّر إنشاء الملف الشخصي للمعلّم" }, 500);
      }

      const { error: cErr } = await admin.from("staff_credentials").insert({
        school_id: schoolId, user_id: newId, username, password, created_by: user.id,
      });
      if (cErr) {
        await admin.from("users").delete().eq("id", newId);
        await admin.auth.admin.deleteUser(newId);   // rollback fully
        const dup = /duplicate|unique/i.test(cErr.message ?? "");
        return json({ error: dup ? "اسم المستخدم مُستخدم مسبقاً" : "تعذّر حفظ بيانات الدخول" },
                    dup ? 409 : 500);
      }
      return json({ ok: true, id: newId, username });
    }

    // ── update (reset password / rename) ───────────────────────────────────────
    if (action === "update") {
      const userId = String(body.userId ?? "");
      if (!userId) return json({ error: "معرّف غير صالح" }, 400);
      const { data: target } = await admin.from("users")
        .select("school_id").eq("id", userId).maybeSingle();
      if (!target || target.school_id !== schoolId) return json({ error: "غير مصرّح" }, 403);

      const password = body.password ? String(body.password) : null;
      const fullName = body.fullName ? String(body.fullName).trim() : null;
      if (password && password.length < 6) return json({ error: "كلمة المرور ٦ أحرف على الأقل" }, 400);

      if (password) {
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) return json({ error: error.message }, 400);
      }
      const credPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (password) credPatch.password = password;
      await admin.from("staff_credentials").update(credPatch).eq("user_id", userId);
      if (fullName) await admin.from("users").update({ full_name: fullName }).eq("id", userId);
      return json({ ok: true });
    }

    // ── deactivate ─────────────────────────────────────────────────────────────
    if (action === "deactivate") {
      const userId = String(body.userId ?? "");
      const { data: target } = await admin.from("users")
        .select("school_id").eq("id", userId).maybeSingle();
      if (!target || target.school_id !== schoolId) return json({ error: "غير مصرّح" }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
