// admin-create-user — secure provisioning of school_admin and directorate_user accounts.
//
// Only a ministry_user may call this function. Creating Supabase Auth users with a
// password requires the service-role key, which must never reach the browser.
//
// Actions (POST JSON { action, ... }):
//   create_school_admin    → { email, fullName, password, schoolId }
//   create_directorate_user → { email, fullName, password, directorateId }
//   deactivate             → { userId }  ⇒ ban the auth user
//   reset_password         → { userId }  ⇒ mint a new password, returned once
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
      .from("users").select("role, directorate_id").eq("id", user.id).maybeSingle();
    if (profErr) return json({ error: `تعذّر التحقّق من الصلاحية: ${profErr.message}` }, 500);
    // A missing row is not an error for maybeSingle(), so an RLS policy that
    // hides the caller's own row used to fall through to the generic role 403
    // and look identical to "wrong role". Name it.
    if (!profile)
      return json({ error: "تعذّرت قراءة صلاحية حسابك (لا صفّ مرئي في users) — راجع مشرف الوزارة" }, 403);
    const callerRole = profile.role ?? "";
    const isMinistry    = callerRole === "ministry_user";
    const isDirectorate = callerRole === "directorate_user";
    if (!isMinistry && !isDirectorate)
      return json({ error: `هذا الإجراء مخصّص لمشرف الوزارة أو المديرية فقط (دورك: ${callerRole || 'غير محدّد'})` }, 403);
    const callerDirectorateId = profile?.directorate_id ?? null;

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

      // تحقق أن المدرسة تتبع مديرية المستدعي قبل إنشاء أي مستخدم
      if (isDirectorate) {
        const { data: school } = await admin.from("schools").select("directorate_id").eq("id", schoolId).maybeSingle();
        if (!school || school.directorate_id !== callerDirectorateId)
          return json({ error: "المدرسة لا تتبع مديريتك" }, 403);
      }

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
      await admin.from("admin_credentials").insert({ user_id: newId, email, password, created_by: user.id });
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

      if (!isMinistry)
        return json({ error: "إنشاء مشرف مديرية مخصّص لمشرف الوزارة فقط" }, 403);

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
      await admin.from("admin_credentials").insert({ user_id: newId, email, password, created_by: user.id });
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
      await admin.from("users").update({ is_active: false }).eq("id", userId);
      return json({ ok: true });
    }

    // ── reset_password ────────────────────────────────────────────────────────
    // Replaces the stored-plaintext model: the caller never reads an existing
    // password, they mint a new one that is returned exactly once. The generated
    // value is written to admin_credentials only so the row stays consistent for
    // the account listing; nothing in the UI reads that column back any more.
    if (action === "reset_password") {
      const userId = String(body.userId ?? "").trim();
      if (!userId) return json({ error: "معرّف المستخدم مطلوب" }, 400);

      const { data: target } = await admin.from("users")
        .select("role, school_id, directorate_id").eq("id", userId).maybeSingle();
      if (!target) return json({ error: "المستخدم غير موجود" }, 404);
      if (target.role === "ministry_user")
        return json({ error: "لا يمكن إعادة تعيين كلمة مرور مستخدم وزارة من هنا" }, 403);

      // A directorate may only reset accounts inside its own directorate —
      // either its schools' admins, or its own staff.
      //
      // Every failure here used to collapse into one 403 ("not in your
      // directorate") because the schools lookup discarded its error: a query
      // failure, a missing school row, and a genuine cross-directorate attempt
      // were indistinguishable, so the operator had nothing to act on. Each
      // branch now names itself.
      if (isDirectorate) {
        if (!callerDirectorateId)
          return json({ error: "حساب المديرية غير مرتبط بمديرية — راجع مشرف الوزارة" }, 403);

        if (target.school_id) {
          const { data: school, error: schoolErr } = await admin.from("schools")
            .select("directorate_id").eq("id", target.school_id).maybeSingle();
          if (schoolErr)
            return json({ error: `تعذّر التحقّق من مدرسة الحساب: ${schoolErr.message}` }, 500);
          if (!school)
            return json({ error: "مدرسة هذا الحساب غير موجودة في السجل" }, 404);
          if (school.directorate_id !== callerDirectorateId)
            return json({ error: "مدرسة هذا الحساب تتبع مديرية أخرى" }, 403);
        } else if (target.directorate_id) {
          if (target.directorate_id !== callerDirectorateId)
            return json({ error: "هذا الحساب يتبع مديرية أخرى" }, 403);
        } else {
          return json({ error: "هذا الحساب غير مرتبط بمدرسة ولا بمديرية" }, 403);
        }
      }

      // 18 random bytes → base64url, so the value is unguessable rather than
      // built from a predictable pattern an operator could reproduce.
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      const password = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password });
      if (updErr) return json({ error: updErr.message }, 400);

      // Destroy the stored plaintext rather than replacing it. Keeping a
      // readable copy is the hole this action exists to close — the operator
      // sees the value once, in this response, and nowhere else.
      const { error: credErr } = await admin.from("admin_credentials")
        .update({ password: null, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (credErr) {
        // The auth password is already changed, so the caller must still get it;
        // surface the bookkeeping failure instead of swallowing it.
        return json({ ok: true, password, warning: `تعذّر تحديث سجل الحساب: ${credErr.message}` });
      }

      return json({ ok: true, password });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
