/**
 * PATCH  /api/settings/setup-configurations/reminders/[ruleId]
 * DELETE /api/settings/setup-configurations/reminders/[ruleId]
 *
 * PATCH  — update rule fields
 *          (system rules: only isActive / subject / body allowed)
 * DELETE — hard-delete custom rules; system rules blocked (400)
 */
import { NextResponse }  from "next/server";
import { z }             from "zod";
import { auth }          from "@/lib/auth";
import {
  updateReminderRule,
  deleteReminderRule,
} from "@/lib/setup-configurations/service";

type Params = { params: Promise<{ ruleId: string }> };

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const UpdateSchema = z.object({
  name:         z.string().min(1).max(120).optional(),
  description:  z.string().max(500).nullable().optional(),
  triggerBasis: z.enum(["DUE_DATE", "EXPECTED_PAYMENT_DATE", "ISSUE_DATE"]).optional(),
  direction:    z.enum(["BEFORE", "AFTER", "ON_DATE"]).optional(),
  offsetDays:   z.number().int().min(0).max(3650).optional(),
  subject:      z.string().max(300).nullable().optional(),
  body:         z.string().max(2000).nullable().optional(),
  isActive:     z.boolean().optional(),
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can update reminder rules." },
      { status: 403 },
    );
  }

  const body   = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    const { ruleId } = await params;
    const rule = await updateReminderRule(session.user.tenantId, ruleId, parsed.data);
    return NextResponse.json({ data: rule });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (
      message.includes("Unique constraint") ||
      message.includes("uq_tenant_reminder_rule_name")
    ) {
      return NextResponse.json(
        { error: "A reminder rule with this name already exists for this entity type." },
        { status: 409 },
      );
    }
    if (message.includes("System reminder")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can delete reminder rules." },
      { status: 403 },
    );
  }

  try {
    const { ruleId } = await params;
    await deleteReminderRule(session.user.tenantId, ruleId);
    return NextResponse.json({ data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("System reminder")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
