/**
 * POST /api/settings/setup-configurations/reminders/[ruleId]/toggle
 *
 * Toggles the isActive flag on any reminder rule (system or custom).
 */
import { NextResponse }   from "next/server";
import { z }              from "zod";
import { auth }           from "@/lib/auth";
import { toggleReminderRule } from "@/lib/setup-configurations/service";

type Params = { params: Promise<{ ruleId: string }> };

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const ToggleSchema = z.object({
  isActive: z.boolean(),
});

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can toggle reminder rules." },
      { status: 403 },
    );
  }

  const body   = await request.json().catch(() => null);
  const parsed = ToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    const { ruleId } = await params;
    const rule = await toggleReminderRule(
      session.user.tenantId,
      ruleId,
      parsed.data.isActive,
    );
    return NextResponse.json({ data: rule });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
