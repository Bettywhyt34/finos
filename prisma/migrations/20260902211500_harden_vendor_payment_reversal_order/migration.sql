-- Keep vendor-payment corrections in dependency order so partial-settlement and FX attribution remain stable.

CREATE OR REPLACE FUNCTION public.guard_vendor_payment_reversal_after_later_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
    IF EXISTS (
      SELECT 1
      FROM public.vendor_payment_allocations current_alloc
      JOIN public.vendor_payment_allocations later_alloc
        ON later_alloc.bill_id = current_alloc.bill_id
      JOIN public.vendor_payments later_payment
        ON later_payment.id = later_alloc.payment_id
      WHERE current_alloc.payment_id = OLD.id
        AND current_alloc.tenant_id = OLD.tenant_id
        AND later_payment.tenant_id = OLD.tenant_id
        AND later_payment.status = 'POSTED'
        AND later_payment.id <> OLD.id
        AND (
          later_payment.payment_date > OLD.payment_date
          OR (later_payment.payment_date = OLD.payment_date AND later_payment.created_at > OLD.created_at)
        )
    ) THEN
      RAISE EXCEPTION 'A later posted vendor payment depends on this payment. Reverse later payments first.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_vendor_payment_reversal_after_later_payment ON public.vendor_payments;
CREATE TRIGGER guard_vendor_payment_reversal_after_later_payment
BEFORE UPDATE OF status ON public.vendor_payments
FOR EACH ROW
EXECUTE FUNCTION public.guard_vendor_payment_reversal_after_later_payment();
