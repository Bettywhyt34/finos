-- ─── Migration: Invoice Line Tax/Discount Enhancement ────────────────────────
-- Adds per-line tax (FK to tax_rates), discount (PERCENT/FIXED), and
-- pre-computed line_total to invoice_lines.
-- Formula: lineTotal = (qty × rate − lineDiscount) × (1 + taxRate/100)
-- This corrects the old formula where tax was applied BEFORE discount.
--
-- Run in Supabase SQL Editor (safe to re-run — all ADD COLUMN IF NOT EXISTS).

-- ── Step 1: Add new columns ────────────────────────────────────────────────────

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS tax_rate_id     UUID           REFERENCES tax_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_name        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tax_amount      DECIMAL(15,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type   VARCHAR(10)    NOT NULL DEFAULT 'PERCENT',
  ADD COLUMN IF NOT EXISTS discount_value  DECIMAL(15,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total      DECIMAL(15,2)  NOT NULL DEFAULT 0;

-- ── Step 2: Backfill tax_rate_id + tax_name for existing lines ─────────────────
-- Match by exact rate within tenant (prefer default rate on tie, then oldest).

WITH matched AS (
  SELECT DISTINCT ON (il.id)
    il.id   AS line_id,
    tr.id   AS tax_rate_id,
    tr.name AS tax_name
  FROM invoice_lines il
  JOIN invoices   inv ON inv.id = il.invoice_id
  JOIN tax_rates  tr  ON tr.tenant_id = inv.tenant_id
                     AND tr.rate       = il.tax_rate
                     AND tr.is_active  = TRUE
  WHERE il.tax_rate > 0
    AND il.tax_rate_id IS NULL
  ORDER BY il.id, tr.is_default DESC, tr.created_at ASC
)
UPDATE invoice_lines il
SET    tax_rate_id = m.tax_rate_id,
       tax_name    = m.tax_name
FROM   matched m
WHERE  il.id = m.line_id;

-- For lines with tax > 0 but no matching rate record, fall back to generic name.
UPDATE invoice_lines
SET    tax_name = 'Tax'
WHERE  tax_rate > 0
  AND  tax_rate_id IS NULL
  AND  tax_name    IS NULL;

-- ── Step 3: Backfill tax_amount + line_total for existing lines ────────────────
-- Old formula: total = amount + tax (discount was invoice-level, not per-line).
-- Existing lines have discount_value = 0, so taxable = amount = qty × rate.

UPDATE invoice_lines
SET
  tax_amount = ROUND(amount * tax_rate / 100, 2),
  line_total = ROUND(amount + ROUND(amount * tax_rate / 100, 2), 2);

-- ── Step 4: Seed VAT 7.5% for tenants that have no active VAT rate ────────────
-- Idempotent: skips tenants that already have at least one active VAT rate.

INSERT INTO tax_rates (id, tenant_id, name, type, rate, is_default, is_active, created_at)
SELECT
  gen_random_uuid(),
  t.id,
  'VAT',
  'VAT',
  7.50,
  TRUE,
  TRUE,
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM   tax_rates tr
  WHERE  tr.tenant_id = t.id
    AND  tr.type      = 'VAT'
    AND  tr.is_active = TRUE
);

-- ── Gates ──────────────────────────────────────────────────────────────────────
-- W-ILTD-1: New columns exist on invoice_lines
SELECT column_name
FROM   information_schema.columns
WHERE  table_name   = 'invoice_lines'
  AND  column_name IN (
    'tax_rate_id','tax_name','tax_amount',
    'discount_type','discount_value','discount_amount','line_total'
  );
-- Expected: 7 rows

-- W-ILTD-2: Every tenant has at least one active VAT rate
SELECT COUNT(*) AS tenants_without_vat
FROM   tenants t
WHERE  NOT EXISTS (
  SELECT 1 FROM tax_rates tr
  WHERE  tr.tenant_id = t.id AND tr.type = 'VAT' AND tr.is_active = TRUE
);
-- Expected: 0
