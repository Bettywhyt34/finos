ALTER TABLE "revenue_recognition_invoice_allocations"
  ADD COLUMN IF NOT EXISTS "allocation_type" TEXT;

ALTER TABLE "revenue_recognition_invoice_allocations"
  DROP CONSTRAINT IF EXISTS "revenue_recognition_invoice_allocations_type_check";
ALTER TABLE "revenue_recognition_invoice_allocations"
  ADD CONSTRAINT "revenue_recognition_invoice_allocations_type_check"
  CHECK ("allocation_type" IN ('UNEARNED_RELEASE','CONTRACT_ASSET_CLEARANCE'));

ALTER TABLE "revenue_recognition_invoice_allocations"
  ALTER COLUMN "allocation_type" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "revenue_recognition_invoice_allocations_type_idx"
  ON "revenue_recognition_invoice_allocations"("allocation_type", "recognition_id");
