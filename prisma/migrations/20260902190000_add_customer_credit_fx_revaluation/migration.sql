-- Money In closure: include open foreign-currency customer-credit liabilities in formal FX revaluation.
-- Preserve separate consumption evidence for the customer-credit carrying adjustment versus AR carrying adjustment.

ALTER TABLE public.customer_credit_applications
  ADD COLUMN IF NOT EXISTS credit_fx_unrealized_consumed NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.customer_credit_refunds
  ADD COLUMN IF NOT EXISTS credit_fx_unrealized_consumed NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate_source TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS exchange_rate_entered_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS exchange_rate_entered_at TIMESTAMPTZ NULL;

ALTER TABLE public.fx_revaluation_items
  ADD COLUMN IF NOT EXISTS customer_credit_id TEXT NULL REFERENCES public.customer_credits(id) ON DELETE RESTRICT;

ALTER TABLE public.fx_revaluation_items
  DROP CONSTRAINT IF EXISTS fx_revaluation_items_type_check,
  DROP CONSTRAINT IF EXISTS fx_revaluation_items_reference_check;

ALTER TABLE public.fx_revaluation_items
  ADD CONSTRAINT fx_revaluation_items_type_check
    CHECK (item_type = ANY (ARRAY['AR'::text, 'AP'::text, 'CUSTOMER_CREDIT'::text])),
  ADD CONSTRAINT fx_revaluation_items_reference_check
    CHECK (
      (item_type = 'AR' AND invoice_id IS NOT NULL AND bill_id IS NULL AND customer_credit_id IS NULL)
      OR
      (item_type = 'AP' AND bill_id IS NOT NULL AND invoice_id IS NULL AND customer_credit_id IS NULL)
      OR
      (item_type = 'CUSTOMER_CREDIT' AND customer_credit_id IS NOT NULL AND invoice_id IS NULL AND bill_id IS NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS fx_revaluation_items_customer_credit_uidx
  ON public.fx_revaluation_items(fx_revaluation_id, customer_credit_id)
  WHERE item_type = 'CUSTOMER_CREDIT';

CREATE INDEX IF NOT EXISTS fx_revaluation_items_customer_credit_active_idx
  ON public.fx_revaluation_items(tenant_id, customer_credit_id, created_at)
  WHERE item_type = 'CUSTOMER_CREDIT';

CREATE OR REPLACE FUNCTION public.validate_fx_revaluation_item_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  reval_tenant uuid;
  reval_currency text;
  source_tenant uuid;
  source_currency text;
BEGIN
  SELECT tenant_id, currency INTO reval_tenant, reval_currency
  FROM fx_revaluations WHERE id = NEW.fx_revaluation_id;

  IF reval_tenant IS NULL OR reval_tenant <> NEW.tenant_id OR upper(reval_currency) <> upper(NEW.currency) THEN
    RAISE EXCEPTION 'FX revaluation item must match its revaluation tenant and currency.' USING ERRCODE='23514';
  END IF;

  IF NEW.item_type = 'AR' THEN
    SELECT tenant_id, currency INTO source_tenant, source_currency
    FROM invoices WHERE id = NEW.invoice_id;
  ELSIF NEW.item_type = 'AP' THEN
    SELECT tenant_id, currency INTO source_tenant, source_currency
    FROM bills WHERE id = NEW.bill_id;
  ELSIF NEW.item_type = 'CUSTOMER_CREDIT' THEN
    SELECT tenant_id, currency INTO source_tenant, source_currency
    FROM customer_credits WHERE id = NEW.customer_credit_id;
  ELSE
    RAISE EXCEPTION 'Unsupported FX revaluation item type %.', NEW.item_type USING ERRCODE='23514';
  END IF;

  IF source_tenant IS NULL OR source_tenant <> NEW.tenant_id OR upper(source_currency) <> upper(NEW.currency) THEN
    RAISE EXCEPTION 'FX revaluation item must match the source open item tenant and currency.' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$function$;
