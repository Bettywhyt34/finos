/**
 * Migration: Transaction Number Series — Add allowManualOverride & preventDuplicates
 *
 * Adds two new boolean columns to transaction_number_series:
 *   allow_manual_override  — user may type a custom number on the form (default true)
 *   prevent_duplicates     — system checks for collision before saving (default true)
 *
 * IDEMPOTENT — uses IF NOT EXISTS / DO NOTHING so re-runs are safe.
 */

-- ── Add columns (idempotent) ────────────────────────────────────────────────────

ALTER TABLE transaction_number_series
  ADD COLUMN IF NOT EXISTS allow_manual_override BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE transaction_number_series
  ADD COLUMN IF NOT EXISTS prevent_duplicates BOOLEAN NOT NULL DEFAULT true;

-- Back-fill any pre-existing rows (no-op on a fresh table):
UPDATE transaction_number_series
SET
  allow_manual_override = true,
  prevent_duplicates    = true
WHERE
  allow_manual_override IS DISTINCT FROM true
  OR prevent_duplicates IS DISTINCT FROM true;

-- ── Gate checks ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name  = 'transaction_number_series'
        AND column_name = 'allow_manual_override'
    )
  ), 'GATE FAIL: allow_manual_override column not found';

  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name  = 'transaction_number_series'
        AND column_name = 'prevent_duplicates'
    )
  ), 'GATE FAIL: prevent_duplicates column not found';
END $$;

SELECT 'TNS add-fields migration complete — all gates passed.' AS status;
