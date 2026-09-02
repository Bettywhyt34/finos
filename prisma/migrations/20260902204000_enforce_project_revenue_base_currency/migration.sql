CREATE OR REPLACE FUNCTION public.enforce_project_revenue_base_currency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  base_currency text;
BEGIN
  SELECT upper(trim(t.currency)) INTO base_currency
  FROM public.tenants t
  WHERE t.id = NEW.tenant_id;

  IF base_currency IS NULL THEN
    RAISE EXCEPTION 'Tenant base currency could not be resolved for Project revenue recognition.';
  END IF;

  NEW.currency = base_currency;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_project_revenue_base_currency ON public.project_revenue_recognitions;
CREATE TRIGGER enforce_project_revenue_base_currency
BEFORE INSERT OR UPDATE OF currency ON public.project_revenue_recognitions
FOR EACH ROW EXECUTE FUNCTION public.enforce_project_revenue_base_currency();

CREATE OR REPLACE FUNCTION public.normalise_project_revenue_activity_currency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  base_currency text;
BEGIN
  IF NEW.event_type = 'REVENUE_RECOGNISED' THEN
    SELECT upper(trim(t.currency)) INTO base_currency
    FROM public.tenants t
    WHERE t.id = NEW.tenant_id;

    IF base_currency IS NOT NULL THEN
      IF NEW.metadata IS NOT NULL THEN
        NEW.metadata = jsonb_set(NEW.metadata, '{currency}', to_jsonb(base_currency), true);
      END IF;
      IF NEW.description IS NOT NULL THEN
        NEW.description = replace(NEW.description, ' NGN ', ' ' || base_currency || ' ');
        IF right(NEW.description, 4) = ' NGN' THEN
          NEW.description = left(NEW.description, length(NEW.description) - 4) || ' ' || base_currency;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalise_project_revenue_activity_currency ON public.project_activities;
CREATE TRIGGER normalise_project_revenue_activity_currency
BEFORE INSERT OR UPDATE ON public.project_activities
FOR EACH ROW EXECUTE FUNCTION public.normalise_project_revenue_activity_currency();
