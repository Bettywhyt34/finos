CREATE OR REPLACE FUNCTION public.validate_bill_base_currency_fx()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  base_currency text;
BEGIN
  SELECT upper(trim(t.currency)) INTO base_currency
  FROM tenants t
  WHERE t.id=NEW.tenant_id;

  IF base_currency IS NULL THEN
    RAISE EXCEPTION 'Bill tenant not found.' USING ERRCODE='23514';
  END IF;

  NEW.currency := upper(trim(NEW.currency));
  IF NEW.currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Bill currency must be a three-letter currency code.' USING ERRCODE='23514';
  END IF;
  IF NEW.exchange_rate IS NULL OR NEW.exchange_rate<=0 THEN
    RAISE EXCEPTION 'Bill exchange rate must be greater than zero.' USING ERRCODE='23514';
  END IF;
  IF NEW.currency=base_currency AND abs(NEW.exchange_rate-1)>0.000001 THEN
    RAISE EXCEPTION 'A Bill in the tenant base currency must use an exchange rate of 1.' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_bill_base_currency_fx ON public.bills;
CREATE TRIGGER enforce_bill_base_currency_fx
BEFORE INSERT OR UPDATE OF tenant_id,currency,exchange_rate
ON public.bills
FOR EACH ROW EXECUTE FUNCTION public.validate_bill_base_currency_fx();