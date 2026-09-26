import { auth } from "@/lib/auth";
import { getFinancialOverview } from "@/lib/dashboard-data";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user.tenantId) return new Response("Unauthorized", { status: 401 });
  const query = new URL(request.url).searchParams;
  const overview = await getFinancialOverview(session.user.tenantId, query.get("periodTo") ?? undefined, query.get("periodFrom") ?? undefined);
  const rows = [["Metric", "NGN"], ["Current ledger cash", overview.cash.total], ["Current overdue receivables at booked rates", overview.attention.overdueInvoiceAmount], ["Current bills due in 7 days including overdue", overview.attention.billsDueAmount], ...Object.entries(overview.performance)];
  return new Response(rows.map(row => row.join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="finos-overview.csv"', "Cache-Control": "no-store" } });
}
