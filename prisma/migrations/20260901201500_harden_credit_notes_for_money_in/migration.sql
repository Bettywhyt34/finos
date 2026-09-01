ALTER TABLE "credit_notes"
  ALTER COLUMN "invoice_id" SET NOT NULL,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS "exchange_rate" NUMERIC(15,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "base_amount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "journal_entry_id" TEXT NULL REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "applied_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "created_by" TEXT NULL;

ALTER TABLE "credit_notes"
  DROP CONSTRAINT IF EXISTS "credit_notes_customer_id_fkey";
ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT;

ALTER TABLE "credit_notes"
  DROP CONSTRAINT IF EXISTS "credit_notes_invoice_id_fkey";
ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT;

ALTER TABLE "credit_notes"
  DROP CONSTRAINT IF EXISTS "credit_notes_amount_check";
ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_amount_check" CHECK ("amount" > 0);

ALTER TABLE "credit_notes"
  DROP CONSTRAINT IF EXISTS "credit_notes_base_amount_check";
ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_base_amount_check" CHECK ("base_amount" >= 0);

ALTER TABLE "credit_notes"
  DROP CONSTRAINT IF EXISTS "credit_notes_currency_check";
ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_currency_check" CHECK (char_length("currency") = 3);

ALTER TABLE "credit_notes"
  DROP CONSTRAINT IF EXISTS "credit_notes_exchange_rate_check";
ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_exchange_rate_check" CHECK ("exchange_rate" > 0);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_tenant_number_uidx"
  ON "credit_notes"("tenant_id", "credit_number");

CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_journal_entry_uidx"
  ON "credit_notes"("journal_entry_id")
  WHERE "journal_entry_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "credit_notes_invoice_idx"
  ON "credit_notes"("tenant_id", "invoice_id", "issue_date" DESC);

ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "credit_notes" FROM anon, authenticated;
