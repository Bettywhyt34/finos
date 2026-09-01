-- Sync the Project revenue-recognition schema already applied to the FINOS database.
-- These tables are server-only accounting evidence tables; JournalEntry + JournalEntryLine
-- remain the authoritative general ledger.

CREATE TABLE IF NOT EXISTS "project_revenue_recognitions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "recognition_date" DATE NOT NULL,
  "amount" NUMERIC(15,2) NOT NULL CHECK ("amount" > 0),
  "unearned_used" NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK ("unearned_used" >= 0),
  "contract_asset_created" NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK ("contract_asset_created" >= 0),
  "currency" TEXT NOT NULL,
  "income_account_id" TEXT NOT NULL REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT,
  "unearned_income_account_id" TEXT REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT,
  "contract_asset_account_id" TEXT REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT,
  "journal_entry_id" TEXT NOT NULL UNIQUE REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "note" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "project_revenue_recognition_split_check"
    CHECK (abs(("unearned_used" + "contract_asset_created") - "amount") < 0.01)
);

CREATE INDEX IF NOT EXISTS "project_revenue_recognitions_project_date_idx"
  ON "project_revenue_recognitions"("tenant_id", "project_id", "recognition_date");

CREATE TABLE IF NOT EXISTS "invoice_line_revenue_allocations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "invoice_id" TEXT NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "invoice_line_id" TEXT NOT NULL UNIQUE REFERENCES "invoice_lines"("id") ON DELETE RESTRICT,
  "income_account_id" TEXT NOT NULL REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT,
  "currency" TEXT NOT NULL,
  "invoice_amount" NUMERIC(15,2) NOT NULL CHECK ("invoice_amount" >= 0),
  "contract_asset_cleared" NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK ("contract_asset_cleared" >= 0),
  "immediate_revenue" NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK ("immediate_revenue" >= 0),
  "unearned_created" NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK ("unearned_created" >= 0),
  "posted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "invoice_line_revenue_allocation_split_check"
    CHECK (abs(("contract_asset_cleared" + "immediate_revenue" + "unearned_created") - "invoice_amount") < 0.01)
);

CREATE INDEX IF NOT EXISTS "invoice_line_revenue_allocations_project_idx"
  ON "invoice_line_revenue_allocations"("tenant_id", "project_id");
CREATE INDEX IF NOT EXISTS "invoice_line_revenue_allocations_invoice_idx"
  ON "invoice_line_revenue_allocations"("tenant_id", "invoice_id");

CREATE TABLE IF NOT EXISTS "revenue_recognition_invoice_allocations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "recognition_id" UUID NOT NULL REFERENCES "project_revenue_recognitions"("id") ON DELETE CASCADE,
  "invoice_line_allocation_id" UUID NOT NULL REFERENCES "invoice_line_revenue_allocations"("id") ON DELETE RESTRICT,
  "amount" NUMERIC(15,2) NOT NULL CHECK ("amount" > 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("recognition_id", "invoice_line_allocation_id")
);

CREATE INDEX IF NOT EXISTS "revenue_recognition_invoice_allocations_recognition_idx"
  ON "revenue_recognition_invoice_allocations"("recognition_id");
CREATE INDEX IF NOT EXISTS "revenue_recognition_invoice_allocations_line_idx"
  ON "revenue_recognition_invoice_allocations"("invoice_line_allocation_id");

ALTER TABLE "project_revenue_recognitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_line_revenue_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revenue_recognition_invoice_allocations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "project_revenue_recognitions" FROM anon, authenticated;
REVOKE ALL ON TABLE "invoice_line_revenue_allocations" FROM anon, authenticated;
REVOKE ALL ON TABLE "revenue_recognition_invoice_allocations" FROM anon, authenticated;
