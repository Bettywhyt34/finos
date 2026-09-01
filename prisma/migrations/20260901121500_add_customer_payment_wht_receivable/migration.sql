-- Customer-side withholding tax is a recoverable tax credit / receivable.
ALTER TABLE "customer_payments"
  ADD COLUMN IF NOT EXISTS "wht_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "customer_payments"
  DROP CONSTRAINT IF EXISTS "customer_payments_wht_amount_nonnegative";

ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_wht_amount_nonnegative"
  CHECK ("wht_amount" >= 0);
