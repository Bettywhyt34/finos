-- Accepted quote conversion is a commercial commitment. Once a quote is converted,
-- its invoice keeps the accepted customer, currency, rate, totals and lines.
-- Administrative invoice fields may still change, but commercial terms must not drift.

CREATE OR REPLACE FUNCTION public.prevent_converted_quote_invoice_commercial_drift()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.tenant_id = OLD.tenant_id
      AND q.converted_invoice_id = OLD.id
      AND q.status = 'CONVERTED'
  ) THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
      RAISE EXCEPTION 'Commercial terms are locked because this invoice was created from an accepted quote. Revise the quote workflow rather than changing the converted invoice.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_converted_quote_invoice_commercials ON public.invoices;
CREATE TRIGGER protect_converted_quote_invoice_commercials
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.prevent_converted_quote_invoice_commercial_drift();

CREATE OR REPLACE FUNCTION public.prevent_converted_quote_invoice_line_drift()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_invoice_id text;
  target_tenant_id uuid;
BEGIN
  target_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT i.tenant_id INTO target_tenant_id
  FROM public.invoices i
  WHERE i.id = target_invoice_id;

  IF EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.tenant_id = target_tenant_id
      AND q.converted_invoice_id = target_invoice_id
      AND q.status = 'CONVERTED'
  ) THEN
    RAISE EXCEPTION 'Invoice lines are locked because this invoice was created from an accepted quote. Revise the quote workflow rather than changing the converted invoice.' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS protect_converted_quote_invoice_lines ON public.invoice_lines;
CREATE TRIGGER protect_converted_quote_invoice_lines
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines
FOR EACH ROW
EXECUTE FUNCTION public.prevent_converted_quote_invoice_line_drift();
