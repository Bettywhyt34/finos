import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ReconcileActions } from "./reconcile-actions";

interface SearchParams {
  discrepancy?: string;
  page?: string;
}

export default async function BettyWhytReconcilePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const orgId = session.user.tenantId;

  const showDiscrepancy = searchParams.discrepancy === "1";
  const page = Math.max(1, Number(searchParams.page ?? "1"));
  const PAGE_SIZE = 50;

  // Load all active items with qty data
  const [items, totalCount, lastMovements] = await Promise.all([
    prisma.item.findMany({
      where: {
        tenantId: orgId,
        isActive:       true,
        ...(showDiscrepancy
          ? {
              OR: [
                { qtyOnline: { lt: 0 } },
                { qtyPos:    { lt: 0 } },
              ],
            }
          : {}),
      },
      orderBy: { itemCode: "asc" },
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
      select: {
        id: true, itemCode: true, name: true,
        qtyOnline: true, qtyPos: true, qtyReserved: true,
      },
    }),
    prisma.item.count({
      where: {
        tenantId: orgId,
        isActive:       true,
        ...(showDiscrepancy ? { OR: [{ qtyOnline: { lt: 0 } }, { qtyPos: { lt: 0 } }] } : {}),
      },
    }),
    // Last movement per item (most recent)
    prisma.inventoryMovement.findMany({
      where:   { tenantId: orgId },
      orderBy: { createdAt: "desc" },
      take:    200,
      select:  { itemId: true, movementType: true, channel: true, createdAt: true, sourceApp: true },
    }),
  ]);

  // Map last movement per item
  const lastMoveMap = new Map<string, (typeof lastMovements)[0]>();
  for (const m of lastMovements) {
    if (!lastMoveMap.has(m.itemId)) lastMoveMap.set(m.itemId, m);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Stock Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-1">
            Compare FINOS inventory snapshots with BettyWhyt channels.
          </p>
        </div>
        <Link
          href="/integrations/bettywhyt/status"
          className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          ← Back to Status
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Link
          href="/integrations/bettywhyt/reconcile"
          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
            !showDiscrepancy
              ? "bg-slate-900 text-white border-slate-900"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          All items
        </Link>
        <Link
          href="/integrations/bettywhyt/reconcile?discrepancy=1"
          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
            showDiscrepancy
              ? "bg-slate-900 text-white border-slate-900"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          Discrepancies only
        </Link>
        <span className="text-xs text-slate-400 ml-2">{totalCount} items</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["SKU", "Item Name", "Online Qty", "POS Qty", "Reserved", "Last Movement", "Source", "Status", "Actions"].map(
                (h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase whitespace-nowrap">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-sm text-slate-500 text-center">
                  {showDiscrepancy ? "No discrepancies found." : "No items found."}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const lastMove  = lastMoveMap.get(item.id);
                const hasIssue  = Number(item.qtyOnline) < 0 || Number(item.qtyPos) < 0;

                return (
                  <tr key={item.id} className={`hover:bg-slate-50 ${hasIssue ? "bg-red-50" : ""}`}>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{item.itemCode}</td>
                    <td className="px-4 py-2.5 text-slate-800 max-w-[180px] truncate">{item.name}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${Number(item.qtyOnline) < 0 ? "text-red-600" : "text-slate-700"}`}>
                      {Number(item.qtyOnline).toLocaleString()}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium ${Number(item.qtyPos) < 0 ? "text-red-600" : "text-slate-700"}`}>
                      {Number(item.qtyPos).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-amber-700">
                      {Number(item.qtyReserved).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {lastMove
                        ? `${new Date(lastMove.createdAt).toLocaleDateString("en-NG")} — ${lastMove.movementType}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {lastMove?.sourceApp ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {hasIssue ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-red-100 text-red-700">
                          Discrepancy
                        </span>
                      ) : (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                          OK
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <ReconcileActions itemId={item.id} itemCode={item.itemCode} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/integrations/bettywhyt/reconcile?page=${page - 1}${showDiscrepancy ? "&discrepancy=1" : ""}`}
                  className="px-3 py-1 border border-slate-200 rounded hover:bg-slate-50"
                >
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/integrations/bettywhyt/reconcile?page=${page + 1}${showDiscrepancy ? "&discrepancy=1" : ""}`}
                  className="px-3 py-1 border border-slate-200 rounded hover:bg-slate-50"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
