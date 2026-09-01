CREATE TABLE IF NOT EXISTS "tax_settlements" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "tax_type" TEXT NOT NULL CHECK ("tax_type" IN ('VAT','WHT')),
  "tax_period" TEXT NOT NULL CHECK ("tax_period" ~ '^[0-9]{4}-[0-9]{2}$'),
  "settlement_date" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "input_vat_applied" DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK ("input_vat_applied" >= 0),
  "cash_paid" DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK ("cash_paid" >= 0),
  "wht_amount" DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK ("wht_amount" >= 0),
  "reference" TEXT,
  "notes" TEXT,
  "journal_entry_id" TEXT NOT NULL REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL DEFAULT 'POSTED' CHECK ("status" IN ('POSTED','REVERSED')),
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "reversed_at" TIMESTAMPTZ,
  "reversed_by_user_id" TEXT,
  "reversal_reason" TEXT
);

CREATE INDEX IF NOT EXISTS "tax_settlements_tenant_period_idx"
  ON "tax_settlements"("tenant_id", "tax_type", "tax_period");
CREATE INDEX IF NOT EXISTS "tax_settlements_journal_entry_idx"
  ON "tax_settlements"("journal_entry_id");

ALTER TABLE "tax_settlements" ENABLE ROW LEVEL SECURITY;
