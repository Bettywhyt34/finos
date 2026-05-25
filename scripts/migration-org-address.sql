-- Migration: Add address and contact fields to tenants table
-- Run in Supabase SQL Editor

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS address1   TEXT,
  ADD COLUMN IF NOT EXISTS address2   TEXT,
  ADD COLUMN IF NOT EXISTS city       TEXT,
  ADD COLUMN IF NOT EXISTS state      TEXT,
  ADD COLUMN IF NOT EXISTS zip        TEXT,
  ADD COLUMN IF NOT EXISTS phone      TEXT,
  ADD COLUMN IF NOT EXISTS fax        TEXT,
  ADD COLUMN IF NOT EXISTS website    TEXT,
  ADD COLUMN IF NOT EXISTS company_id TEXT,
  ADD COLUMN IF NOT EXISTS tax_id     TEXT;
