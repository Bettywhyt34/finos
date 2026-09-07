-- Same-currency bank-to-bank transfer lifecycle
-- Transfer is a business document with one locked journal:
--   Dr destination bank ledger
--   Cr source bank ledger
-- Statement evidence for each side is linked through bank_reconciliation_matches,
-- so both bank statements can point to the same transfer without duplicating accounting.

create table if not exists public.bank_transfers (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  transfer_number text not null,
  transfer_date date not null,
  source_bank_account_id text not null references public.bank_accounts(id) on delete restrict,
  destination_bank_account_id text not null references public.bank_accounts(id) on delete restrict,
  currency text not null,
  amount numeric(15,2) not null check (amount > 0),
  reference text,
  description text,
  journal_entry_id text not null unique references public.journal_entries(id) on delete restrict,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint bank_transfers_distinct_accounts check (source_bank_account_id <> destination_bank_account_id),
  constraint bank_transfers_tenant_number_unique unique (tenant_id, transfer_number)
);

create index if not exists bank_transfers_source_idx
  on public.bank_transfers(tenant_id, source_bank_account_id, transfer_date);

create index if not exists bank_transfers_destination_idx
  on public.bank_transfers(tenant_id, destination_bank_account_id, transfer_date);

create index if not exists bank_transfers_pair_amount_idx
  on public.bank_transfers(
    tenant_id,
    source_bank_account_id,
    destination_bank_account_id,
    currency,
    amount,
    transfer_date
  );

alter table public.bank_transfers enable row level security;
revoke all on public.bank_transfers from anon, authenticated;
