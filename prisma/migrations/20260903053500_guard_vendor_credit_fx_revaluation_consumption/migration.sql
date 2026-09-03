CREATE OR REPLACE FUNCTION public.guard_vendor_credit_fx_revaluation_reversal()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.status='POSTED'::fx_revaluation_status AND NEW.status='REVERSED'::fx_revaluation_status THEN
    IF EXISTS (
      SELECT 1
      FROM fx_revaluation_items fri
      WHERE fri.fx_revaluation_id=OLD.id
        AND fri.item_type='VENDOR_CREDIT'
        AND (
          EXISTS (
            SELECT 1 FROM vendor_credit_applications vca
            WHERE vca.tenant_id=OLD.tenant_id
              AND vca.vendor_credit_id=fri.vendor_credit_id
              AND vca.application_type='LATER'
              AND vca.status='POSTED'
              AND abs(vca.credit_fx_unrealized_consumed)>0.005
          )
          OR EXISTS (
            SELECT 1 FROM vendor_credit_refunds vcr
            WHERE vcr.tenant_id=OLD.tenant_id
              AND vcr.vendor_credit_id=fri.vendor_credit_id
              AND vcr.status='POSTED'
              AND abs(vcr.credit_fx_unrealized_consumed)>0.005
          )
        )
    ) THEN
      RAISE EXCEPTION 'This FX revaluation has been consumed by a Vendor Credit movement. Reverse the later Vendor Credit application or refund first.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_vendor_credit_fx_revaluation_reversal ON public.fx_revaluations;
CREATE TRIGGER guard_vendor_credit_fx_revaluation_reversal
BEFORE UPDATE OF status ON public.fx_revaluations
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_credit_fx_revaluation_reversal();