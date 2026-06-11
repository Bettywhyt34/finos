import { NextRequest, NextResponse }     from "next/server";
import { auth }                          from "@/lib/auth";
import { z }                             from "zod";
import {
  getPdfTemplateById,
  updatePdfTemplate,
  deletePdfTemplate,
} from "@/lib/customization/pdf-service";

const PatchSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(300).optional(),
  layoutKey:   z.enum(["standard", "compact", "modern", "classic"]).optional(),
  isActive:    z.boolean().optional(),
});

// GET /api/settings/customization/pdf-templates/[templateId]
export async function GET(
  _req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const row = await getPdfTemplateById(session.user.tenantId!, params.templateId);
    if (!row) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/settings/customization/pdf-templates/[templateId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any).role as string | undefined;
  if (role !== "OWNER" && role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  try {
    const row = await updatePdfTemplate(session.user.tenantId!, params.templateId, parsed.data);
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Template not found." ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/settings/customization/pdf-templates/[templateId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as any).role as string | undefined;
  if (role !== "OWNER" && role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deletePdfTemplate(session.user.tenantId!, params.templateId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Template not found." ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
