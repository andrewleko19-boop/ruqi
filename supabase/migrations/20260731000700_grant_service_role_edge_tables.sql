-- ════════════════════════════════════════════════════════════════════════════
--  Grant service_role the table privileges the Edge Functions actually use.
--
--  BUG (reported): resetting a principal's password from the directorate portal
--  returned 500 "permission denied for table schools". The admin-create-user
--  function's service-role client reads public.schools to verify a target account
--  belongs to the caller's directorate, but this project grants service_role
--  table-by-table (users, staff_credentials, admin_credentials, notifications,
--  parent_otps, parent_links, …) and `schools` was never granted — so the query
--  is denied even though service_role bypasses RLS (grants are separate from RLS).
--
--  The same gap is latent in other functions, fixed here together:
--    • schools                    ← admin-create-user (directorate/school scope checks)
--    • students                   ← parent-auth (phone → student linking)
--    • class_teacher              ← admin-create-staff 'delete' (remove teacher links)
--    • national_*_registry        ← registry-lookup (read registry rows)
--    • push_subscriptions (write) ← save-push-subscription (upsert/delete; only
--                                    SELECT was granted, so saves would fail)
--
--  Least privilege is kept: read-only where the function only reads. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

grant select                on public.schools                     to service_role;
grant select                on public.students                    to service_role;
grant select, delete        on public.class_teacher               to service_role;
grant select                on public.national_students_registry  to service_role;
grant select                on public.national_staff_registry     to service_role;
grant insert, update, delete on public.push_subscriptions         to service_role;
