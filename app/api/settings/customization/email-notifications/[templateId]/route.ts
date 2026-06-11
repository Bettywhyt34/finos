import { NextRequest, NextResponse }          from "next/server";
import { z }                                  from "zod";
import { requireAuth, requireMutationRole }   from "@/lib/auth/guards";
import {
  getEmailNotificationTemplateById,
  updateEmailNotificationTemplate,
} from "@/lib/customization/email-notifications-service";

const PatchSchema = z.object({
  subject:   z.string().min(1).max(500).optional(),
  bodyHtml:  z.string().min(1).optional(),
  bodyText:  z.string().optional(),
  isEnabled: z.boolean().optional(),
});

// GET /api/settings/customization/email-notifications/[templateId]
export async function GET(
  _req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response;

  try {
    const row = await getEmailNotificationTemplateById(ctx.tenantId, params.templateId);
    if (!row) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/settings/customization/email-notifications/[templateId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  try {
    const row = await updateEmailNotificationTemplate(
      ctx.tenantId,
      params.templateId,
      parsed.data,
    );
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Template not found." ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
