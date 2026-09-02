ALTER TABLE "credit_notes"
  ADD COLUMN IF NOT EXISTS "ar_applied_amount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "customer_credit_amount" NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "credit_notes"
  DROP CONSTRAINT IF EXISTS "credit_notes_ar_applied_amount_check",
  ADD CONSTRAINT "credit_notes_ar_applied_amount_check" CHECK ("ar_applied_amount" >= 0),
  DROP CONSTRAINT IF EXISTS "credit_notes_customer_credit_amount_check",
  ADD CONSTRAINT "credit_notes_customer_credit_amount_check" CHECK ("customer_credit_amount" >= 0),
  DROP CONSTRAINT IF EXISTS "credit_notes_credit_split_check",
  ADD CONSTRAINT "credit_notes_credit_split_check" CHECK (ABS(("ar_applied_amount" + "customer_credit_amount") - "amount") <= 0.01);

CREATE TABLE IF NOT EXISTS "customer_credits" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" TEXT NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "credit_note_id" TEXT NOT NULL UNIQUE REFERENCES "credit_notes"("id") ON DELETE RESTRICT,
  "currency" TEXT NOT NULL,
  "exchange_rate" NUMERIC(15,6) NOT NULL,
  "original_amount" NUMERIC(15,2) NOT NULL,
  "remaining_amount" NUMERIC(15,2) NOT NULL,
  "original_base_amount" NUMERIC(15,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "customer_credits_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "customer_credits_exchange_rate_check" CHECK ("exchange_rate" > 0),
  CONSTRAINT "customer_credits_original_amount_check" CHECK ("original_amount" > 0),
  CONSTRAINT "customer_credits_remaining_amount_check" CHECK ("remaining_amount" >= 0 AND "remaining_amount" <= "original_amount"),
  CONSTRAINT "customer_credits_original_base_amount_check" CHECK ("original_base_amount" > 0),
  CONSTRAINT "customer_credits_status_check" CHECK ("status" IN ('OPEN','CLOSED','REVERSED'))
);

CREATE INDEX IF NOT EXISTS "customer_credits_tenant_customer_open_idx"
  ON "customer_credits" ("tenant_id", "customer_id", "currency", "created_at")
  WHERE "status" = 'OPEN' AND "remaining_amount" > 0;

CREATE INDEX IF NOT EXISTS "customer_credits_tenant_status_idx"
  ON "customer_credits" ("tenant_id", "status", "created_at" DESC);
