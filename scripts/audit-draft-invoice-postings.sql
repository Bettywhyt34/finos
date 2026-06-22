-- =============================================================================
-- AUDIT: Draft invoices with existing journal entries
-- =============================================================================
--
-- Purpose:
--   The old invoice system posted AR/Revenue journal entries immediately on
--   draft creation (fire-and-forget). After the posting lifecycle correction,
--   journal entries are only posted when an invoice is marked as Sent.
--
--   This script identifies DRAFT invoices that already have journal entries
--   (i.e., created by the old system). Use this to decide on cleanup.
--
-- IMPORTANT:
--   This script is READ-ONLY. It does not modify any data.
--   Do NOT run any cleanup automatically — review findings first.
--
-- Cleanup options:
--   A. Test / dev data only:
--      DELETE FROM journal_entry_lines WHERE entry_id IN (<ids from section 3>);
--      DELETE FROM journal_entries WHERE id IN (<ids from section 3>);
--
--   B. Production data:
--      Post reversal entries (flip DR/CR), do NOT delete.
--      This preserves audit trail and maintains double-entry integrity.
--      Use source = 'invoice_draft_cleanup_reversal' to tag reversals.
--
-- =============================================================================

-- Section 1: Count of affected invoices
-- Expected: 0 for a clean system. Non-zero means old draft postings exist.
SELECT
  COUNT(DISTINCT i.id)        AS draft_invoices_with_journal,
  COUNT(je.id)                AS journal_entries_to_investigate
FROM invoices i
JOIN journal_entries je
  ON je.source_id = i.id
 AND je.source    = 'invoice'
WHERE i.status = 'DRAFT';

-- =============================================================================

-- Section 2: Summary by tenant
SELECT
  t.name                      AS tenant_name,
  i.tenant_id,
  COUNT(DISTINCT i.id)        AS draft_invoices_with_journal,
  COUNT(je.id)                AS journal_entries,
  MIN(i.created_at)           AS oldest_draft_created,
  MAX(i.created_at)           AS newest_draft_created
FROM invoices i
JOIN tenants t
  ON t.id = i.tenant_id
JOIN journal_entries je
  ON je.source_id = i.id
 AND je.source    = 'invoice'
WHERE i.status = 'DRAFT'
GROUP BY t.name, i.tenant_id
ORDER BY draft_invoices_with_journal DESC;

-- =============================================================================

-- Section 3: Full list — invoice details with linked journal entries
-- Use the je.id values to identify entries for cleanup.
SELECT
  i.id                        AS invoice_id,
  i.invoice_number,
  i.status                    AS invoice_status,
  i.created_at                AS invoice_created,
  i.total_amount,
  i.currency,
  i.exchange_rate,
  je.id                       AS journal_entry_id,
  je.entry_number,
  je.entry_date               AS journal_date,
  je.description              AS journal_description,
  je.created_at               AS journal_created
FROM invoices i
JOIN journal_entries je
  ON je.source_id = i.id
 AND je.source    = 'invoice'
WHERE i.status = 'DRAFT'
ORDER BY i.created_at DESC;

-- =============================================================================

-- Section 4: Journal lines for affected entries (double-entry detail)
-- Shows the exact DR/CR amounts posted for each draft invoice.
SELECT
  i.invoice_number,
  je.entry_number,
  coa.code                    AS account_code,
  coa.name                    AS account_name,
  jel.debit,
  jel.credit,
  je.entry_date
FROM invoices i
JOIN journal_entries je
  ON je.source_id = i.id
 AND je.source    = 'invoice'
JOIN journal_entry_lines jel
  ON jel.journal_entry_id = je.id
JOIN chart_of_accounts coa
  ON coa.id = jel.account_id
WHERE i.status = 'DRAFT'
ORDER BY i.invoice_number, je.entry_number, coa.code;

-- =============================================================================
-- Section 5: SENT / PARTIAL / PAID / OVERDUE invoices missing a journal entry
-- Expected: 0 rows after go-live.
-- Pre-go-live rows are acceptable if invoices were marked sent before
-- line-level posting was implemented.
SELECT
  t.name            AS tenant,
  i.invoice_number,
  i.status,
  i.total_amount,
  i.sent_at
FROM invoices i
JOIN tenants t ON t.id = i.tenant_id
WHERE i.status IN ('SENT', 'PARTIAL', 'PAID', 'OVERDUE')
  AND NOT EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.source_id = i.id
      AND je.source    = 'invoice'
  )
ORDER BY t.name, i.invoice_number;

-- =============================================================================

-- Section 6: Invoices with duplicate "invoice" source journal entries
-- Expected: 0 rows.
SELECT
  t.name            AS tenant,
  i.invoice_number,
  i.status,
  COUNT(je.id)      AS journal_entry_count
FROM invoices i
JOIN tenants t         ON t.id = i.tenant_id
JOIN journal_entries je ON je.source_id = i.id AND je.source = 'invoice'
GROUP BY t.name, i.invoice_number, i.status
HAVING COUNT(je.id) > 1
ORDER BY journal_entry_count DESC, t.name;

-- =============================================================================

-- Section 7: Invoice lines missing an income account
-- Expected: 0 rows after COA baseline backfill.
SELECT
  t.name            AS tenant,
  i.invoice_number,
  i.status,
  COUNT(il.id)      AS lines_missing_income_account
FROM invoice_lines il
JOIN invoices i ON i.id = il.invoice_id
JOIN tenants t  ON t.id = i.tenant_id
WHERE il.income_account_id IS NULL
GROUP BY t.name, i.invoice_number, i.status
ORDER BY t.name, i.invoice_number;

-- =============================================================================
-- END OF AUDIT SCRIPT
-- =============================================================================
