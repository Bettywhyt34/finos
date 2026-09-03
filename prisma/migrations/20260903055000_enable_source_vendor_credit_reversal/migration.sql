ALTER TABLE public.vendor_credit_applications
  DROP CONSTRAINT IF EXISTS vendor_credit_applications_lifecycle_check;

ALTER TABLE public.vendor_credit_applications
  ADD CONSTRAINT vendor_credit_applications_lifecycle_check CHECK (
    (application_type='SOURCE' AND status='POSTED' AND journal_entry_id IS NULL
      AND reversal_journal_entry_id IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR
    (application_type='SOURCE' AND status='REVERSED' AND journal_entry_id IS NULL
      AND reversal_journal_entry_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND length(trim(reversal_reason)) > 0)
    OR
    (application_type='LATER' AND status='POSTED' AND journal_entry_id IS NOT NULL
      AND reversal_journal_entry_id IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR
    (application_type='LATER' AND status='REVERSED' AND journal_entry_id IS NOT NULL
      AND reversal_journal_entry_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND length(trim(reversal_reason)) > 0)
  );

CREATE OR REPLACE FUNCTION public.guard_source_vendor_credit_reversal_dependencies()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.status<>'REVERSED' AND NEW.status='REVERSED' THEN
    IF EXISTS (
      SELECT 1 FROM vendor_credit_applications vca
      WHERE vca.tenant_id=OLD.tenant_id AND vca.vendor_credit_id=OLD.id
        AND vca.application_type='LATER' AND vca.status='POSTED'
    ) OR EXISTS (
      SELECT 1 FROM vendor_credit_refunds vcr
      WHERE vcr.tenant_id=OLD.tenant_id AND vcr.vendor_credit_id=OLD.id AND vcr.status='POSTED'
    ) THEN
      RAISE EXCEPTION 'Reverse all later Vendor Credit applications and refunds first.' USING ERRCODE='23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM fx_revaluation_items fri
      JOIN fx_revaluations fr ON fr.id=fri.fx_revaluation_id
      WHERE fri.tenant_id=OLD.tenant_id AND fri.item_type='VENDOR_CREDIT' AND fri.vendor_credit_id=OLD.id
        AND fr.status='POSTED'::fx_revaluation_status
    ) THEN
      RAISE EXCEPTION 'Reverse the posted FX revaluation affecting this Vendor Credit first.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_source_vendor_credit_reversal_dependencies ON public.vendor_credits;
CREATE TRIGGER guard_source_vendor_credit_reversal_dependencies
BEFORE UPDATE OF status ON public.vendor_credits
FOR EACH ROW EXECUTE FUNCTION public.guard_source_vendor_credit_reversal_dependencies();