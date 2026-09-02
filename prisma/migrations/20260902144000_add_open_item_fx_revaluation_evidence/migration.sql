CREATE TABLE IF NOT EXISTS public.fx_revaluation_items (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fx_revaluation_id text NOT NULL REFERENCES public.fx_revaluations(id) ON DELETE RESTRICT,
  item_type text NOT NULL,
  invoice_id text NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  bill_id text NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  currency text NOT NULL,
  foreign_balance numeric(15,2) NOT NULL,
  original_rate numeric(15,6) NOT NULL,
  closing_rate numeric(15,6) NOT NULL,
  historical_base_amount numeric(15,2) NOT NULL,
  prior_carrying_adjustment numeric(15,2) NOT NULL DEFAULT 0,
  carrying_base_amount numeric(15,2) NOT NULL,
  target_base_amount numeric(15,2) NOT NULL,
  adjustment_base_amount numeric(15,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_revaluation_items_type_check CHECK (item_type IN ('AR','AP')),
  CONSTRAINT fx_revaluation_items_reference_check CHECK ((item_type='AR' AND invoice_id IS NOT NULL AND bill_id IS NULL) OR (item_type='AP' AND bill_id IS NOT NULL AND invoice_id IS NULL)),
  CONSTRAINT fx_revaluation_items_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT fx_revaluation_items_balance_check CHECK (foreign_balance > 0),
  CONSTRAINT fx_revaluation_items_rate_check CHECK (original_rate > 0 AND closing_rate > 0),
  CONSTRAINT fx_revaluation_items_historical_equation CHECK (abs(historical_base_amount - round((foreign_balance * original_rate)::numeric,2)) <= 0.01),
  CONSTRAINT fx_revaluation_items_carrying_equation CHECK (abs(carrying_base_amount - round((historical_base_amount + prior_carrying_adjustment)::numeric,2)) <= 0.01),
  CONSTRAINT fx_revaluation_items_target_equation CHECK (abs(target_base_amount - round((foreign_balance * closing_rate)::numeric,2)) <= 0.01),
  CONSTRAINT fx_revaluation_items_adjustment_equation CHECK (abs(adjustment_base_amount - round((target_base_amount - carrying_base_amount)::numeric,2)) <= 0.01)
);
CREATE UNIQUE INDEX IF NOT EXISTS fx_revaluation_items_invoice_uidx ON public.fx_revaluation_items(fx_revaluation_id, invoice_id) WHERE item_type='AR';
CREATE UNIQUE INDEX IF NOT EXISTS fx_revaluation_items_bill_uidx ON public.fx_revaluation_items(fx_revaluation_id, bill_id) WHERE item_type='AP';
CREATE INDEX IF NOT EXISTS fx_revaluation_items_ar_active_idx ON public.fx_revaluation_items(tenant_id, invoice_id, created_at) WHERE item_type='AR';
CREATE INDEX IF NOT EXISTS fx_revaluation_items_ap_active_idx ON public.fx_revaluation_items(tenant_id, bill_id, created_at) WHERE item_type='AP';

ALTER TABLE public.customer_payment_allocations
  ADD COLUMN IF NOT EXISTS base_historical_ar_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fx_unrealized_consumed numeric(15,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.hydrate_customer_payment_allocation_fx_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE invoice_rate numeric;
BEGIN
  SELECT exchange_rate INTO invoice_rate FROM invoices WHERE id = NEW.invoice_id;
  IF invoice_rate IS NOT NULL AND abs(NEW.base_historical_ar_amount) <= 0.005 THEN NEW.base_historical_ar_amount := round((NEW.amount * invoice_rate)::numeric,2); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS hydrate_customer_payment_allocation_fx_evidence ON public.customer_payment_allocations;
CREATE TRIGGER hydrate_customer_payment_allocation_fx_evidence BEFORE INSERT OR UPDATE ON public.customer_payment_allocations FOR EACH ROW EXECUTE FUNCTION public.hydrate_customer_payment_allocation_fx_evidence();

CREATE OR REPLACE FUNCTION public.validate_customer_payment_allocation_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE payment_row customer_payments%ROWTYPE; invoice_row invoices%ROWTYPE; posted_adjustment numeric; prior_consumed numeric; active_before numeric; pre_payment_balance numeric; expected_consumed numeric;
BEGIN
  SELECT * INTO payment_row FROM customer_payments WHERE id = NEW.payment_id;
  SELECT * INTO invoice_row FROM invoices WHERE id = NEW.invoice_id;
  IF payment_row.id IS NULL OR invoice_row.id IS NULL THEN RAISE EXCEPTION 'Receipt allocation must reference an existing receipt and invoice.' USING ERRCODE='23503'; END IF;
  IF payment_row.tenant_id <> invoice_row.tenant_id OR payment_row.customer_id <> invoice_row.customer_id OR upper(payment_row.currency) <> upper(invoice_row.currency) THEN RAISE EXCEPTION 'Receipt allocation invoice must match receipt tenant, customer and currency.' USING ERRCODE='23514'; END IF;
  IF NEW.amount <= 0 THEN RAISE EXCEPTION 'Receipt allocation amount must be positive.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.base_historical_ar_amount - round((NEW.amount * invoice_row.exchange_rate)::numeric,2)) > 0.01 THEN RAISE EXCEPTION 'Receipt allocation historical AR evidence does not match the invoice transaction rate.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.base_ar_amount - round((NEW.base_historical_ar_amount + NEW.fx_unrealized_consumed)::numeric,2)) > 0.01 THEN RAISE EXCEPTION 'Receipt allocation AR carrying value must equal historical AR plus consumed unrealised FX.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.base_settlement_amount - round((NEW.amount * payment_row.exchange_rate)::numeric,2)) > 0.01 THEN RAISE EXCEPTION 'Receipt allocation base settlement evidence does not match the receipt rate.' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(fri.adjustment_base_amount),0) INTO posted_adjustment FROM fx_revaluation_items fri JOIN fx_revaluations fr ON fr.id=fri.fx_revaluation_id WHERE fri.tenant_id=payment_row.tenant_id AND fri.item_type='AR' AND fri.invoice_id=NEW.invoice_id AND fr.status='POSTED'::fx_revaluation_status;
  SELECT coalesce(sum(cpa.fx_unrealized_consumed),0) INTO prior_consumed FROM customer_payment_allocations cpa JOIN customer_payments cp ON cp.id=cpa.payment_id WHERE cpa.invoice_id=NEW.invoice_id AND cpa.payment_id<>NEW.payment_id AND cp.status='POSTED'::customer_payment_status;
  active_before := round((posted_adjustment-prior_consumed)::numeric,2);
  pre_payment_balance := round((invoice_row.balance_due + NEW.amount)::numeric,2);
  IF pre_payment_balance <= 0 THEN RAISE EXCEPTION 'Receipt allocation cannot reconstruct a positive pre-payment invoice balance.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.amount-pre_payment_balance)<=0.01 THEN expected_consumed:=active_before; ELSE expected_consumed:=round((active_before*NEW.amount/pre_payment_balance)::numeric,2); END IF;
  IF abs(NEW.fx_unrealized_consumed-expected_consumed)>0.01 THEN RAISE EXCEPTION 'Receipt allocation unrealised FX consumption does not match the invoice carrying adjustment.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_fx_revaluation_item_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE reval_tenant uuid; reval_currency text; source_tenant uuid; source_currency text;
BEGIN
  SELECT tenant_id,currency INTO reval_tenant,reval_currency FROM fx_revaluations WHERE id=NEW.fx_revaluation_id;
  IF reval_tenant IS NULL OR reval_tenant<>NEW.tenant_id OR upper(reval_currency)<>upper(NEW.currency) THEN RAISE EXCEPTION 'FX revaluation item must match its revaluation tenant and currency.' USING ERRCODE='23514'; END IF;
  IF NEW.item_type='AR' THEN SELECT tenant_id,currency INTO source_tenant,source_currency FROM invoices WHERE id=NEW.invoice_id; ELSE SELECT tenant_id,currency INTO source_tenant,source_currency FROM bills WHERE id=NEW.bill_id; END IF;
  IF source_tenant IS NULL OR source_tenant<>NEW.tenant_id OR upper(source_currency)<>upper(NEW.currency) THEN RAISE EXCEPTION 'FX revaluation item must match the source open item tenant and currency.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_fx_revaluation_item_identity ON public.fx_revaluation_items;
CREATE CONSTRAINT TRIGGER enforce_fx_revaluation_item_identity AFTER INSERT OR UPDATE ON public.fx_revaluation_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_fx_revaluation_item_identity();

CREATE OR REPLACE FUNCTION public.validate_fx_revaluation_atomicity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE journal_ok boolean; item_count integer; calc_ar_exposure numeric; calc_ap_exposure numeric; calc_ar_carrying numeric; calc_ap_carrying numeric; calc_ar_target numeric; calc_ap_target numeric; calc_ar_gl numeric; calc_ap_gl numeric;
BEGIN
 IF NEW.status='POSTED'::fx_revaluation_status THEN
  SELECT EXISTS(SELECT 1 FROM journal_entries je WHERE je.id=NEW.journal_entry_id AND je.tenant_id=NEW.tenant_id AND je.source='fx-revaluation' AND je.is_locked=true) INTO journal_ok;
  IF NOT journal_ok THEN RAISE EXCEPTION 'Posted FX revaluation must reference its authoritative locked journal.' USING ERRCODE='23514'; END IF;
  SELECT count(*),coalesce(sum(foreign_balance) FILTER(WHERE item_type='AR'),0),coalesce(sum(foreign_balance) FILTER(WHERE item_type='AP'),0),coalesce(sum(carrying_base_amount) FILTER(WHERE item_type='AR'),0),coalesce(sum(carrying_base_amount) FILTER(WHERE item_type='AP'),0),coalesce(sum(target_base_amount) FILTER(WHERE item_type='AR'),0),coalesce(sum(target_base_amount) FILTER(WHERE item_type='AP'),0),coalesce(sum(adjustment_base_amount) FILTER(WHERE item_type='AR'),0),coalesce(-sum(adjustment_base_amount) FILTER(WHERE item_type='AP'),0)
  INTO item_count,calc_ar_exposure,calc_ap_exposure,calc_ar_carrying,calc_ap_carrying,calc_ar_target,calc_ap_target,calc_ar_gl,calc_ap_gl FROM fx_revaluation_items WHERE fx_revaluation_id=NEW.id AND tenant_id=NEW.tenant_id;
  IF item_count=0 THEN RAISE EXCEPTION 'Posted FX revaluation must retain open-item evidence.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.ar_exposure-calc_ar_exposure)>0.01 OR abs(NEW.ap_exposure-calc_ap_exposure)>0.01 OR abs(NEW.ar_booked_ngn-calc_ar_carrying)>0.01 OR abs(NEW.ap_booked_ngn-calc_ap_carrying)>0.01 OR abs(NEW.ar_current_ngn-calc_ar_target)>0.01 OR abs(NEW.ap_current_ngn-calc_ap_target)>0.01 OR abs(NEW.ar_gain_loss-calc_ar_gl)>0.01 OR abs(NEW.ap_gain_loss-calc_ap_gl)>0.01 OR abs(NEW.unrealized_gain_loss-round((calc_ar_gl+calc_ap_gl)::numeric,2))>0.01 THEN RAISE EXCEPTION 'FX revaluation header does not agree with its open-item evidence.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_fx_revaluation_atomicity ON public.fx_revaluations;
CREATE CONSTRAINT TRIGGER enforce_fx_revaluation_atomicity AFTER INSERT OR UPDATE ON public.fx_revaluations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_fx_revaluation_atomicity();
