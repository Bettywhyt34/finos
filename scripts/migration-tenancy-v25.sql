-- ============================================================
-- Phase 2.5 Week 1: Tenancy Migration
-- File: scripts/migration-tenancy-v25.sql
-- Idempotent — safe to re-run.
-- RUN ENTIRELY IN SUPABASE SQL EDITOR BEFORE DEPLOYING CODE.
--
-- NOTE ON TYPES:
--   Prisma maps String @id → TEXT in Postgres, so organizations.id
--   and all organization_id FK columns are TEXT even though they hold
--   UUID-formatted values.  The new tenants.id is a proper UUID column,
--   so every place we move data across the boundary requires ::UUID cast.
-- ============================================================

-- ─── Step 1a: Parity snapshot ───────────────────────────────
-- Run these and save the numbers BEFORE proceeding.
SELECT COUNT(*) AS org_count        FROM organizations;
SELECT COUNT(*) AS membership_count FROM organization_memberships;

-- ─── Step 1b: Create tenants table ──────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      VARCHAR(255)  NOT NULL,
  slug                      VARCHAR(100)  UNIQUE,
  country_code              CHAR(2)       DEFAULT 'NG',
  currency                  CHAR(3)       DEFAULT 'NGN',
  fiscal_year_start         SMALLINT      DEFAULT 1,
  fiscal_year_end           VARCHAR(10),                    -- kept for compatibility
  industry_code             VARCHAR(30),
  timezone                  VARCHAR(50)   DEFAULT 'Africa/Lagos',
  status                    VARCHAR(20)   DEFAULT 'active',
  benchmark_consent         BOOLEAN,
  benchmark_consent_at      TIMESTAMPTZ,
  benchmark_consent_version VARCHAR(10),
  created_at                TIMESTAMPTZ   DEFAULT NOW()
);

-- ─── Step 1c: Seed tenants from organizations ───────────────
-- Cast id TEXT → UUID (Prisma stores UUIDs as TEXT in the source table).
INSERT INTO tenants (
  id, name, slug, country_code, currency,
  fiscal_year_start, fiscal_year_end, timezone, status, created_at
)
SELECT
  id::UUID,    -- TEXT → UUID cast required
  name,
  LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '-', 'g')),
  'NG',
  COALESCE(currency, 'NGN'),
  1,
  fiscal_year_end,
  'Africa/Lagos',
  'active',
  created_at
FROM organizations
ON CONFLICT (id) DO NOTHING;

-- ─── Step 1d: Rename organizations → organizations_legacy ───
ALTER TABLE organizations RENAME TO organizations_legacy;

-- ─── Step 1e: Compatibility view ────────────────────────────
-- Casts tenants.id back to TEXT so legacy app code reading id as text still works.
CREATE OR REPLACE VIEW organizations AS
  SELECT id::TEXT AS id, name, slug, currency, created_at FROM tenants;

-- ─── Step 1f: Rename organization_memberships ───────────────
-- Hard cutover — coordinate deploy.
-- The renamed tenant_id column stays TEXT (same type as original organization_id).
ALTER TABLE organization_memberships RENAME COLUMN organization_id TO tenant_id;
ALTER TABLE organization_memberships RENAME TO tenant_memberships;

-- ─── Step 1g: Add tenant_id UUID to all 28 root tables ──────
-- Pattern: A) add UUID column  B) migrate data with TEXT→UUID cast  C) NOT NULL
-- organization_id remains (TEXT) — not dropped in Week 1.

-- chart_of_accounts
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE chart_of_accounts SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE chart_of_accounts ALTER COLUMN tenant_id SET NOT NULL;

-- journal_entries
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE journal_entries SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE journal_entries ALTER COLUMN tenant_id SET NOT NULL;

-- invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE invoices SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE invoices ALTER COLUMN tenant_id SET NOT NULL;

-- bills
ALTER TABLE bills ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE bills SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE bills ALTER COLUMN tenant_id SET NOT NULL;

-- bank_accounts
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE bank_accounts SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE bank_accounts ALTER COLUMN tenant_id SET NOT NULL;

-- customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE customers SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE customers ALTER COLUMN tenant_id SET NOT NULL;

-- vendors
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE vendors SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE vendors ALTER COLUMN tenant_id SET NOT NULL;

-- items
ALTER TABLE items ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE items SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE items ALTER COLUMN tenant_id SET NOT NULL;

-- item_categories
ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE item_categories SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE item_categories ALTER COLUMN tenant_id SET NOT NULL;

-- expenses
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE expenses SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE expenses ALTER COLUMN tenant_id SET NOT NULL;

-- expense_categories
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE expense_categories SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE expense_categories ALTER COLUMN tenant_id SET NOT NULL;

-- accounting_periods
ALTER TABLE accounting_periods ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE accounting_periods SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE accounting_periods ALTER COLUMN tenant_id SET NOT NULL;

-- budgets
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE budgets SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE budgets ALTER COLUMN tenant_id SET NOT NULL;

-- credit_notes
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE credit_notes SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE credit_notes ALTER COLUMN tenant_id SET NOT NULL;

-- customer_payments
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE customer_payments SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE customer_payments ALTER COLUMN tenant_id SET NOT NULL;

-- vendor_payments
ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE vendor_payments SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE vendor_payments ALTER COLUMN tenant_id SET NOT NULL;

-- integration_connections (table rename is a later phase; tenant_id column only)
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE integration_connections SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE integration_connections ALTER COLUMN tenant_id SET NOT NULL;

-- account_mappings
ALTER TABLE account_mappings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE account_mappings SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE account_mappings ALTER COLUMN tenant_id SET NOT NULL;

-- sync_logs
ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE sync_logs SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE sync_logs ALTER COLUMN tenant_id SET NOT NULL;

-- sync_quarantine
ALTER TABLE sync_quarantine ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE sync_quarantine SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE sync_quarantine ALTER COLUMN tenant_id SET NOT NULL;

-- unified_transactions_cache
ALTER TABLE unified_transactions_cache ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE unified_transactions_cache SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE unified_transactions_cache ALTER COLUMN tenant_id SET NOT NULL;

-- revflow_campaigns
ALTER TABLE revflow_campaigns ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE revflow_campaigns SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE revflow_campaigns ALTER COLUMN tenant_id SET NOT NULL;

-- revflow_invoices
ALTER TABLE revflow_invoices ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE revflow_invoices SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE revflow_invoices ALTER COLUMN tenant_id SET NOT NULL;

-- earnmark360_employees
ALTER TABLE earnmark360_employees ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE earnmark360_employees SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE earnmark360_employees ALTER COLUMN tenant_id SET NOT NULL;

-- earnmark360_payroll_runs
ALTER TABLE earnmark360_payroll_runs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE earnmark360_payroll_runs SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE earnmark360_payroll_runs ALTER COLUMN tenant_id SET NOT NULL;

-- inventory_movements
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE inventory_movements SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE inventory_movements ALTER COLUMN tenant_id SET NOT NULL;

-- fx_revaluations
ALTER TABLE fx_revaluations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE fx_revaluations SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL;
ALTER TABLE fx_revaluations ALTER COLUMN tenant_id SET NOT NULL;

-- oauth_states
-- Create if migration-oauth-integrations.sql was never run on this DB.
CREATE TABLE IF NOT EXISTS oauth_states (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  state           TEXT        UNIQUE NOT NULL,
  organization_id TEXT,
  user_id         TEXT        NOT NULL,
  source_app      TEXT        NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE oauth_states SET tenant_id = organization_id::UUID WHERE tenant_id IS NULL AND organization_id IS NOT NULL;
-- Only enforce NOT NULL when every existing row has been migrated (safe if table is empty).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM oauth_states WHERE tenant_id IS NULL) THEN
    ALTER TABLE oauth_states ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- ─── Step 1x-a: Inspect existing RLS policies ───────────────
-- Run and save results — these policies must be replaced.
SELECT tablename, policyname, cmd, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual::text ILIKE '%organization_id%'
    OR qual::text ILIKE '%current_org%'
    OR tablename IN ('organizations', 'organization_memberships')
  );

-- ─── Step 1x-b: Update RLS policies ─────────────────────────
-- For the 28 root tables: tenant_id is UUID, compare to ::UUID cast.
-- For tenant_memberships: tenant_id is TEXT (renamed in-place), compare to raw setting.

DROP POLICY IF EXISTS tenant_isolation ON chart_of_accounts;
CREATE POLICY tenant_isolation ON chart_of_accounts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON journal_entries;
CREATE POLICY tenant_isolation ON journal_entries
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON invoices;
CREATE POLICY tenant_isolation ON invoices
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bills;
CREATE POLICY tenant_isolation ON bills
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bank_accounts;
CREATE POLICY tenant_isolation ON bank_accounts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON customers;
CREATE POLICY tenant_isolation ON customers
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON vendors;
CREATE POLICY tenant_isolation ON vendors
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON items;
CREATE POLICY tenant_isolation ON items
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON item_categories;
CREATE POLICY tenant_isolation ON item_categories
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON expenses;
CREATE POLICY tenant_isolation ON expenses
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON expense_categories;
CREATE POLICY tenant_isolation ON expense_categories
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON accounting_periods;
CREATE POLICY tenant_isolation ON accounting_periods
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON budgets;
CREATE POLICY tenant_isolation ON budgets
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON credit_notes;
CREATE POLICY tenant_isolation ON credit_notes
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON customer_payments;
CREATE POLICY tenant_isolation ON customer_payments
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON vendor_payments;
CREATE POLICY tenant_isolation ON vendor_payments
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON integration_connections;
CREATE POLICY tenant_isolation ON integration_connections
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON account_mappings;
CREATE POLICY tenant_isolation ON account_mappings
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE account_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON sync_logs;
CREATE POLICY tenant_isolation ON sync_logs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON sync_quarantine;
CREATE POLICY tenant_isolation ON sync_quarantine
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE sync_quarantine ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON unified_transactions_cache;
CREATE POLICY tenant_isolation ON unified_transactions_cache
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE unified_transactions_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON revflow_campaigns;
CREATE POLICY tenant_isolation ON revflow_campaigns
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE revflow_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON revflow_invoices;
CREATE POLICY tenant_isolation ON revflow_invoices
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE revflow_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON earnmark360_employees;
CREATE POLICY tenant_isolation ON earnmark360_employees
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE earnmark360_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON earnmark360_payroll_runs;
CREATE POLICY tenant_isolation ON earnmark360_payroll_runs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE earnmark360_payroll_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON inventory_movements;
CREATE POLICY tenant_isolation ON inventory_movements
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON fx_revaluations;
CREATE POLICY tenant_isolation ON fx_revaluations
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE fx_revaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON oauth_states;
CREATE POLICY tenant_isolation ON oauth_states
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

-- tenant_memberships: tenant_id is TEXT (renamed in-place from organization_id),
-- so compare to raw setting string, not ::UUID.
DROP POLICY IF EXISTS tenant_isolation ON tenant_memberships;
CREATE POLICY tenant_isolation ON tenant_memberships
  FOR ALL USING (tenant_id = current_setting('app.current_tenant', TRUE));
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;

-- ─── Step 1x-c: Verify tenant isolation post-migration ───────
-- All tenant-scoped tables should appear here:
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND qual::text ILIKE '%tenant_id%';

-- This MUST return 0 (Gate G1c):
SELECT COUNT(*) FROM pg_policies
WHERE schemaname = 'public'
  AND qual::text ILIKE '%organization_id%';

-- ─── Step 1x-d: Parity check (post-migration) ────────────────
-- Both counts must match Step 1a numbers.
SELECT COUNT(*) FROM tenants;
SELECT COUNT(*) FROM tenant_memberships;

-- ─── Gate G1b: Legacy columns (non-zero by design in Week 1) ─
-- organization_id columns are NOT dropped — deferred to post-G1a pass.
SELECT table_name, column_name FROM information_schema.columns
WHERE column_name = 'organization_id'
  AND table_schema = 'public';
