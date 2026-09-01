CREATE TABLE IF NOT EXISTS "quotes" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" TEXT NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "quote_number" TEXT NOT NULL,
  "issue_date" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "expiry_date" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "exchange_rate" NUMERIC(15,6) NOT NULL DEFAULT 1,
  "subtotal" NUMERIC(15,2) NOT NULL,
  "discount_amount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "tax_amount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "total_amount" NUMERIC(15,2) NOT NULL,
  "reference" TEXT NULL,
  "order_number" TEXT NULL,
  "notes" TEXT NULL,
  "converted_invoice_id" TEXT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "accepted_at" TIMESTAMPTZ NULL,
  "converted_at" TIMESTAMPTZ NULL,
  "created_by" TEXT NULL,
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotes_status_check" CHECK ("status" IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CONVERTED')),
  CONSTRAINT "quotes_currency_check" CHECK (char_length("currency") = 3),
  CONSTRAINT "quotes_exchange_rate_check" CHECK ("exchange_rate" > 0),
  CONSTRAINT "quotes_subtotal_check" CHECK ("subtotal" >= 0),
  CONSTRAINT "quotes_discount_check" CHECK ("discount_amount" >= 0),
  CONSTRAINT "quotes_tax_check" CHECK ("tax_amount" >= 0),
  CONSTRAINT "quotes_total_check" CHECK ("total_amount" >= 0),
  CONSTRAINT "quotes_dates_check" CHECK ("expiry_date" >= "issue_date")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quotes_tenant_number_uidx" ON "quotes"("tenant_id", "quote_number");
CREATE INDEX IF NOT EXISTS "quotes_customer_idx" ON "quotes"("tenant_id", "customer_id", "issue_date" DESC);
CREATE INDEX IF NOT EXISTS "quotes_status_idx" ON "quotes"("tenant_id", "status", "expiry_date");

CREATE TABLE IF NOT EXISTS "quote_lines" (
  "id" TEXT PRIMARY KEY,
  "quote_id" TEXT NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "item_id" TEXT NULL REFERENCES "items"("id") ON DELETE SET NULL,
  "description" TEXT NOT NULL,
  "quantity" NUMERIC(15,2) NOT NULL,
  "rate" NUMERIC(15,2) NOT NULL,
  "amount" NUMERIC(15,2) NOT NULL,
  "tax_rate_id" UUID NULL REFERENCES "tax_rates"("id") ON DELETE SET NULL,
  "tax_name" TEXT NULL,
  "tax_rate" NUMERIC(5,2) NOT NULL DEFAULT 0,
  "tax_amount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "discount_type" TEXT NOT NULL DEFAULT 'PERCENT',
  "discount_value" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "discount_amount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "line_total" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "income_account_id" TEXT NULL REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL,
  "project_id" TEXT NULL REFERENCES "projects"("id") ON DELETE SET NULL,
  "reporting_tags" JSONB NULL,
  CONSTRAINT "quote_lines_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "quote_lines_rate_check" CHECK ("rate" >= 0),
  CONSTRAINT "quote_lines_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "quote_lines_tax_check" CHECK ("tax_amount" >= 0),
  CONSTRAINT "quote_lines_discount_type_check" CHECK ("discount_type" IN ('PERCENT','FIXED')),
  CONSTRAINT "quote_lines_discount_value_check" CHECK ("discount_value" >= 0),
  CONSTRAINT "quote_lines_discount_amount_check" CHECK ("discount_amount" >= 0),
  CONSTRAINT "quote_lines_total_check" CHECK ("line_total" >= 0)
);

CREATE INDEX IF NOT EXISTS "quote_lines_quote_idx" ON "quote_lines"("quote_id");
CREATE INDEX IF NOT EXISTS "quote_lines_project_idx" ON "quote_lines"("project_id");

ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_lines" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "quotes" FROM anon, authenticated;
REVOKE ALL ON TABLE "quote_lines" FROM anon, authenticated;
