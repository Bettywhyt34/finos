ALTER TABLE "invoice_line_revenue_allocations"
  ADD COLUMN IF NOT EXISTS "unearned_income_account_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "invoice_line_revenue_allocations"
    ADD CONSTRAINT "invoice_line_revenue_allocations_unearned_income_account_id_fkey"
    FOREIGN KEY ("unearned_income_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "invoice_line_revenue_allocations_unearned_account_idx"
  ON "invoice_line_revenue_allocations"("unearned_income_account_id")
  WHERE "unearned_income_account_id" IS NOT NULL;
