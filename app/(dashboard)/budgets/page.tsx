import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatCurrency } from "@/lib/utils";

const TYPE_COLORS: Record<string, string> = {
  OPERATING: "bg-blue-100 text-blue-700",
  CAPEX: "bg-purple-100 text-purple-700",
  CASHFLOW: "bg-cyan-100 text-cyan-700",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700",
  SUBMITTED: "bg-orange-100 text-orange-700",
  APPROVED: "bg-green-100 text-green-700",
  LOCKED: "bg-gray-100 text-gray-600",
};

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: { year?: string; type?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const year = searchParams.year ? parseInt(searchParams.year) : new Date().getFullYear();
  const typeFilter = searchParams.type as "OPERATING" | "CAPEX" | "CASHFLOW" | undefined;

  const budgets = await prisma.budget.findMany({
    where: {
      organizationId: orgId,
      fiscalYear: year,
      ...(typeFilter ? { type: typeFilter } : {}),
    },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: {
          _count: { select: { lines: true } },
        },
      },
      _count: { select: { versions: true } },
    },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
  });

  // Calculate total budget per budget (sum of all lines in latest version)
  const budgetTotals = await prisma.budgetLine.groupBy({
    by: ["budgetVersionId"],
    where: {
      budgetVersionId: { in: budgets.map((b) => b.versions[0]?.id).filter(Boolean) as string[] },
    },
    _sum: { amount: true },
  });
  const totalMap = new Map(budgetTotals.map((t) => [t.budgetVersionId, Number(t._sum.amount ?? 0)]));

  const years = [year - 1, year, year + 1];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budgets</h1>
          <p className="text-sm text-muted-foreground">
            Operating, CapEx and Cash Flow budgets for FY{year}
          </p>
        </div>
        <Link href="/budgets/new" className={buttonVariants()}>
          Create Budget
        </Link>
      </div>

      {/* Filters */}
      <form method="GET" className="flex gap-3 items-end flex-wrap">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Fiscal Year</label>
          <select name="year" defaultValue={year}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <select name="type" defaultValue={typeFilter ?? ""}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm">
            <option value="">All types</option>
            <option value="OPERATING">Operating</option>
            <option value="CAPEX">CapEx</option>
            <option value="CASHFLOW">Cash Flow</option>
          </select>
        </div>
        <button type="submit"
          className={buttonVariants({ variant: "outline", size: "sm" })}>
          Filter
        </button>
      </form>

      {budgets.length === 0 && (
        <div className="rounded-lg border p-12 text-center space-y-3">
          <p className="text-muted-foreground">No budgets for FY{year}</p>
          <Link href="/budgets/new" className={buttonVariants({ variant: "outline" })}>
            Create your first budget
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {budgets.map((b) => {
          const latestVersion = b.versions[0];
          const total = totalMap.get(latestVersion?.id ?? "") ?? 0;
          return (
            <Link
              key={b.id}
              href={"/budgets/" + b.id}
              className="rounded-lg border p-5 space-y-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{b.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">FY{b.fiscalYear}</p>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <span className={"px-2 py-0.5 rounded text-xs font-medium " + TYPE_COLORS[b.type]}>
                    {b.type}
                  </span>
                  <span className={"px-2 py-0.5 rounded text-xs font-medium " + STATUS_COLORS[b.status]}>
                    {b.status}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(total)}</p>
                <p className="text-xs text-muted-foreground">
                  {b._count.versions} version{b._count.versions !== 1 ? "s" : ""} &middot;
                  v{latestVersion?.versionNumber ?? 1}: {latestVersion?.label ?? "Original"}
                </p>
              </div>
              {b.description && (
                <p className="text-xs text-muted-foreground truncate">{b.description}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Created {formatDate(b.createdAt)}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
