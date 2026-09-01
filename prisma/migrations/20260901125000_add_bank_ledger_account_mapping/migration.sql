-- Preserve the exact Chart of Accounts cash/bank account behind each bank account.
ALTER TABLE "bank_accounts"
  ADD COLUMN IF NOT EXISTS "ledger_account_id" TEXT;

ALTER TABLE "bank_accounts"
  DROP CONSTRAINT IF EXISTS "bank_accounts_ledger_account_id_fkey";

ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_ledger_account_id_fkey"
  FOREIGN KEY ("ledger_account_id") REFERENCES "chart_of_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_tenant_ledger_account_unique"
  ON "bank_accounts"("tenant_id", "ledger_account_id")
  WHERE "ledger_account_id" IS NOT NULL;

WITH unique_matches AS (
  SELECT ba."id" AS bank_account_id, MIN(coa."id") AS ledger_account_id
  FROM "bank_accounts" ba
  JOIN "chart_of_accounts" coa
    ON coa."tenant_id" = ba."tenant_id"
   AND LOWER(TRIM(coa."name")) = LOWER(TRIM(ba."account_name"))
   AND coa."type"::text = 'ASSET'
   AND LOWER(COALESCE(coa."subtype", '')) IN ('bank', 'cash')
  WHERE ba."ledger_account_id" IS NULL
  GROUP BY ba."id"
  HAVING COUNT(*) = 1
)
UPDATE "bank_accounts" ba
SET "ledger_account_id" = um.ledger_account_id
FROM unique_matches um
WHERE ba."id" = um.bank_account_id;
