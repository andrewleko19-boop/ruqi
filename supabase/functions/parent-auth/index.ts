// parent-auth — OTP-based authentication for parents/guardians.
//
// Parents never create accounts directly — they enter their phone number,
// receive a 6-digit OTP (logged to console now, sent via SMS later), and on
// successful verification get a Supabase session. The phone is matched against
// students.parent_phone to build parent_links automatically.
//
// Actions (POST JSON { action, ... }):
//   request_otp → { phone }              ⇒ generate OTP, store hashed, console.log
//   verify_otp  → { phone, code }        ⇒ verify, create/find auth user, return session
//
// Email pattern: {normalizedPhone}@parent.nsams.local  (same style as staff)
//
// Env (auto-injected): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PARENT_EMAIL_DOMAIN = "parent.nsams.local";
const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-\(\)]/g, "");
  if (p.startsWith("00963")) p = "+963" + p.slice(5);
  else if (p.startsWith("0963")) p = "+963" + p.slice(4);
  else if (p.startsWith("963") && !p.startsWith("+963")) p = "+" + p;
  else if (p.startsWith("09")) p = "+963" + p.slice(1);
  return p;
}

// Reduce any phone format to its national core (e.g. 9XXXXXXXX) so matching
// is format-agnostic — mirrors public._nsams_phone_core() in the database.
function phoneCore(raw: string): string {
  const d = (raw ?? "").replace(/[^0-9]/g, "");
  if (d.startsWith("00963")) return d.slice(5);
  if (d.startsWith("963"))   return d.slice(3);
  if (d.startsWith("0"))     return d.slice(1);
  return d;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SERVICE_KEY) return json({ error: "الخادم غير مهيّأ — SUPABASE_SERVICE_ROLE_KEY مفقود" }, 500);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // ── request_otp ───────────────────────────────────────────────────────────
    if (action === "request_otp") {
      const phone = normalizePhone(String(body.phone ?? ""));
      if (!phone.match(/^\+9639[0-9]{8}$/))
        return json({ error: "رقم الهاتف غير صالح (مثال: 0961234567)" }, 400);

      const code = generateOtp();
      const hash = await sha256(code);
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

      // Invalidate any previous unexpired OTPs for this phone
      await admin.from("parent_otps")
        .update({ used_at: new Date().toISOString() })
        .eq("phone", phone)
        .is("used_at", null);

      const { error: insErr } = await admin.from("parent_otps").insert({
        phone, code_hash: hash, expires_at: expiresAt,
      });
      if (insErr) return json({ error: `تعذّر حفظ رمز التحقق: ${insErr.message}` }, 500);

      // TODO: replace with SMS provider integration
      console.log(`[parent-auth] OTP for ${phone}: ${code}`);

      return json({ ok: true, message: "تم إرسال رمز التحقق" });
    }

    // ── verify_otp ────────────────────────────────────────────────────────────
    if (action === "verify_otp") {
      const phone = normalizePhone(String(body.phone ?? ""));
      const code  = String(body.code ?? "").trim();
      if (!phone || !code) return json({ error: "البيانات ناقصة" }, 400);

      const hash = await sha256(code);
      const now  = new Date().toISOString();

      // Find the most recent valid (unused, unexpired) OTP for this phone
      const { data: otpRow, error: fetchErr } = await admin
        .from("parent_otps")
        .select("id, code_hash, expires_at, attempts, used_at")
        .eq("phone", phone)
        .is("used_at", null)
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchErr) return json({ error: `خطأ في التحقق: ${fetchErr.message}` }, 500);
      if (!otpRow)  return json({ error: "رمز التحقق منتهي الصلاحية أو غير موجود" }, 400);

      const attempts = (otpRow.attempts ?? 0) + 1;
      if (attempts > MAX_ATTEMPTS) {
        await admin.from("parent_otps").update({ used_at: now }).eq("id", otpRow.id);
        return json({ error: "تجاوزت الحد الأقصى للمحاولات، يرجى طلب رمز جديد" }, 429);
      }

      if (otpRow.code_hash !== hash) {
        await admin.from("parent_otps").update({ attempts }).eq("id", otpRow.id);
        const remaining = MAX_ATTEMPTS - attempts;
        return json({ error: `رمز التحقق غير صحيح (${remaining} محاولات متبقية)` }, 400);
      }

      // Mark OTP as used
      await admin.from("parent_otps").update({ used_at: now }).eq("id", otpRow.id);

      // Find or create Supabase auth user
      const email = `${phone}@${PARENT_EMAIL_DOMAIN}`;
      let userId: string;

      const { data: existing } = await admin.auth.admin.listUsers();
      const existingUser = existing?.users?.find(u => u.email === email);

      if (existingUser) {
        userId = existingUser.id;
      } else {
        const tmpPassword = `${phone}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password: tmpPassword,
          email_confirm: true,
          user_metadata: { phone, role: "parent" },
        });
        if (createErr || !created?.user)
          return json({ error: `تعذّر إنشاء الحساب: ${createErr?.message ?? ""}` }, 500);
        userId = created.user.id;

        // Insert into users table with parent role
        await admin.from("users").upsert(
          { id: userId, role: "parent", full_name: phone },
          { onConflict: "id" }
        );
      }

      // Build / refresh parent_links by matching the phone against BOTH
      // students.contact_phone (always filled by the school) and parent_phone,
      // across the common stored formats. The DB self-healing RPC
      // (parent_sync_links) is the authoritative, format-proof path on every
      // app load — this is just an immediate best-effort link at sign-in time.
      const core = phoneCore(phone);
      const variants = [`+963${core}`, `0${core}`, core, `00963${core}`, `963${core}`];

      const [byContact, byParent] = await Promise.all([
        admin.from("students").select("id").eq("is_active", true).in("contact_phone", variants),
        admin.from("students").select("id").eq("is_active", true).in("parent_phone",  variants),
      ]);
      const idSet = new Set<string>();
      (byContact.data ?? []).forEach((s: { id: string }) => idSet.add(s.id));
      (byParent.data  ?? []).forEach((s: { id: string }) => idSet.add(s.id));
      const linkedStudents = [...idSet].map(id => ({ id }));

      if (linkedStudents.length > 0) {
        const links = linkedStudents.map(s => ({ user_id: userId, student_id: s.id }));
        await admin.from("parent_links").upsert(links, { onConflict: "user_id,student_id", ignoreDuplicates: true });
      }

      // Generate a session for this user
      const { data: sessionData, error: sessErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: "" },
      });
      if (sessErr || !sessionData) {
        // Fallback: use signInWithPassword with a new random password set now
        const newPwd = `P${Date.now()}${Math.random().toString(36).slice(2)}!`;
        await admin.auth.admin.updateUserById(userId, { password: newPwd });
        const anonClient = createClient(SUPABASE_URL, ANON_KEY);
        const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({ email, password: newPwd });
        if (signInErr || !signInData?.session)
          return json({ error: `تعذّر إنشاء الجلسة: ${signInErr?.message ?? ""}` }, 500);
        return json({
          ok: true,
          access_token:  signInData.session.access_token,
          refresh_token: signInData.session.refresh_token,
          student_count: linkedStudents?.length ?? 0,
        });
      }

      // Use the token from the magic link to sign in via OTP verify flow
      const { properties } = sessionData;
      if (properties?.hashed_token) {
        // Attempt to exchange hashed_token for a session
        const anonClient = createClient(SUPABASE_URL, ANON_KEY);
        const { data: verifyData, error: verifyErr } = await anonClient.auth.verifyOtp({
          email,
          token: properties.hashed_token,
          type: "magiclink",
        });
        if (!verifyErr && verifyData?.session) {
          return json({
            ok: true,
            access_token:  verifyData.session.access_token,
            refresh_token: verifyData.session.refresh_token,
            student_count: linkedStudents?.length ?? 0,
          });
        }
      }

      // Final fallback: set known password and sign in
      const finalPwd = `Px${Date.now()}${Math.random().toString(36).slice(2)}!`;
      await admin.auth.admin.updateUserById(userId, { password: finalPwd });
      const anonClient2 = createClient(SUPABASE_URL, ANON_KEY);
      const { data: sd2, error: se2 } = await anonClient2.auth.signInWithPassword({ email, password: finalPwd });
      if (se2 || !sd2?.session)
        return json({ error: `تعذّر إنشاء الجلسة: ${se2?.message ?? ""}` }, 500);

      return json({
        ok: true,
        access_token:  sd2.session.access_token,
        refresh_token: sd2.session.refresh_token,
        student_count: linkedStudents?.length ?? 0,
      });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
