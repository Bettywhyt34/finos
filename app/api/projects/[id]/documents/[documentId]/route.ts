import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMutationRole } from "@/lib/auth/guards";

const CATEGORIES = new Set(["CONTRACT", "PURCHASE_ORDER", "DELIVERY_EVIDENCE", "RECONCILIATION", "CLOSEOUT", "OTHER"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN", "ACCOUNTANT"]);
  if (!ctx) return response;
  const { id: projectId, documentId } = await params;
  const body = await req.json().catch(() => null) as { title?: string; category?: string } | null;
  const title = body?.title?.trim();
  const category = body?.category;
  if (!title || !category || !CATEGORIES.has(category)) return NextResponse.json({ error: "Title and category are required." }, { status: 400 });

  const rows = await prisma.$queryRaw<Array<{ title: string; category: string }>>`
    SELECT "title", "category" FROM "project_documents"
    WHERE "id" = ${documentId}::uuid AND "project_id" = ${projectId}
      AND "tenant_id" = ${ctx.tenantId}::uuid AND "status" = 'ACTIVE'
  `;
  const existing = rows[0];
  if (!existing) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "project_documents" SET "title" = ${title}, "category" = ${category}
      WHERE "id" = ${documentId}::uuid AND "project_id" = ${projectId} AND "tenant_id" = ${ctx.tenantId}::uuid
    `;
    await tx.$executeRaw`
      INSERT INTO "project_activities" (
        "tenant_id", "project_id", "event_type", "title", "description", "actor_id", "actor_name", "metadata"
      ) VALUES (
        ${ctx.tenantId}::uuid, ${projectId}, 'DOCUMENT_UPDATED', 'Document details updated',
        ${title}, ${ctx.userId}, ${ctx.email ?? null},
        CAST(${JSON.stringify({ documentId, before: existing, after: { title, category } })} AS jsonb)
      )
    `;
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN", "ACCOUNTANT"]);
  if (!ctx) return response;
  const { id: projectId, documentId } = await params;

  const rows = await prisma.$queryRaw<Array<{ title: string }>>`
    SELECT "title" FROM "project_documents"
    WHERE "id" = ${documentId}::uuid AND "project_id" = ${projectId}
      AND "tenant_id" = ${ctx.tenantId}::uuid AND "status" = 'ACTIVE'
  `;
  if (!rows[0]) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "project_documents"
      SET "status" = 'ARCHIVED', "archived_by" = ${ctx.userId}, "archived_at" = NOW()
      WHERE "id" = ${documentId}::uuid AND "tenant_id" = ${ctx.tenantId}::uuid
    `;
    await tx.$executeRaw`
      INSERT INTO "project_activities" (
        "tenant_id", "project_id", "event_type", "title", "description", "actor_id", "actor_name", "metadata"
      ) VALUES (
        ${ctx.tenantId}::uuid, ${projectId}, 'DOCUMENT_ARCHIVED', 'Document archived',
        ${rows[0].title}, ${ctx.userId}, ${ctx.email ?? null},
        CAST(${JSON.stringify({ documentId })} AS jsonb)
      )
    `;
  });
  return NextResponse.json({ ok: true });
}
