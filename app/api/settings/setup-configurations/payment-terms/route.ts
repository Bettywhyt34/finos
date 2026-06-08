/**
 * GET  /api/settings/setup-configurations/payment-terms
 * POST /api/settings/setup-configurations/payment-terms
 */
import { NextResponse }    from "next/server";
import { z }               from "zod";
import { auth }            from "@/lib/auth";
import {
  getPaymentTerms,
  createPaymentTerm,
} from "@/lib/setup-configurations/service";

function isAdmin(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const CreateSchema = z.object({
  name:      z.string().min(1, "Term name is required").max(100),
  dueType:   z.enum(["DUE_ON_RECEIPT", "FIXED_DAYS", "END_OF_MONTH", "END_OF_NEXT_MONTH"]),
  dueInDays: z.number().int().min(0).max(365).nullable().optional(),
  appliesTo: z.enum(["CUSTOMERS", "VENDORS", "BOTH"]).optional(),
  isDefault: z.boolean().optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const terms = await getPaymentTerms(session.user.tenantId);
  return NextResponse.json({ data: terms });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can create payment terms." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { dueType, dueInDays } = parsed.data;

  // dueInDays is required when dueType = FIXED_DAYS
  if (dueType === "FIXED_DAYS" && (dueInDays == null || dueInDays < 0)) {
    return NextResponse.json(
      { error: "Due In Days is required for Fixed number of days terms." },
      { status: 400 },
    );
  }

  try {
    const term = await createPaymentTerm(session.user.tenantId, {
      name:      parsed.data.name,
      dueType,
      dueInDays: dueType === "FIXED_DAYS" ? (dueInDays ?? 0) : null,
      appliesTo: parsed.data.appliesTo ?? "BOTH",
      isDefault: parsed.data.isDefault ?? false,
    });
    return NextResponse.json({ data: term }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    // Prisma unique constraint violation
    if (message.includes("Unique constraint") || message.includes("uq_tenant_payment_term_name")) {
      return NextResponse.json(
        { error: "A payment term with this name already exists." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
