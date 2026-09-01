-- Purchase-side tax snapshots for recoverable/input VAT.
ALTER TABLE "bill_lines"
  ADD COLUMN IF NOT EXISTS "tax_rate_id" UUID,
  ADD COLUMN IF NOT EXISTS "tax_name" TEXT,
  ADD COLUMN IF NOT EXISTS "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "bill_lines"
  DROP CONSTRAINT IF EXISTS "bill_lines_tax_rate_id_fkey";

ALTER TABLE "bill_lines"
  ADD CONSTRAINT "bill_lines_tax_rate_id_fkey"
  FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "bill_lines_tax_rate_id_idx"
  ON "bill_lines"("tax_rate_id");
