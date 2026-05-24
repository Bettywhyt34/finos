-- Migration: Add logo_url column to tenants table
-- Run in Supabase SQL Editor

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
