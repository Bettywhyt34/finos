import fs from "fs";
import path from "path";

const root = process.cwd();
const budgetDir = path.join(root, "app", "(dashboard)", "budgets");
const newDir = path.join(budgetDir, "new");
const idDir = path.join(budgetDir, "[id]");
fs.mkdirSync(newDir, { recursive: true });
fs.mkdirSync(idDir, { recursive: true });

// ─── actions.ts ───────────────────────────────────────────────────────────────
const actions = `"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.organizationId) throw new Error("Unauthorized");
  return {
    orgId: session.user.organizationId,
    userId: (session.user as { id?: string }).id ?? "system",
    userName: session.user.name ?? "Unknown",
  };
}

export async function createBudget(data: {
  name: string;
  type: "OPERATING" | "CAPEX" | "CASHFLOW";
  fiscalYear: number;
  description?: string;
  copyFromBudgetId?: string; // copy lines from prior year budget
}) {
  try {
    const { orgId, userId } = await getOrgAndUser();

    const budget = await prisma.budget.create({
      data: {
        organizationId: orgId,
        name: data.name,
        type: data.type,
        fiscalYear: data.fiscalYear,
        description: data.description,
        status: "DRAFT",
        createdBy: userId,
        versions: {
          create: {
            versionNumber: 1,
            label: "Original",
            status: "DRAFT",
            createdBy: userId,
          },
        },
      },
      include: { versions: true },
    });

    // Copy lines from prior year if requested
    if (data.copyFromBudgetId) {
      const sourceVersion = await prisma.budgetVersion.findFirst({
        where: { budgetId: data.copyFromBudgetId, status: { in: ["APPROVED", "LOCKED"] } },
        orderBy: { versionNumber: "desc" },
        include: { lines: true },
      });
      if (sourceVersion && sourceVersion.lines.length > 0) {
        const newVersionId = budget.versions[0].id;
        // Shift periods by 1 year
        const yearDiff = data.fiscalYear - (data.fiscalYear - 1);
        await prisma.budgetLine.createMany({
          data: sourceVersion.lines.map((l) => ({
            budgetId: budget.id,
            budgetVersionId: newVersionId,
            accountId: l.accountId,
            department: l.department,
            project: l.project,
            period: (parseInt(l.period.slice(0, 4)) + yearDiff) + l.period.slice(4),
            amount: l.amount,
          })),
          skipDuplicates: true,
        });
      }
    }

    revalidatePath("/budgets");
    return { success: true, id: budget.id, versionId: budget.versions[0].id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create budget" };
  }
}

export interface BudgetLineInput {
  accountId: string;
  department?: string;
  project?: string;
  period: string;
  amount: number;
  notes?: string;
}

export async function saveBudgetLines(
  budgetId: string,
  versionId: string,
  lines: BudgetLineInput[]
) {
  try {
    const { orgId } = await getOrgAndUser();

    const budget = await prisma.budget.findFirst({
      where: { id: budgetId, organizationId: orgId },
      include: { versions: { where: { id: versionId } } },
    });
    if (!budget) return { error: "Budget not found" };
    if (budget.versions[0]?.status === "LOCKED") return { error: "Budget version is locked" };

    // Upsert each line
    for (const line of lines) {
      if (line.amount === 0) {
        // Delete zero-amount lines to keep table clean
        await prisma.budgetLine.deleteMany({
          where: {
            budgetVersionId: versionId,
            accountId: line.accountId,
            period: line.period,
            department: line.department ?? null,
            project: line.project ?? null,
          },
        });
      } else {
        await prisma.budgetLine.upsert({
          where: {
            budgetVersionId_accountId_period_department_project: {
              budgetVersionId: versionId,
              accountId: line.accountId,
              period: line.period,
              department: line.department ?? "",
              project: line.project ?? "",
            },
          },
          create: {
            budgetId,
            budgetVersionId: versionId,
            accountId: line.accountId,
            department: line.department ?? null,
            project: line.project ?? null,
            period: line.period,
            amount: line.amount,
            notes: line.notes,
          },
          update: {
            amount: line.amount,
            notes: line.notes ?? null,
          },
        });
      }
    }

    revalidatePath("/budgets/" + budgetId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save budget lines" };
  }
}

export async function submitBudget(budgetId: string, versionId: string) {
  try {
    const { orgId, userId, userName } = await getOrgAndUser();

    const budget = await prisma.budget.findFirst({
      where: { id: budgetId, organizationId: orgId },
    });
    if (!budget) return { error: "Budget not found" };
    if (budget.status === "LOCKED") return { error: "Budget is locked" };

    await prisma.$transaction([
      prisma.budgetVersion.update({
        where: { id: versionId },
        data: { status: "SUBMITTED" },
      }),
      prisma.budget.update({
        where: { id: budgetId },
        data: { status: "SUBMITTED" },
      }),
      prisma.budgetApproval.create({
        data: {
          budgetId,
          budgetVersionId: versionId,
          approverId: userId,
          approverName: userName,
          status: "PENDING",
        },
      }),
    ]);

    revalidatePath("/budgets/" + budgetId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to submit budget" };
  }
}

export async function approveBudget(
  budgetId: string,
  versionId: string,
  approvalId: string,
  comments?: string
) {
  try {
    const { orgId, userId } = await getOrgAndUser();

    await prisma.budget.findFirstOrThrow({
      where: { id: budgetId, organizationId: orgId },
    });

    await prisma.$transaction([
      prisma.budgetApproval.update({
        where: { id: approvalId },
        data: { status: "APPROVED", comments: comments ?? null, actedAt: new Date() },
      }),
      prisma.budgetVersion.update({
        where: { id: versionId },
        data: { status: "APPROVED", approvedBy: userId, approvedAt: new Date() },
      }),
      prisma.budget.update({
        where: { id: budgetId },
        data: { status: "APPROVED" },
      }),
    ]);

    revalidatePath("/budgets/" + budgetId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to approve budget" };
  }
}

export async function rejectBudget(
  budgetId: string,
  approvalId: string,
  comments: string
) {
  try {
    const { orgId } = await getOrgAndUser();
    await prisma.budget.findFirstOrThrow({ where: { id: budgetId, organizationId: orgId } });

    await prisma.$transaction([
      prisma.budgetApproval.update({
        where: { id: approvalId },
        data: { status: "REJECTED", comments, actedAt: new Date() },
      }),
      prisma.budget.update({
        where: { id: budgetId },
        data: { status: "DRAFT" },
      }),
    ]);

    revalidatePath("/budgets/" + budgetId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reject budget" };
  }
}

export async function lockBudget(budgetId: string, versionId: string) {
  try {
    const { orgId } = await getOrgAndUser();
    await prisma.budget.findFirstOrThrow({
      where: { id: budgetId, organizationId: orgId, status: "APPROVED" },
    });

    await prisma.$transaction([
      prisma.budgetVersion.update({
        where: { id: versionId },
        data: { status: "LOCKED" },
      }),
      prisma.budget.update({
        where: { id: budgetId },
        data: { status: "LOCKED" },
      }),
    ]);

    revalidatePath("/budgets/" + budgetId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to lock budget" };
  }
}

export async function createRevision(budgetId: string, currentVersionId: string, label: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();

    const budget = await prisma.budget.findFirst({
      where: { id: budgetId, organizationId: orgId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!budget) return { error: "Budget not found" };

    const nextVersion = (budget.versions[0]?.versionNumber ?? 0) + 1;

    // Copy lines from current version
    const sourceLines = await prisma.budgetLine.findMany({
      where: { budgetVersionId: currentVersionId },
    });

    const newVersion = await prisma.budgetVersion.create({
      data: {
        budgetId,
        versionNumber: nextVersion,
        label,
        status: "DRAFT",
        createdBy: userId,
        lines: {
          create: sourceLines.map((l) => ({
            budgetId,
            accountId: l.accountId,
            department: l.department,
            project: l.project,
            period: l.period,
            amount: l.amount,
            notes: l.notes,
          })),
        },
      },
    });

    await prisma.budget.update({
      where: { id: budgetId },
      data: { status: "DRAFT" },
    });

    revalidatePath("/budgets/" + budgetId);
    return { success: true, versionId: newVersion.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create revision" };
  }
}
`;

fs.writeFileSync(path.join(budgetDir, "actions.ts"), actions);
console.log("Written: budgets/actions.ts");

// ─── Budget List Page ─────────────────────────────────────────────────────────
const listPage = `import { prisma } from "@/lib/prisma";
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
`;

fs.writeFileSync(path.join(budgetDir, "page.tsx"), listPage);
console.log("Written: budgets/page.tsx");

// ─── Budget New (wizard) ──────────────────────────────────────────────────────
const newPage = `import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { BudgetWizard } from "./budget-wizard";

export default async function NewBudgetPage() {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const currentYear = new Date().getFullYear();

  // Prior year approved/locked budgets for copy option
  const priorBudgets = await prisma.budget.findMany({
    where: {
      organizationId: orgId,
      fiscalYear: currentYear - 1,
      status: { in: ["APPROVED", "LOCKED"] },
    },
    select: { id: true, name: true, type: true, fiscalYear: true },
    orderBy: { type: "asc" },
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Create Budget</h1>
        <p className="text-sm text-muted-foreground">
          Define a new budget for operating expenses, capital expenditure, or cash flow.
        </p>
      </div>
      <BudgetWizard currentYear={currentYear} priorBudgets={priorBudgets} />
    </div>
  );
}
`;

fs.writeFileSync(path.join(newDir, "page.tsx"), newPage);
console.log("Written: budgets/new/page.tsx");

// ─── Budget Wizard (client) ───────────────────────────────────────────────────
const wizard = `"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createBudget } from "../actions";
import { toast } from "sonner";

interface PriorBudget { id: string; name: string; type: string; fiscalYear: number; }

interface Props {
  currentYear: number;
  priorBudgets: PriorBudget[];
}

const TYPE_INFO = {
  OPERATING: { label: "Operating Budget", desc: "Revenue, salaries, overhead — day-to-day operations" },
  CAPEX: { label: "Capital Expenditure", desc: "Equipment, infrastructure, long-term assets" },
  CASHFLOW: { label: "Cash Flow Budget", desc: "Cash inflows and outflows by period" },
};

export function BudgetWizard({ currentYear, priorBudgets }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [type, setType] = useState<"OPERATING" | "CAPEX" | "CASHFLOW">("OPERATING");
  const [name, setName] = useState("");
  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [description, setDescription] = useState("");
  const [copyFromId, setCopyFromId] = useState("");

  const matchingPrior = priorBudgets.filter((b) => b.type === type);

  function handleCreate() {
    if (!name.trim()) { toast.error("Budget name is required"); return; }

    startTransition(async () => {
      const result = await createBudget({
        name: name.trim(),
        type,
        fiscalYear,
        description: description.trim() || undefined,
        copyFromBudgetId: copyFromId || undefined,
      });

      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Budget created");
      router.push("/budgets/" + result.id + "?versionId=" + result.versionId);
    });
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Type */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">Budget Type</Label>
        <div className="grid grid-cols-3 gap-3">
          {(["OPERATING", "CAPEX", "CASHFLOW"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setType(t); setCopyFromId(""); }}
              className={
                "rounded-lg border p-4 text-left transition-colors " +
                (type === t ? "border-primary bg-primary/5" : "hover:bg-muted/30")
              }
            >
              <p className="font-medium text-sm">{TYPE_INFO[t].label}</p>
              <p className="text-xs text-muted-foreground mt-1">{TYPE_INFO[t].desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Details */}
      <div className="rounded-lg border p-4 space-y-4">
        <p className="font-semibold text-sm">Budget Details</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1">
            <Label>Budget Name *</Label>
            <Input
              placeholder={"e.g. FY" + fiscalYear + " Operating Budget"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Fiscal Year</Label>
            <Select value={String(fiscalYear)} onValueChange={(v) => setFiscalYear(parseInt(v ?? String(currentYear)))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Description (optional)</Label>
            <Input
              placeholder="Brief description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Step 3: Copy from prior */}
      <div className="rounded-lg border p-4 space-y-3">
        <p className="font-semibold text-sm">Starting Point</p>
        {matchingPrior.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              Copy amounts from a prior approved {TYPE_INFO[type].label.toLowerCase()} to save time.
            </p>
            <div className="space-y-1">
              <Label>Copy from (optional)</Label>
              <Select value={copyFromId} onValueChange={(v) => setCopyFromId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Start fresh (blank)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Start fresh (blank)</SelectItem>
                  {matchingPrior.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      FY{b.fiscalYear} — {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No prior year {TYPE_INFO[type].label.toLowerCase()} found. Starting fresh.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="button" onClick={handleCreate} disabled={isPending || !name.trim()}>
          {isPending ? "Creating..." : "Create Budget"}
        </Button>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(newDir, "budget-wizard.tsx"), wizard);
console.log("Written: budgets/new/budget-wizard.tsx");

// ─── Budget Detail Page ───────────────────────────────────────────────────────
const detailPage = `import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { BudgetGrid } from "./budget-grid";
import { BudgetVersionActions } from "./budget-version-actions";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default async function BudgetDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { versionId?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const budget = await prisma.budget.findFirst({
    where: { id: params.id, organizationId: orgId },
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
      organizationId: orgId,
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
        <BudgetVersionActions
          budget={{ id: budget.id, status: budget.status }}
          version={{ id: activeVersion.id, status: activeVersion.status, versionNumber: activeVersion.versionNumber }}
          approval={activeVersion.approvals[0] ?? null}
        />
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
`;

fs.writeFileSync(path.join(idDir, "page.tsx"), detailPage);
console.log("Written: budgets/[id]/page.tsx");

// ─── Budget Grid (client) ─────────────────────────────────────────────────────
const grid = `"use client";

import { useState, useTransition, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { saveBudgetLines } from "../actions";
import { toast } from "sonner";

interface Account { id: string; code: string; name: string; type: string; }
interface AccountMeta { code: string; name: string; type: string; }

interface Props {
  budgetId: string;
  versionId: string;
  accounts: Account[];
  months: string[];          // YYYY-MM
  monthNames: string[];      // Jan-Dec
  initialLines: Record<string, Record<string, number>>; // accountId → { period → amount }
  accountMeta: Record<string, AccountMeta>;
  colTotals: number[];
  grandTotal: number;
  isEditable: boolean;
}

export function BudgetGrid({
  budgetId, versionId, accounts, months, monthNames,
  initialLines, accountMeta, colTotals: initColTotals, grandTotal: initGrandTotal, isEditable,
}: Props) {
  const [isPending, startTransition] = useTransition();

  // lines[accountId][period] = amount
  const [lines, setLines] = useState<Record<string, Record<string, number>>>(initialLines);
  const [addAccountId, setAddAccountId] = useState("");
  const [dirty, setDirty] = useState(false);

  const accountIds = Object.keys(lines);

  function setAmount(accountId: string, period: string, value: string) {
    const num = parseFloat(value) || 0;
    setLines((prev) => ({
      ...prev,
      [accountId]: { ...(prev[accountId] ?? {}), [period]: num },
    }));
    setDirty(true);
  }

  function addRow() {
    if (!addAccountId) return;
    if (lines[addAccountId]) { toast.info("Account already in grid"); return; }
    setLines((prev) => ({ ...prev, [addAccountId]: {} }));
    setAddAccountId("");
    setDirty(true);
  }

  function removeRow(accountId: string) {
    setLines((prev) => {
      const next = { ...prev };
      delete next[accountId];
      return next;
    });
    setDirty(true);
  }

  function fillRow(accountId: string, value: string) {
    const num = parseFloat(value) || 0;
    setLines((prev) => ({
      ...prev,
      [accountId]: Object.fromEntries(months.map((m) => [m, num])),
    }));
    setDirty(true);
  }

  const colTotals = months.map((m) =>
    accountIds.reduce((s, id) => s + (lines[id]?.[m] ?? 0), 0)
  );
  const grandTotal = colTotals.reduce((s, v) => s + v, 0);

  function handleSave() {
    const flatLines = accountIds.flatMap((accountId) =>
      months.map((period) => ({
        accountId,
        period,
        amount: lines[accountId]?.[period] ?? 0,
      }))
    );
    startTransition(async () => {
      const result = await saveBudgetLines(budgetId, versionId, flatLines);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Budget saved");
      setDirty(false);
    });
  }

  const getMeta = (id: string): AccountMeta =>
    accountMeta[id] ?? accounts.find((a) => a.id === id) ?? { code: "?", name: "Unknown", type: "" };

  const availableAccounts = accounts.filter((a) => !lines[a.id]);

  return (
    <div className="space-y-3">
      {isEditable && (
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Add Account Row</label>
            <Select value={addAccountId} onValueChange={(v) => setAddAccountId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Search account..." />
              </SelectTrigger>
              <SelectContent>
                {availableAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={addRow} disabled={!addAccountId}>
            Add Row
          </Button>
          {dirty && (
            <Button type="button" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>
      )}

      <div className="rounded-lg border overflow-x-auto">
        <table className="text-sm min-w-max w-full">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="text-left p-2 font-medium min-w-[200px] sticky left-0 bg-muted/50">Account</th>
              {monthNames.map((m, i) => (
                <th key={i} className="text-right p-2 font-medium w-28">{m}</th>
              ))}
              <th className="text-right p-2 font-medium w-28 bg-muted/70">Total</th>
              {isEditable && <th className="p-2 w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {accountIds.length === 0 && (
              <tr>
                <td colSpan={14} className="p-8 text-center text-muted-foreground">
                  No accounts added yet. Use the selector above to add budget rows.
                </td>
              </tr>
            )}
            {accountIds.map((accountId) => {
              const meta = getMeta(accountId);
              const rowTotal = months.reduce((s, m) => s + (lines[accountId]?.[m] ?? 0), 0);
              return (
                <tr key={accountId} className="border-t hover:bg-muted/20 group">
                  <td className="p-2 sticky left-0 bg-background group-hover:bg-muted/20">
                    <div>
                      <span className="font-mono text-xs text-muted-foreground">{meta.code}</span>
                      <span className="ml-2 text-sm">{meta.name}</span>
                    </div>
                    {isEditable && (
                      <div className="hidden group-hover:flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">Fill all months:</span>
                        <Input
                          type="number"
                          className="h-5 w-24 text-xs"
                          placeholder="amount"
                          onBlur={(e) => { if (e.target.value) fillRow(accountId, e.target.value); }}
                        />
                      </div>
                    )}
                  </td>
                  {months.map((m) => (
                    <td key={m} className="p-1">
                      {isEditable ? (
                        <Input
                          type="number"
                          min="0"
                          step="1000"
                          className="h-7 text-xs text-right w-full"
                          value={lines[accountId]?.[m] || ""}
                          placeholder="0"
                          onChange={(e) => setAmount(accountId, m, e.target.value)}
                        />
                      ) : (
                        <span className="block text-right text-xs px-2">
                          {(lines[accountId]?.[m] ?? 0) > 0
                            ? (lines[accountId][m] / 1000).toFixed(0) + "k"
                            : ""}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="p-2 text-right font-medium bg-muted/20 text-xs">
                    {formatCurrency(rowTotal)}
                  </td>
                  {isEditable && (
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(accountId)}
                        className="text-muted-foreground hover:text-red-500 text-xs"
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 bg-muted/40 font-semibold">
            <tr>
              <td className="p-2 sticky left-0 bg-muted/40">Total</td>
              {colTotals.map((t, i) => (
                <td key={i} className="p-2 text-right text-xs">{formatCurrency(t)}</td>
              ))}
              <td className="p-2 text-right bg-muted/60">{formatCurrency(grandTotal)}</td>
              {isEditable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(idDir, "budget-grid.tsx"), grid);
console.log("Written: budgets/[id]/budget-grid.tsx");

// ─── Budget Version Actions (client) ─────────────────────────────────────────
const versionActions = `"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  submitBudget, approveBudget, rejectBudget, lockBudget, createRevision,
} from "../actions";
import { toast } from "sonner";

interface Props {
  budget: { id: string; status: string };
  version: { id: string; status: string; versionNumber: number };
  approval: { id: string; status: string } | null;
}

export function BudgetVersionActions({ budget, version, approval }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showRevise, setShowRevise] = useState(false);
  const [comments, setComments] = useState("");
  const [reviseLabel, setReviseLabel] = useState("Revised");

  function act(fn: () => Promise<{ error?: string; success?: boolean }>, successMsg: string) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result && result.error) { toast.error(result.error); return; }
      toast.success(successMsg);
      setShowApprove(false); setShowReject(false); setShowRevise(false);
      router.refresh();
    });
  }

  const { status } = budget;
  const vStatus = version.status;

  return (
    <div className="flex gap-2">
      {vStatus === "DRAFT" && (
        <Button type="button" onClick={() => act(() => submitBudget(budget.id, version.id), "Budget submitted for approval")}>
          Submit for Approval
        </Button>
      )}
      {vStatus === "SUBMITTED" && approval?.status === "PENDING" && (
        <>
          <Button type="button" variant="outline" onClick={() => setShowReject(true)} disabled={isPending}>
            Reject
          </Button>
          <Button type="button" onClick={() => setShowApprove(true)} disabled={isPending}>
            Approve
          </Button>
        </>
      )}
      {vStatus === "APPROVED" && (
        <Button type="button" variant="outline"
          onClick={() => act(() => lockBudget(budget.id, version.id), "Budget locked")}>
          Lock Budget
        </Button>
      )}
      {(vStatus === "APPROVED" || vStatus === "LOCKED") && (
        <Button type="button" variant="outline" onClick={() => setShowRevise(true)}>
          Create Revision
        </Button>
      )}

      {/* Approve dialog */}
      <Dialog open={showApprove} onOpenChange={setShowApprove}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve Budget</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            <Label>Comments (optional)</Label>
            <Input placeholder="Approval comments" value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="button" disabled={isPending}
              onClick={() => act(() => approveBudget(budget.id, version.id, approval!.id, comments), "Budget approved")}>
              Approve
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={showReject} onOpenChange={setShowReject}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Budget</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            <Label>Reason for rejection *</Label>
            <Input placeholder="Required" value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" disabled={isPending || !comments.trim()}
              onClick={() => act(() => rejectBudget(budget.id, approval!.id, comments), "Budget rejected")}>
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revision dialog */}
      <Dialog open={showRevise} onOpenChange={setShowRevise}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Budget Revision</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-sm text-muted-foreground">
              Creates a new draft version (v{version.versionNumber + 1}) copied from the current version.
            </p>
            <Label>Version Label</Label>
            <Input placeholder="e.g. Revised Q2, Forecast" value={reviseLabel} onChange={(e) => setReviseLabel(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="button" disabled={isPending || !reviseLabel.trim()}
              onClick={() => act(() => createRevision(budget.id, version.id, reviseLabel), "Revision created")}>
              Create Revision
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
`;

fs.writeFileSync(path.join(idDir, "budget-version-actions.tsx"), versionActions);
console.log("Written: budgets/[id]/budget-version-actions.tsx");

console.log("\nBudget module (Day 1-2) written.");
