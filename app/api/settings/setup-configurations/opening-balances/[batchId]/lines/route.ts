/**
 * POST /api/settings/setup-configurations/opening-balances/[batchId]/lines
 *
 * Adds a single line to a DRAFT opening balance batch.
 * OWNER / ADMIN only.
 */
import { NextResponse }          from "next/server";
import { z }                     from "zod";
import { auth }                  from "@/lib/auth";
import {
  addOpeningBalanceLine,
} from "@/lib/setup-configurations/service";

function canWrite(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const LineSchema = z.object({
  lineType:        z.enum(["ACCOUNT", "CUSTOMER", "VENDOR", "BANK"]).default("ACCOUNT"),
  accountId:       z.string().nullable().optional(),
  customerId:      z.string().nullable().optional(),
  vendorId:        z.string().nullable().optional(),
  bankAccountId:   z.string().nullable().optional(),
  label:           z.string().min(1, "Label is required").max(255),
  accountCategory: z.string().max(100).nullable().optional(),
  currency:        z.string().length(3).default("NGN"),
  exchangeRate:    z.number().positive().default(1),
  debit:           z.number().min(0).default(0),
  credit:          z.number().min(0).default(0),
});

export async function POST(
  request: Request,
  { params }: { params: { batchId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body   = await request.json().catch(() => null);
  const parsed = LineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { debit, credit } = parsed.data;
  if (debit > 0 && credit > 0) {
    return NextResponse.json(
      { error: "A line cannot have both a debit and a credit value." },
      { status: 400 },
    );
  }
  if (debit === 0 && credit === 0) {
    return NextResponse.json(
      { error: "At least one of debit or credit must be greater than zero." },
      { status: 400 },
    );
  }

  try {
    const line = await addOpeningBalanceLine(
      session.user.tenantId,
      params.batchId,
      parsed.data,
    );
    return NextResponse.json({ data: line }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found"))  return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes("Only DRAFT")) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
