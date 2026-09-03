CREATE OR REPLACE FUNCTION public.validate_accrual_settlement_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  accrual_amount numeric; accrual_date_value timestamptz; accrual_vendor text; accrual_status text; accrual_account text; accrual_project text; accrual_tags jsonb;
  bill_date_value timestamptz; bill_vendor text; bill_status text; bill_rate numeric; bill_line_amount numeric; bill_line_mode text; bill_line_account_type text; bill_line_account text; bill_line_project text; bill_line_tags jsonb;
  used_accrual numeric; used_bill_line numeric; bill_line_capacity numeric;
BEGIN
  IF NEW.status<>'POSTED' THEN RETURN NEW; END IF;
  SELECT a.amount,a.accrual_date,a.vendor_id,a.status,a.account_id,a.project_id,a.reporting_tags
    INTO accrual_amount,accrual_date_value,accrual_vendor,accrual_status,accrual_account,accrual_project,accrual_tags
  FROM accruals a WHERE a.id=NEW.accrual_id AND a.tenant_id=NEW.tenant_id;
  IF accrual_amount IS NULL OR accrual_status<>'POSTED' THEN RAISE EXCEPTION 'Settlement must reference an active accrual in the same tenant.' USING ERRCODE='23514'; END IF;

  SELECT b.bill_date,b.vendor_id,b.status::text,b.exchange_rate,bl.amount,bl.cost_recognition_mode,coa.type::text,bl.account_id,bl.project_id,bl.reporting_tags
    INTO bill_date_value,bill_vendor,bill_status,bill_rate,bill_line_amount,bill_line_mode,bill_line_account_type,bill_line_account,bill_line_project,bill_line_tags
  FROM bill_lines bl
  JOIN bills b ON b.id=bl.bill_id
  JOIN chart_of_accounts coa ON coa.id=bl.account_id AND coa.tenant_id=b.tenant_id
  WHERE bl.id=NEW.bill_line_id AND b.tenant_id=NEW.tenant_id;

  IF bill_date_value IS NULL OR bill_status='DRAFT' THEN RAISE EXCEPTION 'Accrual settlement requires a posted Bill line in the same tenant.' USING ERRCODE='23514'; END IF;
  IF bill_line_mode<>'IMMEDIATE' OR bill_line_account_type<>'EXPENSE' THEN RAISE EXCEPTION 'Only immediate Expense Bill lines can settle an accrual.' USING ERRCODE='23514'; END IF;
  IF bill_line_account<>accrual_account THEN RAISE EXCEPTION 'Bill Expense account must match the accrual Expense account.' USING ERRCODE='23514'; END IF;
  IF accrual_project IS NOT NULL AND bill_line_project IS DISTINCT FROM accrual_project THEN RAISE EXCEPTION 'Bill Project must match the accrual Project.' USING ERRCODE='23514'; END IF;
  IF COALESCE(accrual_tags,'{}'::jsonb)<>COALESCE(bill_line_tags,'{}'::jsonb) THEN RAISE EXCEPTION 'Bill Reporting Tags must match the accrual Reporting Tags.' USING ERRCODE='23514'; END IF;
  IF accrual_vendor IS NOT NULL AND bill_vendor<>accrual_vendor THEN RAISE EXCEPTION 'Bill vendor does not match the accrual vendor.' USING ERRCODE='23514'; END IF;
  IF NEW.settlement_date<accrual_date_value OR NEW.settlement_date<bill_date_value THEN RAISE EXCEPTION 'Settlement date cannot precede the accrual or Bill date.' USING ERRCODE='23514'; END IF;

  SELECT COALESCE(SUM(s.amount),0) INTO used_accrual
  FROM accrual_settlements s
  WHERE s.accrual_id=NEW.accrual_id AND s.tenant_id=NEW.tenant_id AND s.status='POSTED' AND s.id<>NEW.id;
  used_accrual := used_accrual + COALESCE((SELECT SUM(r.amount) FROM accrual_releases r WHERE r.accrual_id=NEW.accrual_id AND r.tenant_id=NEW.tenant_id AND r.status='POSTED'),0);
  IF used_accrual+NEW.amount-accrual_amount>0.01 THEN RAISE EXCEPTION 'Settlement exceeds the remaining accrual balance.' USING ERRCODE='23514'; END IF;

  SELECT COALESCE(SUM(s.amount),0) INTO used_bill_line
  FROM accrual_settlements s
  WHERE s.bill_line_id=NEW.bill_line_id AND s.tenant_id=NEW.tenant_id AND s.status='POSTED' AND s.id<>NEW.id;
  bill_line_capacity := round((bill_line_amount*bill_rate)::numeric,2);
  IF used_bill_line+NEW.amount-bill_line_capacity>0.01 THEN RAISE EXCEPTION 'Settlement exceeds the available base-currency amount on the Bill line.' USING ERRCODE='23514'; END IF;

  RETURN NEW;
END;
$$;