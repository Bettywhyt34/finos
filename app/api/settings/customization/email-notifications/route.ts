import { NextRequest, NextResponse }     from "next/server";
import { requireAuth }                  from "@/lib/auth/guards";
import { getEmailNotificationTemplates } from "@/lib/customization/email-notifications-service";

// GET /api/settings/customization/email-notifications?category=SALES
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response;

  const category = req.nextUrl.searchParams.get("category") ?? undefined;

  try {
    const templates = await getEmailNotificationTemplates(ctx.tenantId, category);
    return NextResponse.json({ data: templates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
