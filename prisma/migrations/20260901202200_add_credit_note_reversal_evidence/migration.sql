ALTER TYPE "CreditNoteStatus" ADD VALUE IF NOT EXISTS 'REVERSED';

ALTER TABLE "credit_notes"
  ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" TEXT NULL REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "reversed_by" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "reversal_reason" TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_reversal_journal_uidx"
  ON "credit_notes"("reversal_journal_entry_id")
  WHERE "reversal_journal_entry_id" IS NOT NULL;
