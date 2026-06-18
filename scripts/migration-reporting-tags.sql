-- =============================================================================
-- Migration: Reporting Tags
-- Creates reporting_tags and reporting_tag_options tables.
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── Step 1: Enum ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'reporting_tag_entity_scope_enum'
  ) THEN
    CREATE TYPE reporting_tag_entity_scope_enum AS ENUM (
      'SALES',
      'PURCHASES',
      'BANKING',
      'ACCOUNTING',
      'INVENTORY',
      'CONTACTS',
      'EXPENSES'
    );
  END IF;
END$$;

-- ── Step 2: reporting_tags table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reporting_tags (
  id          TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name        TEXT        NOT NULL,
  description TEXT,
  color       TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  is_system   BOOLEAN     NOT NULL DEFAULT false,

  applies_to  reporting_tag_entity_scope_enum[] NOT NULL DEFAULT '{}',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one name per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reporting_tags_tenant_id_name_key'
  ) THEN
    ALTER TABLE reporting_tags
      ADD CONSTRAINT reporting_tags_tenant_id_name_key UNIQUE (tenant_id, name);
  END IF;
END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS reporting_tags_tenant_id_idx
  ON reporting_tags(tenant_id);

CREATE INDEX IF NOT EXISTS reporting_tags_tenant_id_is_active_idx
  ON reporting_tags(tenant_id, is_active);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_reporting_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reporting_tags_updated_at ON reporting_tags;
CREATE TRIGGER trg_reporting_tags_updated_at
  BEFORE UPDATE ON reporting_tags
  FOR EACH ROW EXECUTE FUNCTION set_reporting_tags_updated_at();

-- ── Step 3: reporting_tag_options table ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS reporting_tag_options (
  id          TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT PRIMARY KEY,
  tag_id      TEXT        NOT NULL REFERENCES reporting_tags(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,

  name        TEXT        NOT NULL,
  description TEXT,
  color       TEXT,
  sort_order  INT         NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one option name per tag per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reporting_tag_options_tenant_id_tag_id_name_key'
  ) THEN
    ALTER TABLE reporting_tag_options
      ADD CONSTRAINT reporting_tag_options_tenant_id_tag_id_name_key
      UNIQUE (tenant_id, tag_id, name);
  END IF;
END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS reporting_tag_options_tenant_id_idx
  ON reporting_tag_options(tenant_id);

CREATE INDEX IF NOT EXISTS reporting_tag_options_tag_id_idx
  ON reporting_tag_options(tag_id);

CREATE INDEX IF NOT EXISTS reporting_tag_options_tenant_id_is_active_idx
  ON reporting_tag_options(tenant_id, is_active);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_reporting_tag_options_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reporting_tag_options_updated_at ON reporting_tag_options;
CREATE TRIGGER trg_reporting_tag_options_updated_at
  BEFORE UPDATE ON reporting_tag_options
  FOR EACH ROW EXECUTE FUNCTION set_reporting_tag_options_updated_at();

-- ── Step 4: Row Level Security ────────────────────────────────────────────────

ALTER TABLE reporting_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting_tag_options ENABLE ROW LEVEL SECURITY;

-- reporting_tags RLS
DROP POLICY IF EXISTS rls_reporting_tags ON reporting_tags;
CREATE POLICY rls_reporting_tags ON reporting_tags
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- reporting_tag_options RLS
DROP POLICY IF EXISTS rls_reporting_tag_options ON reporting_tag_options;
CREATE POLICY rls_reporting_tag_options ON reporting_tag_options
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── Step 5: Gate checks ───────────────────────────────────────────────────────

DO $$
DECLARE
  v_tag_cols  INT;
  v_opt_cols  INT;
BEGIN
  SELECT COUNT(*) INTO v_tag_cols
    FROM information_schema.columns
   WHERE table_name = 'reporting_tags';

  SELECT COUNT(*) INTO v_opt_cols
    FROM information_schema.columns
   WHERE table_name = 'reporting_tag_options';

  ASSERT v_tag_cols >= 9,
    'Gate W-RT-1 FAILED: reporting_tags should have at least 9 columns, found ' || v_tag_cols;

  ASSERT v_opt_cols >= 9,
    'Gate W-RT-2 FAILED: reporting_tag_options should have at least 9 columns, found ' || v_opt_cols;

  RAISE NOTICE 'Gate W-RT-1 PASSED: reporting_tags has % columns', v_tag_cols;
  RAISE NOTICE 'Gate W-RT-2 PASSED: reporting_tag_options has % columns', v_opt_cols;
END$$;
