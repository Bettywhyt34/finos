-- Migration: Extend vendors table with address, financial, and import fields
-- Run in Supabase SQL Editor — idempotent

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS billing_address    TEXT,
  ADD COLUMN IF NOT EXISTS billing_city       TEXT,
  ADD COLUMN IF NOT EXISTS billing_state      TEXT,
  ADD COLUMN IF NOT EXISTS billing_country    TEXT,
  ADD COLUMN IF NOT EXISTS billing_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS opening_balance    DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency           TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS notes              TEXT,
  ADD COLUMN IF NOT EXISTS website            TEXT,
  ADD COLUMN IF NOT EXISTS external_vendor_id TEXT;

-- Unique index for dedup on re-import (partial — NULLs not constrained)
CREATE UNIQUE INDEX IF NOT EXISTS vendors_tenant_external_vendor_id_key
  ON vendors (tenant_id, external_vendor_id)
  WHERE external_vendor_id IS NOT NULL;

-- Verification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'vendors'
  AND column_name IN (
    'billing_address','billing_city','billing_state','billing_country',
    'billing_postal_code','opening_balance','currency','notes',
    'website','external_vendor_id'
  )
ORDER BY column_name;
