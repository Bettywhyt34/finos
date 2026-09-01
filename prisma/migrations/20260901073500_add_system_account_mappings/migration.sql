CREATE TABLE IF NOT EXISTS "system_account_mappings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_account_mappings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "system_account_mappings_tenant_role_key" UNIQUE ("tenant_id", "role"),
  CONSTRAINT "system_account_mappings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "system_account_mappings_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "system_account_mappings_account_id_idx"
  ON "system_account_mappings"("account_id");

ALTER TABLE "system_account_mappings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "system_account_mappings" FROM anon, authenticated;

COMMENT ON TABLE "system_account_mappings" IS
  'FINOS internal accounting-role to chart-of-account mapping. Server-side accounting engine only; not an integration account mapping.';
