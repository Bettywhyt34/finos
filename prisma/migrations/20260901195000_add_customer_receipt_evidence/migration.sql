-- Money In: preserve where cash landed, receipt currency/rate, and allocation base-currency evidence.
-- JournalEntry + JournalEntryLine remain the authoritative GL.

ALTER TABLE "customer_payments"
  ADD COLUMN IF NOT EXISTS "bank_account_id" TEXT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS "exchange_rate" NUMERIC(15,6) NOT NULL DEFAULT 1;

ALTER TABLE "customer_payments"
  DROP CONSTRAINT IF EXISTS "customer_payments_currency_check";
ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_currency_check" CHECK (char_length("currency") = 3);

ALTER TABLE "customer_payments"
  DROP CONSTRAINT IF EXISTS "customer_payments_exchange_rate_check";
ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_exchange_rate_check" CHECK ("exchange_rate" > 0);

CREATE INDEX IF NOT EXISTS "customer_payments_bank_account_idx"
  ON "customer_payments"("tenant_id", "bank_account_id", "payment_date" DESC)
  WHERE "bank_account_id" IS NOT NULL;

ALTER TABLE "customer_payment_allocations"
  ADD COLUMN IF NOT EXISTS "base_ar_amount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "base_settlement_amount" NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "customer_payment_allocations"
  DROP CONSTRAINT IF EXISTS "customer_payment_allocations_base_ar_amount_check";
ALTER TABLE "customer_payment_allocations"
  ADD CONSTRAINT "customer_payment_allocations_base_ar_amount_check" CHECK ("base_ar_amount" >= 0);

ALTER TABLE "customer_payment_allocations"
  DROP CONSTRAINT IF EXISTS "customer_payment_allocations_base_settlement_amount_check";
ALTER TABLE "customer_payment_allocations"
  ADD CONSTRAINT "customer_payment_allocations_base_settlement_amount_check" CHECK ("base_settlement_amount" >= 0);
