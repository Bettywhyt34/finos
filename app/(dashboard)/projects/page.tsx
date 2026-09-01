import Link from "next/link";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";

interface ProjectRow {
  id: string;
  name: string;
  code: string | null;
  status: string;
  currency: string;
  startDate: Date;
  endDate: Date | null;
  contractValue: unknown;
  costBudget: unknown;
  marginTarget: unknown;
  customerName: string;
  revenueEarned: unknown;
  invoiced: unknown;
  costsIncurred: unknown;
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-[var(--surface-muted)] text-[var(--text-secondary)]",
  ACTIVE: "bg-[#E7F2EC] text-[var(--positive)]",
  ON_HOLD: "bg-[#FBF1DF] text-[var(--attention)]",
  COMPLETED: "bg-[#E7F2EC] text-[var(--positive)]",
  CANCELLED: "bg-[#F8EAEA] text-[var(--critical)]",
};

export default async function ProjectsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;
  let projects: ProjectRow[] = [];
  let migrationPending = false;

  try {
    projects = await prisma.$queryRaw<ProjectRow[]>`
      SELECT
        p."id",
        p."name",
        p."code",
        p."status"::text AS "status",
        p."currency",
        p."start_date" AS "startDate",
        p."end_date" AS "endDate",
        p."contract_value" AS "contractValue",
        p."cost_budget" AS "costBudget",
        p."margin_target" AS "marginTarget",
        c."company_name" AS "customerName",
        COALESCE(gl."revenueEarned", 0) AS "revenueEarned",
        COALESCE(billing."invoiced", 0) AS "invoiced",
        COALESCE(gl."costsIncurred", 0) AS "costsIncurred"
      FROM "projects" p
      INNER JOIN "customers" c ON c."id" = p."customer_id"
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(CASE WHEN coa."type" = 'INCOME' THEN jel."credit" - jel."debit" ELSE 0 END), 0) AS "revenueEarned",
          COALESCE(SUM(CASE WHEN coa."type" = 'EXPENSE' THEN jel."debit" - jel."credit" ELSE 0 END), 0) AS "costsIncurred"
        FROM "journal_entry_lines" jel
        INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
        INNER JOIN "chart_of_accounts" coa ON coa."id" = jel."account_id"
        WHERE je."tenant_id" = p."tenant_id"
          AND jel."project_id" = p."id"
          AND je."source" IS DISTINCT FROM 'year-end-close'
      ) gl ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(ila."invoice_amount"), 0) AS "invoiced"
        FROM "invoice_line_revenue_allocations" ila
        INNER JOIN "invoices" i ON i."id" = ila."invoice_id" AND i."tenant_id" = ila."tenant_id"
        WHERE ila."tenant_id" = p."tenant_id"
          AND ila."project_id" = p."id"
          AND i."status" <> 'VOIDED'
      ) billing ON true
      WHERE p."tenant_id" = ${tenantId}
      ORDER BY p."updated_at" DESC
    `;
  } catch {
    migrationPending = true;
  }

  const activeCount = projects.filter((project) => project.status === "ACTIVE").length;
  const revenueEarned = projects.reduce((sum, project) => sum + Number(project.revenueEarned ?? 0), 0);
  const invoiced = projects.reduce((sum, project) => sum + Number(project.invoiced ?? 0), 0);
  const costsIncurred = projects.reduce((sum, project) => sum + Number(project.costsIncurred ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Projects</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Connect commercial value, earned revenue, invoicing, costs and margin.</p>
        </div>
        <Link href="/projects/new" className="flex h-10 items-center gap-2 rounded-lg bg-[var(--finos-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--finos-accent-hover)]">
          <Plus className="h-4 w-4" /> New project
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active projects", String(activeCount)],
          ["Revenue earned", formatCurrency(revenueEarned)],
          ["Invoiced (net)", formatCurrency(invoiced)],
          ["Costs incurred", formatCurrency(costsIncurred)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--app-border)] bg-white p-5">
            <p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p>
            <p className="font-financial mt-3 text-[28px] font-medium text-[var(--text-primary)]">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--text-secondary)]">Portfolio accounting totals are shown in NGN, FINOS&apos;s base ledger currency. Contract values remain in each Project&apos;s own currency.</p>

      {migrationPending ? (
        <div className="rounded-xl border border-[#E7D09F] bg-[#FBF1DF] p-5 text-sm text-[var(--attention)]">
          The Projects database structure could not be read. Review the current Project migrations before continuing.
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
        <div className="border-b border-[var(--app-border)] px-6 py-5">
          <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">All projects</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Period</th>
                <th className="px-5 py-3 text-right font-medium">Contract value</th>
                <th className="px-5 py-3 text-right font-medium">Revenue earned</th>
                <th className="px-5 py-3 text-right font-medium">Invoiced</th>
                <th className="px-5 py-3 text-right font-medium">Costs</th>
                <th className="px-5 py-3 text-right font-medium">Gross margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-border)]">
              {projects.length > 0 ? projects.map((project) => {
                const projectRevenue = Number(project.revenueEarned ?? 0);
                const projectCosts = Number(project.costsIncurred ?? 0);
                return (
                  <tr key={project.id} className="hover:bg-[var(--app-bg)]">
                    <td className="px-5 py-4">
                      <Link href={`/projects/${project.id}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--finos-accent)] hover:underline">
                        {project.name}
                      </Link>
                      {project.code ? <p className="font-code mt-0.5 text-xs text-[var(--text-secondary)]">{project.code}</p> : null}
                    </td>
                    <td className="px-5 py-4 text-[var(--text-primary)]">{project.customerName}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLE[project.status] ?? STATUS_STYLE.DRAFT}`}>
                        {project.status.replace("_", " ").toLowerCase()}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[var(--text-secondary)]">
                      {formatDate(project.startDate)}{project.endDate ? ` – ${formatDate(project.endDate)}` : " – Ongoing"}
                    </td>
                    <td className="tabular-nums px-5 py-4 text-right font-medium text-[var(--text-primary)]">{formatCurrency(Number(project.contractValue), project.currency)}</td>
                    <td className="tabular-nums px-5 py-4 text-right text-[var(--text-primary)]">{formatCurrency(projectRevenue)}</td>
                    <td className="tabular-nums px-5 py-4 text-right text-[var(--text-primary)]">{formatCurrency(Number(project.invoiced ?? 0))}</td>
                    <td className="tabular-nums px-5 py-4 text-right text-[var(--text-primary)]">{formatCurrency(projectCosts)}</td>
                    <td className="tabular-nums px-5 py-4 text-right font-medium text-[var(--text-primary)]">{formatCurrency(projectRevenue - projectCosts)}</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center">
                    <p className="font-serif text-xl text-[var(--text-primary)]">No projects yet</p>
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">Create the first project to connect delivery, billing, revenue and costs.</p>
                    <Link href="/projects/new" className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--finos-accent)] px-4 text-sm font-semibold text-white">
                      <Plus className="h-4 w-4" /> Create project
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
