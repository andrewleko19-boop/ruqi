// send-push — delivers a Web Push notification to all subscriptions of a user.
//
// Called by the DB trigger helper notify_user() via pg_net.http_post().
// Body: { notificationId: string, recipientId: string }
//
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Env (set by user in Edge Function secrets):
//   VAPID_PUBLIC_KEY  — base64url-encoded uncompressed EC public key
//   VAPID_PRIVATE_KEY — base64url-encoded raw EC private key
//   VAPID_SUBJECT     — "mailto:admin@example.com" or site origin

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Minimal VAPID + Web Push implementation (no npm:web-push dependency) ──────
// We sign the request manually using the Web Crypto API available in Deno Deploy.

function base64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function buildVapidToken(
  audience: string,
  subject: string,
  publicKeyB64: string,
  privateKeyB64: string,
): Promise<string> {
  const header  = base64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })));
  const sigInput = new TextEncoder().encode(`${header}.${payload}`);

  const privateKey = await importVapidPrivateKey(privateKeyB64, publicKeyB64);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, sigInput);
  return `${header}.${payload}.${base64urlEncode(sig)}`;
}

// VAPID private keys come in two shapes depending on how they were generated:
//   • raw 32-byte EC scalar  (web-push CLI, browser-style) → import via JWK
//   • PKCS8 DER-wrapped key   (Node crypto, openssl)        → import via "pkcs8"
// Detect by decoded length so either format works.
async function importVapidPrivateKey(privateKeyB64: string, publicKeyB64: string): Promise<CryptoKey> {
  const raw = base64urlDecode(privateKeyB64);
  if (raw.length === 32) {
    const pub = base64urlDecode(publicKeyB64); // 0x04 || x(32) || y(32)
    const x = base64urlEncode(pub.slice(1, 33));
    const y = base64urlEncode(pub.slice(33, 65));
    return await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", d: privateKeyB64, x, y, key_ops: ["sign"] },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  }
  return await crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function sendWebPush(
  sub: { endpoint: string; p256dh: string; auth_key: string },
  payload: string,
  vapidPublic: string,
  vapidPrivate: string,
  vapidSubject: string,
): Promise<void> {
  const url      = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt      = await buildVapidToken(audience, vapidSubject, vapidPublic, vapidPrivate);

  // RFC 8291 aes128gcm encryption.
  const salt          = crypto.getRandomValues(new Uint8Array(16));
  const serverKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic  = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  const clientPublicRaw = base64urlDecode(sub.p256dh);
  const clientPublic    = await crypto.subtle.importKey(
    "raw", clientPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const authSecret = base64urlDecode(sub.auth_key);

  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublic }, serverKeyPair.privateKey, 256,
  );

  // Step 1: derive 32-byte IKM from shared secret, keyed by auth secret (RFC 8291 §3.3).
  const keyInfo  = concatBuffers(
    new TextEncoder().encode("WebPush: info\x00"),
    clientPublicRaw,
    serverPublic,
  );
  const sharedKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveBits"]);
  const ikm = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authSecret, info: keyInfo }, sharedKey, 256,
  );

  // Step 2: derive CEK (16 bytes) and nonce (12 bytes) from IKM + random salt.
  const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const cek = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("Content-Encoding: aes128gcm\x00") },
    ikmKey, 128,
  );
  const nonce = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("Content-Encoding: nonce\x00") },
    ikmKey, 96,
  );

  // Encrypt: append 0x02 last-record delimiter (RFC 8188) then AES-128-GCM.
  const aesKey    = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concatBuffers(new TextEncoder().encode(payload), new Uint8Array([0x02]));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext);

  // aes128gcm body: salt(16) || rs_uint32_be(4) || idlen(1=65) || serverPublicKey(65) || ciphertext.
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const body = concatBuffers(salt, rs, new Uint8Array([65]), serverPublic, new Uint8Array(ciphertext));

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization":    `vapid t=${jwt}, k=${vapidPublic}`,
      "Content-Type":     "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL":              "86400",
      "Content-Length":   String(body.byteLength),
    },
    body,
  });
  if (!res.ok && res.status !== 201) {
    const text = await res.text().catch(() => "");
    throw new Error(`Push failed ${res.status}: ${text}`);
  }
}

function concatBuffers(...bufs: (ArrayBuffer | Uint8Array)[]): Uint8Array {
  const total  = bufs.reduce((n, b) => n + b.byteLength, 0);
  const result = new Uint8Array(total);
  let   offset = 0;
  for (const b of bufs) {
    const arr = b instanceof Uint8Array ? b : new Uint8Array(b);
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405);

  try {
    const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const VAPID_PUBLIC   = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE  = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT  = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@school.gov.sy";

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: true, skipped: "no VAPID keys" });

    // Only the DB trigger (notify_user via pg_net) may call this function.
    // It sends the service-role key as Bearer token — verify it matches.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!bearer || bearer !== SERVICE_KEY) return json({ error: "غير مصرّح" }, 401);

    const { notificationId, recipientId } = await req.json();
    if (!notificationId || !recipientId)  return json({ error: "missing params" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: notif }, { data: subs }] = await Promise.all([
      admin.from("notifications").select("title,body").eq("id", notificationId).maybeSingle(),
      admin.from("push_subscriptions").select("endpoint,p256dh,auth_key").eq("user_id", recipientId),
    ]);

    if (!notif || !subs?.length) return json({ ok: true, sent: 0 });

    const payload = JSON.stringify({ title: notif.title, body: notif.body ?? "" });

    const results = await Promise.allSettled(
      subs.map((s) => sendWebPush(s, payload, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT)),
    );

    const sent   = results.filter((r) => r.status === "fulfilled").length;
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason?.message ?? r.reason));
    if (errors.length) console.error("[send-push] failures:", errors);

    await admin.from("notifications")
      .update({ push_sent_at: new Date().toISOString() })
      .eq("id", notificationId);

    return json({ ok: true, sent, total: subs.length, errors });
  } catch (e) {
    console.error("[send-push]", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
