-- Money Out: Bill-line cost recognition / prepayment lifecycle.
-- Existing lines remain IMMEDIATE by default; PREPAID is available only for intended Expense accounts.

ALTER TABLE public.bill_lines
  ADD COLUMN IF NOT EXISTS cost_recognition_mode text NOT NULL DEFAULT 'IMMEDIATE';

ALTER TABLE public.bill_lines
  DROP CONSTRAINT IF EXISTS bill_lines_cost_recognition_mode_check;
ALTER TABLE public.bill_lines
  ADD CONSTRAINT bill_lines_cost_recognition_mode_check
  CHECK (cost_recognition_mode IN ('IMMEDIATE','PREPAID'));

CREATE TABLE IF NOT EXISTS public.bill_line_cost_recognitions (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bill_line_id text NOT NULL REFERENCES public.bill_lines(id) ON DELETE RESTRICT,
  recognition_date timestamp without time zone NOT NULL,
  amount numeric(15,2) NOT NULL,
  historical_exchange_rate numeric(15,6) NOT NULL,
  base_amount numeric(15,2) NOT NULL,
  journal_entry_id text NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversal_journal_entry_id text NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversed_at timestamptz NULL,
  reversed_by text NULL,
  reversal_reason text NULL,
  CONSTRAINT bill_line_cost_recognitions_amount_check CHECK (amount > 0 AND historical_exchange_rate > 0 AND base_amount > 0),
  CONSTRAINT bill_line_cost_recognitions_status_check CHECK (status IN ('POSTED','REVERSED')),
  CONSTRAINT bill_line_cost_recognitions_lifecycle_check CHECK (
    (status='POSTED' AND reversal_journal_entry_id IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR
    (status='REVERSED' AND reversal_journal_entry_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND length(trim(reversal_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS bill_line_cost_recognitions_line_idx
  ON public.bill_line_cost_recognitions(tenant_id,bill_line_id,status,recognition_date);
CREATE INDEX IF NOT EXISTS bill_line_cost_recognitions_journal_idx
  ON public.bill_line_cost_recognitions(journal_entry_id);
CREATE INDEX IF NOT EXISTS bill_line_cost_recognitions_reversal_journal_idx
  ON public.bill_line_cost_recognitions(reversal_journal_entry_id)
  WHERE reversal_journal_entry_id IS NOT NULL;

ALTER TABLE public.bill_line_cost_recognitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.bill_line_cost_recognitions;
CREATE POLICY tenant_isolation ON public.bill_line_cost_recognitions
  FOR ALL TO public
  USING (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid)
  WITH CHECK (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid);

CREATE OR REPLACE FUNCTION public.validate_bill_line_prepaid_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE account_type text;
BEGIN
  IF NEW.cost_recognition_mode='PREPAID' THEN
    SELECT coa.type::text INTO account_type
    FROM chart_of_accounts coa
    JOIN bills b ON b.id=NEW.bill_id
    WHERE coa.id=NEW.account_id AND coa.tenant_id=b.tenant_id AND coa.is_active=true;
    IF account_type IS DISTINCT FROM 'EXPENSE' THEN
      RAISE EXCEPTION 'Only Bill lines with an active Expense destination account can be marked PREPAID.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_bill_line_prepaid_mode ON public.bill_lines;
CREATE CONSTRAINT TRIGGER enforce_bill_line_prepaid_mode
AFTER INSERT OR UPDATE OF account_id,cost_recognition_mode,bill_id ON public.bill_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_bill_line_prepaid_mode();

CREATE OR REPLACE FUNCTION public.validate_bill_line_cost_recognition_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE bill_tenant uuid; mode text; line_amount numeric; bill_rate numeric; posted_recognised numeric;
BEGIN
  SELECT b.tenant_id, bl.cost_recognition_mode, bl.amount, b.exchange_rate
    INTO bill_tenant, mode, line_amount, bill_rate
  FROM bill_lines bl JOIN bills b ON b.id=bl.bill_id
  WHERE bl.id=NEW.bill_line_id;

  IF bill_tenant IS NULL OR bill_tenant<>NEW.tenant_id OR mode<>'PREPAID' THEN
    RAISE EXCEPTION 'Cost recognition must belong to a PREPAID Bill line in the same tenant.' USING ERRCODE='23514';
  END IF;
  IF abs(NEW.historical_exchange_rate-bill_rate)>0.000001 THEN
    RAISE EXCEPTION 'Prepaid cost recognition must use the original Bill exchange rate.' USING ERRCODE='23514';
  END IF;
  IF abs(NEW.base_amount-round((NEW.amount*NEW.historical_exchange_rate)::numeric,2))>0.01 THEN
    RAISE EXCEPTION 'Prepaid cost recognition base amount must equal amount at the historical Bill rate.' USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(SUM(r.amount),0) INTO posted_recognised
  FROM bill_line_cost_recognitions r
  WHERE r.tenant_id=NEW.tenant_id AND r.bill_line_id=NEW.bill_line_id AND r.status='POSTED' AND r.id<>NEW.id;
  IF NEW.status='POSTED' THEN posted_recognised := posted_recognised + NEW.amount; END IF;
  IF posted_recognised-line_amount>0.01 THEN
    RAISE EXCEPTION 'Posted cost recognitions exceed the prepaid Bill line amount.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_bill_line_cost_recognition_identity ON public.bill_line_cost_recognitions;
CREATE CONSTRAINT TRIGGER enforce_bill_line_cost_recognition_identity
AFTER INSERT OR UPDATE ON public.bill_line_cost_recognitions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_bill_line_cost_recognition_identity();
