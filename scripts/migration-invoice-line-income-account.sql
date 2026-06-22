-- Idempotent: safe to re-run

-- 1. Add column
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS income_account_id TEXT
    REFERENCES chart_of_accounts(id) ON DELETE SET NULL;

-- 2. Index
CREATE INDEX IF NOT EXISTS idx_invoice_lines_income_account
  ON invoice_lines(income_account_id);

-- 3. Backfill from item.income_account_id
UPDATE invoice_lines il
SET income_account_id = i.income_account_id
FROM items i
WHERE il.item_id = i.id
  AND i.income_account_id IS NOT NULL
  AND il.income_account_id IS NULL;

-- 4. Backfill from tenant's IN-001 account for remaining nulls
UPDATE invoice_lines il
SET income_account_id = coa.id
FROM invoices inv
JOIN chart_of_accounts coa
  ON coa.tenant_id = inv.tenant_id
  AND coa.code = 'IN-001'
  AND coa.is_active = TRUE
WHERE il.invoice_id = inv.id
  AND il.income_account_id IS NULL;

-- Gate: count of backfilled lines
SELECT COUNT(*) AS lines_with_income_account FROM invoice_lines WHERE income_account_id IS NOT NULL;
SELECT COUNT(*) AS lines_without_income_account FROM invoice_lines WHERE income_account_id IS NULL;
