import { NextRequest, NextResponse }                        from "next/server";
import { auth }                                            from "@/lib/auth";
import { restoreEmailNotificationTemplateDefault }         from "@/lib/customization/email-notifications-service";

// POST /api/settings/customization/email-notifications/[templateId]/restore-default
export async function POST(
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
    const row = await restoreEmailNotificationTemplateDefault(
      session.user.tenantId!,
      params.templateId,
    );
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Template not found." ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
