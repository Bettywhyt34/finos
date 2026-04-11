-- ============================================================
-- Phase 2.5 Week 2: COA financial_category Migration
-- File: scripts/migration-coa-v25.sql
-- Idempotent — safe to re-run.
-- RUN IN SUPABASE SQL EDITOR.
-- ============================================================

-- ─── Step 1: Create financial_category_enum ─────────────────
-- CREATE TYPE has no IF NOT EXISTS; use DO block for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'financial_category_enum'
  ) THEN
    CREATE TYPE financial_category_enum AS ENUM (
      'other_income',
      'income',
      'cost_of_sales',
      'direct_expenses',
      'expenses',
      'other_expenses',
      'current_asset',
      'non_current_asset',
      'current_liability',
      'non_current_liability',
      'equity'
    );
  END IF;
END $$;

-- ─── Step 2: Add columns to chart_of_accounts ───────────────
ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS financial_category financial_category_enum,
  ADD COLUMN IF NOT EXISTS migration_status    VARCHAR(20) DEFAULT 'pending';

-- Backfill migration_status for rows that existed before this column was added
-- (ADD COLUMN with DEFAULT backfills automatically in PostgreSQL 11+,
--  but this guard covers edge cases on re-run).
UPDATE chart_of_accounts
  SET migration_status = 'pending'
  WHERE migration_status IS NULL;

-- ─── Step 3: Auto-migrate unambiguous account types ─────────
-- INCOME → financial_category = 'income'
UPDATE chart_of_accounts
  SET financial_category = 'income',
      migration_status   = 'auto_migrated'
  WHERE type            = 'INCOME'
    AND migration_status = 'pending';

-- EQUITY → financial_category = 'equity'
UPDATE chart_of_accounts
  SET financial_category = 'equity',
      migration_status   = 'auto_migrated'
  WHERE type            = 'EQUITY'
    AND migration_status = 'pending';

-- ASSET, LIABILITY, EXPENSE remain 'pending' — tenant must reclassify.

-- ─── Step 4: Create tenant_report_config ────────────────────
CREATE TABLE IF NOT EXISTS tenant_report_config (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  other_income_position VARCHAR(10)  DEFAULT 'top',
  created_at            TIMESTAMPTZ  DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (tenant_id)
);

-- ─── Step 5: Verification queries ───────────────────────────

-- Gate W2a: enum exists (expected: 1 row)
SELECT typname, typtype FROM pg_type WHERE typname = 'financial_category_enum';

-- Gate W2b: columns added (expected: 2 rows)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name  = 'chart_of_accounts'
  AND column_name IN ('financial_category', 'migration_status');

-- Gate W2c: distribution by migration_status
SELECT migration_status, COUNT(*) AS count
FROM chart_of_accounts
GROUP BY migration_status
ORDER BY migration_status;

-- Pending accounts by type — tells you what the reclassify UI must handle
SELECT type, COUNT(*) AS count
FROM chart_of_accounts
WHERE migration_status = 'pending'
GROUP BY type
ORDER BY type;

-- Gate W2d: must return 0
SELECT COUNT(*) AS auto_migrated_with_null_category
FROM chart_of_accounts
WHERE migration_status   = 'auto_migrated'
  AND financial_category IS NULL;
