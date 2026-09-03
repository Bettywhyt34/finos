-- Enforce Vendor Credit cost splits against the source Bill-line recognition state.

CREATE OR REPLACE FUNCTION public.validate_vendor_credit_prepaid_split()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  mode text;
  line_amount numeric;
  credit_date_value timestamptz;
  latest_recognition_date timestamptz;
  prior_credit numeric;
  posted_recognised numeric;
  prior_recognised_reversal numeric;
  net_before numeric;
  effective_recognised numeric;
  expected_recognised numeric;
  expected_prepaid numeric;
BEGIN
  SELECT bl.cost_recognition_mode, bl.amount
    INTO mode, line_amount
  FROM bill_lines bl
  JOIN bills b ON b.id=bl.bill_id
  WHERE bl.id=NEW.source_bill_line_id AND b.tenant_id=NEW.tenant_id;

  IF mode IS NULL THEN
    RAISE EXCEPTION 'Vendor Credit line must reference a Bill line in the same tenant.' USING ERRCODE='23514';
  END IF;

  SELECT vc.credit_date
    INTO credit_date_value
  FROM vendor_credits vc
  WHERE vc.id=NEW.vendor_credit_id AND vc.tenant_id=NEW.tenant_id;

  IF credit_date_value IS NULL THEN
    RAISE EXCEPTION 'Vendor Credit line must belong to a Vendor Credit in the same tenant.' USING ERRCODE='23514';
  END IF;

  IF mode <> 'PREPAID' THEN
    IF abs(NEW.recognised_cost_reversal-NEW.service_amount)>0.01 OR NEW.prepaid_cost_reversal>0.01 THEN
      RAISE EXCEPTION 'Non-prepaid Bill lines must reverse their full service amount to the original account.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT MAX(r.recognition_date)
    INTO latest_recognition_date
  FROM bill_line_cost_recognitions r
  WHERE r.tenant_id=NEW.tenant_id
    AND r.bill_line_id=NEW.source_bill_line_id
    AND r.status='POSTED';

  IF latest_recognition_date IS NOT NULL AND credit_date_value < latest_recognition_date THEN
    RAISE EXCEPTION 'Vendor Credit cannot be dated before an existing prepaid-cost recognition on the source Bill line.' USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(SUM(vcl.service_amount),0), COALESCE(SUM(vcl.recognised_cost_reversal),0)
    INTO prior_credit, prior_recognised_reversal
  FROM vendor_credit_lines vcl
  JOIN vendor_credits vc ON vc.id=vcl.vendor_credit_id
  WHERE vcl.tenant_id=NEW.tenant_id
    AND vcl.source_bill_line_id=NEW.source_bill_line_id
    AND vc.status<>'REVERSED'
    AND vcl.id<>NEW.id;

  SELECT COALESCE(SUM(r.amount),0)
    INTO posted_recognised
  FROM bill_line_cost_recognitions r
  WHERE r.tenant_id=NEW.tenant_id
    AND r.bill_line_id=NEW.source_bill_line_id
    AND r.status='POSTED';

  net_before := round((line_amount-prior_credit)::numeric,2);
  effective_recognised := round((posted_recognised-prior_recognised_reversal)::numeric,2);

  IF net_before < -0.01 OR effective_recognised < -0.01 OR effective_recognised-net_before>0.01 THEN
    RAISE EXCEPTION 'Prepaid cost evidence is inconsistent before Vendor Credit posting.' USING ERRCODE='23514';
  END IF;

  IF NEW.service_amount-net_before>0.01 THEN
    RAISE EXCEPTION 'Vendor Credit exceeds the remaining source Bill-line amount.' USING ERRCODE='23514';
  END IF;

  IF net_before <= 0.005 THEN
    expected_recognised := 0;
  ELSE
    expected_recognised := round((NEW.service_amount*(effective_recognised/net_before))::numeric,2);
    expected_recognised := LEAST(effective_recognised, GREATEST(0, expected_recognised));
  END IF;
  expected_prepaid := round((NEW.service_amount-expected_recognised)::numeric,2);

  IF abs(NEW.recognised_cost_reversal-expected_recognised)>0.01
     OR abs(NEW.prepaid_cost_reversal-expected_prepaid)>0.01 THEN
    RAISE EXCEPTION 'Vendor Credit must reverse recognised and prepaid cost proportionately.' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_vendor_credit_prepaid_split ON public.vendor_credit_lines;
CREATE TRIGGER enforce_vendor_credit_prepaid_split
BEFORE INSERT OR UPDATE OF service_amount, recognised_cost_reversal, prepaid_cost_reversal, source_bill_line_id, vendor_credit_id, tenant_id
ON public.vendor_credit_lines
FOR EACH ROW
EXECUTE FUNCTION public.validate_vendor_credit_prepaid_split();
