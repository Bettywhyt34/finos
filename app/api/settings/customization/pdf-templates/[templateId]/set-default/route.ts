import { NextRequest, NextResponse }  from "next/server";
import { requireMutationRole }       from "@/lib/auth/guards";
import { setDefaultPdfTemplate }     from "@/lib/customization/pdf-service";

// POST /api/settings/customization/pdf-templates/[templateId]/set-default
export async function POST(_req: NextRequest, props: { params: Promise<{ templateId: string }> }) {
  const params = await props.params;
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response;

  try {
    const row = await setDefaultPdfTemplate(ctx.tenantId, params.templateId);
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Template not found." ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
