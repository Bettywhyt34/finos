import { NextRequest, NextResponse }              from "next/server";
import { requireAuth }                           from "@/lib/auth/guards";
import { previewEmailNotificationTemplate }      from "@/lib/customization/email-notifications-service";

// POST /api/settings/customization/email-notifications/[templateId]/preview
export async function POST(
  _req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response;

  try {
    const preview = await previewEmailNotificationTemplate(ctx.tenantId, params.templateId);
    return NextResponse.json({ data: preview });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Template not found." ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
