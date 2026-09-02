CREATE OR REPLACE FUNCTION public.block_credit_note_with_active_ar_fx()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE invoice_currency text; posted_adjustment numeric; consumed_adjustment numeric; active_adjustment numeric;
BEGIN
  IF NEW.status <> 'APPLIED'::"CreditNoteStatus" THEN RETURN NEW; END IF;
  SELECT currency INTO invoice_currency FROM invoices WHERE id = NEW.invoice_id;
  IF invoice_currency IS NULL OR upper(invoice_currency) = 'NGN' THEN RETURN NEW; END IF;

  SELECT coalesce(sum(fri.adjustment_base_amount),0) INTO posted_adjustment
  FROM fx_revaluation_items fri JOIN fx_revaluations fr ON fr.id=fri.fx_revaluation_id
  WHERE fri.tenant_id=NEW.tenant_id AND fri.item_type='AR' AND fri.invoice_id=NEW.invoice_id AND fr.status='POSTED'::fx_revaluation_status;

  SELECT coalesce(sum(cpa.fx_unrealized_consumed),0) INTO consumed_adjustment
  FROM customer_payment_allocations cpa JOIN customer_payments cp ON cp.id=cpa.payment_id
  WHERE cpa.invoice_id=NEW.invoice_id AND cp.tenant_id=NEW.tenant_id AND cp.status='POSTED'::customer_payment_status;

  active_adjustment := round((posted_adjustment-consumed_adjustment)::numeric,2);
  IF abs(active_adjustment)>0.01 THEN
    RAISE EXCEPTION 'Credit note blocked: this foreign-currency invoice has an active unrealised FX carrying adjustment. Reverse the applicable FX revaluation first.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_credit_note_active_ar_fx_guard ON public.credit_notes;
CREATE CONSTRAINT TRIGGER enforce_credit_note_active_ar_fx_guard
AFTER INSERT OR UPDATE ON public.credit_notes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.block_credit_note_with_active_ar_fx();
