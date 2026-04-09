import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Users, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CustomerForm } from "./customer-form";
import { formatCurrency, cn } from "@/lib/utils";

export default async function CustomersPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const customers = await prisma.customer.findMany({
    where: { organizationId, isActive: true },
    include: {
      invoices: { select: { totalAmount: true, amountPaid: true } },
    },
    orderBy: { companyName: "asc" },
  });

  const totalBalance = customers.reduce((sum, c) => {
    const invoiced = c.invoices.reduce((s, i) => s + parseFloat(String(i.totalAmount)), 0);
    const paid = c.invoices.reduce((s, i) => s + parseFloat(String(i.amountPaid)), 0);
    return sum + (invoiced - paid);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500 mt-1">
            {customers.length} customer{customers.length !== 1 ? "s" : ""} ·
            AR Balance: {formatCurrency(totalBalance)}
          </p>
        </div>
        <CustomerForm />
      </div>

      {customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Users className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No customers yet</p>
          <p className="text-sm text-slate-400">Add your first customer to start invoicing.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Code</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Company</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Terms</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => {
                const invoiced = c.invoices.reduce((s, i) => s + parseFloat(String(i.totalAmount)), 0);
                const paid = c.invoices.reduce((s, i) => s + parseFloat(String(i.amountPaid)), 0);
                const balance = invoiced - paid;
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.customerCode}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{c.companyName}</td>
                    <td className="px-4 py-3 text-slate-600">{c.contactName || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{c.email || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{c.paymentTerms}d</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      <span className={balance > 0 ? "text-amber-600" : "text-slate-900"}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${c.id}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2")}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
