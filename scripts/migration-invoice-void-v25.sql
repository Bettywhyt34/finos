-- Migration: Invoice Void + dateSent improvements
-- Run in Supabase SQL Editor
-- Idempotent (safe to re-run)

-- 1. Add VOIDED to the invoice status enum
--    Dynamically finds the correct enum type name by looking for a type
--    that already contains 'WRITTEN_OFF' (a known InvoiceStatus value).
DO $$
DECLARE
  v_enum_type text;
BEGIN
  SELECT pt.typname INTO v_enum_type
  FROM pg_type pt
  JOIN pg_enum pe ON pt.oid = pe.enumtypid
  WHERE pe.enumlabel = 'WRITTEN_OFF'
  LIMIT 1;

  IF v_enum_type IS NULL THEN
    RAISE EXCEPTION 'Could not find the invoice status enum type';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum pe
    JOIN pg_type pt ON pt.oid = pe.enumtypid
    WHERE pt.typname = v_enum_type AND pe.enumlabel = 'VOIDED'
  ) THEN
    EXECUTE format('ALTER TYPE %I ADD VALUE ''VOIDED''', v_enum_type);
    RAISE NOTICE 'Added VOIDED to enum type: %', v_enum_type;
  ELSE
    RAISE NOTICE 'VOIDED already exists in enum type: %', v_enum_type;
  END IF;
END$$;

-- 2. Add voided_at and voided_reason columns
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_reason TEXT;

-- Gate: verify columns exist
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'voided_at'
  ), 'voided_at column missing';
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'voided_reason'
  ), 'voided_reason column missing';
  RAISE NOTICE 'Migration invoice-void-v25: OK';
END$$;
