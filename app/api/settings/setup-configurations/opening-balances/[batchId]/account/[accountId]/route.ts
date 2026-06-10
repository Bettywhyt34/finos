/**
 * GET /api/settings/setup-configurations/opening-balances/[batchId]/account/[accountId]
 *
 * Returns all lines for a specific account category within a batch.
 * [accountId] param is a category slug, e.g. "accounts-receivable".
 *
 * Access: OWNER / ADMIN / ACCOUNTANT.
 */
import { NextResponse }          from "next/server";
import { auth }                  from "@/lib/auth";
import { getOpeningBalance }     from "@/lib/setup-configurations/service";

function canRead(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "ACCOUNTANT";
}

/** Convert "accounts-receivable" → "Accounts Receivable" */
function unslugify(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function GET(
  _request: Request,
  { params }: { params: { batchId: string; accountId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canRead(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const batch = await getOpeningBalance(session.user.tenantId);
  if (!batch || batch.id !== params.batchId) {
    return NextResponse.json({ error: "Opening balance not found." }, { status: 404 });
  }

  const categoryName = unslugify(params.accountId);
  const lines = batch.lines.filter(
    (l) => (l.accountCategory ?? "").toLowerCase() === categoryName.toLowerCase(),
  );

  return NextResponse.json({
    data: {
      batch:    { id: batch.id, migrationDate: batch.migrationDate, status: batch.status },
      category: categoryName,
      lines,
    },
  });
}
