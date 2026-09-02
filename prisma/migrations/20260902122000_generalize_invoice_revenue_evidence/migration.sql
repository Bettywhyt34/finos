ALTER TABLE "invoice_line_revenue_allocations"
  ALTER COLUMN "project_id" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "invoice_revenue_recognitions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "invoice_id" TEXT NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "recognition_date" DATE NOT NULL,
  "currency" TEXT NOT NULL,
  "transaction_amount" NUMERIC(15,2) NOT NULL,
  "exchange_rate" NUMERIC(15,6) NOT NULL,
  "base_amount" NUMERIC(15,2) NOT NULL,
  "journal_entry_id" TEXT NOT NULL REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "note" TEXT,
  "created_by" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "reversal_journal_entry_id" TEXT REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "reversed_at" TIMESTAMPTZ,
  "reversed_by" TEXT,
  "reversal_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "invoice_revenue_recognitions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "invoice_revenue_recognitions_amount_check" CHECK ("transaction_amount" > 0 AND "base_amount" > 0),
  CONSTRAINT "invoice_revenue_recognitions_rate_check" CHECK ("exchange_rate" > 0),
  CONSTRAINT "invoice_revenue_recognitions_status_check" CHECK ("status" IN ('POSTED','REVERSED'))
);

CREATE INDEX IF NOT EXISTS "invoice_revenue_recognitions_invoice_idx"
  ON "invoice_revenue_recognitions" ("tenant_id", "invoice_id", "recognition_date", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_revenue_recognitions_journal_idx"
  ON "invoice_revenue_recognitions" ("journal_entry_id");

CREATE TABLE IF NOT EXISTS "invoice_revenue_recognition_allocations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "recognition_id" UUID NOT NULL REFERENCES "invoice_revenue_recognitions"("id") ON DELETE RESTRICT,
  "invoice_line_allocation_id" UUID NOT NULL REFERENCES "invoice_line_revenue_allocations"("id") ON DELETE RESTRICT,
  "base_amount" NUMERIC(15,2) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "invoice_revenue_recognition_allocations_amount_check" CHECK ("base_amount" > 0),
  CONSTRAINT "invoice_revenue_recognition_allocations_unique" UNIQUE ("recognition_id", "invoice_line_allocation_id")
);

CREATE INDEX IF NOT EXISTS "invoice_revenue_recognition_allocations_line_idx"
  ON "invoice_revenue_recognition_allocations" ("tenant_id", "invoice_line_allocation_id");

CREATE TABLE IF NOT EXISTS "credit_note_service_allocations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "credit_note_id" TEXT NOT NULL REFERENCES "credit_notes"("id") ON DELETE RESTRICT,
  "invoice_line_allocation_id" UUID NOT NULL REFERENCES "invoice_line_revenue_allocations"("id") ON DELETE RESTRICT,
  "service_base_amount" NUMERIC(15,2) NOT NULL,
  "unearned_reversed" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "revenue_reversed" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "credit_note_service_allocations_amount_check" CHECK ("service_base_amount" > 0),
  CONSTRAINT "credit_note_service_allocations_split_check" CHECK (
    "unearned_reversed" >= 0 AND "revenue_reversed" >= 0
    AND ABS(("unearned_reversed" + "revenue_reversed") - "service_base_amount") <= 0.01
  ),
  CONSTRAINT "credit_note_service_allocations_unique" UNIQUE ("credit_note_id", "invoice_line_allocation_id")
);

CREATE INDEX IF NOT EXISTS "credit_note_service_allocations_line_idx"
  ON "credit_note_service_allocations" ("tenant_id", "invoice_line_allocation_id");