import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { CURRENCY_SYMBOLS } from "@/lib/fx";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  POSTED: "bg-green-100 text-green-700",
  REVERSED: "bg-red-100 text-red-700",
};

export default async function FxRevaluationPage() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  const [revaluations, tenant, customerCreditRows] = await Promise.all([
    prisma.fxRevaluation.findMany({
      where: { tenantId: orgId },
      orderBy: [{ period: "desc" }, { currency: "asc" }],
    }),
    prisma.tenant.findUnique({ where: { id: orgId }, select: { currency: true } }),
    prisma.$queryRaw<Array<{ fxRevaluationId: string; exposure: unknown; gainLoss: unknown }>>`
      SELECT fri."fx_revaluation_id" AS "fxRevaluationId",
             COALESCE(SUM(fri."foreign_balance"),0) AS "exposure",
             COALESCE(SUM(-fri."adjustment_base_amount"),0) AS "gainLoss"
      FROM "fx_revaluation_items" fri
      WHERE fri."tenant_id"=${orgId}::uuid AND fri."item_type"='CUSTOMER_CREDIT'
      GROUP BY fri."fx_revaluation_id"
    `,
  ]);

  const baseCurrency = tenant?.currency.trim().toUpperCase() || "NGN";
  const customerCreditByRevaluation = new Map(customerCreditRows.map((row) => [row.fxRevaluationId, row]));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">FX Revaluation</h1>
          <p className="text-sm text-muted-foreground">
            Formal unrealised FX revaluation of open AR, AP and customer-credit monetary balances · base {baseCurrency}
          </p>
        </div>
        <Link href="/accounting/fx-revaluation/new" className={buttonVariants()}>
          New Revaluation
        </Link>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm min-w-[1180px]">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Period</th>
              <th className="text-left p-3 font-medium">Currency</th>
              <th className="text-right p-3 font-medium">Rate</th>
              <th className="text-right p-3 font-medium">AR Exposure</th>
              <th className="text-right p-3 font-medium">AP Exposure</th>
              <th className="text-right p-3 font-medium">Customer Credits</th>
              <th className="text-right p-3 font-medium">AR G/L</th>
              <th className="text-right p-3 font-medium">AP G/L</th>
              <th className="text-right p-3 font-medium">Credit G/L</th>
              <th className="text-right p-3 font-medium">Net ({baseCurrency})</th>
              <th className="text-left p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {revaluations.length === 0 && (
              <tr>
                <td colSpan={11} className="p-8 text-center text-muted-foreground">
                  No revaluations yet. Create a revaluation when you need to restate open foreign monetary balances at a closing rate.
                </td>
              </tr>
            )}
            {revaluations.map((r) => {
              const customerCredit = customerCreditByRevaluation.get(r.id);
              const creditExposure = Number(customerCredit?.exposure ?? 0);
              const creditGainLoss = Number(customerCredit?.gainLoss ?? 0);
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-3"><Link href={"/accounting/fx-revaluation/" + r.id} className="font-medium hover:underline">{r.period}</Link></td>
                  <td className="p-3 font-medium">{r.currency} {CURRENCY_SYMBOLS[r.currency] ?? ""}</td>
                  <td className="p-3 text-right text-muted-foreground">{Number(r.closingRate).toFixed(4)}</td>
                  <td className="p-3 text-right">{r.currency} {Number(r.arExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                  <td className="p-3 text-right">{r.currency} {Number(r.apExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                  <td className="p-3 text-right">{r.currency} {creditExposure.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                  <td className={"p-3 text-right " + (Number(r.arGainLoss) >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(Number(r.arGainLoss), baseCurrency)}</td>
                  <td className={"p-3 text-right " + (Number(r.apGainLoss) >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(Number(r.apGainLoss), baseCurrency)}</td>
                  <td className={"p-3 text-right " + (creditGainLoss >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(creditGainLoss, baseCurrency)}</td>
                  <td className={"p-3 text-right font-semibold " + (Number(r.unrealizedGainLoss) >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(Number(r.unrealizedGainLoss), baseCurrency)}</td>
                  <td className="p-3"><span className={"px-2 py-0.5 rounded text-xs font-medium " + STATUS_COLORS[r.status]}>{r.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
