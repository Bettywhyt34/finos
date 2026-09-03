CREATE OR REPLACE FUNCTION public.validate_accrual_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  tenant_currency text;
  account_type text;
  tag_entry record;
BEGIN
  SELECT upper(t.currency) INTO tenant_currency FROM tenants t WHERE t.id=NEW.tenant_id;
  IF tenant_currency IS NULL THEN RAISE EXCEPTION 'Accrual tenant not found.' USING ERRCODE='23514'; END IF;
  IF upper(NEW.currency)<>tenant_currency THEN RAISE EXCEPTION 'Accruals must be recorded in the tenant base currency.' USING ERRCODE='23514'; END IF;
  SELECT coa.type::text INTO account_type FROM chart_of_accounts coa WHERE coa.id=NEW.account_id AND coa.tenant_id=NEW.tenant_id AND coa.is_active=true;
  IF account_type IS DISTINCT FROM 'EXPENSE' THEN RAISE EXCEPTION 'Accrual destination account must be an active Expense account in the same tenant.' USING ERRCODE='23514'; END IF;
  IF NEW.vendor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vendors v WHERE v.id=NEW.vendor_id AND v.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Accrual vendor must belong to the same tenant.' USING ERRCODE='23514'; END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Accrual Project must belong to the same tenant.' USING ERRCODE='23514'; END IF;
  IF NEW.reporting_tags IS NOT NULL THEN
    IF jsonb_typeof(NEW.reporting_tags)<>'object' THEN RAISE EXCEPTION 'Accrual Reporting Tags must be an object.' USING ERRCODE='23514'; END IF;
    FOR tag_entry IN SELECT key,value FROM jsonb_each_text(NEW.reporting_tags)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM reporting_tags rt
        JOIN reporting_tag_options rto ON rto.tag_id=rt.id AND rto.tenant_id=rt.tenant_id
        WHERE rt.id=tag_entry.key AND rt.tenant_id=NEW.tenant_id AND rt.is_active=true
          AND rto.id=tag_entry.value AND rto.is_active=true
      ) THEN
        RAISE EXCEPTION 'Accrual contains an invalid or inactive Reporting Tag option.' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;