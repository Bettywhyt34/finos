-- Money Out: lifecycle for open vendor-credit balances.
-- Credits may be applied to later bills or refunded by the supplier.

ALTER TABLE public.vendor_credits
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.vendor_credits
  DROP CONSTRAINT IF EXISTS vendor_credits_amounts_check,
  DROP CONSTRAINT IF EXISTS vendor_credits_status_check,
  DROP CONSTRAINT IF EXISTS vendor_credits_status_balance_check;

ALTER TABLE public.vendor_credits
  ADD CONSTRAINT vendor_credits_amounts_check CHECK (
    subtotal >= 0 AND tax_amount >= 0 AND total_amount > 0
    AND abs(total_amount - round((subtotal + tax_amount)::numeric, 2)) <= 0.01
    AND applied_amount >= 0 AND refunded_amount >= 0 AND remaining_amount >= 0
    AND abs(total_amount - round((applied_amount + refunded_amount + remaining_amount)::numeric, 2)) <= 0.01
  ),
  ADD CONSTRAINT vendor_credits_status_check CHECK (status IN ('OPEN','CLOSED','REVERSED')),
  ADD CONSTRAINT vendor_credits_status_balance_check CHECK (
    (status = 'OPEN' AND remaining_amount > 0.01)
    OR (status = 'CLOSED' AND remaining_amount <= 0.01)
    OR (status = 'REVERSED')
  );

ALTER TABLE public.vendor_credit_applications
  ADD COLUMN IF NOT EXISTS base_historical_credit_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_fx_unrealized_consumed numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id text NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reversed_by text NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason text NULL;

ALTER TABLE public.vendor_credit_applications
  DROP CONSTRAINT IF EXISTS vendor_credit_applications_base_check;

ALTER TABLE public.vendor_credit_applications
  ADD CONSTRAINT vendor_credit_applications_base_check CHECK (
    base_historical_ap_amount >= 0
    AND base_ap_amount >= 0
    AND base_historical_credit_amount >= 0
    AND base_credit_amount >= 0
    AND abs(base_ap_amount - round((base_historical_ap_amount + fx_unrealized_consumed)::numeric,2)) <= 0.01
    AND (
      application_type = 'SOURCE'
      OR abs(base_credit_amount - round((base_historical_credit_amount + credit_fx_unrealized_consumed)::numeric,2)) <= 0.01
    )
  ),
  ADD CONSTRAINT vendor_credit_applications_lifecycle_check CHECK (
    (application_type='SOURCE' AND status='POSTED' AND journal_entry_id IS NULL
      AND reversal_journal_entry_id IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR
    (application_type='LATER' AND status='POSTED' AND journal_entry_id IS NOT NULL
      AND reversal_journal_entry_id IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR
    (application_type='LATER' AND status='REVERSED' AND journal_entry_id IS NOT NULL
      AND reversal_journal_entry_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND length(trim(reversal_reason)) > 0)
  );

CREATE TABLE IF NOT EXISTS public.vendor_credit_refunds (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_credit_id text NOT NULL REFERENCES public.vendor_credits(id) ON DELETE RESTRICT,
  bank_account_id text NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL,
  currency text NOT NULL,
  exchange_rate numeric(15,6) NOT NULL,
  base_historical_credit_amount numeric(15,2) NOT NULL,
  credit_fx_unrealized_consumed numeric(15,2) NOT NULL DEFAULT 0,
  base_credit_amount numeric(15,2) NOT NULL,
  base_settlement_amount numeric(15,2) NOT NULL,
  fx_gain_loss numeric(15,2) NOT NULL DEFAULT 0,
  journal_entry_id text NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED',
  refunded_at timestamp without time zone NOT NULL,
  reference text NULL,
  notes text NULL,
  created_by text NOT NULL,
  exchange_rate_source text NOT NULL DEFAULT 'MANUAL',
  exchange_rate_entered_by text NOT NULL,
  exchange_rate_entered_at timestamptz NOT NULL DEFAULT now(),
  reversal_journal_entry_id text NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_at timestamptz NULL,
  reversed_by text NULL,
  reversal_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_credit_refunds_amount_check CHECK (amount > 0),
  CONSTRAINT vendor_credit_refunds_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT vendor_credit_refunds_rate_check CHECK (exchange_rate > 0),
  CONSTRAINT vendor_credit_refunds_base_check CHECK (
    base_historical_credit_amount >= 0 AND base_credit_amount >= 0 AND base_settlement_amount >= 0
    AND abs(base_credit_amount - round((base_historical_credit_amount + credit_fx_unrealized_consumed)::numeric,2)) <= 0.01
  ),
  CONSTRAINT vendor_credit_refunds_rate_source_check CHECK (exchange_rate_source IN ('MANUAL','SYSTEM','INTEGRATION')),
  CONSTRAINT vendor_credit_refunds_status_check CHECK (status IN ('POSTED','REVERSED')),
  CONSTRAINT vendor_credit_refunds_reversal_check CHECK (
    (status='POSTED' AND reversal_journal_entry_id IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR
    (status='REVERSED' AND reversal_journal_entry_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND length(trim(reversal_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS vendor_credit_refunds_credit_idx
  ON public.vendor_credit_refunds(tenant_id, vendor_credit_id, status, refunded_at);
CREATE INDEX IF NOT EXISTS vendor_credit_refunds_bank_idx
  ON public.vendor_credit_refunds(tenant_id, bank_account_id, status, refunded_at);

ALTER TABLE public.vendor_credit_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vendor_credit_refunds;
CREATE POLICY tenant_isolation ON public.vendor_credit_refunds
  FOR ALL TO public
  USING (tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant'::text, true))::uuid);

CREATE OR REPLACE FUNCTION public.validate_vendor_credit_refund_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE credit_tenant uuid; credit_currency text; bank_tenant uuid; bank_currency text;
BEGIN
  SELECT tenant_id,currency INTO credit_tenant,credit_currency
  FROM vendor_credits WHERE id=NEW.vendor_credit_id;
  SELECT tenant_id,currency INTO bank_tenant,bank_currency
  FROM bank_accounts WHERE id=NEW.bank_account_id;

  IF credit_tenant IS NULL OR bank_tenant IS NULL
     OR credit_tenant<>NEW.tenant_id OR bank_tenant<>NEW.tenant_id
     OR upper(credit_currency)<>upper(NEW.currency)
     OR upper(bank_currency)<>upper(NEW.currency) THEN
    RAISE EXCEPTION 'Vendor credit refund must match credit and bank tenant/currency.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_vendor_credit_refund_identity ON public.vendor_credit_refunds;
CREATE CONSTRAINT TRIGGER enforce_vendor_credit_refund_identity
AFTER INSERT OR UPDATE ON public.vendor_credit_refunds
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_vendor_credit_refund_identity();
