-- Private, server-managed Project documents and immutable Project activity.
CREATE TABLE IF NOT EXISTS "project_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL UNIQUE,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL CHECK ("file_size" > 0),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  "uploaded_by" TEXT NOT NULL,
  "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "archived_by" TEXT,
  "archived_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "project_documents_tenant_project_status_idx"
  ON "project_documents" ("tenant_id", "project_id", "status");

CREATE TABLE IF NOT EXISTS "project_activities" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "event_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "actor_id" TEXT NOT NULL,
  "actor_name" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "project_activities_tenant_project_created_idx"
  ON "project_activities" ("tenant_id", "project_id", "created_at" DESC);

ALTER TABLE "project_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_activities" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "project_documents" FROM anon, authenticated;
REVOKE ALL ON TABLE "project_activities" FROM anon, authenticated;
GRANT ALL ON TABLE "project_documents" TO service_role;
GRANT ALL ON TABLE "project_activities" TO service_role;

COMMENT ON TABLE "project_documents" IS 'Private Project file metadata. File bytes are held in the private project-documents Storage bucket.';
COMMENT ON TABLE "project_activities" IS 'Append-only chronological Project audit events.';
