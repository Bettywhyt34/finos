-- Migration: Add additional_fields JSONB column to tenants table
-- Run in Supabase SQL Editor

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS additional_fields JSONB;
