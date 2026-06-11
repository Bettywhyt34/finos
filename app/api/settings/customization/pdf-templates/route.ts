import { NextRequest, NextResponse }  from "next/server";
import { z }                          from "zod";
import { requireAuth, requireMutationRole } from "@/lib/auth/guards";
import { getPdfTemplates, createPdfTemplate, PDF_DOC_TYPE_ORDER } from "@/lib/customization/pdf-service";

const CreateSchema = z.object({
  documentType: z.enum(PDF_DOC_TYPE_ORDER as [string, ...string[]]),
  name:         z.string().min(1).max(100),
  description:  z.string().max(300).optional(),
  layoutKey:    z.enum(["standard", "compact", "modern", "classic"]).optional(),
});

// GET /api/settings/customization/pdf-templates?type=INVOICE
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response;

  const type = req.nextUrl.searchParams.get("type") ?? undefined;

  try {
    const rows = await getPdfTemplates(ctx.tenantId, type ?? undefined);
    return NextResponse.json({ data: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/settings/customization/pdf-templates
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  try {
    const row = await createPdfTemplate(ctx.tenantId, parsed.data);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
