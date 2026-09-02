-- Money In closure: project-linked credit-note accounting and AR FX carrying-value consumption.

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS fx_unrealized_consumed NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.credit_note_service_allocations
  ADD COLUMN IF NOT EXISTS contract_asset_restored NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.credit_note_service_allocations
  DROP CONSTRAINT IF EXISTS credit_note_service_allocations_split_check;

ALTER TABLE public.credit_note_service_allocations
  ADD CONSTRAINT credit_note_service_allocations_contract_asset_restored_check
    CHECK (contract_asset_restored >= 0),
  ADD CONSTRAINT credit_note_service_allocations_split_check
    CHECK (
      unearned_reversed >= 0
      AND revenue_reversed >= 0
      AND contract_asset_restored >= 0
      AND abs((unearned_reversed + revenue_reversed + contract_asset_restored) - service_base_amount) <= 0.01
    );

CREATE TABLE IF NOT EXISTS public.credit_note_project_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_id TEXT NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  invoice_line_allocation_id UUID NOT NULL REFERENCES public.invoice_line_revenue_allocations(id) ON DELETE RESTRICT,
  source_allocation_id UUID NOT NULL REFERENCES public.revenue_recognition_invoice_allocations(id) ON DELETE RESTRICT,
  source_recognition_id UUID NOT NULL REFERENCES public.project_revenue_recognitions(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_note_project_adjustments_type_check
    CHECK (adjustment_type IN ('CONTRACT_ASSET_RESTORATION','REVENUE_REVERSAL')),
  CONSTRAINT credit_note_project_adjustments_amount_check CHECK (amount > 0),
  CONSTRAINT credit_note_project_adjustments_unique UNIQUE (credit_note_id, source_allocation_id, adjustment_type)
);

CREATE INDEX IF NOT EXISTS credit_note_project_adjustments_credit_idx
  ON public.credit_note_project_adjustments(tenant_id, credit_note_id);
CREATE INDEX IF NOT EXISTS credit_note_project_adjustments_source_idx
  ON public.credit_note_project_adjustments(tenant_id, source_recognition_id, adjustment_type);
CREATE INDEX IF NOT EXISTS credit_note_project_adjustments_line_idx
  ON public.credit_note_project_adjustments(invoice_line_allocation_id);

REVOKE ALL ON TABLE public.credit_note_project_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.credit_note_project_adjustments TO service_role;
