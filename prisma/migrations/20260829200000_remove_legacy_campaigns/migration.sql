-- Remove the superseded campaign structure. Projects are the sole commercial record.
-- This intentionally deletes legacy campaign links and the legacy campaign table.

ALTER TABLE "invoices" DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "bills" DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "revflow_invoices" DROP COLUMN IF EXISTS "campaign_id";

DROP TABLE IF EXISTS "revflow_campaigns";
