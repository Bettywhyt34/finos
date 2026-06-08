/**
 * PATCH  /api/settings/setup-configurations/payment-terms/[termId]
 * DELETE /api/settings/setup-configurations/payment-terms/[termId]
 *
 * PATCH  — update name, dueType, dueInDays, appliesTo, isDefault, isActive
 *          (system terms: only isDefault and isActive allowed)
 * DELETE — soft-deactivate (sets isActive = false); system terms are blocked
 */
import { NextResponse }  from "next/server";
import { z }             from "zod";
import { auth }          from "@/lib/auth";
import {
  updatePaymentTerm,
  deactivatePaymentTerm,
} from "@/lib/setup-configurations/service";

type Params = { params: Promise<{ termId: string }> };

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const UpdateSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  dueType:   z.enum(["DUE_ON_RECEIPT", "FIXED_DAYS", "END_OF_MONTH", "END_OF_NEXT_MONTH"]).optional(),
  dueInDays: z.number().int().min(0).max(365).nullable().optional(),
  appliesTo: z.enum(["CUSTOMERS", "VENDORS", "BOTH"]).optional(),
  isDefault: z.boolean().optional(),
  isActive:  z.boolean().optional(),
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can update payment terms." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // If switching to FIXED_DAYS, dueInDays must be provided in the same request
  if (
    parsed.data.dueType === "FIXED_DAYS" &&
    parsed.data.dueInDays == null
  ) {
    return NextResponse.json(
      { error: "Due In Days is required when Due Type is Fixed number of days." },
      { status: 400 },
    );
  }

  try {
    const { termId } = await params;
    const term = await updatePaymentTerm(session.user.tenantId, termId, parsed.data);
    return NextResponse.json({ data: term });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Unique constraint") || message.includes("uq_tenant_payment_term_name")) {
      return NextResponse.json(
        { error: "A payment term with this name already exists." },
        { status: 409 },
      );
    }
    if (message.includes("cannot")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE (soft deactivate) ──────────────────────────────────────────────────

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can deactivate payment terms." },
      { status: 403 },
    );
  }

  try {
    const { termId } = await params;
    await deactivatePaymentTerm(session.user.tenantId, termId);
    return NextResponse.json({ data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("System") || message.includes("Cannot")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
