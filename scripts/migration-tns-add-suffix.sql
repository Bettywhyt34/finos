/**
 * Migration: Transaction Number Series — Add suffix column
 *
 * Adds a suffix column to transaction_number_series so numbers can be
 * formatted as PREFIX-NUMBER-SUFFIX (e.g. INV-00001-NG).
 *
 * IDEMPOTENT — uses IF NOT EXISTS / DO NOTHING so re-runs are safe.
 */

-- ── Add column (idempotent) ──────────────────────────────────────────────────

ALTER TABLE transaction_number_series
  ADD COLUMN IF NOT EXISTS suffix TEXT NOT NULL DEFAULT '';

-- Back-fill any pre-existing rows (no-op if already ''):
UPDATE transaction_number_series
SET suffix = ''
WHERE suffix IS DISTINCT FROM '';

-- ── Gate check ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name  = 'transaction_number_series'
        AND column_name = 'suffix'
    )
  ), 'GATE FAIL: suffix column not found';
END $$;

SELECT 'TNS add-suffix migration complete — gate passed.' AS status;
