-- Vendor Credits against prepaid Bill lines must reverse recognised expense and remaining prepayment proportionately.

ALTER TABLE public.vendor_credit_lines
  ADD COLUMN IF NOT EXISTS recognised_cost_reversal numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepaid_cost_reversal numeric(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.vendor_credit_lines
  DROP CONSTRAINT IF EXISTS vendor_credit_lines_cost_split_check;
ALTER TABLE public.vendor_credit_lines
  ADD CONSTRAINT vendor_credit_lines_cost_split_check CHECK (
    recognised_cost_reversal >= 0 AND prepaid_cost_reversal >= 0
    AND abs(service_amount - round((recognised_cost_reversal + prepaid_cost_reversal)::numeric,2)) <= 0.01
  );

CREATE OR REPLACE FUNCTION public.validate_bill_line_cost_recognition_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  bill_tenant uuid;
  mode text;
  line_amount numeric;
  bill_rate numeric;
  posted_recognised numeric;
  active_credit numeric;
  recognised_credit_reversal numeric;
  net_line_amount numeric;
  effective_recognised numeric;
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

  SELECT COALESCE(SUM(vcl.service_amount),0), COALESCE(SUM(vcl.recognised_cost_reversal),0)
    INTO active_credit, recognised_credit_reversal
  FROM vendor_credit_lines vcl
  JOIN vendor_credits vc ON vc.id=vcl.vendor_credit_id
  WHERE vcl.tenant_id=NEW.tenant_id AND vcl.source_bill_line_id=NEW.bill_line_id AND vc.status<>'REVERSED';

  net_line_amount := line_amount - active_credit;
  effective_recognised := posted_recognised - recognised_credit_reversal;
  IF net_line_amount < -0.01 OR effective_recognised < -0.01 OR effective_recognised-net_line_amount>0.01 THEN
    RAISE EXCEPTION 'Posted cost recognition exceeds the net prepaid Bill line after Vendor Credits.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
