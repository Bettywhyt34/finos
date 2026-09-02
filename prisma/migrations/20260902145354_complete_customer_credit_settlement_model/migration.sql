-- Customer credit movement evidence: applications to invoices and refunds to bank.
ALTER TABLE public.customer_credits
  ADD COLUMN IF NOT EXISTS remaining_base_amount numeric(15,2);

UPDATE public.customer_credits
SET remaining_base_amount = round((remaining_amount * exchange_rate)::numeric,2)
WHERE remaining_base_amount IS NULL;

ALTER TABLE public.customer_credits ALTER COLUMN remaining_base_amount SET NOT NULL;
ALTER TABLE public.customer_credits DROP CONSTRAINT IF EXISTS customer_credits_remaining_base_amount_check;
ALTER TABLE public.customer_credits ADD CONSTRAINT customer_credits_remaining_base_amount_check
  CHECK (remaining_base_amount >= 0 AND remaining_base_amount <= original_base_amount + 0.01);
ALTER TABLE public.customer_credits DROP CONSTRAINT IF EXISTS customer_credits_original_base_equation;
ALTER TABLE public.customer_credits ADD CONSTRAINT customer_credits_original_base_equation
  CHECK (abs(original_base_amount - round((original_amount * exchange_rate)::numeric,2)) <= 0.01);

CREATE TABLE IF NOT EXISTS public.customer_credit_applications (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_credit_id text NOT NULL REFERENCES public.customer_credits(id) ON DELETE RESTRICT,
  invoice_id text NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL,
  base_credit_amount numeric(15,2) NOT NULL,
  base_ar_amount numeric(15,2) NOT NULL,
  fx_unrealized_consumed numeric(15,2) NOT NULL DEFAULT 0,
  journal_entry_id text NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED',
  applied_at timestamptz NOT NULL,
  created_by text NOT NULL,
  reversal_journal_entry_id text NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_at timestamptz NULL,
  reversed_by text NULL,
  reversal_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_credit_applications_amount_check CHECK (amount > 0),
  CONSTRAINT customer_credit_applications_base_check CHECK (base_credit_amount > 0 AND base_ar_amount > 0),
  CONSTRAINT customer_credit_applications_status_check CHECK (status IN ('POSTED','REVERSED'))
);
CREATE INDEX IF NOT EXISTS customer_credit_applications_credit_idx ON public.customer_credit_applications(tenant_id, customer_credit_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS customer_credit_applications_invoice_idx ON public.customer_credit_applications(tenant_id, invoice_id, applied_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS customer_credit_applications_journal_uidx ON public.customer_credit_applications(journal_entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_credit_applications_reversal_journal_uidx ON public.customer_credit_applications(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_credit_refunds (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_credit_id text NOT NULL REFERENCES public.customer_credits(id) ON DELETE RESTRICT,
  bank_account_id text NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL,
  currency text NOT NULL,
  exchange_rate numeric(15,6) NOT NULL,
  base_credit_amount numeric(15,2) NOT NULL,
  base_settlement_amount numeric(15,2) NOT NULL,
  journal_entry_id text NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED',
  refunded_at timestamptz NOT NULL,
  reference text NULL,
  notes text NULL,
  created_by text NOT NULL,
  reversal_journal_entry_id text NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_at timestamptz NULL,
  reversed_by text NULL,
  reversal_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_credit_refunds_amount_check CHECK (amount > 0),
  CONSTRAINT customer_credit_refunds_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT customer_credit_refunds_rate_check CHECK (exchange_rate > 0),
  CONSTRAINT customer_credit_refunds_base_check CHECK (base_credit_amount > 0 AND base_settlement_amount > 0),
  CONSTRAINT customer_credit_refunds_status_check CHECK (status IN ('POSTED','REVERSED'))
);
CREATE INDEX IF NOT EXISTS customer_credit_refunds_credit_idx ON public.customer_credit_refunds(tenant_id, customer_credit_id, refunded_at DESC);
CREATE INDEX IF NOT EXISTS customer_credit_refunds_bank_idx ON public.customer_credit_refunds(tenant_id, bank_account_id, refunded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS customer_credit_refunds_journal_uidx ON public.customer_credit_refunds(journal_entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_credit_refunds_reversal_journal_uidx ON public.customer_credit_refunds(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_customer_credit_application()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  credit_row customer_credits%ROWTYPE;
  invoice_row invoices%ROWTYPE;
  journal_ok boolean;
  posted_adjustment numeric;
  receipt_consumed numeric;
  application_consumed numeric;
  active_before numeric;
  pre_application_balance numeric;
  expected_consumed numeric;
BEGIN
  SELECT * INTO credit_row FROM customer_credits WHERE id = NEW.customer_credit_id;
  SELECT * INTO invoice_row FROM invoices WHERE id = NEW.invoice_id;
  IF credit_row.id IS NULL OR invoice_row.id IS NULL THEN RAISE EXCEPTION 'Customer-credit application must reference an existing credit and invoice.' USING ERRCODE='23503'; END IF;
  IF credit_row.tenant_id <> NEW.tenant_id OR invoice_row.tenant_id <> NEW.tenant_id OR credit_row.customer_id <> invoice_row.customer_id OR upper(credit_row.currency) <> upper(invoice_row.currency) THEN
    RAISE EXCEPTION 'Customer-credit application must match tenant, customer and currency.' USING ERRCODE='23514';
  END IF;
  IF abs(NEW.base_credit_amount - round((NEW.amount * credit_row.exchange_rate)::numeric,2)) > 0.01 THEN RAISE EXCEPTION 'Customer-credit application liability carrying value does not match the credit rate.' USING ERRCODE='23514'; END IF;
  IF NEW.status = 'POSTED' THEN
    SELECT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id=NEW.journal_entry_id AND je.tenant_id=NEW.tenant_id AND je.source='customer_credit_application' AND je.source_id=NEW.id AND je.is_locked=true) INTO journal_ok;
    IF NOT journal_ok THEN RAISE EXCEPTION 'Posted customer-credit application must reference its authoritative journal.' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum(fri.adjustment_base_amount),0) INTO posted_adjustment FROM fx_revaluation_items fri JOIN fx_revaluations fr ON fr.id=fri.fx_revaluation_id WHERE fri.tenant_id=NEW.tenant_id AND fri.item_type='AR' AND fri.invoice_id=NEW.invoice_id AND fr.status='POSTED'::fx_revaluation_status;
    SELECT coalesce(sum(cpa.fx_unrealized_consumed),0) INTO receipt_consumed FROM customer_payment_allocations cpa JOIN customer_payments cp ON cp.id=cpa.payment_id WHERE cpa.invoice_id=NEW.invoice_id AND cp.status='POSTED'::customer_payment_status;
    SELECT coalesce(sum(cca.fx_unrealized_consumed),0) INTO application_consumed FROM customer_credit_applications cca WHERE cca.invoice_id=NEW.invoice_id AND cca.id<>NEW.id AND cca.status='POSTED';
    active_before := round((posted_adjustment - receipt_consumed - application_consumed)::numeric,2);
    pre_application_balance := round((invoice_row.balance_due + NEW.amount)::numeric,2);
    IF pre_application_balance <= 0 THEN RAISE EXCEPTION 'Customer-credit application cannot reconstruct a positive pre-application invoice balance.' USING ERRCODE='23514'; END IF;
    IF abs(NEW.amount - pre_application_balance) <= 0.01 THEN expected_consumed := active_before; ELSE expected_consumed := round((active_before * NEW.amount / pre_application_balance)::numeric,2); END IF;
    IF abs(NEW.fx_unrealized_consumed - expected_consumed) > 0.01 THEN RAISE EXCEPTION 'Customer-credit application unrealised FX consumption does not match AR carrying value.' USING ERRCODE='23514'; END IF;
    IF abs(NEW.base_ar_amount - round((NEW.amount * invoice_row.exchange_rate + NEW.fx_unrealized_consumed)::numeric,2)) > 0.01 THEN RAISE EXCEPTION 'Customer-credit application AR carrying value is inconsistent.' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.reversal_journal_entry_id IS NULL OR NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id=NEW.reversal_journal_entry_id AND je.tenant_id=NEW.tenant_id AND je.source='customer_credit_application_reversal' AND je.source_id=NEW.id AND je.is_locked=true) THEN
      RAISE EXCEPTION 'Reversed customer-credit application must retain reversal journal evidence.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_customer_credit_application ON public.customer_credit_applications;
CREATE CONSTRAINT TRIGGER enforce_customer_credit_application AFTER INSERT OR UPDATE ON public.customer_credit_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_customer_credit_application();

CREATE OR REPLACE FUNCTION public.validate_customer_credit_refund()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  credit_row customer_credits%ROWTYPE;
  bank_tenant uuid; bank_currency text; bank_active boolean; bank_ledger text;
  ledger_tenant uuid; ledger_type text; ledger_active boolean;
BEGIN
  SELECT * INTO credit_row FROM customer_credits WHERE id=NEW.customer_credit_id;
  IF credit_row.id IS NULL OR credit_row.tenant_id<>NEW.tenant_id OR upper(credit_row.currency)<>upper(NEW.currency) THEN RAISE EXCEPTION 'Customer-credit refund must match the credit tenant and currency.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.base_credit_amount - round((NEW.amount * credit_row.exchange_rate)::numeric,2)) > 0.01 THEN RAISE EXCEPTION 'Customer-credit refund carrying value does not match the credit rate.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.base_settlement_amount - round((NEW.amount * NEW.exchange_rate)::numeric,2)) > 0.01 THEN RAISE EXCEPTION 'Customer-credit refund settlement value does not match the refund rate.' USING ERRCODE='23514'; END IF;
  SELECT ba.tenant_id,ba.currency,ba.is_active,ba.ledger_account_id,coa.tenant_id,coa.type::text,coa.is_active INTO bank_tenant,bank_currency,bank_active,bank_ledger,ledger_tenant,ledger_type,ledger_active FROM bank_accounts ba LEFT JOIN chart_of_accounts coa ON coa.id=ba.ledger_account_id AND coa.tenant_id=ba.tenant_id WHERE ba.id=NEW.bank_account_id;
  IF bank_tenant IS NULL OR bank_tenant<>NEW.tenant_id OR upper(bank_currency)<>upper(NEW.currency) OR bank_active<>true OR bank_ledger IS NULL OR ledger_tenant<>NEW.tenant_id OR ledger_type<>'ASSET' OR ledger_active<>true THEN RAISE EXCEPTION 'Customer-credit refund bank account must be active, same-currency and mapped to an active Asset ledger account.' USING ERRCODE='23514'; END IF;
  IF NEW.status='POSTED' THEN
    IF NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id=NEW.journal_entry_id AND je.tenant_id=NEW.tenant_id AND je.source='customer_credit_refund' AND je.source_id=NEW.id AND je.is_locked=true) THEN RAISE EXCEPTION 'Posted customer-credit refund must reference its authoritative journal.' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.reversal_journal_entry_id IS NULL OR NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id=NEW.reversal_journal_entry_id AND je.tenant_id=NEW.tenant_id AND je.source='customer_credit_refund_reversal' AND je.source_id=NEW.id AND je.is_locked=true) THEN RAISE EXCEPTION 'Reversed customer-credit refund must retain reversal journal evidence.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_customer_credit_refund ON public.customer_credit_refunds;
CREATE CONSTRAINT TRIGGER enforce_customer_credit_refund AFTER INSERT OR UPDATE ON public.customer_credit_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_customer_credit_refund();

CREATE OR REPLACE FUNCTION public.validate_customer_credit_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE applied numeric; refunded numeric; expected_remaining numeric; expected_base numeric; credit_note_status text;
BEGIN
  SELECT coalesce(sum(amount),0) INTO applied FROM customer_credit_applications WHERE customer_credit_id=NEW.id AND status='POSTED';
  SELECT coalesce(sum(amount),0) INTO refunded FROM customer_credit_refunds WHERE customer_credit_id=NEW.id AND status='POSTED';
  expected_remaining := round((NEW.original_amount - applied - refunded)::numeric,2);
  expected_base := round((expected_remaining * NEW.exchange_rate)::numeric,2);
  IF expected_remaining < -0.01 THEN RAISE EXCEPTION 'Customer-credit movements exceed the original credit amount.' USING ERRCODE='23514'; END IF;
  SELECT status::text INTO credit_note_status FROM credit_notes WHERE id=NEW.credit_note_id;
  IF NEW.status='REVERSED' THEN
    IF credit_note_status IS DISTINCT FROM 'REVERSED' OR abs(NEW.remaining_amount)>0.01 OR abs(NEW.remaining_base_amount)>0.01 OR applied>0.01 OR refunded>0.01 THEN RAISE EXCEPTION 'Reversed customer credit must come from a reversed unused credit note.' USING ERRCODE='23514'; END IF;
  ELSE
    IF abs(NEW.remaining_amount-greatest(expected_remaining,0))>0.01 OR abs(NEW.remaining_base_amount-greatest(expected_base,0))>0.01 THEN RAISE EXCEPTION 'Customer-credit balance does not reconcile to posted applications and refunds.' USING ERRCODE='23514'; END IF;
    IF (NEW.remaining_amount<=0.01 AND NEW.status<>'CLOSED') OR (NEW.remaining_amount>0.01 AND NEW.status<>'OPEN') THEN RAISE EXCEPTION 'Customer-credit status does not agree with its remaining balance.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_customer_credit_balance ON public.customer_credits;
CREATE CONSTRAINT TRIGGER enforce_customer_credit_balance AFTER INSERT OR UPDATE ON public.customer_credits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_customer_credit_balance();

CREATE OR REPLACE FUNCTION public.validate_credit_note_customer_credit_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cc customer_credits%ROWTYPE;
BEGIN
  IF NEW.status='APPLIED'::"CreditNoteStatus" AND NEW.customer_credit_amount>0.005 THEN
    SELECT * INTO cc FROM customer_credits WHERE credit_note_id=NEW.id;
    IF cc.id IS NULL OR cc.tenant_id<>NEW.tenant_id OR cc.customer_id<>NEW.customer_id OR upper(cc.currency)<>upper(NEW.currency) OR abs(cc.original_amount-NEW.customer_credit_amount)>0.01 OR abs(cc.original_base_amount-round((NEW.customer_credit_amount*NEW.exchange_rate)::numeric,2))>0.01 THEN RAISE EXCEPTION 'Applied credit note customer-credit split must retain matching liability evidence.' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status='APPLIED'::"CreditNoteStatus" AND NEW.customer_credit_amount<=0.005 THEN
    IF EXISTS (SELECT 1 FROM customer_credits WHERE credit_note_id=NEW.id AND status<>'REVERSED') THEN RAISE EXCEPTION 'Credit note without customer-credit amount cannot retain an active customer-credit liability.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_credit_note_customer_credit_evidence ON public.credit_notes;
CREATE CONSTRAINT TRIGGER enforce_credit_note_customer_credit_evidence AFTER INSERT OR UPDATE ON public.credit_notes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_credit_note_customer_credit_evidence();
