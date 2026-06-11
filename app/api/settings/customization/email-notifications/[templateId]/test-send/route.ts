import { NextRequest, NextResponse }         from "next/server";
import { requireMutationRole }              from "@/lib/auth/guards";
import { prisma }                           from "@/lib/prisma";
import { sendEmail }                        from "@/lib/email";
import {
  renderEmailSubject,
  renderEmailBody,
  SAMPLE_CONTEXT,
} from "@/lib/email-notifications/template-renderer";

const TEST_BANNER = `<div style="background:#fef3c7;border:1px solid #fde68a;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-family:sans-serif;font-size:13px">
  <strong>Test email from FINOS.</strong> This was sent only to your account. No real data is included.
</div>`;

// POST /api/settings/customization/email-notifications/[templateId]/test-send
export async function POST(
  _req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response;

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Email provider is not configured." },
      { status: 503 },
    );
  }

  if (!ctx.email) {
    return NextResponse.json(
      { error: "Your account has no email address." },
      { status: 400 },
    );
  }

  const template = await prisma.emailNotificationTemplate.findFirst({
    where: { id: params.templateId, tenantId: ctx.tenantId },
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  try {
    const subject  = "[TEST] " + renderEmailSubject(template.subject, SAMPLE_CONTEXT);
    const bodyHtml = TEST_BANNER + renderEmailBody(template.bodyHtml, SAMPLE_CONTEXT);

    await sendEmail({ to: ctx.email, subject, html: bodyHtml });

    return NextResponse.json({ message: `Test email sent to ${ctx.email}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
