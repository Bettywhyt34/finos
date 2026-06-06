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
  LayoutDashboard,
  CalendarClock,
  BarChart2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  getDashboardKpis,
  getRecentInvoices,
  getRecentBills,
  getAvgInvoiceAge,
  getDsoMetric,
} from "@/lib/dashboard-data";
import { formatDate, cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  DRAFT:       "bg-slate-100 text-slate-600",
  SENT:        "bg-blue-100 text-blue-700",
  PARTIAL:     "bg-yellow-100 text-yellow-700",
  PAID:        "bg-emerald-100 text-emerald-700",
  OVERDUE:     "bg-red-100 text-red-700",
  WRITTEN_OFF: "bg-slate-100 text-slate-500",
  RECORDED:    "bg-blue-100 text-blue-700",
};

type KpiColor = "emerald" | "blue" | "orange" | "violet";
const KPI_COLORS: Record<KpiColor, { accent: string; iconBg: string; iconText: string }> = {
  emerald: { accent: "border-t-emerald-500",  iconBg: "bg-emerald-100",  iconText: "text-emerald-600"  },
  blue:    { accent: "border-t-blue-500",     iconBg: "bg-blue-100",     iconText: "text-blue-600"     },
  orange:  { accent: "border-t-orange-500",   iconBg: "bg-orange-100",   iconText: "text-orange-600"   },
  violet:  { accent: "border-t-violet-500",   iconBg: "bg-violet-100",   iconText: "text-violet-600"   },
};

export default async function DashboardPage() {
  const session = await auth();
  const orgId = session!.user.tenantId!;
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  const [kpis, recentInvoices, recentBills, avgAge, dso] = await Promise.all([
    getDashboardKpis(orgId),
    getRecentInvoices(orgId),
    getRecentBills(orgId),
    getAvgInvoiceAge(orgId),
    getDsoMetric(orgId, 365),
  ]);

  const kpiCards: { title: string; subtitle: string; value: string; icon: React.ComponentType<{ className?: string }>; color: KpiColor }[] = [
    { title: "Total Revenue",   subtitle: "This month",     value: kpis.totalRevenue,   icon: TrendingUp,   color: "emerald" },
    { title: "Outstanding AR",  subtitle: "Unpaid invoices", value: kpis.outstandingAR,  icon: FileText,     color: "blue"    },
    { title: "Outstanding AP",  subtitle: "Unpaid bills",    value: kpis.outstandingAP,  icon: TrendingDown, color: "orange"  },
    { title: "Bank Balance",    subtitle: "All accounts",    value: kpis.bankBalance,    icon: Wallet,       color: "violet"  },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <PageHeader
        title={`Good day, ${firstName}`}
        subtitle="Here's what's happening with your business today."
        icon={LayoutDashboard}
        color="indigo"
        action={
          <div className="flex gap-2">
            <Link href="/expenses" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Receipt className="h-4 w-4 mr-1.5" />
              Record Expense
            </Link>
            <Link href="/purchases/bills/new" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Bill
            </Link>
            <Link href="/sales/invoices/new" className={cn(buttonVariants({ size: "sm" }))}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Invoice
            </Link>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card) => {
          const c = KPI_COLORS[card.color];
          return (
            <Card
              key={card.title}
              className={cn("border-slate-200 shadow-none border-t-4 overflow-hidden", c.accent)}
            >
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-slate-500">
                  {card.title}
                </CardTitle>
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", c.iconBg)}>
                  <card.icon className={cn("h-4 w-4", c.iconText)} />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-slate-900">{card.value}</p>
                <p className="text-xs text-slate-400 mt-1">{card.subtitle}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* AR Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Avg Invoice Age */}
        <Link href="/sales/invoices" className="block group">
          <Card className="border-slate-200 shadow-none border-t-4 border-t-sky-500 overflow-hidden transition-shadow group-hover:shadow-md">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-slate-500">Avg Invoice Age</CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-sky-100">
                <CalendarClock className="h-4 w-4 text-sky-600" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">
                {avgAge > 0 ? `${avgAge} days` : "—"}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Active + paid invoices since sent · click to view
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* DSO */}
        <Link href="/reports/dso" className="block group">
          <Card className="border-slate-200 shadow-none border-t-4 border-t-indigo-500 overflow-hidden transition-shadow group-hover:shadow-md">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-slate-500">Days Sales Outstanding</CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-100">
                <BarChart2 className="h-4 w-4 text-indigo-600" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">
                {dso.dso > 0 ? `${dso.dso} days` : "—"}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                (AR ÷ Revenue) × 365 · click for per-customer breakdown
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <Card className="border-slate-200 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center">
                <FileText className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <CardTitle className="text-base font-semibold">Recent Invoices</CardTitle>
            </div>
            <Link
              href="/sales/invoices"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-xs")}
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentInvoices.length === 0 ? (
              <EmptyState
                icon={FileText}
                iconClass="text-emerald-400"
                iconBg="bg-emerald-50"
                message="No invoices yet"
                actionLabel="Create Invoice"
                actionHref="/sales/invoices/new"
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentInvoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{inv.customerName}</p>
                      <p className="text-xs text-slate-400">
                        {inv.invoiceNumber} · {formatDate(inv.issueDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[inv.status] ?? "bg-slate-100 text-slate-600")}>
                        {inv.status}
                      </span>
                      <span className="text-sm font-semibold text-slate-800">{inv.totalAmount}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent Bills */}
        <Card className="border-slate-200 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-amber-100 flex items-center justify-center">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
              </div>
              <CardTitle className="text-base font-semibold">Recent Bills</CardTitle>
            </div>
            <Link
              href="/purchases/bills"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-xs")}
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentBills.length === 0 ? (
              <EmptyState
                icon={Clock}
                iconClass="text-amber-400"
                iconBg="bg-amber-50"
                message="No bills recorded"
                actionLabel="Record Bill"
                actionHref="/purchases/bills/new"
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentBills.map((bill) => (
                  <li key={bill.id} className="flex items-center justify-between px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{bill.vendorName}</p>
                      <p className="text-xs text-slate-400">
                        {bill.billNumber} · {formatDate(bill.billDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[bill.status] ?? "bg-slate-100 text-slate-600")}>
                        {bill.status}
                      </span>
                      <span className="text-sm font-semibold text-slate-800">{bill.totalAmount}</span>
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
  iconClass,
  iconBg,
  message,
  actionLabel,
  actionHref,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  iconBg: string;
  message: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
      <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-3", iconBg)}>
        <Icon className={cn("h-6 w-6", iconClass)} />
      </div>
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
