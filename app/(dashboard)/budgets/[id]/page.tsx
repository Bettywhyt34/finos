import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { BudgetGrid } from "./budget-grid";
import { BudgetVersionActions } from "./budget-version-actions";
import { XpenxFlowOverrideDialog } from "./xpenxflow-override-dialog";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default async function BudgetDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { versionId?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  const budget = await prisma.budget.findFirst({
    where: { id: params.id, tenantId: orgId },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          lines: {
            include: { account: { select: { id: true, code: true, name: true, type: true } } },
          },
          approvals: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });

  if (!budget) notFound();

  // Active version
  const activeVersion =
    budget.versions.find((v) => v.id === searchParams.versionId) ?? budget.versions[0];

  if (!activeVersion) notFound();

  // Build account list from lines + all relevant accounts for adding rows
  const accounts = await prisma.chartOfAccounts.findMany({
    where: {
      tenantId: orgId,
      isActive: true,
      type: { in: budget.type === "CAPEX" ? ["ASSET", "EXPENSE"] : ["INCOME", "EXPENSE"] },
    },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: "asc" },
  });

  // Build month columns for the fiscal year
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return budget.fiscalYear + "-" + String(m).padStart(2, "0");
  });

  // Pivot: accountId → { period → amount }
  const lineMap = new Map<string, Map<string, number>>();
  const accountMeta = new Map<string, { code: string; name: string; type: string }>();

  for (const line of activeVersion.lines) {
    if (!lineMap.has(line.accountId)) {
      lineMap.set(line.accountId, new Map());
      accountMeta.set(line.accountId, {
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
      });
    }
    lineMap.get(line.accountId)!.set(line.period, Number(line.amount));
  }

  // Column totals
  const colTotals = months.map((m) =>
    Array.from(lineMap.values()).reduce((s, periods) => s + (periods.get(m) ?? 0), 0)
  );
  const grandTotal = colTotals.reduce((s, v) => s + v, 0);

  const STATUS_COLORS: Record<string, string> = {
    DRAFT: "bg-amber-100 text-amber-700",
    SUBMITTED: "bg-orange-100 text-orange-700",
    APPROVED: "bg-green-100 text-green-700",
    LOCKED: "bg-gray-100 text-gray-600",
  };

  const isEditable = activeVersion.status === "DRAFT";

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{budget.name}</h1>
            <span className={"px-2 py-0.5 rounded text-xs font-medium " + STATUS_COLORS[budget.status]}>
              {budget.status}
            </span>
            <span className="px-2 py-0.5 rounded text-xs bg-muted">{budget.type}</span>
            <span className="text-sm text-muted-foreground">FY{budget.fiscalYear}</span>
          </div>
          {budget.description && (
            <p className="text-sm text-muted-foreground">{budget.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <XpenxFlowOverrideDialog
            budgetId={budget.id}
            versionId={activeVersion.id}
            budgetName={budget.name}
          />
          <BudgetVersionActions
            budget={{ id: budget.id, status: budget.status }}
            version={{ id: activeVersion.id, status: activeVersion.status, versionNumber: activeVersion.versionNumber }}
            approval={activeVersion.approvals[0] ?? null}
          />
        </div>
      </div>

      {/* Version tabs */}
      {budget.versions.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {budget.versions.map((v) => (
            <a
              key={v.id}
              href={"?" + new URLSearchParams({ versionId: v.id })}
              className={
                "px-3 py-1.5 rounded-md text-sm border transition-colors " +
                (v.id === activeVersion.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted/50")
              }
            >
              v{v.versionNumber}: {v.label}
              <span className={"ml-2 px-1.5 rounded text-xs " + STATUS_COLORS[v.status]}>
                {v.status}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Total Budget</p>
          <p className="text-xl font-bold">{formatCurrency(grandTotal)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Monthly Average</p>
          <p className="text-xl font-bold">{formatCurrency(grandTotal / 12)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Account Rows</p>
          <p className="text-xl font-bold">{lineMap.size}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Version</p>
          <p className="text-xl font-bold">v{activeVersion.versionNumber} — {activeVersion.label}</p>
        </div>
      </div>

      {/* Approval history */}
      {activeVersion.approvals.length > 0 && (
        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-sm font-medium">Approval History</p>
          {activeVersion.approvals.map((a) => (
            <div key={a.id} className="flex items-center gap-3 text-sm">
              <span className={"px-2 py-0.5 rounded text-xs font-medium " +
                (a.status === "APPROVED" ? "bg-green-100 text-green-700" :
                 a.status === "REJECTED" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700")}>
                {a.status}
              </span>
              <span>{a.approverName ?? a.approverId}</span>
              {a.comments && <span className="text-muted-foreground">&ldquo;{a.comments}&rdquo;</span>}
            </div>
          ))}
        </div>
      )}

      {/* Monthly grid */}
      <BudgetGrid
        budgetId={budget.id}
        versionId={activeVersion.id}
        accounts={accounts}
        months={months}
        monthNames={MONTH_NAMES}
        initialLines={Object.fromEntries(
          Array.from(lineMap.entries()).map(([accountId, periods]) => [
            accountId,
            Object.fromEntries(periods.entries()),
          ])
        )}
        accountMeta={Object.fromEntries(accountMeta.entries())}
        colTotals={colTotals}
        grandTotal={grandTotal}
        isEditable={isEditable}
      />
    </div>
  );
}
