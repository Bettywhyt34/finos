-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenant_id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "contract_value" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cost_budget" DECIMAL(15,2),
    "margin_target" DECIMAL(5,2),
    "default_income_account_id" TEXT,
    "contract_asset_account_id" TEXT,
    "unearned_income_account_id" TEXT,
    "billing_schedule" JSONB,
    "reporting_tags" JSONB,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
    CONSTRAINT "projects_contract_value_check" CHECK ("contract_value" >= 0),
    CONSTRAINT "projects_cost_budget_check" CHECK ("cost_budget" IS NULL OR "cost_budget" >= 0),
    CONSTRAINT "projects_margin_target_check" CHECK ("margin_target" IS NULL OR ("margin_target" >= 0 AND "margin_target" <= 100))
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_tenant_id_code_key" ON "projects"("tenant_id", "code");
CREATE INDEX "projects_tenant_id_status_idx" ON "projects"("tenant_id", "status");
CREATE INDEX "projects_tenant_id_customer_id_idx" ON "projects"("tenant_id", "customer_id");
CREATE INDEX "projects_tenant_id_start_date_end_date_idx" ON "projects"("tenant_id", "start_date", "end_date");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_income_account_id_fkey"
  FOREIGN KEY ("default_income_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_contract_asset_account_id_fkey"
  FOREIGN KEY ("contract_asset_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_unearned_income_account_id_fkey"
  FOREIGN KEY ("unearned_income_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase defense in depth: this table is server-only in the current FINOS architecture.
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "projects" FROM anon, authenticated;
