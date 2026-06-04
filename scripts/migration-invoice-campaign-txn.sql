-- Migration: Add campaign_id and external_txn_id to invoices
-- Run in Supabase SQL Editor
-- Idempotent — safe to run multiple times

-- 1. Add campaign_id column
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS campaign_id TEXT;

-- 2. Add external_txn_id column
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS external_txn_id TEXT;

-- 3. Unique index on (tenant_id, external_txn_id) — only for non-null values
--    Partial index so NULLs are not constrained (invoices without txn id still allowed)
CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_external_txn_id_key
  ON invoices (tenant_id, external_txn_id)
  WHERE external_txn_id IS NOT NULL;

-- 4. Index on campaign_id for campaign report queries
CREATE INDEX IF NOT EXISTS invoices_campaign_id_idx
  ON invoices (tenant_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

-- Verification
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'invoices'
  AND column_name IN ('campaign_id', 'external_txn_id')
ORDER BY column_name;
