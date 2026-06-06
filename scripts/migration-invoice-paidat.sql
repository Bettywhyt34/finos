-- Migration: Add paid_at to invoices for accurate invoice age tracking
-- Run in Supabase SQL Editor after migration-invoice-void-v25.sql
-- Idempotent

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'paid_at'
  ), 'paid_at column missing';
  RAISE NOTICE 'Migration invoice-paidat: OK';
END$$;
