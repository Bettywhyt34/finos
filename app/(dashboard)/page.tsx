import { auth } from "@/lib/auth";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  FileText,
  Plus,
  Receipt,
  Clock,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getDashboardKpis,
  getRecentInvoices,
  getRecentBills,
} from "@/lib/dashboard-data";
import { formatDate, cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-50 text-blue-700",
  PARTIAL: "bg-yellow-50 text-yellow-700",
  PAID: "bg-green-50 text-green-700",
  OVERDUE: "bg-red-50 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-500",
  RECORDED: "bg-blue-50 text-blue-700",
};

export default async function DashboardPage() {
  const session = await auth();
  const orgId = session!.user.organizationId!;
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  const [kpis, recentInvoices, recentBills] = await Promise.all([
    getDashboardKpis(orgId),
    getRecentInvoices(orgId),
    getRecentBills(orgId),
  ]);

  const kpiCards = [
    {
      title: "Total Revenue",
      subtitle: "This month",
      value: kpis.totalRevenue,
      icon: TrendingUp,
      iconClass: "text-green-600",
    },
    {
      title: "Outstanding AR",
      subtitle: "Unpaid invoices",
      value: kpis.outstandingAR,
      icon: FileText,
      iconClass: "text-blue-600",
    },
    {
      title: "Outstanding AP",
      subtitle: "Unpaid bills",
      value: kpis.outstandingAP,
      icon: TrendingDown,
      iconClass: "text-orange-500",
    },
    {
      title: "Bank Balance",
      subtitle: "All accounts",
      value: kpis.bankBalance,
      icon: Wallet,
      iconClass: "text-purple-600",
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* DEBUG STRIP — remove after fix */}
      <div className="bg-yellow-300 border-2 border-yellow-500 rounded-lg p-3 text-xs font-mono">
        <span className="font-bold">DEBUG session:</span>{" "}
        org_id=&quot;{session?.user?.organizationId}&quot; &nbsp;|&nbsp;
        org_name=&quot;{(session?.user as Record<string, unknown>)?.org_name as string}&quot; &nbsp;|&nbsp;
        email=&quot;{session?.user?.email}&quot;
      </div>

      {/* Welcome */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Good day, {firstName}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Here&apos;s what&apos;s happening with your business today.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/expenses"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Receipt className="h-4 w-4 mr-1.5" />
            Record Expense
          </Link>
          <Link
            href="/purchases/bills"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Bill
          </Link>
          <Link
            href="/sales/invoices/new"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Invoice
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <Card key={card.title} className="border-slate-200 shadow-none">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-slate-500">
                {card.title}
              </CardTitle>
              <card.icon className={cn("h-4 w-4", card.iconClass)} />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
              <p className="text-xs text-slate-400 mt-1">{card.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <Card className="border-slate-200 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">
              Recent Invoices
            </CardTitle>
            <Link
              href="/customers/invoices"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-xs"
              )}
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentInvoices.length === 0 ? (
              <EmptyState
                icon={FileText}
                message="No invoices yet"
                actionLabel="Create Invoice"
                actionHref="/sales/invoices/new"
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentInvoices.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between px-6 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {inv.customerName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {inv.invoiceNumber} · {formatDate(inv.issueDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          STATUS_STYLES[inv.status] ??
                            "bg-slate-100 text-slate-600"
                        )}
                      >
                        {inv.status}
                      </span>
                      <span className="text-sm font-semibold text-slate-800">
                        {inv.totalAmount}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent Bills */}
        <Card className="border-slate-200 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">
              Recent Bills
            </CardTitle>
            <Link
              href="/vendors/bills"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-xs"
              )}
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentBills.length === 0 ? (
              <EmptyState
                icon={Clock}
                message="No bills recorded"
                actionLabel="Record Bill"
                actionHref="/purchases/bills"
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentBills.map((bill) => (
                  <li
                    key={bill.id}
                    className="flex items-center justify-between px-6 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {bill.vendorName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {bill.billNumber} · {formatDate(bill.billDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          STATUS_STYLES[bill.status] ??
                            "bg-slate-100 text-slate-600"
                        )}
                      >
                        {bill.status}
                      </span>
                      <span className="text-sm font-semibold text-slate-800">
                        {bill.totalAmount}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
  actionLabel,
  actionHref,
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
      <Icon className="h-8 w-8 text-slate-300 mb-2" />
      <p className="text-sm text-slate-400 mb-3">{message}</p>
      <Link
        href={actionHref}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        {actionLabel}
      </Link>
    </div>
  );
}
