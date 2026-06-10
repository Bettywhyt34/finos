/**
 * GET  /api/settings/setup-configurations/reminders
 * POST /api/settings/setup-configurations/reminders
 */
import { NextResponse }  from "next/server";
import { z }             from "zod";
import { auth }          from "@/lib/auth";
import {
  getReminderRules,
  createReminderRule,
} from "@/lib/setup-configurations/service";

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const ENTITY_TYPES  = ["INVOICE", "BILL"]                              as const;
const KINDS         = ["MANUAL", "AUTOMATED"]                          as const;
const BASES         = ["DUE_DATE", "EXPECTED_PAYMENT_DATE", "ISSUE_DATE"] as const;
const DIRECTIONS    = ["BEFORE", "AFTER", "ON_DATE"]                   as const;

const CreateSchema = z.object({
  entityType:   z.enum(ENTITY_TYPES),
  kind:         z.enum(KINDS),
  name:         z.string().min(1, "Name is required").max(120),
  description:  z.string().max(500).nullable().optional(),
  triggerBasis: z.enum(BASES),
  direction:    z.enum(DIRECTIONS),
  offsetDays:   z.number().int().min(0).max(3650),
  subject:      z.string().max(300).nullable().optional(),
  body:         z.string().max(2000).nullable().optional(),
  isActive:     z.boolean().optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType") ?? undefined;

  if (entityType && !ENTITY_TYPES.includes(entityType as never)) {
    return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
  }

  const rules = await getReminderRules(session.user.tenantId, entityType);
  return NextResponse.json({ data: rules });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can create reminder rules." },
      { status: 403 },
    );
  }

  const body   = await request.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // EXPECTED_PAYMENT_DATE is only valid for INVOICE
  if (
    parsed.data.triggerBasis === "EXPECTED_PAYMENT_DATE" &&
    parsed.data.entityType   !== "INVOICE"
  ) {
    return NextResponse.json(
      { error: "Expected Payment Date basis is only valid for Invoice reminders." },
      { status: 400 },
    );
  }

  try {
    const rule = await createReminderRule(session.user.tenantId, parsed.data);
    return NextResponse.json({ data: rule }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (
      message.includes("Unique constraint") ||
      message.includes("uq_tenant_reminder_rule_name")
    ) {
      return NextResponse.json(
        { error: "A reminder rule with this name already exists for this entity type." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
