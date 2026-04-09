-- Multi-currency migration
-- Run this in Supabase SQL Editor (Settings → SQL Editor)

-- Add currency + exchange_rate to invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS currency     VARCHAR(10)     NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(15, 6)  NOT NULL DEFAULT 1;

-- Add currency + exchange_rate to bills
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS currency     VARCHAR(10)     NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(15, 6)  NOT NULL DEFAULT 1;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name IN ('invoices', 'bills')
  AND column_name IN ('currency', 'exchange_rate')
ORDER BY table_name, column_name;
