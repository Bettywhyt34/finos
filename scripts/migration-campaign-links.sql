-- Migration: Link bills + expenses to RevflowCampaign, add bill import fields
-- Run in Supabase SQL Editor — idempotent

-- 1. Bills: campaign FK, dedup key, PO number
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS campaign_id          TEXT REFERENCES revflow_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_bill_id     TEXT,
  ADD COLUMN IF NOT EXISTS purchase_order_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bills_tenant_external_bill_id_key
  ON bills(tenant_id, external_bill_id)
  WHERE external_bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bills_campaign_id_idx ON bills(campaign_id);

-- 2. Expenses: campaign FK
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS campaign_id TEXT REFERENCES revflow_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS expenses_campaign_id_idx ON expenses(campaign_id);

-- 3. Gates
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'bills' AND column_name = 'campaign_id') = 1,
    'Gate W-CL1: bills.campaign_id missing';
  ASSERT (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'bills' AND column_name = 'external_bill_id') = 1,
    'Gate W-CL2: bills.external_bill_id missing';
  ASSERT (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'expenses' AND column_name = 'campaign_id') = 1,
    'Gate W-CL3: expenses.campaign_id missing';
  RAISE NOTICE 'All campaign-link gates passed.';
END $$;
