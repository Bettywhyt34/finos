import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Package, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ItemForm } from "./item-form";
import { formatCurrency, cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
  INVENTORY: "bg-blue-100 text-blue-700",
  SERVICE: "bg-purple-100 text-purple-700",
  NON_STOCK: "bg-slate-100 text-slate-600",
};

export default async function ItemsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const [items, categories, accounts] = await Promise.all([
    prisma.item.findMany({
      where: { organizationId, isActive: true },
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    prisma.itemCategory.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Items</h1>
          <p className="text-sm text-slate-500 mt-1">
            {items.length} item{items.length !== 1 ? "s" : ""} ·{" "}
            <Link href="/items/categories" className="hover:underline text-blue-600">Manage categories</Link>
          </p>
        </div>
        <ItemForm categories={categories} accounts={accounts} />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Package className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No items yet</p>
          <p className="text-sm text-slate-400">Add products and services to your catalog.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Code</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Category</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Sales Price</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Cost Price</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.itemCode}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[item.type] || ""}`}>
                      {item.type.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{item.category?.name || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {item.salesPrice ? formatCurrency(parseFloat(String(item.salesPrice))) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {item.costPrice ? formatCurrency(parseFloat(String(item.costPrice))) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/items/${item.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2")}>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
