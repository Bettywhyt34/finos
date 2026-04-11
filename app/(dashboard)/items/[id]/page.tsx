import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Package } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
  INVENTORY: "bg-blue-100 text-blue-700",
  SERVICE: "bg-purple-100 text-purple-700",
  NON_STOCK: "bg-slate-100 text-slate-600",
};

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const item = await prisma.item.findFirst({
    where: { id, tenantId },
    include: {
      category: true,
      invoiceLines: {
        include: { invoice: { select: { invoiceNumber: true, issueDate: true, status: true, customer: { select: { companyName: true } } } } },
        orderBy: { id: "desc" },
        take: 20,
      },
    },
  });

  if (!item) notFound();

  // Resolve account names for the 3 optional account IDs
  const accountIds = [item.incomeAccountId, item.expenseAccountId, item.assetAccountId].filter(Boolean) as string[];
  const accounts = accountIds.length
    ? await prisma.chartOfAccounts.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, code: true, name: true },
      })
    : [];
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, `${a.code} — ${a.name}`]));

  const totalSold = item.invoiceLines.reduce((s, l) => s + parseFloat(String(l.amount)), 0);
  const qtyTotal = parseFloat(String(item.qtyOnline)) + parseFloat(String(item.qtyPos));

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link href="/items" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Items
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-900">{item.name}</span>
        <span className="font-mono text-xs text-slate-400">{item.itemCode}</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[item.type] || ""}`}>
          {item.type.replace("_", " ")}
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Sales Price</p>
          <p className="text-2xl font-bold font-mono text-slate-900">
            {item.salesPrice ? formatCurrency(parseFloat(String(item.salesPrice))) : "—"}
          </p>
        </div>
        <div className="border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Cost Price</p>
          <p className="text-2xl font-bold font-mono text-slate-900">
            {item.costPrice ? formatCurrency(parseFloat(String(item.costPrice))) : "—"}
          </p>
        </div>
        {item.type === "INVENTORY" ? (
          <div className="border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">Stock On Hand</p>
            <p className="text-2xl font-bold font-mono text-slate-900">
              {qtyTotal.toFixed(2)} <span className="text-sm font-normal text-slate-400">{item.unit}</span>
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">Total Billed</p>
            <p className="text-2xl font-bold font-mono text-green-600">{formatCurrency(totalSold)}</p>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="border border-slate-200 rounded-xl p-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-500 mb-0.5">Category</p>
          <p className="font-medium text-slate-900">{item.category?.name || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Unit</p>
          <p className="font-medium text-slate-900">{item.unit}</p>
        </div>
        {item.incomeAccountId && (
          <div>
            <p className="text-slate-500 mb-0.5">Income Account</p>
            <p className="font-medium text-slate-900 font-mono text-xs">{accountMap[item.incomeAccountId] || item.incomeAccountId}</p>
          </div>
        )}
        {item.expenseAccountId && (
          <div>
            <p className="text-slate-500 mb-0.5">Expense Account</p>
            <p className="font-medium text-slate-900 font-mono text-xs">{accountMap[item.expenseAccountId] || item.expenseAccountId}</p>
          </div>
        )}
        {item.assetAccountId && (
          <div>
            <p className="text-slate-500 mb-0.5">Asset Account</p>
            <p className="font-medium text-slate-900 font-mono text-xs">{accountMap[item.assetAccountId] || item.assetAccountId}</p>
          </div>
        )}
        {item.type === "INVENTORY" && (
          <>
            <div>
              <p className="text-slate-500 mb-0.5">Qty Online</p>
              <p className="font-medium text-slate-900">{parseFloat(String(item.qtyOnline)).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-0.5">Qty POS</p>
              <p className="font-medium text-slate-900">{parseFloat(String(item.qtyPos)).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-0.5">Qty Reserved</p>
              <p className="font-medium text-slate-900">{parseFloat(String(item.qtyReserved)).toFixed(2)}</p>
            </div>
          </>
        )}
        {item.description && (
          <div className="col-span-2">
            <p className="text-slate-500 mb-0.5">Description</p>
            <p className="font-medium text-slate-900">{item.description}</p>
          </div>
        )}
      </div>

      {/* Recent usage on invoices */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Recent Invoice Lines</h2>
        </div>
        {item.invoiceLines.length === 0 ? (
          <div className="flex flex-col items-center py-10 border border-dashed border-slate-200 rounded-xl">
            <Package className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">Not used on any invoices yet</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Invoice</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Customer</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Qty</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {item.invoiceLines.map((line) => (
                  <tr key={line.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/sales/invoices/${line.invoiceId}`} className="text-blue-600 hover:underline font-mono text-xs">
                        {line.invoice.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{line.invoice.customer?.companyName || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{formatDate(line.invoice.issueDate)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        {line.invoice.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{parseFloat(String(line.quantity)).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(line.amount)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
