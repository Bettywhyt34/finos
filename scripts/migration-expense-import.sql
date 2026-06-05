-- Migration: add external_expense_id to expenses for Zoho import deduplication
-- Run in Supabase SQL Editor

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS external_expense_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_tenant_external_uq
  ON expenses (tenant_id, external_expense_id)
  WHERE external_expense_id IS NOT NULL;
