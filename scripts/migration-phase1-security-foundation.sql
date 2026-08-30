-- FINOS Phase 1: security foundation
-- Applied to Supabase project iruxtpmlgiblwjmdrnkx on 2026-08-28.
--
-- FINOS uses NextAuth + server-side Prisma for application data access. The
-- Supabase Data API is not an application data path, so public-schema objects
-- must not be reachable through browser-facing anon or authenticated roles.
-- service_role remains available for controlled server-side operations.

BEGIN;

-- Close the current Data API surface.
REVOKE ALL ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public
  FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

-- New objects must be private by default. Explicit grants can be introduced
-- later for a deliberately designed API surface.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- RLS remains enabled as defence in depth even though the browser-facing Data
-- API grants are removed. Existing policies are retained until Phase 2 decides
-- whether a dedicated application database role will enforce tenant context.
DO $phase1$
DECLARE
  row_record record;
BEGIN
  FOR row_record IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      row_record.schema_name,
      row_record.table_name
    );
  END LOOP;
END
$phase1$;

-- The compatibility view must obey the caller's privileges/RLS rather than
-- those of its owner.
ALTER VIEW public.organizations SET (security_invoker = true);

-- Pin trigger-function resolution to trusted schemas.
ALTER FUNCTION public.check_period_open()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.fn_ent_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.fn_journal_balance_check()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.fn_payment_terms_set_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.fn_pdf_templates_set_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.fn_tns_set_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_locations_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_reporting_tag_options_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_reporting_tags_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_updated_at_reminder_rules()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_web_tabs_updated_at()
  SET search_path = pg_catalog, public;

NOTIFY pgrst, 'reload schema';

COMMIT;
