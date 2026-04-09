-- Phase 1.5 Budgeting Module migration
-- Run this in Supabase SQL Editor (Settings → SQL Editor)
-- NOTE: All ID columns are TEXT to match Prisma String @id @default(uuid()) → TEXT in Supabase

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE budget_type AS ENUM ('OPERATING', 'CAPEX', 'CASHFLOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE budget_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE override_type AS ENUM ('KEEP_FINOS', 'USE_EXTERNAL', 'MERGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── budgets ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budgets (
  id              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT         NOT NULL REFERENCES organizations(id),
  name            TEXT         NOT NULL,
  type            budget_type  NOT NULL DEFAULT 'OPERATING',
  fiscal_year     INTEGER      NOT NULL,
  description     TEXT,
  status          budget_status NOT NULL DEFAULT 'DRAFT',
  created_by      TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budgets_org ON budgets (organization_id, fiscal_year DESC);

-- ─── budget_versions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_versions (
  id             TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  budget_id      TEXT          NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  version_number INTEGER       NOT NULL DEFAULT 1,
  label          TEXT          NOT NULL DEFAULT 'Original',  -- e.g. Original, Revised Q1, Forecast
  status         budget_status NOT NULL DEFAULT 'DRAFT',
  approved_by    TEXT,
  approved_at    TIMESTAMPTZ,
  created_by     TEXT          NOT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_budget_version UNIQUE (budget_id, version_number)
);

-- ─── budget_lines ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_lines (
  id                TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  budget_id         TEXT         NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  budget_version_id TEXT         NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  account_id        TEXT         NOT NULL REFERENCES chart_of_accounts(id),
  department        TEXT,        -- optional department tag
  project           TEXT,        -- optional project tag
  period            VARCHAR(7)   NOT NULL,  -- YYYY-MM
  amount            NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes             TEXT,

  CONSTRAINT uq_budget_line UNIQUE (budget_version_id, account_id, period, department, project)
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_version ON budget_lines (budget_version_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_account ON budget_lines (account_id, period);

-- ─── budget_approvals ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_approvals (
  id                TEXT            PRIMARY KEY DEFAULT gen_random_uuid()::text,
  budget_id         TEXT            NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  budget_version_id TEXT            NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  approver_id       TEXT            NOT NULL,  -- user id
  approver_name     TEXT,
  status            approval_status NOT NULL DEFAULT 'PENDING',
  comments          TEXT,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  acted_at          TIMESTAMPTZ
);

-- ─── budget_override_logs ─────────────────────────────────────────────────────
-- Records every XpenxFlow override decision for audit trail

CREATE TABLE IF NOT EXISTS budget_override_logs (
  id                 TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  budget_id          TEXT          NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  budget_version_id  TEXT          REFERENCES budget_versions(id),
  override_source    TEXT          NOT NULL DEFAULT 'xpenxflow',  -- integration source
  override_type      override_type NOT NULL,
  approved_by        TEXT          NOT NULL,
  approved_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  difference_percent NUMERIC(6,2),  -- max difference detected
  prior_values       JSONB,         -- snapshot of FINOS budget before override
  external_values    JSONB,         -- snapshot of XpenxFlow budget
  merge_accounts     TEXT[],        -- accounts kept from external in MERGE mode
  notes              TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Verify ───────────────────────────────────────────────────────────────────

SELECT table_name, (SELECT COUNT(*) FROM information_schema.columns c2
  WHERE c2.table_name = t.table_name) AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('budgets','budget_versions','budget_lines','budget_approvals','budget_override_logs')
ORDER BY table_name;
