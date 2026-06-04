-- Migration: Customer Import Fields
-- Adds columns needed for full Zoho-compatible import/export
-- Run in Supabase SQL Editor

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS salutation          TEXT,
  ADD COLUMN IF NOT EXISTS first_name          TEXT,
  ADD COLUMN IF NOT EXISTS last_name           TEXT,
  ADD COLUMN IF NOT EXISTS mobile              TEXT,
  ADD COLUMN IF NOT EXISTS website             TEXT,
  ADD COLUMN IF NOT EXISTS currency            TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS customer_sub_type   TEXT DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS billing_city        TEXT,
  ADD COLUMN IF NOT EXISTS billing_state       TEXT,
  ADD COLUMN IF NOT EXISTS billing_country     TEXT,
  ADD COLUMN IF NOT EXISTS billing_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS opening_balance     DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Gate: verify columns exist
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'customers'
      AND column_name IN (
        'salutation','first_name','last_name','mobile','website',
        'currency','customer_sub_type','billing_city','billing_state',
        'billing_country','billing_postal_code','opening_balance'
      )
  ) = 12, 'Migration gate failed: not all customer import columns were added';
  RAISE NOTICE 'Customer import migration: all 12 columns verified OK';
END$$;
