ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issued_document_snapshot JSONB NULL;

CREATE OR REPLACE FUNCTION public.capture_issued_invoice_document_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  tenant_row public.tenants%ROWTYPE;
  template_row public.pdf_templates%ROWTYPE;
BEGIN
  IF OLD.status = 'DRAFT'::"InvoiceStatus"
     AND NEW.status = 'SENT'::"InvoiceStatus"
     AND NEW.issued_document_snapshot IS NULL THEN

    SELECT * INTO tenant_row
    FROM public.tenants
    WHERE id = NEW.tenant_id;

    SELECT * INTO template_row
    FROM public.pdf_templates
    WHERE tenant_id = NEW.tenant_id
      AND document_type::text = 'INVOICE'
      AND is_active = true
    ORDER BY
      CASE
        WHEN is_default = true THEN 1
        WHEN is_system = true AND layout_key = 'standard' THEN 2
        WHEN is_system = true THEN 3
        ELSE 4
      END,
      created_at ASC
    LIMIT 1;

    NEW.issued_document_snapshot = jsonb_build_object(
      'version', 1,
      'capturedAt', now(),
      'branding', jsonb_build_object(
        'name', tenant_row.name,
        'logoUrl', tenant_row.logo_url,
        'address1', tenant_row.address1,
        'address2', tenant_row.address2,
        'city', tenant_row.city,
        'state', tenant_row.state,
        'zip', tenant_row.zip,
        'phone', tenant_row.phone,
        'website', tenant_row.website,
        'taxId', tenant_row.tax_id
      ),
      'template', CASE
        WHEN template_row.id IS NULL THEN jsonb_build_object(
          'id', NULL,
          'layoutKey', 'standard',
          'config', '{}'::jsonb,
          'accentColor', '#1B3A6B'
        )
        ELSE jsonb_build_object(
          'id', template_row.id,
          'layoutKey', COALESCE(template_row.layout_key, 'standard'),
          'config', COALESCE(template_row.config, '{}'::jsonb),
          'accentColor', COALESCE(template_row.config->>'primaryColorFallback', '#1B3A6B')
        )
      END
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS capture_issued_invoice_document_snapshot ON public.invoices;
CREATE TRIGGER capture_issued_invoice_document_snapshot
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.capture_issued_invoice_document_snapshot();
