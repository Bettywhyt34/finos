/**
 * POST /api/settings/setup-configurations/opening-balances/[batchId]/finalise
 *
 * Finalises the opening balance:
 *  - Validates DR = CR balance.
 *  - Validates all lines have accountId.
 *  - Posts a balanced opening journal entry via lib/accounting/journals.
 *  - Locks the batch (status → FINALISED).
 *
 * 409 Conflict if unbalanced, missing accounts, or already finalised.
 * OWNER / ADMIN only.
 */
import { NextResponse }          from "next/server";
import { auth }                  from "@/lib/auth";
import {
  finaliseOpeningBalance,
} from "@/lib/setup-configurations/service";

function canWrite(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function POST(
  _request: Request,
  { params }: { params: { batchId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const batch = await finaliseOpeningBalance(
      session.user.tenantId,
      params.batchId,
      session.user.id,
    );
    return NextResponse.json({ data: batch });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";

    // Accounting integrity violations → 409
    if (
      message.includes("not balanced")   ||
      message.includes("no account")     ||
      message.includes("Only DRAFT")     ||
      message.includes("no lines")       ||
      message.includes("period")
    ) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
