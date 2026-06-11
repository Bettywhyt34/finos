import { NextRequest, NextResponse }     from "next/server";
import { auth }                          from "@/lib/auth";
import { getEmailNotificationTemplates } from "@/lib/customization/email-notifications-service";

// GET /api/settings/customization/email-notifications?category=SALES
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const category = req.nextUrl.searchParams.get("category") ?? undefined;

  try {
    const templates = await getEmailNotificationTemplates(session.user.tenantId!, category);
    return NextResponse.json({ data: templates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
