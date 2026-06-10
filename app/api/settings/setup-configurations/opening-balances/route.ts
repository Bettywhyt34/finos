/**
 * GET  /api/settings/setup-configurations/opening-balances
 * POST /api/settings/setup-configurations/opening-balances
 *
 * GET: returns the tenant's current opening balance batch with lines.
 *      Returns { data: null } when no batch exists.
 *
 * POST: creates a new DRAFT batch.
 *       OWNER / ADMIN only.
 *       409 if a batch already exists (one per tenant rule).
 */
import { NextResponse }          from "next/server";
import { z }                     from "zod";
import { auth }                  from "@/lib/auth";
import {
  getOpeningBalance,
  createOpeningBalanceDraft,
} from "@/lib/setup-configurations/service";

function canWrite(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function canRead(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "ACCOUNTANT";
}

const CreateSchema = z.object({
  migrationDate: z.string().min(1, "Migration date is required"),
  notes:         z.string().max(2000).optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canRead(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const batch = await getOpeningBalance(session.user.tenantId);
  return NextResponse.json({ data: batch ?? null });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canWrite(session.user.role)) {
    return NextResponse.json(
      { error: "Forbidden. Only Owners and Admins can create opening balances." },
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

  // Enforce one batch per tenant
  const existing = await getOpeningBalance(session.user.tenantId);
  if (existing) {
    return NextResponse.json(
      { error: "An opening balance already exists for this organisation. Edit or delete it first." },
      { status: 409 },
    );
  }

  try {
    const migrationDate = new Date(parsed.data.migrationDate);
    if (isNaN(migrationDate.getTime())) {
      return NextResponse.json({ error: "Invalid migration date." }, { status: 400 });
    }

    const batch = await createOpeningBalanceDraft(session.user.tenantId, {
      migrationDate: migrationDate.toISOString(),
      notes:         parsed.data.notes,
    });
    return NextResponse.json({ data: batch }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
