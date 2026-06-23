-- ════════════════════════════════════════════════════════════════════════════
--  Remove unused PostGIS.
--
--  The only geometry object in the database is public.schools.location — a
--  derived mirror of (lat, lng) maintained by the trg_schools_set_location
--  trigger. The application reads lat/lng directly and never references
--  `location`, so the geometry column (and PostGIS itself) is dead weight.
--
--  Removing it resolves, in one shot:
--    • ERROR  rls_disabled_in_public        → public.spatial_ref_sys (PostGIS table)
--    • WARN   extension_in_public           → postgis installed in `public`
--    • WARN   function_search_path_mutable  → the PostGIS st_*/geometry_* functions
--    • WARN   anon_security_definer_…       → st_estimatedextent
--
--  Idempotent. PostGIS can be re-enabled later with `create extension postgis`
--  (preferably into a dedicated schema) if spatial features are ever needed.
-- ════════════════════════════════════════════════════════════════════════════

drop trigger  if exists trg_schools_set_location on public.schools;
drop function if exists public.schools_set_location();
drop index    if exists public.idx_schools_location;
alter table   public.schools drop column if exists location;

-- No remaining geometry/geography columns depend on PostGIS, so this drops the
-- extension and all of its objects (spatial_ref_sys, geometry_columns, …).
drop extension if exists postgis;
