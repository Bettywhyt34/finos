-- ============================================================
-- Migration: Tax Rates
-- File: scripts/migration-tax-rates.sql
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS tax_rates (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(100)  NOT NULL,
  type        VARCHAR(20)   NOT NULL DEFAULT 'CUSTOM',  -- VAT | WHT | PAYE | CUSTOM
  rate        DECIMAL(5,2)  NOT NULL DEFAULT 0,          -- percentage, e.g. 7.50
  is_default  BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tax_rates;
CREATE POLICY tenant_isolation ON tax_rates
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- Gate: verify table exists
SELECT COUNT(*) AS tax_rates_count FROM tax_rates;
