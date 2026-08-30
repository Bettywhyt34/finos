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
        c."company_name" AS "customerName"
      FROM "projects" p
      INNER JOIN "customers" c ON c."id" = p."customer_id"
      WHERE p."tenant_id" = ${tenantId}
      ORDER BY p."updated_at" DESC
    `;
  } catch {
    migrationPending = true;
  }

  const activeCount = projects.filter((project) => project.status === "ACTIVE").length;
  const draftCount = projects.filter((project) => project.status === "DRAFT").length;
  const contractValue = projects.reduce((sum, project) => sum + Number(project.contractValue ?? 0), 0);
  const plannedCost = projects.reduce((sum, project) => sum + Number(project.costBudget ?? 0), 0);
  const defaultCurrency = projects[0]?.currency ?? "NGN";

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">Projects</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Connect commercial value, revenue, invoicing, collections, costs and margin.</p>
        </div>
        <Link href="/projects/new" className="flex h-10 items-center gap-2 rounded-lg bg-[var(--finos-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--finos-accent-hover)]">
          <Plus className="h-4 w-4" /> New project
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active projects", String(activeCount)],
          ["Draft projects", String(draftCount)],
          ["Contract value", formatCurrency(contractValue, defaultCurrency)],
          ["Planned project costs", formatCurrency(plannedCost, defaultCurrency)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--app-border)] bg-white p-5">
            <p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p>
            <p className="font-financial mt-3 text-[28px] font-medium text-[var(--text-primary)]">{value}</p>
          </div>
        ))}
      </div>

      {migrationPending ? (
        <div className="rounded-xl border border-[#E7D09F] bg-[#FBF1DF] p-5 text-sm text-[var(--attention)]">
          The Projects migration exists locally but has not been applied to this database. No production database was changed.
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
        <div className="border-b border-[var(--app-border)] px-6 py-5">
          <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">All projects</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Period</th>
                <th className="px-5 py-3 text-right font-medium">Contract value</th>
                <th className="px-5 py-3 text-right font-medium">Cost budget</th>
                <th className="px-5 py-3 text-right font-medium">Margin target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-border)]">
              {projects.length > 0 ? projects.map((project) => (
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
                  <td className="tabular-nums px-5 py-4 text-right text-[var(--text-primary)]">{project.costBudget == null ? "—" : formatCurrency(Number(project.costBudget), project.currency)}</td>
                  <td className="tabular-nums px-5 py-4 text-right text-[var(--text-primary)]">{project.marginTarget == null ? "—" : `${Number(project.marginTarget).toFixed(1)}%`}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
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
