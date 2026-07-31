-- ════════════════════════════════════════════════════════════════════════════
--  Accountability + anti-enumeration for registry-lookup (audit C2, companion).
--
--  The registry-lookup Edge Function lets any {school_admin, directorate_user,
--  ministry_user} resolve a national_id / self_number to a national-registry row.
--  That number→identity lookup is a legitimate enrollment workflow (the name is
--  often what you are trying to discover), so a name match cannot be required
--  there. Instead we make every lookup accountable and cap bulk enumeration:
--
--    • registry_lookup_audit records who looked up what and when.
--    • The function counts the caller's lookups in the last hour and refuses past
--      a threshold, so a single account cannot silently scrape the registry.
--
--  Only ministry may read the audit; only service_role (the function) writes it.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.registry_lookup_audit (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('student','staff')),
  lookup_id  text not null,
  found      boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists registry_lookup_audit_user_time_idx
  on public.registry_lookup_audit (user_id, created_at desc);

alter table public.registry_lookup_audit enable row level security;

drop policy if exists registry_lookup_audit_ministry_select on public.registry_lookup_audit;
create policy registry_lookup_audit_ministry_select on public.registry_lookup_audit
  for select to authenticated
  using ((select role from public.users where id = auth.uid()) = 'ministry_user');

-- No direct client writes; the Edge Function inserts with the service role.
grant select on public.registry_lookup_audit to authenticated;
grant insert, select on public.registry_lookup_audit to service_role;
