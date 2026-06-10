import { NextResponse }                  from "next/server";
import { auth }                         from "@/lib/auth";
import { getTransactionNumberSeries }   from "@/lib/customization/service";

// GET /api/settings/customization/transaction-number-series
// Returns all series rows for the authenticated tenant.
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await getTransactionNumberSeries(session.user.tenantId!);
    return NextResponse.json({ data: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
