ALTER TABLE "project_revenue_recognitions"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'POSTED',
  ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "reversed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "reversal_reason" TEXT;

ALTER TABLE "project_revenue_recognitions"
  DROP CONSTRAINT IF EXISTS "project_revenue_recognitions_status_check";
ALTER TABLE "project_revenue_recognitions"
  ADD CONSTRAINT "project_revenue_recognitions_status_check"
  CHECK ("status" IN ('POSTED','REVERSED'));

DO $$ BEGIN
  ALTER TABLE "project_revenue_recognitions"
    ADD CONSTRAINT "project_revenue_recognitions_reversal_journal_entry_id_fkey"
    FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "project_revenue_recognitions_reversal_journal_uidx"
  ON "project_revenue_recognitions"("reversal_journal_entry_id")
  WHERE "reversal_journal_entry_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "project_revenue_recognitions_project_status_idx"
  ON "project_revenue_recognitions"("tenant_id", "project_id", "status", "recognition_date" DESC);
