import { NextRequest, NextResponse }              from "next/server";
import { auth }                                  from "@/lib/auth";
import { previewEmailNotificationTemplate }      from "@/lib/customization/email-notifications-service";

// POST /api/settings/customization/email-notifications/[templateId]/preview
export async function POST(
  _req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const preview = await previewEmailNotificationTemplate(
      session.user.tenantId!,
      params.templateId,
    );
    return NextResponse.json({ data: preview });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Template not found." ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
