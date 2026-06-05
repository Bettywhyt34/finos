import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InventoryMovementsExport } from "./inventory-movements-export";

const MOVEMENT_LABELS: Record<string, string> = {
  SALE_ONLINE:  "Sale (Online)",
  SALE_POS:     "Sale (POS)",
  RECEIPT:      "Stock Receipt",
  ADJUSTMENT:   "Adjustment",
  RESERVATION:  "Reservation",
  RELEASE:      "Release",
};

const CHANNEL_LABELS: Record<string, string> = {
  ONLINE: "Online",
  POS:    "POS",
  BOTH:   "Both",
};

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; type?: string; channel?: string };
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const tenantId = session.user.tenantId;

  // Date range defaults: last 30 days
  const toDate   = searchParams.to   ? new Date(searchParams.to)   : new Date();
  const fromDate = searchParams.from ? new Date(searchParams.from)  : new Date(toDate.getTime() - 30 * 86_400_000);
  toDate.setHours(23, 59, 59, 999);
  fromDate.setHours(0, 0, 0, 0);

  const typeFilter    = searchParams.type    ?? "";
  const channelFilter = searchParams.channel ?? "";

  const where: Prisma.InventoryMovementWhereInput = {
    tenantId,
    createdAt: { gte: fromDate, lte: toDate },
    ...(typeFilter    ? { movementType: typeFilter }    : {}),
    ...(channelFilter ? { channel:      channelFilter } : {}),
  };

  const movements = await prisma.inventoryMovement.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      item: { select: { itemCode: true, name: true } },
    },
  });

  // Summary stats
  const totalIn  = movements.filter((m) => Number(m.quantity) > 0).reduce((s, m) => s + Number(m.quantity), 0);
  const totalOut = movements.filter((m) => Number(m.quantity) < 0).reduce((s, m) => s + Number(m.quantity), 0);
  const net      = totalIn + totalOut;

  // Distinct filter options
  const allTypes    = Array.from(new Set(movements.map((m) => m.movementType)));
  const allChannels = Array.from(new Set(movements.map((m) => m.channel)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory Movements</h1>
          <p className="text-sm text-slate-500 mt-1">
            All stock movements across online and POS channels.
          </p>
        </div>
        <InventoryMovementsExport movements={movements} />
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">From</label>
          <input
            type="date"
            name="from"
            defaultValue={fromDate.toISOString().slice(0, 10)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">To</label>
          <input
            type="date"
            name="to"
            defaultValue={toDate.toISOString().slice(0, 10)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Type</label>
          <select
            name="type"
            defaultValue={typeFilter}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">All types</option>
            {allTypes.map((t) => (
              <option key={t} value={t}>{MOVEMENT_LABELS[t] ?? t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Channel</label>
          <select
            name="channel"
            defaultValue={channelFilter}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">All channels</option>
            {allChannels.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c] ?? c}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="px-4 py-1.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-700 rounded-md transition-colors"
        >
          Apply
        </button>
      </form>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Records",    value: movements.length.toLocaleString(),                    color: "text-slate-900" },
          { label: "Stock In",   value: `+${totalIn.toLocaleString()}`,                       color: "text-emerald-700" },
          { label: "Stock Out",  value: totalOut.toLocaleString(),                             color: "text-red-600" },
          { label: "Net Movement", value: (net >= 0 ? "+" : "") + net.toLocaleString(),       color: net >= 0 ? "text-emerald-700" : "text-red-600" },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{card.label}</p>
            <p className={`mt-1 text-lg font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Movements table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">
            {movements.length} movement{movements.length !== 1 ? "s" : ""}
          </h2>
        </div>

        {movements.length === 0 ? (
          <p className="px-6 py-10 text-sm text-slate-500 text-center">
            No inventory movements found for the selected period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  {["Date", "SKU", "Item", "Type", "Channel", "Qty", "Unit Cost", "Reference", "Source"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {movements.map((m) => {
                  const qty = Number(m.quantity);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                        {m.createdAt.toLocaleDateString("en-NG")}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                        {m.item.itemCode}
                      </td>
                      <td className="px-4 py-2.5 text-slate-800 max-w-[200px] truncate">
                        {m.item.name}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 whitespace-nowrap">
                          {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs rounded px-1.5 py-0.5 whitespace-nowrap ${
                          m.channel === "POS"
                            ? "bg-violet-100 text-violet-700"
                            : m.channel === "ONLINE"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-slate-100 text-slate-600"
                        }`}>
                          {CHANNEL_LABELS[m.channel] ?? m.channel}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${qty >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                        {qty >= 0 ? `+${qty.toLocaleString()}` : qty.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {m.unitCost ? `₦${Number(m.unitCost).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">
                        {m.reference ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs">
                        {m.sourceApp ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
