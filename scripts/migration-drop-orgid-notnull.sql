-- ============================================================
-- Fix: Drop NOT NULL from organization_id on all tables
-- that received tenant_id during the Phase 2.5 Week 1 migration.
--
-- Root cause: migration-tenancy-v25.sql added tenant_id but
-- left organization_id as NOT NULL. Prisma no longer includes
-- organization_id in INSERT statements (column removed from schema),
-- causing "Null constraint violation on the (not available)" for
-- every new record creation.
--
-- Idempotent — safe to re-run. Skips tables/columns that do not
-- exist or are already nullable.
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN VALUES
    ('chart_of_accounts'),
    ('journal_entries'),
    ('invoices'),
    ('bills'),
    ('bank_accounts'),
    ('customers'),
    ('vendors'),
    ('items'),
    ('item_categories'),
    ('expenses'),
    ('expense_categories'),
    ('accounting_periods'),
    ('budgets'),
    ('credit_notes'),
    ('customer_payments'),
    ('vendor_payments'),
    ('integration_connections'),
    ('account_mappings'),
    ('sync_logs'),
    ('sync_quarantine'),
    ('unified_transactions_cache'),
    ('revflow_campaigns'),
    ('revflow_invoices'),
    ('earnmark360_employees'),
    ('earnmark360_payroll_runs'),
    ('inventory_movements'),
    ('fx_revaluations'),
    ('oauth_states')
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = t
        AND column_name  = 'organization_id'
        AND is_nullable  = 'NO'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id DROP NOT NULL', t);
      RAISE NOTICE 'Fixed: dropped NOT NULL from %.organization_id', t;
    ELSE
      RAISE NOTICE 'Skipped: %.organization_id (not found or already nullable)', t;
    END IF;
  END LOOP;
END $$;

-- Verify: should show 'YES' in is_nullable for all rows
SELECT table_name, column_name, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  column_name  = 'organization_id'
ORDER  BY table_name;
