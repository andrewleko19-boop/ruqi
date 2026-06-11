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

function base64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
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

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64urlDecode(privateKeyB64),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, sigInput);
  return `${header}.${payload}.${base64urlEncode(sig)}`;
}

async function sendWebPush(
  sub: { endpoint: string; p256dh: string; auth_key: string },
  payload: string,
  vapidPublic: string,
  vapidPrivate: string,
  vapidSubject: string,
): Promise<void> {
  const url       = new URL(sub.endpoint);
  const audience  = `${url.protocol}//${url.host}`;
  const jwt       = await buildVapidToken(audience, vapidSubject, vapidPublic, vapidPrivate);

  // Encrypt the payload (RFC 8291) ── use the aesgcm variant supported by all browsers.
  // We rely on the Content-Encoding: aesgcm path for simplicity:
  // Generate a salt and an ephemeral key pair.
  const salt          = crypto.getRandomValues(new Uint8Array(16));
  const serverKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic  = await crypto.subtle.exportKey("raw", serverKeyPair.publicKey);

  const clientPublic  = await crypto.subtle.importKey(
    "raw", base64urlDecode(sub.p256dh), { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const authSecret = base64urlDecode(sub.auth_key);

  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublic }, serverKeyPair.privateKey, 256,
  );

  // PRK = HKDF-Extract(auth_secret, sharedBits)  key_length=32
  const baseHkdf = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveBits"]);
  const prk = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authSecret, info: new TextEncoder().encode("Content-Encoding: auth\0") },
    baseHkdf, 256,
  );

  const prkKey  = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
  const prkInfo = concatBuffers(
    new TextEncoder().encode("Content-Encoding: aesgcm\0"),
    new Uint8Array([0, 65]),
    new Uint8Array(serverPublic),
    new Uint8Array([0, 65]),
    base64urlDecode(sub.p256dh),
  );
  const prkInfoKey = new TextEncoder().encode("Content-Encoding: nonce\0");
  const prkInfoNonce = concatBuffers(
    prkInfoKey,
    new Uint8Array([0, 65]),
    new Uint8Array(serverPublic),
    new Uint8Array([0, 65]),
    base64urlDecode(sub.p256dh),
  );

  const contentEncKey = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: prkInfo }, prkKey, 128,
  );
  const nonce = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: prkInfoNonce }, prkKey, 96,
  );

  const aesKey = await crypto.subtle.importKey("raw", contentEncKey, "AES-GCM", false, ["encrypt"]);
  const enc    = new TextEncoder().encode(payload);
  // Prepend padding length (uint16 big-endian = 0) per RFC 8291 aesgcm
  const padded = concatBuffers(new Uint8Array([0, 0]), enc);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, aesKey, padded,
  );

  const headers: Record<string, string> = {
    "Authorization":     `vapid t=${jwt},k=${vapidPublic}`,
    "Content-Type":      "application/octet-stream",
    "Content-Encoding":  "aesgcm",
    "Encryption":        `salt=${base64urlEncode(salt)}`,
    "Crypto-Key":        `dh=${base64urlEncode(serverPublic)};p256ecdsa=${vapidPublic}`,
    "TTL":               "86400",
    "Content-Length":    String(ciphertext.byteLength),
  };

  const res = await fetch(sub.endpoint, { method: "POST", headers, body: ciphertext });
  if (!res.ok && res.status !== 201) {
    const text = await res.text().catch(() => "");
    throw new Error(`Push failed ${res.status}: ${text}`);
  }
}

function concatBuffers(...bufs: (ArrayBuffer | Uint8Array)[]): Uint8Array {
  const total  = bufs.reduce((n, b) => n + (b instanceof Uint8Array ? b.byteLength : b.byteLength), 0);
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

    const sent = results.filter((r) => r.status === "fulfilled").length;
    await admin.from("notifications")
      .update({ push_sent_at: new Date().toISOString() })
      .eq("id", notificationId);

    return json({ ok: true, sent, total: subs.length });
  } catch (e) {
    console.error("[send-push]", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
