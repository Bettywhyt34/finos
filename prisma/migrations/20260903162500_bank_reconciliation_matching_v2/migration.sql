-- Matching Engine V2
-- Allow one bank statement row to be allocated across multiple FINOS bank-ledger
-- lines, and one FINOS bank-ledger line to be allocated across multiple statement
-- rows. Existing match evidence is preserved.

alter table public.bank_reconciliation_matches
  drop constraint if exists bank_reconciliation_matches_statement_unique;

alter table public.bank_reconciliation_matches
  drop constraint if exists bank_reconciliation_matches_journal_unique;

create index if not exists bank_reconciliation_matches_statement_idx
  on public.bank_reconciliation_matches(bank_transaction_id);

create index if not exists bank_reconciliation_matches_journal_idx
  on public.bank_reconciliation_matches(journal_entry_line_id);

create unique index if not exists bank_reconciliation_matches_session_pair_uidx
  on public.bank_reconciliation_matches(session_id, bank_transaction_id, journal_entry_line_id);
