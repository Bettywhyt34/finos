import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function BudgetSettingsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const orgId = session.user.tenantId;

  const [totalBudgets, activeBudgets, overrideLogs] = await Promise.all([
    prisma.budget.count({ where: { tenantId: orgId } }),
    prisma.budget.count({
      where: { tenantId: orgId, status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] } },
    }),
    prisma.budgetOverrideLog.count({
      where: { budget: { tenantId: orgId } },
    }),
  ]);

  const recentOverrides = await prisma.budgetOverrideLog.findMany({
    where: { budget: { tenantId: orgId } },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { budget: { select: { name: true, fiscalYear: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Budget Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure budgeting defaults and XpenxFlow integration
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Budgets", value: totalBudgets },
          { label: "Active Budgets", value: activeBudgets },
          { label: "Override Decisions", value: overrideLogs },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{card.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Approval Workflow */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Approval Workflow</h2>
        <p className="text-sm text-slate-500 mb-4">
          Default workflow for all budget types.
        </p>
        <div className="flex items-center gap-3">
          {["Draft", "Submitted", "Approved", "Locked"].map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm font-medium text-slate-700">
                {step}
              </span>
              {i < 3 && <span className="text-slate-400 text-lg font-light">&#8594;</span>}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Configurable multi-level approval with role-based routing coming in Phase 2.
        </p>
      </div>

      {/* XpenxFlow Integration */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">XpenxFlow Integration</h2>
        <p className="text-sm text-slate-500 mb-4">
          How FINOS resolves budget conflicts with XpenxFlow data.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-sm font-medium text-amber-800">Phase 1.5 — Integration Prep</p>
          <p className="text-sm text-amber-700 mt-1">
            XpenxFlow API connectivity will be configured in Phase 2. Override decisions can be
            recorded manually from each budget&#39;s detail page. All decisions are logged to the
            audit table below.
          </p>
        </div>

        <div className="space-y-2">
          {[
            { label: "Override Threshold Alert", desc: "Alert when XpenxFlow variance exceeds this %" },
            { label: "Auto-import Schedule", desc: "Automatically pull budget data from XpenxFlow" },
            { label: "Webhook URL", desc: "Receive real-time budget updates from XpenxFlow" },
            { label: "API Key", desc: "XpenxFlow API authentication token" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between p-3 border border-slate-200 rounded-lg"
            >
              <div>
                <p className="text-sm font-medium text-slate-700">{item.label}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
              <span className="text-xs text-slate-400 italic bg-slate-50 px-2 py-1 rounded">
                Phase 2
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Override Audit Log */}
      {recentOverrides.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Recent Override Decisions</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Budget</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Decision</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Approved By</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Diff %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recentOverrides.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3 text-sm text-slate-700">
                    <Link href={"/budgets/" + log.budgetId} className="hover:underline">
                      {log.budget.fiscalYear} — {log.budget.name}
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={
                        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium " +
                        (log.overrideType === "KEEP_FINOS"
                          ? "bg-blue-50 text-blue-700"
                          : log.overrideType === "USE_EXTERNAL"
                          ? "bg-orange-50 text-orange-700"
                          : "bg-purple-50 text-purple-700")
                      }
                    >
                      {log.overrideType}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-600">{log.approvedBy}</td>
                  <td className="px-6 py-3 text-sm text-slate-500">
                    {new Date(log.createdAt).toLocaleDateString("en-NG")}
                  </td>
                  <td className="px-6 py-3 text-sm text-right text-slate-600">
                    {log.differencePercent !== null ? Number(log.differencePercent).toFixed(1) + "%" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentOverrides.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500 text-sm">
          No override decisions recorded yet. Use the XpenxFlow Override button on a budget to log decisions.
        </div>
      )}
    </div>
  );
}
