/**
 * Migration: PDF Templates — Professional Branded Invoice
 *
 * Adds the "Professional Branded Invoice" system template (layout key:
 * professional_branded_invoice) for the INVOICE document type, for every
 * existing tenant.
 *
 * Colour source: config.useBrandAccent = true — the renderer resolves colour
 * from organisation branding at render time. #1B3A6B is the fallback only.
 *
 * IDEMPOTENT — ON CONFLICT DO NOTHING on (tenant_id, document_type, name).
 */

DO $$
DECLARE
  t_id UUID;
BEGIN
  FOR t_id IN SELECT id FROM tenants
  LOOP
    INSERT INTO pdf_templates
      (id, tenant_id, document_type, name, description, layout_key,
       is_system, is_default, is_active, config)
    VALUES (
      gen_random_uuid()::text,
      t_id,
      'INVOICE'::pdf_template_document_type_enum,
      'Professional Branded Invoice',
      'EJC-style structured invoice: branded header, bill-to, item table, totals, notes, payment terms, warranty. Colours resolve from organisation branding.',
      'professional_branded_invoice',
      true,
      false,
      true,
      '{
        "useBrandAccent": true,
        "primaryColorFallback": "#1B3A6B",
        "tableHeaderUsesBrandAccent": true,
        "sectionHeadingUsesBrandAccent": true,
        "alternateRowColor": "#EBF1FA",
        "borderColor": "#CCCCCC",
        "showSubject": true,
        "showNotes": true,
        "showPaymentTerms": true,
        "showWarranty": true
      }'::jsonb
    )
    ON CONFLICT ON CONSTRAINT uq_pdf_template_tenant_type_name DO NOTHING;
  END LOOP;
END $$;

-- Gate check
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) > 0
    FROM pdf_templates
    WHERE name = 'Professional Branded Invoice'
      AND layout_key = 'professional_branded_invoice'
      AND document_type = 'INVOICE'
  ), 'GATE FAIL: Professional Branded Invoice template not seeded';
END $$;

SELECT 'Professional Branded Invoice template migration complete.' AS status;
