-- ============================================================
-- PART 2 — Core Chart of Accounts Baseline (idempotent)
-- ============================================================
-- Safe to re-run: uses WHERE NOT EXISTS per tenant.
-- Inserts only if the code does not already exist for that tenant.
-- Does NOT overwrite or reactivate existing accounts.
-- Respects @@unique([tenantId, code]).
-- organization_id left NULL for all new rows (post-tenancy-migration pattern).
-- ============================================================

-- 1. CA-001 — Accounts Receivable (ASSET)
INSERT INTO chart_of_accounts (id, tenant_id, code, name, type, subtype, is_active, migration_status, created_at)
SELECT
  gen_random_uuid()::text,
  t.id,
  'CA-001',
  'Accounts Receivable',
  'ASSET'::"AccountType",
  'Current Asset',
  TRUE,
  'baseline_seed',
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = 'CA-001'
)
AND t.status != 'ARCHIVED';

-- 2. IN-001 — Sales Income (INCOME)
INSERT INTO chart_of_accounts (id, tenant_id, code, name, type, subtype, is_active, migration_status, created_at)
SELECT
  gen_random_uuid()::text,
  t.id,
  'IN-001',
  'Sales Income',
  'INCOME'::"AccountType",
  'Operating Revenue',
  TRUE,
  'baseline_seed',
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = 'IN-001'
)
AND t.status != 'ARCHIVED';

-- 3. CA-003 — Bank (ASSET)
INSERT INTO chart_of_accounts (id, tenant_id, code, name, type, subtype, is_active, migration_status, created_at)
SELECT
  gen_random_uuid()::text,
  t.id,
  'CA-003',
  'Bank',
  'ASSET'::"AccountType",
  'Bank',
  TRUE,
  'baseline_seed',
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = 'CA-003'
)
AND t.status != 'ARCHIVED';

-- 4. CL-001 — Accounts Payable (LIABILITY)
INSERT INTO chart_of_accounts (id, tenant_id, code, name, type, subtype, is_active, migration_status, created_at)
SELECT
  gen_random_uuid()::text,
  t.id,
  'CL-001',
  'Accounts Payable',
  'LIABILITY'::"AccountType",
  'Current Liability',
  TRUE,
  'baseline_seed',
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = 'CL-001'
)
AND t.status != 'ARCHIVED';

-- 5. CL-OUTPUT-VAT — Output VAT Payable (LIABILITY)
--    Note: Bettywhyt has CL-003 "VAT Payable" and QVT has 2100/2101 "VAT OUTPUT (SALES)".
--    CL-OUTPUT-VAT is the canonical posting code and does not affect those existing accounts.
INSERT INTO chart_of_accounts (id, tenant_id, code, name, type, subtype, is_active, migration_status, created_at)
SELECT
  gen_random_uuid()::text,
  t.id,
  'CL-OUTPUT-VAT',
  'Output VAT Payable',
  'LIABILITY'::"AccountType",
  'Current Liability',
  TRUE,
  'baseline_seed',
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.code = 'CL-OUTPUT-VAT'
)
AND t.status != 'ARCHIVED';

-- ── Gate: what was seeded ──────────────────────────────────────────────────
SELECT
  t.name AS tenant,
  c.code,
  c.name AS account_name,
  c.type,
  c.is_active,
  c.migration_status
FROM chart_of_accounts c
JOIN tenants t ON t.id = c.tenant_id
WHERE c.migration_status = 'baseline_seed'
ORDER BY t.name, c.code;


-- ============================================================
-- PART 3 — Backfill invoice_lines.income_account_id
-- ============================================================
-- Must run AFTER Part 2 (baseline accounts now exist).
-- Priority:
--   1. item.income_account_id (if valid INCOME, active, same tenant)
--   2. tenant's IN-001 (active INCOME)
--   3. leave NULL
-- Does NOT touch invoice totals, status, or create journal entries.
-- ============================================================

-- 3a. Backfill from item.income_account_id where the item account is valid INCOME
--     Uses CTE to avoid PostgreSQL restriction on referencing the update target in FROM JOINs.
WITH item_accounts AS (
  SELECT
    il.id                  AS line_id,
    i.income_account_id    AS new_account_id
  FROM invoice_lines il
  JOIN invoices inv ON inv.id = il.invoice_id
  JOIN items i ON i.id = il.item_id
  JOIN chart_of_accounts coa
    ON coa.id         = i.income_account_id
   AND coa.tenant_id  = inv.tenant_id
   AND coa.type       = 'INCOME'::"AccountType"
   AND coa.is_active  = TRUE
  WHERE il.income_account_id IS NULL
    AND i.income_account_id IS NOT NULL
)
UPDATE invoice_lines
SET income_account_id = item_accounts.new_account_id
FROM item_accounts
WHERE invoice_lines.id = item_accounts.line_id;

-- 3b. Backfill remaining NULLs from tenant's IN-001
WITH default_accounts AS (
  SELECT
    il.id   AS line_id,
    coa.id  AS new_account_id
  FROM invoice_lines il
  JOIN invoices inv ON inv.id = il.invoice_id
  JOIN chart_of_accounts coa
    ON coa.tenant_id = inv.tenant_id
   AND coa.code      = 'IN-001'
   AND coa.type      = 'INCOME'::"AccountType"
   AND coa.is_active = TRUE
  WHERE il.income_account_id IS NULL
)
UPDATE invoice_lines
SET income_account_id = default_accounts.new_account_id
FROM default_accounts
WHERE invoice_lines.id = default_accounts.line_id;

-- ── Gate: backfill result ─────────────────────────────────────────────────
SELECT
  t.name AS tenant,
  COUNT(*) AS total_lines,
  COUNT(il.income_account_id) AS with_income_account,
  COUNT(*) - COUNT(il.income_account_id) AS still_null
FROM invoice_lines il
JOIN invoices inv ON inv.id = il.invoice_id
JOIN tenants t ON t.id = inv.tenant_id
GROUP BY t.name
ORDER BY t.name;
