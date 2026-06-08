-- =============================================================================
-- Phase 2.5 — Payment Terms
-- Run in Supabase SQL Editor (session pooler, port 5432 / direct URL)
-- Safe to re-run: CREATE IF NOT EXISTS / ON CONFLICT DO NOTHING throughout
-- =============================================================================

-- ── Step 1: Create enums (idempotent) ─────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_term_due_type_enum') THEN
    CREATE TYPE payment_term_due_type_enum AS ENUM (
      'DUE_ON_RECEIPT',
      'FIXED_DAYS',
      'END_OF_MONTH',
      'END_OF_NEXT_MONTH'
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_term_applies_to_enum') THEN
    CREATE TYPE payment_term_applies_to_enum AS ENUM (
      'CUSTOMERS',
      'VENDORS',
      'BOTH'
    );
  END IF;
END;
$$;

-- ── Step 2: Create payment_terms table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_terms (
  id          UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID                          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT                          NOT NULL,
  due_in_days INTEGER                       CHECK (due_in_days IS NULL OR due_in_days >= 0),
  due_type    payment_term_due_type_enum    NOT NULL DEFAULT 'FIXED_DAYS',
  applies_to  payment_term_applies_to_enum  NOT NULL DEFAULT 'BOTH',
  is_default  BOOLEAN                       NOT NULL DEFAULT FALSE,
  is_system   BOOLEAN                       NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN                       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenant_payment_term_name UNIQUE (tenant_id, name)
);

-- ── Step 3: Indexes ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payment_terms_tenant
  ON payment_terms (tenant_id);

CREATE INDEX IF NOT EXISTS idx_payment_terms_tenant_active
  ON payment_terms (tenant_id, is_active);

-- ── Step 4: updated_at trigger ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_payment_terms_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_terms_updated_at ON payment_terms;
CREATE TRIGGER trg_payment_terms_updated_at
  BEFORE UPDATE ON payment_terms
  FOR EACH ROW EXECUTE FUNCTION fn_payment_terms_set_updated_at();

-- ── Step 5: Seed system payment terms for all active tenants ──────────────────
-- Idempotent: ON CONFLICT (tenant_id, name) DO NOTHING
-- is_system = TRUE marks these as protected (cannot be renamed/deleted)
-- Net 30 is the only is_default = TRUE seed term

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM tenants LOOP
    INSERT INTO payment_terms
      (tenant_id, name, due_in_days, due_type, applies_to, is_default, is_system)
    VALUES
      (r.id, 'Due on Receipt',       NULL, 'DUE_ON_RECEIPT',  'BOTH', FALSE, TRUE),
      (r.id, 'Net 15',               15,   'FIXED_DAYS',      'BOTH', FALSE, TRUE),
      (r.id, 'Net 30',               30,   'FIXED_DAYS',      'BOTH', TRUE,  TRUE),
      (r.id, 'Net 60',               60,   'FIXED_DAYS',      'BOTH', FALSE, TRUE),
      (r.id, 'Net 90',               90,   'FIXED_DAYS',      'BOTH', FALSE, TRUE),
      (r.id, 'Due end of the month', NULL, 'END_OF_MONTH',    'BOTH', FALSE, TRUE),
      (r.id, 'Due end of next month',NULL, 'END_OF_NEXT_MONTH','BOTH', FALSE, TRUE)
    ON CONFLICT (tenant_id, name) DO NOTHING;
  END LOOP;
END;
$$;

-- ── Step 6: Row Level Security ────────────────────────────────────────────────

ALTER TABLE payment_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_terms_tenant_isolation ON payment_terms;
CREATE POLICY payment_terms_tenant_isolation ON payment_terms
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- ── Gates (run after applying to verify) ─────────────────────────────────────

-- Gate PT-a: Table exists and is accessible
SELECT COUNT(*) AS payment_terms_rows FROM payment_terms;

-- Gate PT-b: Enums exist
SELECT typname FROM pg_type
  WHERE typname IN ('payment_term_due_type_enum', 'payment_term_applies_to_enum')
  ORDER BY typname;

-- Gate PT-c: System terms seeded per tenant
SELECT t.name AS tenant_name, COUNT(pt.id) AS seeded_terms
  FROM tenants t
  LEFT JOIN payment_terms pt ON pt.tenant_id = t.id AND pt.is_system = TRUE
  GROUP BY t.name
  ORDER BY t.name;

-- Gate PT-d: Exactly one default per tenant
SELECT tenant_id, COUNT(*) AS default_count
  FROM payment_terms
  WHERE is_default = TRUE
  GROUP BY tenant_id
  HAVING COUNT(*) > 1;  -- should return 0 rows
