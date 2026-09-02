ALTER TABLE "credit_notes"
  ADD COLUMN IF NOT EXISTS "service_base_amount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vat_base_amount" NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "credit_notes"
  DROP CONSTRAINT IF EXISTS "credit_notes_base_split_check",
  ADD CONSTRAINT "credit_notes_base_split_check" CHECK (
    "service_base_amount" >= 0 AND "vat_base_amount" >= 0
    AND ABS(("service_base_amount" + "vat_base_amount") - "base_amount") <= 0.01
  );
