-- ════════════════════════════════════════════════════════════════════════════
--  Per-IP rate limiting for parent OTP requests (audit M4).
--
--  request_otp only capped 5/hour PER PHONE. On a public, unauthenticated,
--  CORS:* endpoint an attacker can iterate arbitrary +9639… numbers and issue 5
--  OTPs to each — SMS-bombing once a real SMS provider replaces the console.log
--  TODO. Recording a hashed client IP lets the Edge Function also cap requests
--  per source, independent of the phone number.
--
--  Stored as a SHA-256 hash, not the raw IP (data minimization).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.parent_otps add column if not exists ip_hash text;

create index if not exists parent_otps_ip_time_idx
  on public.parent_otps (ip_hash, created_at);
