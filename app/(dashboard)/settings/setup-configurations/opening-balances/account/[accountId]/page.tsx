import { redirect }             from "next/navigation";
import Link                      from "next/link";
import { auth }                  from "@/lib/auth";
import { prisma }                from "@/lib/prisma";
import { getOpeningBalance }     from "@/lib/setup-configurations/service";
import { ChevronLeft }           from "lucide-react";

// Converts slug "accounts-receivable" → "Accounts Receivable"
function unslugify(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

type DrillableCategory = "Accounts Receivable" | "Accounts Payable" | "Bank/Cash";

function getColumnConfig(category: string): {
  nameCol: string;
  showExchangeRate: boolean;
} {
  switch (category) {
    case "Accounts Receivable":
      return { nameCol: "Customer Name",   showExchangeRate: true  };
    case "Accounts Payable":
      return { nameCol: "Vendor Name",     showExchangeRate: true  };
    case "Bank/Cash":
      return { nameCol: "Bank Account",    showExchangeRate: true  };
    default:
      return { nameCol: "Account",         showExchangeRate: false };
  }
}

interface PageProps {
  params: { accountId: string };
}

export default async function OpeningBalanceDrilldownPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");

  const [batch, tenant] = await Promise.all([
    getOpeningBalance(session.user.tenantId),
    prisma.tenant.findUnique({
      where:  { id: session.user.tenantId },
      select: { currency: true },
    }),
  ]);

  if (!batch) {
    redirect("/settings/setup-configurations/opening-balances");
  }

  const tenantCurrency = tenant?.currency ?? "NGN";
  const category       = unslugify(params.accountId);
  const lines          = batch.lines.filter(
    (l) => (l.accountCategory ?? "").toLowerCase() === category.toLowerCase(),
  );

  const { nameCol, showExchangeRate } = getColumnConfig(category);

  const totalDebit  = lines.reduce((s, l) => s + l.debit,  0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">

      {/* Back navigation */}
      <div className="mb-6">
        <Link
          href="/settings/setup-configurations/opening-balances"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Opening Balances
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Opening Balances</h1>
        <p className="text-sm text-slate-500 mt-1">{category}</p>
      </div>

      {/* Summary row */}
      <div className="flex gap-4 mb-6">
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 min-w-[160px]">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Debit</p>
          <p className="text-base font-semibold text-blue-900 tabular-nums">
            {formatCurrency(totalDebit, tenantCurrency)}
          </p>
        </div>
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-5 py-3 min-w-[160px]">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Credit</p>
          <p className="text-base font-semibold text-purple-900 tabular-nums">
            {formatCurrency(totalCredit, tenantCurrency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 min-w-[100px]">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Lines</p>
          <p className="text-base font-semibold text-slate-800">{lines.length}</p>
        </div>
      </div>

      {/* Lines table */}
      {lines.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
          No lines found for &ldquo;{category}&rdquo;.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">
                  {nameCol}
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide w-24">
                  Currency
                </th>
                {showExchangeRate && (
                  <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide w-28">
                    Exchange Rate
                  </th>
                )}
                <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide w-36">
                  Debit
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide w-36">
                  Credit
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.id}
                  className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors"
                >
                  <td className="px-4 py-3 text-slate-800 font-medium">{line.label}</td>
                  <td className="px-4 py-3 text-slate-600">{line.currency}</td>
                  {showExchangeRate && (
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {line.exchangeRate === 1
                        ? <span className="text-slate-300">1.00</span>
                        : line.exchangeRate.toFixed(4)}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {line.debit > 0
                      ? formatCurrency(line.debit, tenantCurrency)
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {line.credit > 0
                      ? formatCurrency(line.credit, tenantCurrency)
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-50">
              <tr>
                <td
                  colSpan={showExchangeRate ? 3 : 2}
                  className="px-4 py-3 text-xs font-semibold text-slate-700 uppercase tracking-wide"
                >
                  Total
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                  {formatCurrency(totalDebit, tenantCurrency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">
                  {formatCurrency(totalCredit, tenantCurrency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
