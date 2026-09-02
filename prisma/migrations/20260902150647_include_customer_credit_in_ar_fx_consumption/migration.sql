-- Receipt AR carrying-value validation must account for customer-credit applications
-- that have already consumed part of the invoice's active unrealised FX adjustment.
CREATE OR REPLACE FUNCTION public.validate_customer_payment_allocation_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  payment_row customer_payments%ROWTYPE;
  invoice_row invoices%ROWTYPE;
  posted_adjustment numeric;
  prior_receipt_consumed numeric;
  credit_application_consumed numeric;
  active_before numeric;
  pre_payment_balance numeric;
  expected_consumed numeric;
BEGIN
  SELECT * INTO payment_row FROM customer_payments WHERE id = NEW.payment_id;
  SELECT * INTO invoice_row FROM invoices WHERE id = NEW.invoice_id;

  IF payment_row.id IS NULL OR invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Receipt allocation must reference an existing receipt and invoice.' USING ERRCODE='23503';
  END IF;
  IF payment_row.tenant_id <> invoice_row.tenant_id OR payment_row.customer_id <> invoice_row.customer_id OR upper(payment_row.currency) <> upper(invoice_row.currency) THEN
    RAISE EXCEPTION 'Receipt allocation invoice must match receipt tenant, customer and currency.' USING ERRCODE='23514';
  END IF;
  IF NEW.amount <= 0 THEN RAISE EXCEPTION 'Receipt allocation amount must be positive.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.base_historical_ar_amount - round((NEW.amount * invoice_row.exchange_rate)::numeric,2)) > 0.01 THEN
    RAISE EXCEPTION 'Receipt allocation historical AR evidence does not match the invoice transaction rate.' USING ERRCODE='23514';
  END IF;
  IF abs(NEW.base_ar_amount - round((NEW.base_historical_ar_amount + NEW.fx_unrealized_consumed)::numeric,2)) > 0.01 THEN
    RAISE EXCEPTION 'Receipt allocation AR carrying value must equal historical AR plus consumed unrealised FX.' USING ERRCODE='23514';
  END IF;
  IF abs(NEW.base_settlement_amount - round((NEW.amount * payment_row.exchange_rate)::numeric,2)) > 0.01 THEN
    RAISE EXCEPTION 'Receipt allocation base settlement evidence does not match the receipt rate.' USING ERRCODE='23514';
  END IF;

  SELECT coalesce(sum(fri.adjustment_base_amount),0) INTO posted_adjustment
  FROM fx_revaluation_items fri JOIN fx_revaluations fr ON fr.id=fri.fx_revaluation_id
  WHERE fri.tenant_id=payment_row.tenant_id AND fri.item_type='AR' AND fri.invoice_id=NEW.invoice_id AND fr.status='POSTED'::fx_revaluation_status;

  SELECT coalesce(sum(cpa.fx_unrealized_consumed),0) INTO prior_receipt_consumed
  FROM customer_payment_allocations cpa JOIN customer_payments cp ON cp.id=cpa.payment_id
  WHERE cpa.invoice_id=NEW.invoice_id AND cpa.payment_id<>NEW.payment_id AND cp.status='POSTED'::customer_payment_status;

  SELECT coalesce(sum(cca.fx_unrealized_consumed),0) INTO credit_application_consumed
  FROM customer_credit_applications cca
  WHERE cca.invoice_id=NEW.invoice_id AND cca.status='POSTED';

  active_before := round((posted_adjustment - prior_receipt_consumed - credit_application_consumed)::numeric,2);
  pre_payment_balance := round((invoice_row.balance_due + NEW.amount)::numeric,2);
  IF pre_payment_balance <= 0 THEN RAISE EXCEPTION 'Receipt allocation cannot reconstruct a positive pre-payment invoice balance.' USING ERRCODE='23514'; END IF;
  IF abs(NEW.amount - pre_payment_balance) <= 0.01 THEN expected_consumed := active_before;
  ELSE expected_consumed := round((active_before * NEW.amount / pre_payment_balance)::numeric,2);
  END IF;
  IF abs(NEW.fx_unrealized_consumed - expected_consumed) > 0.01 THEN
    RAISE EXCEPTION 'Receipt allocation unrealised FX consumption does not match the invoice carrying adjustment.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
