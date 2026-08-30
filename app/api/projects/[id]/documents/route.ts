import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMutationRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase-server";

const BUCKET = "project-documents";
const MAX_SIZE = 15 * 1024 * 1024;
const CATEGORIES = new Set(["CONTRACT", "PURCHASE_ORDER", "DELIVERY_EVIDENCE", "RECONCILIATION", "CLOSEOUT", "OTHER"]);
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN", "ACCOUNTANT"]);
  if (!ctx) return response;
  const { id: projectId } = await params;

  const project = await prisma.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const title = String(form.get("title") ?? "").trim();
  const category = String(form.get("category") ?? "OTHER");
  if (!file || !title) return NextResponse.json({ error: "Document title and file are required." }, { status: 400 });
  if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Select a valid document category." }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Use a PDF, image, Word, Excel or CSV file." }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_SIZE) return NextResponse.json({ error: "File must be between 1 byte and 15 MB." }, { status: 400 });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "document";
  const storagePath = `${ctx.tenantId}/${projectId}/${randomUUID()}-${safeName}`;
  const supabase = createAdminClient();
  const { data: bucket } = await supabase.storage.getBucket(BUCKET);
  if (!bucket) {
    const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_SIZE,
      allowedMimeTypes: [...ALLOWED_TYPES],
    });
    if (bucketError && !bucketError.message.toLowerCase().includes("already exists")) {
      return NextResponse.json({ error: "Private document storage could not be prepared." }, { status: 500 });
    }
  }

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, await file.arrayBuffer(), {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  try {
    const [document] = await prisma.$transaction(async (tx) => {
      const documents = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "project_documents" (
          "tenant_id", "project_id", "title", "category", "file_name", "storage_path",
          "mime_type", "file_size", "uploaded_by"
        ) VALUES (
          ${ctx.tenantId}::uuid, ${projectId}, ${title}, ${category}, ${file.name},
          ${storagePath}, ${file.type}, ${file.size}, ${ctx.userId}
        ) RETURNING "id"
      `;
      await tx.$executeRaw`
        INSERT INTO "project_activities" (
          "tenant_id", "project_id", "event_type", "title", "description", "actor_id", "actor_name", "metadata"
        ) VALUES (
          ${ctx.tenantId}::uuid, ${projectId}, 'DOCUMENT_ADDED', 'Document added',
          ${title}, ${ctx.userId}, ${ctx.email ?? null},
          CAST(${JSON.stringify({ category, fileName: file.name, documentId: documents[0]?.id })} AS jsonb)
        )
      `;
      return documents;
    });
    return NextResponse.json({ id: document?.id });
  } catch {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: "Document metadata could not be saved." }, { status: 500 });
  }
}
