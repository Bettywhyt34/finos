import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { FileText, Plus, Upload, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { formatCurrency, toNGN, cn } from "@/lib/utils";
import { InvoiceListClient } from "./invoice-list-client";

export default async function InvoicesPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    include: { customer: { select: { companyName: true } } },
    orderBy: { createdAt: "desc" },
  });

  // AR total: only invoices that have been sent (exclude DRAFT, VOIDED, WRITTEN_OFF)
  const totalAR = invoices
    .filter((i) => ["SENT", "PARTIAL", "OVERDUE"].includes(i.status))
    .reduce((s, i) => {
      const bal = parseFloat(String(i.balanceDue));
      const rate = parseFloat(String(i.exchangeRate));
      return s + toNGN(bal, rate);
    }, 0);

  const draftCount = invoices.filter((i) => i.status === "DRAFT").length;
  const overdueCount = invoices.filter((i) => i.status === "OVERDUE").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Invoices"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              <FileText className="h-3 w-3" />
              {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
              AR {formatCurrency(totalAR)}
            </span>
            {draftCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
                {draftCount} draft
              </span>
            )}
            {overdueCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                {overdueCount} overdue
              </span>
            )}
          </span>
        }
        icon={FileText}
        color="emerald"
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/sales/invoices/import"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Link>
            <div className="flex items-center gap-1 border border-slate-200 rounded-md overflow-hidden">
              <a
                href="/api/invoices/export?format=finos"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "rounded-none border-r border-slate-200 gap-1.5 h-8 px-3"
                )}
              >
                <Download className="h-3.5 w-3.5" />
                FINOS CSV
              </a>
              <a
                href="/api/invoices/export?format=zoho"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "rounded-none gap-1.5 h-8 px-3"
                )}
              >
                <Download className="h-3.5 w-3.5" />
                Zoho CSV
              </a>
            </div>
            <Link href="/sales/invoices/new" className={buttonVariants()}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Invoice
            </Link>
          </div>
        }
      />

      {invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-emerald-200 rounded-xl bg-emerald-50/40">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
            <FileText className="h-7 w-7 text-emerald-400" />
          </div>
          <p className="text-slate-600 font-medium mb-1">No invoices yet</p>
          <p className="text-sm text-slate-400">Create your first invoice or import from Zoho.</p>
        </div>
      ) : (
        <InvoiceListClient
          invoices={invoices.map((inv) => ({
            ...inv,
            exchangeRate: String(inv.exchangeRate),
            totalAmount: String(inv.totalAmount),
            balanceDue: String(inv.balanceDue),
            sentAt: inv.sentAt ?? null,
            paidAt: inv.paidAt ?? null,
          }))}
        />
      )}
    </div>
  );
}
