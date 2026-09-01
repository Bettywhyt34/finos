create table if not exists public.bank_reconciliation_sessions (
  id text primary key default gen_random_uuid()::text,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_account_id text not null references public.bank_accounts(id) on delete cascade,
  statement_from date not null,
  statement_to date not null,
  statement_closing_balance numeric(15,2) not null,
  status text not null default 'OPEN' check (status in ('OPEN','COMPLETED')),
  completed_at timestamptz null,
  completed_by text null,
  created_at timestamptz not null default now(),
  constraint bank_reconciliation_sessions_date_range check (statement_to >= statement_from)
);

create index if not exists bank_reconciliation_sessions_tenant_bank_idx
  on public.bank_reconciliation_sessions(tenant_id, bank_account_id, statement_from, statement_to);

create table if not exists public.bank_reconciliation_matches (
  id text primary key default gen_random_uuid()::text,
  session_id text not null references public.bank_reconciliation_sessions(id) on delete cascade,
  bank_transaction_id text not null references public.bank_transactions(id) on delete cascade,
  journal_entry_line_id text not null references public.journal_entry_lines(id) on delete restrict,
  matched_amount numeric(15,2) not null check (matched_amount > 0),
  created_at timestamptz not null default now(),
  constraint bank_reconciliation_matches_statement_unique unique (bank_transaction_id),
  constraint bank_reconciliation_matches_journal_unique unique (journal_entry_line_id)
);

create index if not exists bank_reconciliation_matches_session_idx
  on public.bank_reconciliation_matches(session_id);

alter table public.bank_reconciliation_sessions enable row level security;
alter table public.bank_reconciliation_matches enable row level security;
revoke all on public.bank_reconciliation_sessions from anon, authenticated;
revoke all on public.bank_reconciliation_matches from anon, authenticated;
