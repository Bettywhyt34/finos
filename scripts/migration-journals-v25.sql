-- ============================================================
-- Phase 2.5 Week 3: Journal Model Migration
-- File: scripts/migration-journals-v25.sql
-- Idempotent — safe to re-run.
-- RUN IN SUPABASE SQL EDITOR.
--
-- NOTE ON TYPES:
--   journal_entries.id and chart_of_accounts.id are TEXT in Postgres
--   (Prisma maps String @id → TEXT). journal_lines.je_id and account_id
--   are therefore TEXT FKs. tenant_id is UUID (from Week 1 migration).
--   The plan spec says "UUID FK" for je_id/account_id; TEXT is used here
--   to match the actual referenced column types.
-- ============================================================

-- ─── Step 1: Create journal_lines table ─────────────────────
CREATE TABLE IF NOT EXISTS journal_lines (
  id          TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  je_id       TEXT          NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  tenant_id   UUID          NOT NULL REFERENCES tenants(id),
  account_id  TEXT          NOT NULL REFERENCES chart_of_accounts(id),
  direction   CHAR(2)       NOT NULL CHECK (direction IN ('DR', 'CR')),
  amount_ngn  DECIMAL(15,2) NOT NULL CHECK (amount_ngn > 0),
  description TEXT
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_je_id    ON journal_lines(je_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_tenant   ON journal_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account  ON journal_lines(account_id);

-- ─── Step 2: Create journal_migration_log ───────────────────
-- source_line_id = journal_entry_lines.id from Phase 1
-- PRIMARY KEY ensures idempotency — cannot insert the same source line twice
CREATE TABLE IF NOT EXISTS journal_migration_log (
  source_line_id TEXT        PRIMARY KEY,
  migrated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Step 3: Hardened imbalance guard trigger ────────────────
-- Per Phase 2.5 B.4 exact spec.
-- Fires on INSERT, UPDATE, DELETE — DEFERRABLE INITIALLY DEFERRED
-- so the check runs at transaction COMMIT, allowing multi-row inserts.

CREATE OR REPLACE FUNCTION fn_journal_balance_check()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_je_id  TEXT;
  v_count  BIGINT;
  v_net    NUMERIC;
BEGIN
  -- Resolve je_id for all operation types
  v_je_id := COALESCE(NEW.je_id, OLD.je_id);

  -- Aggregate current lines for this journal entry
  SELECT
    COUNT(*),
    COALESCE(
      SUM(CASE WHEN direction = 'DR' THEN amount_ngn
               ELSE -amount_ngn END),
      0
    )
  INTO v_count, v_net
  FROM journal_lines
  WHERE je_id = v_je_id;

  -- Allow a journal entry with zero lines (e.g. cascade delete in progress)
  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  -- Reject any imbalance greater than rounding tolerance
  IF ABS(v_net) > 0.001 THEN
    RAISE EXCEPTION
      'Journal entry % is not balanced: DR-CR net = % (must be 0)',
      v_je_id, v_net;
  END IF;

  RETURN NULL;  -- return value ignored for AFTER triggers
END;
$$;

-- Drop and recreate so the trigger definition is always current
DROP TRIGGER IF EXISTS trg_journal_balance ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_balance
  AFTER INSERT OR UPDATE OR DELETE
  ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_journal_balance_check();

-- ─── Step 4: Period-close posting guard ──────────────────────
-- Per Phase 2.5 B.4 exact spec.
-- Uses entry_date (canonical column on journal_entries) to derive YYYY-MM period.
-- Missing accounting_period row = open (new-tenant safe).

CREATE OR REPLACE FUNCTION check_period_open()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_period    TEXT;
  v_is_closed BOOLEAN;
BEGIN
  -- Derive YYYY-MM from entry_date
  v_period := TO_CHAR(NEW.entry_date, 'YYYY-MM');

  SELECT is_closed
  INTO   v_is_closed
  FROM   accounting_periods
  WHERE  tenant_id = NEW.tenant_id
    AND  period    = v_period;

  -- Treat missing row as open (safe for new tenants without periods seeded)
  IF v_is_closed IS TRUE THEN
    RAISE EXCEPTION
      'Accounting period % is closed — cannot post journal entry', v_period;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_period_check ON journal_entries;
CREATE TRIGGER trg_journal_period_check
  BEFORE INSERT
  ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION check_period_open();

-- ─── Step 5: Migrate journal_entry_lines → journal_lines ────
-- Runs inside a DO block (single transaction) so the DEFERRABLE trigger
-- fires at block-end with all DR and CR lines present → net = 0.
-- journal_migration_log.source_line_id PRIMARY KEY prevents re-migration.

DO $$
BEGIN
  -- DR pass: lines where debit > 0 and not yet migrated
  INSERT INTO journal_lines (je_id, tenant_id, account_id, direction, amount_ngn, description)
  SELECT
    jel.entry_id,
    je.tenant_id,
    jel.account_id,
    'DR',
    jel.debit,
    jel.description
  FROM journal_entry_lines jel
  JOIN journal_entries     je  ON je.id = jel.entry_id
  WHERE jel.debit > 0
    AND jel.id NOT IN (SELECT source_line_id FROM journal_migration_log);

  -- CR pass: lines where credit > 0 and not yet migrated
  INSERT INTO journal_lines (je_id, tenant_id, account_id, direction, amount_ngn, description)
  SELECT
    jel.entry_id,
    je.tenant_id,
    jel.account_id,
    'CR',
    jel.credit,
    jel.description
  FROM journal_entry_lines jel
  JOIN journal_entries     je  ON je.id = jel.entry_id
  WHERE jel.credit > 0
    AND jel.id NOT IN (SELECT source_line_id FROM journal_migration_log);

  -- Log all migrated source lines (idempotent — ON CONFLICT DO NOTHING)
  INSERT INTO journal_migration_log (source_line_id)
  SELECT id
  FROM   journal_entry_lines
  WHERE  GREATEST(debit, credit) > 0
    AND  id NOT IN (SELECT source_line_id FROM journal_migration_log)
  ON CONFLICT DO NOTHING;

END $$;

-- ─── Step 6: Three-date model + lifecycle fields on unified_transactions ──
ALTER TABLE unified_transactions_cache
  ADD COLUMN IF NOT EXISTS source_date       DATE,
  ADD COLUMN IF NOT EXISTS posting_date      DATE,
  ADD COLUMN IF NOT EXISTS recognition_date  DATE,
  ADD COLUMN IF NOT EXISTS data_quality_state VARCHAR(20) DEFAULT 'clean',
  ADD COLUMN IF NOT EXISTS source_provenance  VARCHAR(20) DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS confidence_score   DECIMAL(5,4) DEFAULT 1.0000,
  ADD COLUMN IF NOT EXISTS is_posted          BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS posted_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS journal_entry_id   TEXT REFERENCES journal_entries(id);

-- ─── Step 7: Verification gate queries ──────────────────────

-- Gate W3a: journal_lines columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'journal_lines'
ORDER BY ordinal_position;

-- Gate W3b: imbalance trigger (expect 3 rows — INSERT, UPDATE, DELETE)
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name        = 'trg_journal_balance'
  AND event_object_table  = 'journal_lines';

-- Gate W3c: period-close trigger (expect 1 row)
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name       = 'trg_journal_period_check'
  AND event_object_table = 'journal_entries';

-- Gate W3d: migration parity (all three counts must match)
SELECT
  (SELECT COUNT(*) FROM journal_entry_lines
   WHERE GREATEST(debit, credit) > 0) AS source_lines,
  (SELECT COUNT(*) FROM journal_lines)        AS migrated_lines,
  (SELECT COUNT(*) FROM journal_migration_log) AS log_entries;

-- Gate W3e: zero imbalanced journal entries (expect 0 rows)
SELECT
  je_id,
  SUM(CASE WHEN direction = 'DR' THEN amount_ngn
           ELSE -amount_ngn END) AS net_balance
FROM journal_lines
GROUP BY je_id
HAVING ABS(SUM(CASE WHEN direction = 'DR' THEN amount_ngn
                    ELSE -amount_ngn END)) > 0.001;

-- Gate W3f: three-date columns on unified_transactions_cache (expect 5 rows)
SELECT column_name
FROM information_schema.columns
WHERE table_name  = 'unified_transactions_cache'
  AND column_name IN ('source_date', 'posting_date', 'recognition_date',
                      'data_quality_state', 'is_posted');

-- Confirm entry_date exists on journal_entries
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name  = 'journal_entries'
  AND column_name = 'entry_date';
