import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase-server";

const BUCKET = "project-documents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response;
  const { id: projectId, documentId } = await params;
  const rows = await prisma.$queryRaw<Array<{ storagePath: string }>>`
    SELECT "storage_path" AS "storagePath" FROM "project_documents"
    WHERE "id" = ${documentId}::uuid AND "project_id" = ${projectId}
      AND "tenant_id" = ${ctx.tenantId}::uuid AND "status" = 'ACTIVE'
  `;
  if (!rows[0]) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(rows[0].storagePath, 60);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Document could not be opened." }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
