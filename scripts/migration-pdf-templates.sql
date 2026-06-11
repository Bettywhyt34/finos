/**
 * Migration: PDF Templates
 *
 * Creates pdf_template_document_type_enum and pdf_templates table.
 * Seeds one system "Standard Template" per document type per existing tenant.
 *
 * IDEMPOTENT — safe to run multiple times.
 */

-- ── Enum ──────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE pdf_template_document_type_enum AS ENUM (
    'ESTIMATE',
    'INVOICE',
    'SALES_RECEIPT',
    'CREDIT_NOTE',
    'PAYMENT_RECEIPT',
    'CUSTOMER_STATEMENT',
    'BILL',
    'VENDOR_CREDIT',
    'VENDOR_PAYMENT',
    'VENDOR_STATEMENT',
    'JOURNAL',
    'ADDITIONAL_INFORMATION'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pdf_templates (
  id                TEXT         NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type     pdf_template_document_type_enum NOT NULL,
  name              TEXT         NOT NULL,
  description       TEXT,
  layout_key        TEXT         NOT NULL DEFAULT 'standard',
  is_system         BOOLEAN      NOT NULL DEFAULT false,
  is_default        BOOLEAN      NOT NULL DEFAULT false,
  is_active         BOOLEAN      NOT NULL DEFAULT true,
  config            JSONB        NOT NULL DEFAULT '{}',
  preview_image_url TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_pdf_template_tenant_type_name UNIQUE (tenant_id, document_type, name),
  CONSTRAINT chk_pdf_layout_key CHECK (char_length(layout_key) BETWEEN 1 AND 50)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pdf_templates_tenant_id
  ON pdf_templates (tenant_id);

CREATE INDEX IF NOT EXISTS idx_pdf_templates_tenant_type
  ON pdf_templates (tenant_id, document_type);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_pdf_templates_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pdf_templates_updated_at ON pdf_templates;
CREATE TRIGGER trg_pdf_templates_updated_at
  BEFORE UPDATE ON pdf_templates
  FOR EACH ROW EXECUTE FUNCTION fn_pdf_templates_set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE pdf_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pdf_templates_tenant_isolation ON pdf_templates;
CREATE POLICY pdf_templates_tenant_isolation ON pdf_templates
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- ── Seed system defaults per existing tenant ──────────────────────────────────

DO $$
DECLARE
  t_id UUID;
BEGIN
  FOR t_id IN SELECT id FROM tenants
  LOOP
    INSERT INTO pdf_templates
      (id, tenant_id, document_type, name, description, layout_key, is_system, is_default, is_active)
    VALUES
      (gen_random_uuid()::text, t_id, 'ESTIMATE'::pdf_template_document_type_enum,              'Standard Template', 'Default estimate template',                  'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'INVOICE'::pdf_template_document_type_enum,               'Standard Template', 'Default invoice template',                   'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'SALES_RECEIPT'::pdf_template_document_type_enum,         'Standard Template', 'Default sales receipt template',             'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'CREDIT_NOTE'::pdf_template_document_type_enum,           'Standard Template', 'Default credit note template',               'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'PAYMENT_RECEIPT'::pdf_template_document_type_enum,       'Standard Template', 'Default payment receipt template',           'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'CUSTOMER_STATEMENT'::pdf_template_document_type_enum,    'Standard Template', 'Default customer statement template',        'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'BILL'::pdf_template_document_type_enum,                  'Standard Template', 'Default bill template',                      'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'VENDOR_CREDIT'::pdf_template_document_type_enum,         'Standard Template', 'Default vendor credit template',             'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'VENDOR_PAYMENT'::pdf_template_document_type_enum,        'Standard Template', 'Default vendor payment template',            'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'VENDOR_STATEMENT'::pdf_template_document_type_enum,      'Standard Template', 'Default vendor statement template',          'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'JOURNAL'::pdf_template_document_type_enum,               'Standard Template', 'Default journal template',                   'standard', true, true, true),
      (gen_random_uuid()::text, t_id, 'ADDITIONAL_INFORMATION'::pdf_template_document_type_enum,'Standard Template', 'Default additional information template',    'standard', true, true, true)
    ON CONFLICT ON CONSTRAINT uq_pdf_template_tenant_type_name DO NOTHING;
  END LOOP;
END $$;

-- ── Gate checks ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'pdf_templates'
    )
  ), 'GATE FAIL: pdf_templates table not found';

  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM pg_type WHERE typname = 'pdf_template_document_type_enum'
    )
  ), 'GATE FAIL: pdf_template_document_type_enum not found';

  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name      = 'pdf_templates'
        AND constraint_name = 'uq_pdf_template_tenant_type_name'
        AND constraint_type = 'UNIQUE'
    )
  ), 'GATE FAIL: uq_pdf_template_tenant_type_name constraint not found';

  ASSERT (
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'pdf_templates' AND indexname = 'idx_pdf_templates_tenant_type'
    )
  ), 'GATE FAIL: idx_pdf_templates_tenant_type index not found';
END $$;

SELECT 'PDF templates migration complete — all gates passed.' AS status;
