-- =============================================================================
-- Migration: Web Tabs
-- Creates web_tabs table with type + placement enums.
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── Step 1: Enums ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'web_tab_type_enum'
  ) THEN
    CREATE TYPE web_tab_type_enum AS ENUM (
      'INTERNAL_ROUTE',
      'EXTERNAL_URL'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'web_tab_placement_enum'
  ) THEN
    CREATE TYPE web_tab_placement_enum AS ENUM (
      'MAIN_NAV',
      'SETTINGS',
      'QUICK_LINKS'
    );
  END IF;
END$$;

-- ── Step 2: web_tabs table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS web_tabs (
  id                TEXT                    NOT NULL DEFAULT gen_random_uuid()::TEXT PRIMARY KEY,
  tenant_id         UUID                    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name              TEXT                    NOT NULL,
  description       TEXT,
  type              web_tab_type_enum       NOT NULL,
  url               TEXT                    NOT NULL,
  placement         web_tab_placement_enum  NOT NULL DEFAULT 'QUICK_LINKS',
  icon              TEXT,
  sort_order        INT                     NOT NULL DEFAULT 0,
  visible_to_roles  TEXT[]                  NOT NULL DEFAULT '{}',

  is_active         BOOLEAN                 NOT NULL DEFAULT true,
  is_system         BOOLEAN                 NOT NULL DEFAULT false,
  is_connected      BOOLEAN                 NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ             NOT NULL DEFAULT now()
);

-- Unique constraint: one name per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'web_tabs_tenant_id_name_key'
  ) THEN
    ALTER TABLE web_tabs
      ADD CONSTRAINT web_tabs_tenant_id_name_key UNIQUE (tenant_id, name);
  END IF;
END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS web_tabs_tenant_id_idx
  ON web_tabs(tenant_id);

CREATE INDEX IF NOT EXISTS web_tabs_tenant_id_placement_idx
  ON web_tabs(tenant_id, placement);

CREATE INDEX IF NOT EXISTS web_tabs_tenant_id_is_active_idx
  ON web_tabs(tenant_id, is_active);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_web_tabs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_web_tabs_updated_at ON web_tabs;
CREATE TRIGGER trg_web_tabs_updated_at
  BEFORE UPDATE ON web_tabs
  FOR EACH ROW EXECUTE FUNCTION set_web_tabs_updated_at();

-- ── Step 3: Row Level Security ────────────────────────────────────────────────

ALTER TABLE web_tabs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_web_tabs ON web_tabs;
CREATE POLICY rls_web_tabs ON web_tabs
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── Step 4: Gate checks ───────────────────────────────────────────────────────

DO $$
DECLARE
  v_tab_cols  INT;
  v_type_ok   INT;
  v_place_ok  INT;
BEGIN
  SELECT COUNT(*) INTO v_tab_cols
    FROM information_schema.columns
   WHERE table_name = 'web_tabs';

  SELECT COUNT(*) INTO v_type_ok
    FROM pg_type WHERE typname = 'web_tab_type_enum';

  SELECT COUNT(*) INTO v_place_ok
    FROM pg_type WHERE typname = 'web_tab_placement_enum';

  ASSERT v_tab_cols >= 14,
    'Gate W-WT-1 FAILED: web_tabs should have at least 14 columns, found ' || v_tab_cols;

  ASSERT v_type_ok = 1,
    'Gate W-WT-2 FAILED: web_tab_type_enum enum is missing';

  ASSERT v_place_ok = 1,
    'Gate W-WT-3 FAILED: web_tab_placement_enum enum is missing';

  RAISE NOTICE 'Gate W-WT-1 PASSED: web_tabs has % columns', v_tab_cols;
  RAISE NOTICE 'Gate W-WT-2 PASSED: web_tab_type_enum exists';
  RAISE NOTICE 'Gate W-WT-3 PASSED: web_tab_placement_enum exists';
END$$;
