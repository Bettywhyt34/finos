-- ============================================================
-- Phase 2: Multi-Source Integration Schema
-- Run in Supabase SQL Editor (Settings → SQL Editor)
-- Sources: Revflow, XpenxFlow, EARNMARK360
-- NOTE: All IDs are TEXT to match Prisma String @id @default(uuid()) → TEXT in Supabase
-- ============================================================

-- ─── integration_connections ──────────────────────────────────────────────────
-- One row per (org, source_app). Stores encrypted credentials and sync state.

CREATE TABLE IF NOT EXISTS integration_connections (
  id               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_app       TEXT         NOT NULL CHECK (source_app IN ('revflow', 'xpenxflow', 'earnmark360')),
  status           TEXT         NOT NULL DEFAULT 'DISCONNECTED'
                                CHECK (status IN ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR')),
  api_key_encrypted TEXT,        -- AES-256-GCM encrypted, never sent to browser
  api_url          TEXT,         -- Base URL for the source system API
  last_sync_at     TIMESTAMPTZ,
  last_sync_cursor TEXT,         -- ISO timestamp or record ID for incremental sync
  last_error       TEXT,         -- Last error message (truncated to 1000 chars at app level)
  sync_enabled     BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_integration_connection UNIQUE (organization_id, source_app)
);

CREATE INDEX IF NOT EXISTS idx_integration_connections_org
  ON integration_connections (organization_id);

CREATE INDEX IF NOT EXISTS idx_integration_connections_status
  ON integration_connections (organization_id, status);

-- ─── account_mappings ─────────────────────────────────────────────────────────
-- Maps source system account codes to FINOS Chart of Accounts.
-- One mapping per (org, source_app, source_account_code).

CREATE TABLE IF NOT EXISTS account_mappings (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id     TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_app          TEXT        NOT NULL CHECK (source_app IN ('revflow', 'xpenxflow', 'earnmark360')),
  source_account_code TEXT        NOT NULL,
  source_account_name TEXT,
  finos_account_id    TEXT        NOT NULL REFERENCES chart_of_accounts(id),
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_account_mapping UNIQUE (organization_id, source_app, source_account_code)
);

CREATE INDEX IF NOT EXISTS idx_account_mappings_org_source
  ON account_mappings (organization_id, source_app);

CREATE INDEX IF NOT EXISTS idx_account_mappings_finos_account
  ON account_mappings (finos_account_id);

-- ─── sync_logs ────────────────────────────────────────────────────────────────
-- Immutable audit trail for every sync operation.
-- Every sync attempt creates a new row. Never updated after completion.

CREATE TABLE IF NOT EXISTS sync_logs (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id     TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_app          TEXT        NOT NULL CHECK (source_app IN ('revflow', 'xpenxflow', 'earnmark360')),
  sync_type           TEXT        NOT NULL CHECK (sync_type IN ('full', 'incremental', 'manual', 'webhook')),
  status              TEXT        NOT NULL DEFAULT 'RUNNING'
                                  CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  cursor_from         TEXT,       -- Starting cursor used for this sync
  cursor_to           TEXT,       -- Ending cursor reached (written on success)
  records_processed   INTEGER     NOT NULL DEFAULT 0,
  records_created     INTEGER     NOT NULL DEFAULT 0,
  records_updated     INTEGER     NOT NULL DEFAULT 0,
  records_failed      INTEGER     NOT NULL DEFAULT 0,
  records_quarantined INTEGER     NOT NULL DEFAULT 0,
  error_message       TEXT,
  triggered_by        TEXT        NOT NULL DEFAULT 'system',  -- user ID or 'system'
  duration_ms         INTEGER     GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_org_source
  ON sync_logs (organization_id, source_app, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_logs_status
  ON sync_logs (organization_id, status, started_at DESC);

-- ─── sync_quarantine ──────────────────────────────────────────────────────────
-- Records that failed to sync (parse error, mapping missing, etc.)
-- Preserved for manual review and retry.

CREATE TABLE IF NOT EXISTS sync_quarantine (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_log_id      TEXT        NOT NULL REFERENCES sync_logs(id) ON DELETE CASCADE,
  source_app       TEXT        NOT NULL,
  source_table     TEXT        NOT NULL,
  source_id        TEXT        NOT NULL,
  raw_data         JSONB       NOT NULL,    -- Original payload from source
  error_reason     TEXT        NOT NULL,
  retry_count      INTEGER     NOT NULL DEFAULT 0,
  resolved         BOOLEAN     NOT NULL DEFAULT false,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_quarantine_org
  ON sync_quarantine (organization_id, source_app, resolved, created_at DESC);

-- ─── unified_transactions_cache ───────────────────────────────────────────────
-- Read-through cache for synced source records.
-- Avoids repeated API calls. Invalidated on next sync.

CREATE TABLE IF NOT EXISTS unified_transactions_cache (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_app       TEXT        NOT NULL,
  source_table     TEXT        NOT NULL,   -- 'invoices', 'bills', 'payroll_runs', etc.
  source_id        TEXT        NOT NULL,
  data_json        JSONB       NOT NULL,
  recognition_period TEXT,                 -- YYYY-MM, if applicable (IFRS 15)
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_unified_cache UNIQUE (organization_id, source_app, source_table, source_id)
);

CREATE INDEX IF NOT EXISTS idx_unified_cache_lookup
  ON unified_transactions_cache (organization_id, source_app, source_table);

CREATE INDEX IF NOT EXISTS idx_unified_cache_period
  ON unified_transactions_cache (organization_id, source_app, recognition_period)
  WHERE recognition_period IS NOT NULL;

-- ─── revflow_campaigns ────────────────────────────────────────────────────────
-- Synced from Revflow: one row per campaign.
-- Read-only — never updated directly; overwritten on sync.

CREATE TABLE IF NOT EXISTS revflow_campaigns (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id      TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revflow_id           TEXT        NOT NULL,  -- Source PK from Revflow
  client_name          TEXT        NOT NULL,
  campaign_name        TEXT        NOT NULL,
  campaign_code        TEXT,
  start_date           DATE,
  end_date             DATE,
  contracted_amount    NUMERIC(15,2),
  currency             TEXT        NOT NULL DEFAULT 'NGN',
  status               TEXT,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_revflow_campaign UNIQUE (organization_id, revflow_id)
);

CREATE INDEX IF NOT EXISTS idx_revflow_campaigns_org
  ON revflow_campaigns (organization_id, status);

-- ─── revflow_invoices ─────────────────────────────────────────────────────────
-- Synced from Revflow: revenue invoices.

CREATE TABLE IF NOT EXISTS revflow_invoices (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id      TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revflow_id           TEXT        NOT NULL,
  campaign_id          TEXT        REFERENCES revflow_campaigns(id),
  invoice_number       TEXT        NOT NULL,
  client_name          TEXT        NOT NULL,
  invoice_date         DATE        NOT NULL,
  recognition_period   TEXT,                 -- YYYY-MM (IFRS 15 from Revflow)
  due_date             DATE,
  subtotal             NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount           NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency             TEXT        NOT NULL DEFAULT 'NGN',
  exchange_rate        NUMERIC(12,6) NOT NULL DEFAULT 1,
  status               TEXT,                 -- 'DRAFT', 'SENT', 'PAID', 'OVERDUE', etc.
  finos_journal_id     TEXT        REFERENCES journal_entries(id),  -- auto-posted JE
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_revflow_invoice UNIQUE (organization_id, revflow_id)
);

CREATE INDEX IF NOT EXISTS idx_revflow_invoices_org
  ON revflow_invoices (organization_id, recognition_period, status);

CREATE INDEX IF NOT EXISTS idx_revflow_invoices_campaign
  ON revflow_invoices (campaign_id);

-- ─── earnmark360_employees ────────────────────────────────────────────────────
-- Synced from EARNMARK360: employee master data.

CREATE TABLE IF NOT EXISTS earnmark360_employees (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id      TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  earnmark_id          TEXT        NOT NULL,
  employee_number      TEXT,
  first_name           TEXT        NOT NULL,
  last_name            TEXT        NOT NULL,
  department           TEXT,
  job_title            TEXT,
  hire_date            DATE,
  employment_type      TEXT,       -- 'FULL_TIME', 'PART_TIME', 'CONTRACT'
  base_salary          NUMERIC(15,2),
  currency             TEXT        NOT NULL DEFAULT 'NGN',
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_earnmark360_employee UNIQUE (organization_id, earnmark_id)
);

CREATE INDEX IF NOT EXISTS idx_earnmark360_employees_org
  ON earnmark360_employees (organization_id, is_active);

-- ─── earnmark360_payroll_runs ─────────────────────────────────────────────────
-- Synced from EARNMARK360: payroll run summaries.

CREATE TABLE IF NOT EXISTS earnmark360_payroll_runs (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id      TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  earnmark_id          TEXT        NOT NULL,
  payroll_period       TEXT        NOT NULL,  -- YYYY-MM
  payroll_date         DATE        NOT NULL,
  gross_pay            NUMERIC(15,2) NOT NULL DEFAULT 0,
  paye_tax             NUMERIC(15,2) NOT NULL DEFAULT 0,
  pension_employee     NUMERIC(15,2) NOT NULL DEFAULT 0,
  pension_employer     NUMERIC(15,2) NOT NULL DEFAULT 0,
  nhf_deduction        NUMERIC(15,2) NOT NULL DEFAULT 0,
  nhis_deduction       NUMERIC(15,2) NOT NULL DEFAULT 0,
  other_deductions     NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_pay              NUMERIC(15,2) NOT NULL DEFAULT 0,
  employee_count       INTEGER      NOT NULL DEFAULT 0,
  currency             TEXT         NOT NULL DEFAULT 'NGN',
  status               TEXT,                  -- 'DRAFT', 'APPROVED', 'PAID'
  finos_journal_id     TEXT         REFERENCES journal_entries(id),
  synced_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_earnmark360_payroll UNIQUE (organization_id, earnmark_id)
);

CREATE INDEX IF NOT EXISTS idx_earnmark360_payroll_org
  ON earnmark360_payroll_runs (organization_id, payroll_period);

-- ─── Verify ───────────────────────────────────────────────────────────────────

SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns c2
   WHERE c2.table_name = t.table_name AND c2.table_schema = 'public') AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN (
    'integration_connections', 'account_mappings', 'sync_logs',
    'sync_quarantine', 'unified_transactions_cache',
    'revflow_campaigns', 'revflow_invoices',
    'earnmark360_employees', 'earnmark360_payroll_runs'
  )
ORDER BY table_name;
