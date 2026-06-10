/**
 * PATCH  /api/settings/setup-configurations/opening-balances/[batchId]/lines/[lineId]
 * DELETE /api/settings/setup-configurations/opening-balances/[batchId]/lines/[lineId]
 */
import { NextResponse }          from "next/server";
import { z }                     from "zod";
import { auth }                  from "@/lib/auth";
import {
  updateOpeningBalanceLine,
  deleteOpeningBalanceLine,
} from "@/lib/setup-configurations/service";

function canWrite(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const PatchLineSchema = z.object({
  accountId:       z.string().nullable().optional(),
  customerId:      z.string().nullable().optional(),
  vendorId:        z.string().nullable().optional(),
  bankAccountId:   z.string().nullable().optional(),
  label:           z.string().min(1).max(255).optional(),
  accountCategory: z.string().max(100).nullable().optional(),
  currency:        z.string().length(3).optional(),
  exchangeRate:    z.number().positive().optional(),
  debit:           z.number().min(0).optional(),
  credit:          z.number().min(0).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: { batchId: string; lineId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body   = await request.json().catch(() => null);
  const parsed = PatchLineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  if (
    parsed.data.debit  !== undefined &&
    parsed.data.credit !== undefined &&
    parsed.data.debit  > 0 &&
    parsed.data.credit > 0
  ) {
    return NextResponse.json(
      { error: "A line cannot have both a debit and a credit value." },
      { status: 400 },
    );
  }

  try {
    const line = await updateOpeningBalanceLine(
      session.user.tenantId,
      params.batchId,
      params.lineId,
      parsed.data,
    );
    return NextResponse.json({ data: line });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found"))  return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes("Only DRAFT")) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { batchId: string; lineId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteOpeningBalanceLine(
      session.user.tenantId,
      params.batchId,
      params.lineId,
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found"))  return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes("Only DRAFT")) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
