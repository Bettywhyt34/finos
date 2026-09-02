-- Money Out FX evidence: preserve settlement currency/rate, selected cash account,
-- and the carrying-value evidence consumed by each vendor-payment allocation.

ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS bank_account_id text NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(15,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_settlement_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_ap_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fx_gain_loss numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate_source text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS exchange_rate_entered_by text NULL,
  ADD COLUMN IF NOT EXISTS exchange_rate_entered_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.vendor_payments
  DROP CONSTRAINT IF EXISTS vendor_payments_currency_check;
ALTER TABLE public.vendor_payments
  ADD CONSTRAINT vendor_payments_currency_check CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE public.vendor_payments
  DROP CONSTRAINT IF EXISTS vendor_payments_exchange_rate_check;
ALTER TABLE public.vendor_payments
  ADD CONSTRAINT vendor_payments_exchange_rate_check CHECK (exchange_rate > 0);

ALTER TABLE public.vendor_payments
  DROP CONSTRAINT IF EXISTS vendor_payments_exchange_rate_source_check;
ALTER TABLE public.vendor_payments
  ADD CONSTRAINT vendor_payments_exchange_rate_source_check CHECK (exchange_rate_source IN ('MANUAL','SYSTEM','INTEGRATION'));

CREATE INDEX IF NOT EXISTS vendor_payments_bank_account_idx
  ON public.vendor_payments(tenant_id, bank_account_id, payment_date DESC)
  WHERE bank_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vendor_payment_allocations (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id text NOT NULL REFERENCES public.vendor_payments(id) ON DELETE RESTRICT,
  bill_id text NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL,
  base_historical_ap_amount numeric(15,2) NOT NULL,
  fx_unrealized_consumed numeric(15,2) NOT NULL DEFAULT 0,
  base_ap_amount numeric(15,2) NOT NULL,
  base_settlement_amount numeric(15,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_payment_allocations_amount_check CHECK (amount > 0),
  CONSTRAINT vendor_payment_allocations_historical_check CHECK (base_historical_ap_amount >= 0),
  CONSTRAINT vendor_payment_allocations_ap_check CHECK (base_ap_amount >= 0),
  CONSTRAINT vendor_payment_allocations_settlement_check CHECK (base_settlement_amount >= 0),
  CONSTRAINT vendor_payment_allocations_ap_equation CHECK (abs(base_ap_amount - round((base_historical_ap_amount + fx_unrealized_consumed)::numeric,2)) <= 0.01),
  UNIQUE(payment_id, bill_id)
);

CREATE INDEX IF NOT EXISTS vendor_payment_allocations_bill_idx
  ON public.vendor_payment_allocations(tenant_id, bill_id, created_at);
CREATE INDEX IF NOT EXISTS vendor_payment_allocations_payment_idx
  ON public.vendor_payment_allocations(payment_id);

CREATE OR REPLACE FUNCTION public.validate_vendor_payment_allocation_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE payment_tenant uuid; payment_vendor text; payment_currency text; payment_rate numeric;
        bill_tenant uuid; bill_vendor text; bill_currency text; bill_rate numeric;
BEGIN
  SELECT tenant_id,vendor_id,currency,exchange_rate
    INTO payment_tenant,payment_vendor,payment_currency,payment_rate
    FROM vendor_payments WHERE id=NEW.payment_id;
  SELECT tenant_id,vendor_id,currency,exchange_rate
    INTO bill_tenant,bill_vendor,bill_currency,bill_rate
    FROM bills WHERE id=NEW.bill_id;
  IF payment_tenant IS NULL OR bill_tenant IS NULL THEN
    RAISE EXCEPTION 'Vendor payment allocation must reference an existing payment and bill.' USING ERRCODE='23503';
  END IF;
  IF payment_tenant<>NEW.tenant_id OR bill_tenant<>NEW.tenant_id OR payment_vendor<>bill_vendor OR upper(payment_currency)<>upper(bill_currency) THEN
    RAISE EXCEPTION 'Vendor payment allocation must match payment and bill tenant, vendor and currency.' USING ERRCODE='23514';
  END IF;
  IF abs(NEW.base_historical_ap_amount - round((NEW.amount * bill_rate)::numeric,2)) > 0.01 THEN
    RAISE EXCEPTION 'Vendor payment historical AP evidence does not match the bill transaction rate.' USING ERRCODE='23514';
  END IF;
  IF abs(NEW.base_settlement_amount - round((NEW.amount * payment_rate)::numeric,2)) > 0.01 THEN
    RAISE EXCEPTION 'Vendor payment settlement evidence does not match the payment rate.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_vendor_payment_allocation_identity ON public.vendor_payment_allocations;
CREATE CONSTRAINT TRIGGER enforce_vendor_payment_allocation_identity
AFTER INSERT OR UPDATE ON public.vendor_payment_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_vendor_payment_allocation_identity();