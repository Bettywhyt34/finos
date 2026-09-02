-- Money In closure: project-linked credit-note accounting and AR FX carrying-value consumption.

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS fx_unrealized_consumed NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.credit_note_service_allocations
  ADD COLUMN IF NOT EXISTS contract_asset_restored NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.credit_note_service_allocations
  DROP CONSTRAINT IF EXISTS credit_note_service_allocations_split_check;

ALTER TABLE public.credit_note_service_allocations
  ADD CONSTRAINT credit_note_service_allocations_contract_asset_restored_check
    CHECK (contract_asset_restored >= 0),
  ADD CONSTRAINT credit_note_service_allocations_split_check
    CHECK (
      unearned_reversed >= 0
      AND revenue_reversed >= 0
      AND contract_asset_restored >= 0
      AND abs((unearned_reversed + revenue_reversed + contract_asset_restored) - service_base_amount) <= 0.01
    );

-- Allow an audited negative CONTRACT_ASSET_CLEARANCE row to represent a credit-note
-- restoration. Existing consumers SUM this ledger, so later billing automatically sees
-- the restored Contract Asset without mutating the original earning event.
ALTER TABLE public.revenue_recognition_invoice_allocations
  DROP CONSTRAINT IF EXISTS revenue_recognition_invoice_allocations_amount_check,
  DROP CONSTRAINT IF EXISTS revenue_recognition_invoice_a_recognition_id_invoice_line_a_key;

ALTER TABLE public.revenue_recognition_invoice_allocations
  ADD CONSTRAINT revenue_recognition_invoice_allocations_amount_nonzero_check
    CHECK (abs(amount) > 0.005);

CREATE INDEX IF NOT EXISTS revenue_recognition_invoice_allocations_recognition_line_idx
  ON public.revenue_recognition_invoice_allocations(recognition_id, invoice_line_allocation_id);

CREATE TABLE IF NOT EXISTS public.credit_note_project_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_id TEXT NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  invoice_line_allocation_id UUID NOT NULL REFERENCES public.invoice_line_revenue_allocations(id) ON DELETE RESTRICT,
  source_allocation_id UUID NOT NULL REFERENCES public.revenue_recognition_invoice_allocations(id) ON DELETE RESTRICT,
  source_recognition_id UUID NOT NULL REFERENCES public.project_revenue_recognitions(id) ON DELETE RESTRICT,
  synthetic_allocation_id UUID NULL,
  adjustment_type TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_note_project_adjustments_type_check
    CHECK (adjustment_type IN ('CONTRACT_ASSET_RESTORATION','REVENUE_REVERSAL')),
  CONSTRAINT credit_note_project_adjustments_amount_check CHECK (amount > 0),
  CONSTRAINT credit_note_project_adjustments_unique UNIQUE (credit_note_id, source_allocation_id, adjustment_type)
);

CREATE INDEX IF NOT EXISTS credit_note_project_adjustments_credit_idx
  ON public.credit_note_project_adjustments(tenant_id, credit_note_id);
CREATE INDEX IF NOT EXISTS credit_note_project_adjustments_source_idx
  ON public.credit_note_project_adjustments(tenant_id, source_recognition_id, adjustment_type);
CREATE INDEX IF NOT EXISTS credit_note_project_adjustments_line_idx
  ON public.credit_note_project_adjustments(invoice_line_allocation_id);

REVOKE ALL ON TABLE public.credit_note_project_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.credit_note_project_adjustments TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_credit_note_contract_asset_restoration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  synthetic_id uuid;
BEGIN
  IF NEW.adjustment_type = 'CONTRACT_ASSET_RESTORATION' THEN
    INSERT INTO public.revenue_recognition_invoice_allocations (
      tenant_id, recognition_id, invoice_line_allocation_id, amount, allocation_type
    ) VALUES (
      NEW.tenant_id, NEW.source_recognition_id, NEW.invoice_line_allocation_id,
      -NEW.amount, 'CONTRACT_ASSET_CLEARANCE'
    ) RETURNING id INTO synthetic_id;

    UPDATE public.credit_note_project_adjustments
    SET synthetic_allocation_id = synthetic_id
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS materialize_credit_note_contract_asset_restoration
  ON public.credit_note_project_adjustments;
CREATE TRIGGER materialize_credit_note_contract_asset_restoration
AFTER INSERT ON public.credit_note_project_adjustments
FOR EACH ROW EXECUTE FUNCTION public.materialize_credit_note_contract_asset_restoration();

-- Prevent future Project revenue recognition from reusing Unearned Income that an
-- applied credit note has already removed. The server transaction rolls back cleanly
-- if a stale screen attempts to post more than the effective balance.
CREATE OR REPLACE FUNCTION public.guard_project_unearned_release_after_credit_notes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  created_amount numeric;
  already_released numeric;
  credited_unearned numeric;
BEGIN
  IF NEW.allocation_type <> 'UNEARNED_RELEASE' OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT ila.unearned_created INTO created_amount
  FROM public.invoice_line_revenue_allocations ila
  WHERE ila.id = NEW.invoice_line_allocation_id;

  SELECT COALESCE(SUM(rria.amount),0) INTO already_released
  FROM public.revenue_recognition_invoice_allocations rria
  JOIN public.project_revenue_recognitions prr ON prr.id = rria.recognition_id
  WHERE rria.invoice_line_allocation_id = NEW.invoice_line_allocation_id
    AND rria.allocation_type = 'UNEARNED_RELEASE'
    AND prr.status = 'POSTED'
    AND rria.id IS DISTINCT FROM NEW.id;

  SELECT COALESCE(SUM(cnsa.unearned_reversed),0) INTO credited_unearned
  FROM public.credit_note_service_allocations cnsa
  JOIN public.credit_notes cn ON cn.id = cnsa.credit_note_id
  WHERE cnsa.invoice_line_allocation_id = NEW.invoice_line_allocation_id
    AND cn.status = 'APPLIED';

  IF already_released + NEW.amount > created_amount - credited_unearned + 0.01 THEN
    RAISE EXCEPTION 'Project revenue recognition exceeds the Unearned Income remaining after applied credit notes.'
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_project_unearned_release_after_credit_notes
  ON public.revenue_recognition_invoice_allocations;
CREATE TRIGGER guard_project_unearned_release_after_credit_notes
BEFORE INSERT OR UPDATE ON public.revenue_recognition_invoice_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_project_unearned_release_after_credit_notes();

-- A credit-note reversal may remove its restored Contract Asset only if that restored
-- amount has not subsequently been consumed by later billing.
CREATE OR REPLACE FUNCTION public.guard_credit_note_project_reversal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  restoration record;
  available_amount numeric;
BEGIN
  IF OLD.status = 'APPLIED' AND NEW.status = 'REVERSED' THEN
    FOR restoration IN
      SELECT source_recognition_id, SUM(amount) AS amount
      FROM public.credit_note_project_adjustments
      WHERE credit_note_id = OLD.id
        AND adjustment_type = 'CONTRACT_ASSET_RESTORATION'
      GROUP BY source_recognition_id
    LOOP
      SELECT prr.contract_asset_created - COALESCE(SUM(
        CASE WHEN rria.allocation_type = 'CONTRACT_ASSET_CLEARANCE' THEN rria.amount ELSE 0 END
      ),0)
      INTO available_amount
      FROM public.project_revenue_recognitions prr
      LEFT JOIN public.revenue_recognition_invoice_allocations rria
        ON rria.recognition_id = prr.id
      WHERE prr.id = restoration.source_recognition_id
      GROUP BY prr.contract_asset_created;

      IF COALESCE(available_amount,0) + 0.01 < restoration.amount THEN
        RAISE EXCEPTION 'This credit note restored Contract Asset that has since been consumed by later billing. Reverse the dependent later billing first.'
          USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_credit_note_project_reversal ON public.credit_notes;
CREATE TRIGGER guard_credit_note_project_reversal
BEFORE UPDATE OF status ON public.credit_notes
FOR EACH ROW EXECUTE FUNCTION public.guard_credit_note_project_reversal();

CREATE OR REPLACE FUNCTION public.remove_reversed_credit_note_synthetic_allocations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  IF OLD.status = 'APPLIED' AND NEW.status = 'REVERSED' THEN
    DELETE FROM public.revenue_recognition_invoice_allocations rria
    USING public.credit_note_project_adjustments cnpa
    WHERE cnpa.credit_note_id = OLD.id
      AND cnpa.adjustment_type = 'CONTRACT_ASSET_RESTORATION'
      AND cnpa.synthetic_allocation_id = rria.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS remove_reversed_credit_note_synthetic_allocations ON public.credit_notes;
CREATE TRIGGER remove_reversed_credit_note_synthetic_allocations
AFTER UPDATE OF status ON public.credit_notes
FOR EACH ROW EXECUTE FUNCTION public.remove_reversed_credit_note_synthetic_allocations();

-- Credit notes can consume an AR unrealised revaluation just like receipts. Protect
-- the revaluation from reversal until the dependent credit note is reversed.
CREATE OR REPLACE FUNCTION public.guard_fx_revaluation_reversal_after_credit_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
    IF EXISTS (
      SELECT 1
      FROM public.fx_revaluation_items fri
      JOIN public.credit_notes cn ON cn.invoice_id = fri.invoice_id
      WHERE fri.fx_revaluation_id = OLD.id
        AND fri.item_type = 'AR'
        AND cn.tenant_id = OLD.tenant_id
        AND cn.status = 'APPLIED'
        AND abs(cn.fx_unrealized_consumed) > 0.005
    ) THEN
      RAISE EXCEPTION 'This FX revaluation has been consumed by an applied credit note. Reverse the dependent credit note first.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_fx_revaluation_reversal_after_credit_note ON public.fx_revaluations;
CREATE TRIGGER guard_fx_revaluation_reversal_after_credit_note
BEFORE UPDATE OF status ON public.fx_revaluations
FOR EACH ROW EXECUTE FUNCTION public.guard_fx_revaluation_reversal_after_credit_note();
