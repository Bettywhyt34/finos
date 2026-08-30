import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CircleDollarSign,
  FileText,
  FolderOpen,
  History,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ProjectDocuments, type ProjectDocumentRow } from "./project-documents";

interface ProjectDetailRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  currency: string;
  startDate: Date;
  endDate: Date | null;
  contractValue: unknown;
  costBudget: unknown;
  marginTarget: unknown;
  billingSchedule: unknown;
  notes: string | null;
  customerName: string;
  customerCode: string;
  incomeAccount: string | null;
  contractAssetAccount: string | null;
  unearnedIncomeAccount: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface BillingMilestone {
  percentage: number;
  expectedDate: string;
}

interface ProjectActivityRow {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  actorName: string | null;
  metadata: unknown;
  createdAt: Date;
}

const TABS = [
  ["overview", "Overview"],
  ["revenue", "Revenue"],
  ["costs", "Costs"],
  ["documents", "Documents"],
  ["activity", "Activity"],
] as const;

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-[var(--surface-muted)] text-[var(--text-secondary)]",
  ACTIVE: "bg-[#E7F2EC] text-[var(--positive)]",
  ON_HOLD: "bg-[#FBF1DF] text-[var(--attention)]",
  COMPLETED: "bg-[#E7F2EC] text-[var(--positive)]",
  CANCELLED: "bg-[#F8EAEA] text-[var(--critical)]",
};

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, query, session] = await Promise.all([params, searchParams, auth()]);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) notFound();

  let rows: ProjectDetailRow[];
  try {
    rows = await prisma.$queryRaw<ProjectDetailRow[]>`
      SELECT
        p."id", p."name", p."code", p."description", p."status"::text AS "status",
        p."currency", p."start_date" AS "startDate", p."end_date" AS "endDate",
        p."contract_value" AS "contractValue", p."cost_budget" AS "costBudget",
        p."margin_target" AS "marginTarget", p."billing_schedule" AS "billingSchedule",
        p."notes", p."created_at" AS "createdAt", p."updated_at" AS "updatedAt",
        c."company_name" AS "customerName", c."customer_code" AS "customerCode",
        income."name" AS "incomeAccount", contract_asset."name" AS "contractAssetAccount",
        unearned."name" AS "unearnedIncomeAccount"
      FROM "projects" p
      INNER JOIN "customers" c ON c."id" = p."customer_id"
      LEFT JOIN "chart_of_accounts" income ON income."id" = p."default_income_account_id"
      LEFT JOIN "chart_of_accounts" contract_asset ON contract_asset."id" = p."contract_asset_account_id"
      LEFT JOIN "chart_of_accounts" unearned ON unearned."id" = p."unearned_income_account_id"
      WHERE p."id" = ${id} AND p."tenant_id" = ${tenantId}
      LIMIT 1
    `;
  } catch {
    notFound();
  }

  const project = rows[0];
  if (!project) notFound();

  const requestedTab = query.tab ?? "overview";
  const activeTab = TABS.some(([key]) => key === requestedTab) ? requestedTab : "overview";
  const contractValue = Number(project.contractValue ?? 0);
  const costBudget = project.costBudget == null ? null : Number(project.costBudget);
  const plannedMargin = costBudget == null ? null : contractValue - costBudget;
  const milestones = parseBillingSchedule(project.billingSchedule);
  let documents: ProjectDocumentRow[] = [];
  let activities: ProjectActivityRow[] = [];
  if (activeTab === "documents") {
    const rows = await prisma.$queryRaw<Array<Omit<ProjectDocumentRow, "uploadedAt"> & { uploadedAt: Date }>>`
      SELECT d."id", d."title", d."category", d."file_name" AS "fileName",
        d."mime_type" AS "mimeType", d."file_size" AS "fileSize", d."uploaded_at" AS "uploadedAt",
        COALESCE(u."name", u."email", d."uploaded_by") AS "uploadedByName"
      FROM "project_documents" d
      LEFT JOIN "users" u ON u."id" = d."uploaded_by"
      WHERE d."tenant_id" = ${tenantId}::uuid AND d."project_id" = ${project.id} AND d."status" = 'ACTIVE'
      ORDER BY d."uploaded_at" DESC
    `;
    documents = rows.map((row) => ({ ...row, uploadedAt: row.uploadedAt.toISOString() }));
  }
  if (activeTab === "activity") {
    activities = await prisma.$queryRaw<ProjectActivityRow[]>`
      SELECT "id", "event_type" AS "eventType", "title", "description",
        "actor_name" AS "actorName", "metadata", "created_at" AS "createdAt"
      FROM "project_activities"
      WHERE "tenant_id" = ${tenantId}::uuid AND "project_id" = ${project.id}
      ORDER BY "created_at" DESC
    `;
  }
  const canManageDocuments = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(session.user.role ?? "");

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <Link href="/projects" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--finos-accent)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Projects
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[36px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">{project.name}</h1>
            <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[project.status] ?? STATUS_STYLE.DRAFT}`}>
              {project.status.replaceAll("_", " ").toLowerCase()}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {project.customerName}{project.code ? <><span className="px-2">·</span><span className="font-code">{project.code}</span></> : null}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--app-border)] bg-white px-4 py-2 text-right">
          <p className="text-xs text-[var(--text-secondary)]">Project period</p>
          <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">
            {formatDate(project.startDate)} – {project.endDate ? formatDate(project.endDate) : "Ongoing"}
          </p>
        </div>
      </header>

      <nav aria-label="Project sections" className="overflow-x-auto border-b border-[var(--app-border)]">
        <div className="flex min-w-max gap-7">
          {TABS.map(([key, label]) => (
            <Link
              key={key}
              href={`/projects/${project.id}?tab=${key}`}
              aria-current={activeTab === key ? "page" : undefined}
              className={`border-b-2 px-1 pb-3 text-sm font-medium ${
                activeTab === key
                  ? "border-[var(--finos-accent)] text-[var(--finos-accent)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>

      {activeTab === "overview" ? (
        <Overview project={project} contractValue={contractValue} costBudget={costBudget} plannedMargin={plannedMargin} milestones={milestones} />
      ) : null}
      {activeTab === "revenue" ? <Revenue currency={project.currency} /> : null}
      {activeTab === "costs" ? <Costs currency={project.currency} /> : null}
      {activeTab === "documents" ? <ProjectDocuments projectId={project.id} documents={documents} canManage={canManageDocuments} /> : null}
      {activeTab === "activity" ? <Activity project={project} activities={activities} /> : null}
    </div>
  );
}

function Overview({
  project,
  contractValue,
  costBudget,
  plannedMargin,
  milestones,
}: {
  project: ProjectDetailRow;
  contractValue: number;
  costBudget: number | null;
  plannedMargin: number | null;
  milestones: BillingMilestone[];
}) {
  const metrics = [
    ["Contract value", formatCurrency(contractValue, project.currency)],
    ["Revenue earned", "—"],
    ["Amount invoiced", "—"],
    ["Amount collected", "—"],
    ["Costs incurred", "—"],
    ["Actual gross margin", "—"],
    ["Contract Asset", "—"],
    ["Unearned Income", "—"],
  ];

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--app-border)] bg-white p-5">
            <p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p>
            <p className="font-financial mt-3 text-[27px] font-medium text-[var(--text-primary)]">{value}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.45fr_1fr]">
        <section className="rounded-xl border border-[var(--app-border)] bg-white">
          <div className="border-b border-[var(--app-border)] px-6 py-5">
            <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Commercial plan</h2>
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-5 p-6 sm:grid-cols-2">
            <Detail label="Customer" value={`${project.customerName} · ${project.customerCode}`} />
            <Detail label="Contract value" value={formatCurrency(contractValue, project.currency)} financial />
            <Detail label="Cost budget" value={costBudget == null ? "Not set" : formatCurrency(costBudget, project.currency)} financial={costBudget != null} />
            <Detail label="Planned margin" value={plannedMargin == null ? "Not set" : formatCurrency(plannedMargin, project.currency)} financial={plannedMargin != null} />
            <Detail label="Margin target" value={project.marginTarget == null ? "Not set" : `${Number(project.marginTarget).toFixed(1)}%`} financial={project.marginTarget != null} />
            <Detail label="Currency" value={project.currency} code />
          </dl>
          {project.description ? <p className="border-t border-[var(--app-border)] px-6 py-5 text-sm leading-6 text-[var(--text-secondary)]">{project.description}</p> : null}
        </section>

        <section className="rounded-xl border border-[var(--app-border)] bg-white">
          <div className="border-b border-[var(--app-border)] px-6 py-5">
            <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Accounting defaults</h2>
          </div>
          <dl className="space-y-5 p-6">
            <Detail label="Income account" value={project.incomeAccount ?? "Use inherited default"} />
            <Detail label="Contract Asset account" value={project.contractAssetAccount ?? "Use inherited default"} />
            <Detail label="Unearned Income account" value={project.unearnedIncomeAccount ?? "Use inherited default"} />
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-[var(--app-border)] bg-white">
        <div className="flex items-center justify-between border-b border-[var(--app-border)] px-6 py-5">
          <div>
            <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Billing plan</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Planning and reminders only; milestones do not create invoices.</p>
          </div>
          <CalendarDays className="h-5 w-5 text-[var(--finos-accent)]" />
        </div>
        {milestones.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--text-secondary)]">
                <tr><th className="px-6 py-3 font-medium">Stage</th><th className="px-6 py-3 font-medium">Expected billing date</th><th className="px-6 py-3 text-right font-medium">Percentage</th><th className="px-6 py-3 text-right font-medium">Planned amount</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-border)]">
                {milestones.map((milestone, index) => (
                  <tr key={`${milestone.expectedDate}-${index}`}>
                    <td className="px-6 py-4 font-medium text-[var(--text-primary)]">Stage {index + 1}</td>
                    <td className="px-6 py-4 text-[var(--text-secondary)]">{formatDate(new Date(`${milestone.expectedDate}T00:00:00`))}</td>
                    <td className="tabular-nums px-6 py-4 text-right text-[var(--text-primary)]">{milestone.percentage}%</td>
                    <td className="tabular-nums px-6 py-4 text-right font-medium text-[var(--text-primary)]">{formatCurrency(contractValue * milestone.percentage / 100, project.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyCompact text="No billing milestones have been planned." />}
      </section>
    </div>
  );
}

function Revenue({ currency }: { currency: string }) {
  return (
    <section className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={TrendingUp} label="Revenue earned" value="—" />
        <Metric icon={ReceiptText} label="Invoiced" value="—" />
        <Metric icon={CircleDollarSign} label="Contract Asset" value="—" />
        <Metric icon={Banknote} label="Unearned Income" value="—" />
      </div>
      <EmptyPanel
        icon={TrendingUp}
        title="No revenue recognition events yet"
        text={`Recognition events, invoice coverage and Contract Asset matching will appear here in ${currency}. No revenue has been inferred from the project plan.`}
      />
    </section>
  );
}

function Costs({ currency }: { currency: string }) {
  return (
    <section className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={ReceiptText} label="Costs incurred" value="—" />
        <Metric icon={FileText} label="Vendor billed" value="—" />
        <Metric icon={CircleDollarSign} label="Accrued costs" value="—" />
        <Metric icon={Banknote} label="Paid" value="—" />
      </div>
      <EmptyPanel
        icon={ReceiptText}
        title="No project costs linked yet"
        text={`Bills, expenses, accruals, provisions and project-linked journals will appear here in ${currency}. Planned cost is not treated as an incurred cost.`}
      />
    </section>
  );
}

function Activity({ project, activities }: { project: ProjectDetailRow; activities: ProjectActivityRow[] }) {
  const timeline = activities.length ? activities : [{
    id: `created-${project.id}`,
    eventType: "PROJECT_CREATED",
    title: "Project created",
    description: "Initial project setup was recorded.",
    actorName: null,
    metadata: null,
    createdAt: project.createdAt,
  }];
  return (
    <section className="rounded-xl border border-[var(--app-border)] bg-white">
      <div className="border-b border-[var(--app-border)] px-6 py-5">
        <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">Activity</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">The Project’s chronological audit trail.</p>
      </div>
      <div className="divide-y divide-[var(--app-border)]">
        {timeline.map((activity) => (
          <div key={activity.id} className="flex gap-4 px-6 py-5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#E7F2EC] text-[var(--positive)]"><History className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">{activity.title}</p>
                <span className="font-code text-[11px] text-[var(--text-secondary)]">{activity.eventType}</span>
              </div>
              {activity.description ? <p className="mt-1 text-sm text-[var(--text-secondary)]">{activity.description}</p> : null}
              <p className="mt-2 text-xs text-[var(--text-secondary)]">{formatDateTime(activity.createdAt)}{activity.actorName ? ` · ${activity.actorName}` : ""}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof TrendingUp; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-white p-5">
      <div className="flex items-center justify-between"><p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p><Icon className="h-4 w-4 text-[var(--finos-accent)]" /></div>
      <p className="font-financial mt-3 text-[27px] font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function Detail({ label, value, financial, code }: { label: string; value: string; financial?: boolean; code?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium text-[var(--text-secondary)]">{label}</dt>
      <dd className={`mt-1.5 text-sm font-medium text-[var(--text-primary)] ${financial ? "font-financial tabular-nums" : ""} ${code ? "font-code" : ""}`}>{value}</dd>
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, text }: { icon: typeof FolderOpen; title: string; text: string }) {
  return (
    <section className="grid min-h-80 place-items-center rounded-xl border border-[var(--app-border)] bg-white px-6 py-14 text-center">
      <div className="max-w-lg">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--finos-accent)]"><Icon className="h-5 w-5" /></div>
        <h2 className="font-serif mt-5 text-xl font-medium text-[var(--text-primary)]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{text}</p>
      </div>
    </section>
  );
}

function EmptyCompact({ text }: { text: string }) {
  return <p className="px-6 py-10 text-center text-sm text-[var(--text-secondary)]">{text}</p>;
}

function parseBillingSchedule(value: unknown): BillingMilestone[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is BillingMilestone => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return typeof candidate.percentage === "number" && typeof candidate.expectedDate === "string";
  });
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(value);
}
