-- Statement Review Match Evidence
-- Match Existing must remain transaction-level review evidence rather than creating
-- a formal reconciliation period. We reuse bank_reconciliation_matches under a
-- hidden REVIEW session, then promote those allocations into the real OPEN session
-- when reconciliation starts for the affected statement dates.

alter table public.bank_reconciliation_sessions
  drop constraint if exists bank_reconciliation_sessions_status_check;

alter table public.bank_reconciliation_sessions
  add constraint bank_reconciliation_sessions_status_check
  check (status in ('REVIEW','OPEN','COMPLETED'));

create or replace function public.promote_bank_review_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'OPEN' then
    return new;
  end if;

  update public.bank_reconciliation_matches brm
     set session_id = new.id
    from public.bank_reconciliation_sessions review_session,
         public.bank_transactions bt
   where review_session.id = brm.session_id
     and review_session.tenant_id = new.tenant_id
     and review_session.bank_account_id = new.bank_account_id
     and review_session.status = 'REVIEW'
     and bt.id = brm.bank_transaction_id
     and bt.bank_account_id = new.bank_account_id
     and bt.transaction_date::date between new.statement_from and new.statement_to;

  delete from public.bank_reconciliation_sessions review_session
   where review_session.tenant_id = new.tenant_id
     and review_session.bank_account_id = new.bank_account_id
     and review_session.status = 'REVIEW'
     and not exists (
       select 1
       from public.bank_reconciliation_matches brm
       where brm.session_id = review_session.id
     );

  return new;
end;
$$;

drop trigger if exists bank_reconciliation_promote_review_matches
  on public.bank_reconciliation_sessions;

create trigger bank_reconciliation_promote_review_matches
after insert on public.bank_reconciliation_sessions
for each row
execute function public.promote_bank_review_matches();
