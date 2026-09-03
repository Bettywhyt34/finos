-- Money Out: vendor credits are distinct from cash settlement.
-- amount_paid remains cash/WHT settlement; amount_credited tracks supplier credits.

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS amount_credited numeric(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_amount_credited_check;
ALTER TABLE public.bills
  ADD CONSTRAINT bills_amount_credited_check
  CHECK (amount_credited >= 0 AND amount_credited <= total_amount + 0.01);

CREATE TABLE IF NOT EXISTS public.vendor_credits (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_id text NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  source_bill_id text NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  credit_number text NOT NULL,
  vendor_reference text NULL,
  credit_date timestamp without time zone NOT NULL,
  currency text NOT NULL,
  exchange_rate numeric(15,6) NOT NULL,
  source_exchange_rate numeric(15,6) NOT NULL,
  subtotal numeric(15,2) NOT NULL,
  tax_amount numeric(15,2) NOT NULL DEFAULT 0,
  total_amount numeric(15,2) NOT NULL,
  applied_amount numeric(15,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(15,2) NOT NULL DEFAULT 0,
  base_source_reversal_amount numeric(15,2) NOT NULL,
  base_ap_amount numeric(15,2) NOT NULL DEFAULT 0,
  base_open_credit_amount numeric(15,2) NOT NULL DEFAULT 0,
  fx_gain_loss numeric(15,2) NOT NULL DEFAULT 0,
  journal_entry_id text NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'OPEN',
  notes text NULL,
  posted_by text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  reversal_journal_entry_id text NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_by text NULL,
  reversed_at timestamptz NULL,
  reversal_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_credits_number_unique UNIQUE (tenant_id, credit_number),
  CONSTRAINT vendor_credits_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT vendor_credits_rates_check CHECK (exchange_rate > 0 AND source_exchange_rate > 0),
  CONSTRAINT vendor_credits_amounts_check CHECK (
    subtotal >= 0 AND tax_amount >= 0 AND total_amount > 0
    AND abs(total_amount - round((subtotal + tax_amount)::numeric, 2)) <= 0.01
    AND applied_amount >= 0 AND remaining_amount >= 0
    AND abs(total_amount - round((applied_amount + remaining_amount)::numeric, 2)) <= 0.01
  ),
  CONSTRAINT vendor_credits_base_check CHECK (
    base_source_reversal_amount > 0 AND base_ap_amount >= 0 AND base_open_credit_amount >= 0
  ),
  CONSTRAINT vendor_credits_status_check CHECK (status IN ('OPEN','APPLIED','REVERSED')),
  CONSTRAINT vendor_credits_status_balance_check CHECK (
    (status = 'OPEN' AND remaining_amount > 0)
    OR (status = 'APPLIED' AND remaining_amount <= 0.01)
    OR (status = 'REVERSED')
  ),
  CONSTRAINT vendor_credits_reversal_check CHECK (
    (status <> 'REVERSED' AND reversal_journal_entry_id IS NULL AND reversed_by IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL)
    OR (status = 'REVERSED' AND reversal_journal_entry_id IS NOT NULL AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL AND length(trim(reversal_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS vendor_credits_vendor_idx
  ON public.vendor_credits(tenant_id, vendor_id, credit_date DESC);
CREATE INDEX IF NOT EXISTS vendor_credits_source_bill_idx
  ON public.vendor_credits(tenant_id, source_bill_id, status);
CREATE INDEX IF NOT EXISTS vendor_credits_open_idx
  ON public.vendor_credits(tenant_id, currency, status, credit_date)
  WHERE status='OPEN' AND remaining_amount > 0;

CREATE TABLE IF NOT EXISTS public.vendor_credit_lines (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_credit_id text NOT NULL REFERENCES public.vendor_credits(id) ON DELETE RESTRICT,
  source_bill_line_id text NOT NULL REFERENCES public.bill_lines(id) ON DELETE RESTRICT,
  description text NOT NULL,
  service_amount numeric(15,2) NOT NULL,
  tax_amount numeric(15,2) NOT NULL DEFAULT 0,
  total_amount numeric(15,2) NOT NULL,
  account_id text NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  project_id text NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  reporting_tags jsonb NULL,
  source_exchange_rate numeric(15,6) NOT NULL,
  base_service_reversal numeric(15,2) NOT NULL,
  base_tax_reversal numeric(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_credit_lines_amount_check CHECK (
    service_amount > 0 AND tax_amount >= 0 AND total_amount > 0
    AND abs(total_amount - round((service_amount + tax_amount)::numeric,2)) <= 0.01
  ),
  CONSTRAINT vendor_credit_lines_rate_check CHECK (source_exchange_rate > 0),
  CONSTRAINT vendor_credit_lines_base_check CHECK (base_service_reversal > 0 AND base_tax_reversal >= 0),
  UNIQUE(vendor_credit_id, source_bill_line_id)
);

CREATE INDEX IF NOT EXISTS vendor_credit_lines_source_idx
  ON public.vendor_credit_lines(tenant_id, source_bill_line_id);

CREATE TABLE IF NOT EXISTS public.vendor_credit_applications (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_credit_id text NOT NULL REFERENCES public.vendor_credits(id) ON DELETE RESTRICT,
  bill_id text NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  application_date timestamp without time zone NOT NULL,
  application_type text NOT NULL DEFAULT 'SOURCE',
  amount numeric(15,2) NOT NULL,
  base_historical_ap_amount numeric(15,2) NOT NULL,
  fx_unrealized_consumed numeric(15,2) NOT NULL DEFAULT 0,
  base_ap_amount numeric(15,2) NOT NULL,
  base_credit_amount numeric(15,2) NOT NULL,
  fx_gain_loss numeric(15,2) NOT NULL DEFAULT 0,
  journal_entry_id text NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_credit_applications_type_check CHECK (application_type IN ('SOURCE','LATER')),
  CONSTRAINT vendor_credit_applications_status_check CHECK (status IN ('POSTED','REVERSED')),
  CONSTRAINT vendor_credit_applications_amount_check CHECK (amount > 0),
  CONSTRAINT vendor_credit_applications_base_check CHECK (
    base_historical_ap_amount >= 0 AND base_ap_amount >= 0 AND base_credit_amount >= 0
    AND abs(base_ap_amount - round((base_historical_ap_amount + fx_unrealized_consumed)::numeric,2)) <= 0.01
  )
);

CREATE INDEX IF NOT EXISTS vendor_credit_applications_bill_idx
  ON public.vendor_credit_applications(tenant_id, bill_id, status, application_date);
CREATE INDEX IF NOT EXISTS vendor_credit_applications_credit_idx
  ON public.vendor_credit_applications(tenant_id, vendor_credit_id, status, application_date);

-- Open vendor credits are monetary assets and participate in formal FX revaluation.
ALTER TABLE public.fx_revaluation_items
  ADD COLUMN IF NOT EXISTS vendor_credit_id text NULL REFERENCES public.vendor_credits(id) ON DELETE RESTRICT;

ALTER TABLE public.fx_revaluation_items
  DROP CONSTRAINT IF EXISTS fx_revaluation_items_type_check,
  DROP CONSTRAINT IF EXISTS fx_revaluation_items_reference_check;

ALTER TABLE public.fx_revaluation_items
  ADD CONSTRAINT fx_revaluation_items_type_check
    CHECK (item_type IN ('AR','AP','CUSTOMER_CREDIT','VENDOR_CREDIT')),
  ADD CONSTRAINT fx_revaluation_items_reference_check
    CHECK (
      (item_type='AR' AND invoice_id IS NOT NULL AND bill_id IS NULL AND customer_credit_id IS NULL AND vendor_credit_id IS NULL)
      OR (item_type='AP' AND bill_id IS NOT NULL AND invoice_id IS NULL AND customer_credit_id IS NULL AND vendor_credit_id IS NULL)
      OR (item_type='CUSTOMER_CREDIT' AND customer_credit_id IS NOT NULL AND invoice_id IS NULL AND bill_id IS NULL AND vendor_credit_id IS NULL)
      OR (item_type='VENDOR_CREDIT' AND vendor_credit_id IS NOT NULL AND invoice_id IS NULL AND bill_id IS NULL AND customer_credit_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS fx_revaluation_items_vendor_credit_idx
  ON public.fx_revaluation_items(tenant_id, vendor_credit_id)
  WHERE vendor_credit_id IS NOT NULL;

-- Tenant isolation for newly exposed evidence tables.
ALTER TABLE public.vendor_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credit_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credit_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_credits;
CREATE POLICY tenant_isolation ON public.vendor_credits
  FOR ALL TO public
  USING (tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant'::text, true))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_credit_lines;
CREATE POLICY tenant_isolation ON public.vendor_credit_lines
  FOR ALL TO public
  USING (tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant'::text, true))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_credit_applications;
CREATE POLICY tenant_isolation ON public.vendor_credit_applications
  FOR ALL TO public
  USING (tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant'::text, true))::uuid);

-- Cross-table identity guards. These are integrity checks only; application code still performs permissions and business validation.
CREATE OR REPLACE FUNCTION public.validate_vendor_credit_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE bill_tenant uuid; bill_vendor text; bill_currency text;
BEGIN
  SELECT tenant_id,vendor_id,currency INTO bill_tenant,bill_vendor,bill_currency FROM bills WHERE id=NEW.source_bill_id;
  IF bill_tenant IS NULL OR bill_tenant<>NEW.tenant_id OR bill_vendor<>NEW.vendor_id OR upper(bill_currency)<>upper(NEW.currency) THEN
    RAISE EXCEPTION 'Vendor credit must match source bill tenant, vendor and currency.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_vendor_credit_identity ON public.vendor_credits;
CREATE CONSTRAINT TRIGGER enforce_vendor_credit_identity
AFTER INSERT OR UPDATE ON public.vendor_credits
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_vendor_credit_identity();

CREATE OR REPLACE FUNCTION public.validate_vendor_credit_line_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE credit_tenant uuid; source_bill text; line_bill text;
BEGIN
  SELECT tenant_id,source_bill_id INTO credit_tenant,source_bill FROM vendor_credits WHERE id=NEW.vendor_credit_id;
  SELECT bill_id INTO line_bill FROM bill_lines WHERE id=NEW.source_bill_line_id;
  IF credit_tenant IS NULL OR credit_tenant<>NEW.tenant_id OR line_bill IS NULL OR line_bill<>source_bill THEN
    RAISE EXCEPTION 'Vendor credit line must belong to the vendor credit source bill and tenant.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_vendor_credit_line_identity ON public.vendor_credit_lines;
CREATE CONSTRAINT TRIGGER enforce_vendor_credit_line_identity
AFTER INSERT OR UPDATE ON public.vendor_credit_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_vendor_credit_line_identity();

CREATE OR REPLACE FUNCTION public.validate_vendor_credit_application_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE credit_tenant uuid; credit_vendor text; credit_currency text; bill_tenant uuid; bill_vendor text; bill_currency text;
BEGIN
  SELECT tenant_id,vendor_id,currency INTO credit_tenant,credit_vendor,credit_currency FROM vendor_credits WHERE id=NEW.vendor_credit_id;
  SELECT tenant_id,vendor_id,currency INTO bill_tenant,bill_vendor,bill_currency FROM bills WHERE id=NEW.bill_id;
  IF credit_tenant IS NULL OR bill_tenant IS NULL OR credit_tenant<>NEW.tenant_id OR bill_tenant<>NEW.tenant_id
     OR credit_vendor<>bill_vendor OR upper(credit_currency)<>upper(bill_currency) THEN
    RAISE EXCEPTION 'Vendor credit application must match credit and bill tenant, vendor and currency.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_vendor_credit_application_identity ON public.vendor_credit_applications;
CREATE CONSTRAINT TRIGGER enforce_vendor_credit_application_identity
AFTER INSERT OR UPDATE ON public.vendor_credit_applications
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_vendor_credit_application_identity();
