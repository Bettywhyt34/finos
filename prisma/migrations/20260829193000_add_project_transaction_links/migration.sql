-- Additive project and reporting-tag links for existing transaction records.
-- Existing rows remain valid because all new link columns are nullable.

ALTER TABLE "invoices"
  ADD COLUMN "order_number" TEXT,
  ADD COLUMN "payment_terms_days" INTEGER,
  ADD COLUMN "recognise_revenue_on_invoice_date" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "invoice_lines"
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "reporting_tags" JSONB;

ALTER TABLE "bill_lines"
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "reporting_tags" JSONB;

ALTER TABLE "expenses"
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "reporting_tags" JSONB;

ALTER TABLE "journal_entry_lines"
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "reporting_tags" JSONB;

ALTER TABLE "journal_lines"
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "reporting_tags" JSONB;

CREATE INDEX "invoice_lines_project_id_idx" ON "invoice_lines"("project_id");
CREATE INDEX "bill_lines_project_id_idx" ON "bill_lines"("project_id");
CREATE INDEX "expenses_project_id_idx" ON "expenses"("project_id");
CREATE INDEX "journal_entry_lines_project_id_idx" ON "journal_entry_lines"("project_id");
CREATE INDEX "journal_lines_project_id_idx" ON "journal_lines"("project_id");

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bill_lines"
  ADD CONSTRAINT "bill_lines_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_payment_terms_days_check"
  CHECK ("payment_terms_days" IS NULL OR "payment_terms_days" >= 0);
