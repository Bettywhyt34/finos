CREATE TABLE public.accruals (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  accrual_number text NOT NULL,
  accrual_date timestamptz NOT NULL,
  description text NOT NULL,
  vendor_id text REFERENCES public.vendors(id) ON DELETE RESTRICT,
  account_id text NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  project_id text REFERENCES public.projects(id) ON DELETE SET NULL,
  reporting_tags jsonb,
  currency text NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  journal_entry_id text NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversal_journal_entry_id text REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  UNIQUE (tenant_id, accrual_number)
);

CREATE TABLE public.accrual_settlements (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  accrual_id text NOT NULL REFERENCES public.accruals(id) ON DELETE RESTRICT,
  bill_line_id text NOT NULL REFERENCES public.bill_lines(id) ON DELETE RESTRICT,
  settlement_date timestamptz NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  journal_entry_id text NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversal_journal_entry_id text REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text
);

CREATE TABLE public.accrual_releases (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  accrual_id text NOT NULL REFERENCES public.accruals(id) ON DELETE RESTRICT,
  release_date timestamptz NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  journal_entry_id text NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversal_journal_entry_id text REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text
);

CREATE INDEX accruals_tenant_status_date_idx ON public.accruals(tenant_id, status, accrual_date);
CREATE INDEX accruals_vendor_idx ON public.accruals(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX accruals_account_idx ON public.accruals(account_id);
CREATE INDEX accruals_project_idx ON public.accruals(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX accruals_journal_idx ON public.accruals(journal_entry_id);
CREATE INDEX accruals_reversal_journal_idx ON public.accruals(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

CREATE INDEX accrual_settlements_tenant_idx ON public.accrual_settlements(tenant_id);
CREATE INDEX accrual_settlements_accrual_idx ON public.accrual_settlements(accrual_id, status, settlement_date);
CREATE INDEX accrual_settlements_bill_line_idx ON public.accrual_settlements(bill_line_id);
CREATE INDEX accrual_settlements_journal_idx ON public.accrual_settlements(journal_entry_id);
CREATE INDEX accrual_settlements_reversal_journal_idx ON public.accrual_settlements(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

CREATE INDEX accrual_releases_tenant_idx ON public.accrual_releases(tenant_id);
CREATE INDEX accrual_releases_accrual_idx ON public.accrual_releases(accrual_id, status, release_date);
CREATE INDEX accrual_releases_journal_idx ON public.accrual_releases(journal_entry_id);
CREATE INDEX accrual_releases_reversal_journal_idx ON public.accrual_releases(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_accrual_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  tenant_currency text;
  account_type text;
BEGIN
  SELECT upper(t.currency) INTO tenant_currency FROM tenants t WHERE t.id=NEW.tenant_id;
  IF tenant_currency IS NULL THEN
    RAISE EXCEPTION 'Accrual tenant not found.' USING ERRCODE='23514';
  END IF;
  IF upper(NEW.currency)<>tenant_currency THEN
    RAISE EXCEPTION 'Accruals must be recorded in the tenant base currency.' USING ERRCODE='23514';
  END IF;

  SELECT coa.type::text INTO account_type
  FROM chart_of_accounts coa
  WHERE coa.id=NEW.account_id AND coa.tenant_id=NEW.tenant_id AND coa.is_active=true;
  IF account_type IS DISTINCT FROM 'EXPENSE' THEN
    RAISE EXCEPTION 'Accrual destination account must be an active Expense account in the same tenant.' USING ERRCODE='23514';
  END IF;

  IF NEW.vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM vendors v WHERE v.id=NEW.vendor_id AND v.tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Accrual vendor must belong to the same tenant.' USING ERRCODE='23514';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Accrual Project must belong to the same tenant.' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_accrual_identity
BEFORE INSERT OR UPDATE OF tenant_id, vendor_id, account_id, project_id, currency, amount, accrual_date
ON public.accruals
FOR EACH ROW EXECUTE FUNCTION public.validate_accrual_identity();

CREATE OR REPLACE FUNCTION public.validate_accrual_settlement_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  accrual_amount numeric;
  accrual_date_value timestamptz;
  accrual_vendor text;
  accrual_status text;
  bill_date_value timestamptz;
  bill_vendor text;
  bill_status text;
  bill_rate numeric;
  bill_line_amount numeric;
  bill_line_mode text;
  bill_line_account_type text;
  used_accrual numeric;
  used_bill_line numeric;
  bill_line_capacity numeric;
BEGIN
  IF NEW.status<>'POSTED' THEN RETURN NEW; END IF;

  SELECT a.amount, a.accrual_date, a.vendor_id, a.status
    INTO accrual_amount, accrual_date_value, accrual_vendor, accrual_status
  FROM accruals a
  WHERE a.id=NEW.accrual_id AND a.tenant_id=NEW.tenant_id;
  IF accrual_amount IS NULL OR accrual_status<>'POSTED' THEN
    RAISE EXCEPTION 'Settlement must reference an active accrual in the same tenant.' USING ERRCODE='23514';
  END IF;

  SELECT b.bill_date, b.vendor_id, b.status::text, b.exchange_rate, bl.amount,
         bl.cost_recognition_mode, coa.type::text
    INTO bill_date_value, bill_vendor, bill_status, bill_rate, bill_line_amount,
         bill_line_mode, bill_line_account_type
  FROM bill_lines bl
  JOIN bills b ON b.id=bl.bill_id
  JOIN chart_of_accounts coa ON coa.id=bl.account_id AND coa.tenant_id=b.tenant_id
  WHERE bl.id=NEW.bill_line_id AND b.tenant_id=NEW.tenant_id;

  IF bill_date_value IS NULL OR bill_status='DRAFT' THEN
    RAISE EXCEPTION 'Accrual settlement requires a posted Bill line in the same tenant.' USING ERRCODE='23514';
  END IF;
  IF bill_line_mode<>'IMMEDIATE' OR bill_line_account_type<>'EXPENSE' THEN
    RAISE EXCEPTION 'Only immediate Expense Bill lines can settle an accrual.' USING ERRCODE='23514';
  END IF;
  IF accrual_vendor IS NOT NULL AND bill_vendor<>accrual_vendor THEN
    RAISE EXCEPTION 'Bill vendor does not match the accrual vendor.' USING ERRCODE='23514';
  END IF;
  IF NEW.settlement_date<accrual_date_value OR NEW.settlement_date<bill_date_value THEN
    RAISE EXCEPTION 'Settlement date cannot precede the accrual or Bill date.' USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(SUM(s.amount),0) INTO used_accrual
  FROM accrual_settlements s
  WHERE s.accrual_id=NEW.accrual_id AND s.tenant_id=NEW.tenant_id AND s.status='POSTED' AND s.id<>NEW.id;
  used_accrual := used_accrual + COALESCE((
    SELECT SUM(r.amount) FROM accrual_releases r
    WHERE r.accrual_id=NEW.accrual_id AND r.tenant_id=NEW.tenant_id AND r.status='POSTED'
  ),0);
  IF used_accrual+NEW.amount-accrual_amount>0.01 THEN
    RAISE EXCEPTION 'Settlement exceeds the remaining accrual balance.' USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(SUM(s.amount),0) INTO used_bill_line
  FROM accrual_settlements s
  WHERE s.bill_line_id=NEW.bill_line_id AND s.tenant_id=NEW.tenant_id AND s.status='POSTED' AND s.id<>NEW.id;
  bill_line_capacity := round((bill_line_amount*bill_rate)::numeric,2);
  IF used_bill_line+NEW.amount-bill_line_capacity>0.01 THEN
    RAISE EXCEPTION 'Settlement exceeds the available base-currency amount on the Bill line.' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_accrual_settlement_identity
BEFORE INSERT OR UPDATE OF tenant_id, accrual_id, bill_line_id, settlement_date, amount, status
ON public.accrual_settlements
FOR EACH ROW EXECUTE FUNCTION public.validate_accrual_settlement_identity();

CREATE OR REPLACE FUNCTION public.validate_accrual_release_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  accrual_amount numeric;
  accrual_date_value timestamptz;
  accrual_status text;
  used_accrual numeric;
BEGIN
  IF NEW.status<>'POSTED' THEN RETURN NEW; END IF;
  SELECT a.amount, a.accrual_date, a.status
    INTO accrual_amount, accrual_date_value, accrual_status
  FROM accruals a
  WHERE a.id=NEW.accrual_id AND a.tenant_id=NEW.tenant_id;
  IF accrual_amount IS NULL OR accrual_status<>'POSTED' THEN
    RAISE EXCEPTION 'Release must reference an active accrual in the same tenant.' USING ERRCODE='23514';
  END IF;
  IF NEW.release_date<accrual_date_value THEN
    RAISE EXCEPTION 'Release date cannot precede the accrual date.' USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(SUM(s.amount),0) INTO used_accrual
  FROM accrual_settlements s
  WHERE s.accrual_id=NEW.accrual_id AND s.tenant_id=NEW.tenant_id AND s.status='POSTED';
  used_accrual := used_accrual + COALESCE((
    SELECT SUM(r.amount) FROM accrual_releases r
    WHERE r.accrual_id=NEW.accrual_id AND r.tenant_id=NEW.tenant_id AND r.status='POSTED' AND r.id<>NEW.id
  ),0);
  IF used_accrual+NEW.amount-accrual_amount>0.01 THEN
    RAISE EXCEPTION 'Release exceeds the remaining accrual balance.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_accrual_release_identity
BEFORE INSERT OR UPDATE OF tenant_id, accrual_id, release_date, amount, status
ON public.accrual_releases
FOR EACH ROW EXECUTE FUNCTION public.validate_accrual_release_identity();

CREATE OR REPLACE FUNCTION public.guard_accrual_source_reversal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
BEGIN
  IF OLD.status='POSTED' AND NEW.status='REVERSED' THEN
    IF EXISTS (SELECT 1 FROM accrual_settlements s WHERE s.accrual_id=OLD.id AND s.status='POSTED')
       OR EXISTS (SELECT 1 FROM accrual_releases r WHERE r.accrual_id=OLD.id AND r.status='POSTED') THEN
      RAISE EXCEPTION 'Reverse active accrual settlements/releases before reversing the source accrual.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_accrual_source_reversal_order
BEFORE UPDATE OF status ON public.accruals
FOR EACH ROW EXECUTE FUNCTION public.guard_accrual_source_reversal();

ALTER TABLE public.accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accrual_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accrual_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY accruals_tenant_isolation ON public.accruals
FOR ALL USING (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid)
WITH CHECK (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid);
CREATE POLICY accrual_settlements_tenant_isolation ON public.accrual_settlements
FOR ALL USING (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid)
WITH CHECK (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid);
CREATE POLICY accrual_releases_tenant_isolation ON public.accrual_releases
FOR ALL USING (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid)
WITH CHECK (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid);