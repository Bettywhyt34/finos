-- ============================================================
-- Migration: Opening Balances
-- Phase: v2.5 Post-Week 4
-- Applied against: Supabase PostgreSQL 15
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Enums (idempotent) ─────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE opening_balance_status_enum AS ENUM ('DRAFT', 'FINALISED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE opening_balance_line_type_enum AS ENUM ('ACCOUNT', 'CUSTOMER', 'VENDOR', 'BANK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. opening_balance_batches ────────────────────────────────────────────────
-- One batch per tenant (enforced in application layer; database allows multiple
-- for future multi-period support).

CREATE TABLE IF NOT EXISTS opening_balance_batches (
  id                TEXT                            NOT NULL PRIMARY KEY,
  tenant_id         UUID                            NOT NULL
                      REFERENCES tenants(id) ON DELETE CASCADE,
  migration_date    TIMESTAMPTZ                     NOT NULL,
  status            opening_balance_status_enum     NOT NULL DEFAULT 'DRAFT',
  notes             TEXT,
  finalised_at      TIMESTAMPTZ,
  finalised_by_id   TEXT,
  journal_entry_id  TEXT                            UNIQUE,
  created_at        TIMESTAMPTZ                     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ                     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE opening_balance_batches IS
  'Tracks the tenant migration date and overall status of opening balance entry.';

COMMENT ON COLUMN opening_balance_batches.journal_entry_id IS
  'Set when the batch is finalised and a balanced journal entry is posted.';

-- ── 3. opening_balance_lines ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opening_balance_lines (
  id               TEXT                               NOT NULL PRIMARY KEY,
  batch_id         TEXT                               NOT NULL
                     REFERENCES opening_balance_batches(id) ON DELETE CASCADE,
  tenant_id        UUID                               NOT NULL,
  account_id       TEXT,                              -- FK to chart_of_accounts (optional until finalise)
  line_type        opening_balance_line_type_enum     NOT NULL DEFAULT 'ACCOUNT',
  customer_id      TEXT,                              -- FK to customers (CUSTOMER type)
  vendor_id        TEXT,                              -- FK to vendors (VENDOR type)
  bank_account_id  TEXT,                              -- FK to bank_accounts (BANK type)
  label            TEXT                               NOT NULL,
  account_category TEXT,                              -- grouping: "Asset", "Accounts Receivable", etc.
  currency         TEXT                               NOT NULL DEFAULT 'NGN',
  exchange_rate    DECIMAL(15,6)                      NOT NULL DEFAULT 1,
  debit            DECIMAL(15,2)                      NOT NULL DEFAULT 0,
  credit           DECIMAL(15,2)                      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ                        NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ                        NOT NULL DEFAULT NOW(),

  CONSTRAINT ob_line_no_both_sides
    CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT ob_line_non_negative_debit
    CHECK (debit >= 0),
  CONSTRAINT ob_line_non_negative_credit
    CHECK (credit >= 0),
  CONSTRAINT ob_line_exchange_rate_positive
    CHECK (exchange_rate > 0)
);

COMMENT ON TABLE opening_balance_lines IS
  'Individual account/customer/vendor/bank lines within an opening balance batch.';

-- ── 4. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ob_batches_tenant_id
  ON opening_balance_batches (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ob_batches_tenant_status
  ON opening_balance_batches (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_ob_lines_tenant_id
  ON opening_balance_lines (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ob_lines_batch_id
  ON opening_balance_lines (batch_id);

CREATE INDEX IF NOT EXISTS idx_ob_lines_account_id
  ON opening_balance_lines (account_id);

-- ── 5. Row-Level Security ─────────────────────────────────────────────────────

ALTER TABLE opening_balance_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_balance_lines   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "ob_batches_tenant_isolation"
    ON opening_balance_batches
    USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "ob_lines_tenant_isolation"
    ON opening_balance_lines
    USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 6. Gate checks ────────────────────────────────────────────────────────────

DO $$ BEGIN
  ASSERT (
    SELECT COUNT(*) = 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'opening_balance_batches'
  ), 'GATE W5a FAIL: opening_balance_batches not created';

  ASSERT (
    SELECT COUNT(*) = 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'opening_balance_lines'
  ), 'GATE W5b FAIL: opening_balance_lines not created';

  ASSERT (
    SELECT COUNT(*) > 0
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_ob_batches_tenant_id'
  ), 'GATE W5c FAIL: idx_ob_batches_tenant_id not created';

  ASSERT (
    SELECT COUNT(*) > 0
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_ob_lines_batch_id'
  ), 'GATE W5d FAIL: idx_ob_lines_batch_id not created';

  ASSERT (
    SELECT COUNT(*) > 0
    FROM pg_type
    WHERE typname = 'opening_balance_status_enum'
  ), 'GATE W5e FAIL: opening_balance_status_enum enum not created';

  ASSERT (
    SELECT COUNT(*) > 0
    FROM pg_type
    WHERE typname = 'opening_balance_line_type_enum'
  ), 'GATE W5f FAIL: opening_balance_line_type_enum enum not created';

  RAISE NOTICE 'Migration opening-balances: all gates passed.';
  RAISE NOTICE 'Tables: opening_balance_batches, opening_balance_lines';
  RAISE NOTICE 'Next step: run `npx prisma generate` then `npx tsc --noEmit --skipLibCheck`';
END $$;
