-- ─── Locations Feature Migration ─────────────────────────────────────────────
-- Run in Supabase SQL Editor

-- 1. Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_type_enum') THEN
    CREATE TYPE location_type_enum AS ENUM ('BUSINESS_LOCATION', 'WAREHOUSE', 'BRANCH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_status_enum') THEN
    CREATE TYPE location_status_enum AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
END $$;

-- 2. Add locations_enabled flag to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS locations_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Locations table
CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        location_type_enum NOT NULL DEFAULT 'BUSINESS_LOCATION',
  parent_id   TEXT REFERENCES locations(id) ON DELETE SET NULL,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  country     TEXT,
  status      location_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indices
CREATE INDEX IF NOT EXISTS idx_locations_tenant_id ON locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent_id  ON locations(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_tenant_name ON locations(tenant_id, lower(name));

-- 5. updated_at trigger (uses a dedicated function to avoid conflicts)
CREATE OR REPLACE FUNCTION set_locations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_locations_updated_at ON locations;
CREATE TRIGGER trg_locations_updated_at
  BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION set_locations_updated_at();

-- Gates
DO $$
BEGIN
  ASSERT (
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'locations_enabled'
  ) IS NOT NULL, 'W-LOC-1 FAIL: locations_enabled missing from tenants';
  ASSERT (SELECT to_regclass('public.locations')) IS NOT NULL,
    'W-LOC-2 FAIL: locations table missing';
  RAISE NOTICE 'Locations migration: all gates passed ✓';
END $$;
