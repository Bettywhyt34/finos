-- ============================================================
-- Phase 2.5 Week 4: Integration Registry
-- File: scripts/migration-integration-registry-v25.sql
-- Idempotent — safe to re-run.
-- RUN IN SUPABASE SQL EDITOR.
-- ============================================================

-- ─── Step 1: Create integration_registry ────────────────────
CREATE TABLE IF NOT EXISTS integration_registry (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_app   VARCHAR(50)  UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  category     VARCHAR(50)  NOT NULL,
  -- VALUES: revenue | expense | payroll | inventory | banking | all
  capabilities JSONB        NOT NULL DEFAULT '{}',
  -- e.g. {"sync_invoices":true,"sync_bills":true,"webhook":true}
  config_schema JSONB       NOT NULL DEFAULT '{}',
  -- JSON Schema for tenant config validation
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Step 2: Seed integration_registry ──────────────────────
-- ON CONFLICT DO NOTHING — idempotent
INSERT INTO integration_registry (source_app, display_name, category, capabilities)
VALUES
  ('revflow',
   'Revflow',
   'revenue',
   '{"sync_invoices":true,"sync_campaigns":true,"auto_post_gl":true,"webhook":false}'),
  ('xpenxflow',
   'XpenxFlow',
   'expense',
   '{"sync_bills":true,"sync_expenses":true,"auto_post_gl":true,"webhook":false}'),
  ('earnmark360',
   'Earnmark360',
   'payroll',
   '{"sync_payroll":true,"sync_employees":true,"auto_post_gl":true,"webhook":false}'),
  ('bettywhyt',
   'BettyWhyt',
   'inventory',
   '{"sync_inventory":true,"sync_sales":true,"auto_post_gl":false,"webhook":true}'),
  ('finos_pos',
   'FINOS POS',
   'revenue',
   '{"sync_invoices":true,"sync_inventory":true,"auto_post_gl":true,"webhook":true}'),
  ('manual',
   'Manual Entry',
   'all',
   '{"sync_invoices":false,"sync_bills":false,"auto_post_gl":false,"webhook":false}')
ON CONFLICT (source_app) DO NOTHING;

-- ─── Step 3: Add FK from integration_connections ─────────────
-- Adds source_app_ref referencing integration_registry(source_app).
-- The original source_app column and any CHECK constraint are NOT dropped.
ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS source_app_ref VARCHAR(50)
    REFERENCES integration_registry(source_app);

-- Populate source_app_ref from existing source_app values
-- (only rows whose source_app exists in the registry)
UPDATE integration_connections
SET source_app_ref = source_app
WHERE source_app_ref IS NULL
  AND source_app IN (SELECT source_app FROM integration_registry);

-- ─── Step 4: Create tenant_integrations ─────────────────────
CREATE TABLE IF NOT EXISTS tenant_integrations (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_app   VARCHAR(50)  NOT NULL REFERENCES integration_registry(source_app),
  status       VARCHAR(20)  NOT NULL DEFAULT 'disconnected',
  -- VALUES: connected | disconnected | error | paused
  connected_at TIMESTAMPTZ,
  config       JSONB        NOT NULL DEFAULT '{}',
  gl_mapping   JSONB        NOT NULL DEFAULT '{}',
  -- e.g. {"default_revenue_account":"4100",
  --        "default_expense_account":"5100",
  --        "default_bank_account":"1000"}
  features     JSONB        NOT NULL DEFAULT '{}',
  -- e.g. {"sync_bills":true,"auto_post_gl":true}
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenant_source UNIQUE (tenant_id, source_app)
);

CREATE INDEX IF NOT EXISTS idx_tenant_integrations_tenant
  ON tenant_integrations(tenant_id);

-- ─── Step 5: Seed tenant_integrations from integration_connections ──
-- Map status: CONNECTED → connected, everything else → disconnected.
-- ON CONFLICT DO NOTHING — idempotent.
INSERT INTO tenant_integrations (tenant_id, source_app, status, connected_at)
SELECT
  ic.tenant_id,
  ic.source_app,
  CASE WHEN ic.status = 'CONNECTED' THEN 'connected' ELSE 'disconnected' END,
  CASE WHEN ic.status = 'CONNECTED' THEN ic.updated_at ELSE NULL END
FROM integration_connections ic
WHERE ic.source_app IN (SELECT source_app FROM integration_registry)
ON CONFLICT (tenant_id, source_app) DO NOTHING;

-- ─── Step 6: RLS ────────────────────────────────────────────
-- integration_registry: system-wide, no RLS (readable by all tenants).
-- tenant_integrations: tenant_isolation policy.
ALTER TABLE tenant_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant_integrations;
CREATE POLICY tenant_isolation ON tenant_integrations
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- Explicitly confirm integration_registry has no RLS
ALTER TABLE integration_registry DISABLE ROW LEVEL SECURITY;

-- ─── Step 7: Verification gate queries ──────────────────────

-- Gate W4a: registry seeded (expect 6 rows)
SELECT source_app, category, is_active
FROM integration_registry
ORDER BY source_app;

-- Gate W4b: tenant_integrations columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tenant_integrations'
ORDER BY ordinal_position;

-- Gate W4c: FKs on tenant_integrations
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema   = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
  AND tc.table_schema   = ccu.table_schema
WHERE tc.table_name      = 'tenant_integrations'
  AND tc.constraint_type = 'FOREIGN KEY';

-- Gate W4d: RLS policy on tenant_integrations (expect 1 row)
SELECT tablename, policyname
FROM pg_policies
WHERE tablename = 'tenant_integrations';

-- Gate W4e: no RLS on integration_registry (expect 0 rows)
SELECT tablename
FROM pg_policies
WHERE tablename = 'integration_registry';

-- Gate W4f: test extensibility — add new integration, verify, clean up
INSERT INTO integration_registry (source_app, display_name, category)
VALUES ('test_integration', 'Test Integration', 'revenue')
ON CONFLICT DO NOTHING;
SELECT COUNT(*) AS new_integration_count
FROM integration_registry WHERE source_app = 'test_integration';
DELETE FROM integration_registry WHERE source_app = 'test_integration';

-- Seed count from integration_connections
SELECT COUNT(*) AS seeded_into_tenant_integrations FROM tenant_integrations;
