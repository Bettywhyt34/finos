import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CURRENCY_SYMBOLS } from "@/lib/fx";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  POSTED: "bg-green-100 text-green-700",
  REVERSED: "bg-red-100 text-red-700",
};

export default async function FxRevaluationPage() {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const revaluations = await prisma.fxRevaluation.findMany({
    where: { organizationId: orgId },
    orderBy: [{ period: "desc" }, { currency: "asc" }],
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">FX Revaluation</h1>
          <p className="text-sm text-muted-foreground">
            Month-end unrealised foreign exchange gains and losses
          </p>
        </div>
        <Link href="/accounting/fx-revaluation/new" className={buttonVariants()}>
          New Revaluation
        </Link>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Period</th>
              <th className="text-left p-3 font-medium">Currency</th>
              <th className="text-right p-3 font-medium">Rate</th>
              <th className="text-right p-3 font-medium">AR Exposure</th>
              <th className="text-right p-3 font-medium">AP Exposure</th>
              <th className="text-right p-3 font-medium">AR Gain/Loss</th>
              <th className="text-right p-3 font-medium">AP Gain/Loss</th>
              <th className="text-right p-3 font-medium">Net</th>
              <th className="text-left p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {revaluations.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  No revaluations yet. Run your first month-end revaluation to recognise unrealised FX gains/losses.
                </td>
              </tr>
            )}
            {revaluations.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="p-3">
                  <Link
                    href={"/accounting/fx-revaluation/" + r.id}
                    className="font-medium hover:underline"
                  >
                    {r.period}
                  </Link>
                </td>
                <td className="p-3 font-medium">
                  {r.currency} {CURRENCY_SYMBOLS[r.currency] ?? ""}
                </td>
                <td className="p-3 text-right text-muted-foreground">
                  {Number(r.closingRate).toFixed(4)}
                </td>
                <td className="p-3 text-right">
                  {r.currency}&nbsp;
                  {Number(r.arExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                </td>
                <td className="p-3 text-right">
                  {r.currency}&nbsp;
                  {Number(r.apExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                </td>
                <td
                  className={
                    "p-3 text-right " +
                    (Number(r.arGainLoss) >= 0 ? "text-green-600" : "text-red-600")
                  }
                >
                  {formatCurrency(Number(r.arGainLoss))}
                </td>
                <td
                  className={
                    "p-3 text-right " +
                    (Number(r.apGainLoss) >= 0 ? "text-green-600" : "text-red-600")
                  }
                >
                  {formatCurrency(Number(r.apGainLoss))}
                </td>
                <td
                  className={
                    "p-3 text-right font-semibold " +
                    (Number(r.unrealizedGainLoss) >= 0 ? "text-green-600" : "text-red-600")
                  }
                >
                  {formatCurrency(Number(r.unrealizedGainLoss))}
                </td>
                <td className="p-3">
                  <span
                    className={
                      "px-2 py-0.5 rounded text-xs font-medium " + STATUS_COLORS[r.status]
                    }
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
