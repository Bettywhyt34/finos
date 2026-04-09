-- Journal entry enhancements migration
-- Run this in Supabase SQL Editor (Settings → SQL Editor)

-- Add attachment_url and reversal_reason to journal_entries
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'journal_entries'
  AND column_name IN ('attachment_url', 'reversal_reason', 'is_reversing', 'reversed_by_id')
ORDER BY column_name;
