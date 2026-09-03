-- Retire legacy vendor-payment posting paths at the database boundary.
-- Every vendor payment must retain allocation evidence equal to the gross AP amount settled.

CREATE OR REPLACE FUNCTION public.validate_vendor_payment_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE allocated numeric;
BEGIN
  SELECT COALESCE(SUM(vpa.amount), 0)
    INTO allocated
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.payment_id = NEW.id
    AND vpa.tenant_id = NEW.tenant_id;

  IF abs(round(allocated, 2) - round(NEW.amount, 2)) > 0.01 THEN
    RAISE EXCEPTION 'Vendor payment allocation evidence must equal the gross AP amount settled.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_vendor_payment_evidence ON public.vendor_payments;
CREATE CONSTRAINT TRIGGER enforce_vendor_payment_evidence
AFTER INSERT OR UPDATE OF amount, tenant_id ON public.vendor_payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.validate_vendor_payment_evidence();
