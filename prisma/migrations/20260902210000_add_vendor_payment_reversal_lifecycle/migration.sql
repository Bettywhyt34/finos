-- Money Out closure: controlled vendor-payment reversal while preserving original settlement evidence.

ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'POSTED',
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id TEXT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reversed_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT NULL;

ALTER TABLE public.vendor_payments
  DROP CONSTRAINT IF EXISTS vendor_payments_status_check,
  DROP CONSTRAINT IF EXISTS vendor_payments_reversal_evidence_check;

ALTER TABLE public.vendor_payments
  ADD CONSTRAINT vendor_payments_status_check
    CHECK (status IN ('POSTED','REVERSED')),
  ADD CONSTRAINT vendor_payments_reversal_evidence_check
    CHECK (
      (status = 'POSTED' AND reversal_journal_entry_id IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
      OR
      (status = 'REVERSED' AND reversal_journal_entry_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND length(trim(reversal_reason)) > 0)
    );

CREATE INDEX IF NOT EXISTS vendor_payments_status_idx
  ON public.vendor_payments(tenant_id, status, payment_date DESC);

-- A later posted AP revaluation is calculated on the post-payment open balance.
-- Do not allow that payment to be reversed underneath the later carrying-value event.
CREATE OR REPLACE FUNCTION public.guard_vendor_payment_reversal_after_later_fx_revaluation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
    IF EXISTS (
      SELECT 1
      FROM public.vendor_payment_allocations vpa
      JOIN public.fx_revaluation_items fri
        ON fri.bill_id = vpa.bill_id
       AND fri.item_type = 'AP'
      JOIN public.fx_revaluations fr
        ON fr.id = fri.fx_revaluation_id
      WHERE vpa.payment_id = OLD.id
        AND vpa.tenant_id = OLD.tenant_id
        AND fr.tenant_id = OLD.tenant_id
        AND fr.status = 'POSTED'
        AND fr.revaluation_date > OLD.payment_date
    ) THEN
      RAISE EXCEPTION 'A later posted FX revaluation depends on this vendor payment. Reverse the later FX revaluation first.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_vendor_payment_reversal_after_later_fx_revaluation ON public.vendor_payments;
CREATE TRIGGER guard_vendor_payment_reversal_after_later_fx_revaluation
BEFORE UPDATE OF status ON public.vendor_payments
FOR EACH ROW
EXECUTE FUNCTION public.guard_vendor_payment_reversal_after_later_fx_revaluation();
