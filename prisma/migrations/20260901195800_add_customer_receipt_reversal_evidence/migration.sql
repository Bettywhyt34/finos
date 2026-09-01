ALTER TABLE "customer_payments"
  ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" TEXT NULL REFERENCES "journal_entries"("id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_payments_reversal_journal_uidx"
  ON "customer_payments"("reversal_journal_entry_id")
  WHERE "reversal_journal_entry_id" IS NOT NULL;
