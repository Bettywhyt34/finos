-- Statement Review Match Evidence
-- Keep transaction-level statement review independent from formal reconciliation periods.
-- These allocations are promoted into bank_reconciliation_matches when a period is completed.

create table if not exists public.bank_statement_matches (
  id text primary key default gen_random_uuid()::text,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_account_id text not null references public.bank_accounts(id) on delete cascade,
  bank_transaction_id text not null references public.bank_transactions(id) on delete cascade,
  journal_entry_line_id text not null references public.journal_entry_lines(id) on delete restrict,
  matched_amount numeric(15,2) not null check (matched_amount > 0),
  created_by text null,
  created_at timestamptz not null default now(),
  constraint bank_statement_matches_pair_unique unique (bank_transaction_id, journal_entry_line_id)
);

create index if not exists bank_statement_matches_tenant_bank_idx
  on public.bank_statement_matches(tenant_id, bank_account_id);

create index if not exists bank_statement_matches_statement_idx
  on public.bank_statement_matches(bank_transaction_id);

create index if not exists bank_statement_matches_journal_idx
  on public.bank_statement_matches(journal_entry_line_id);

alter table public.bank_statement_matches enable row level security;
revoke all on public.bank_statement_matches from anon, authenticated;
