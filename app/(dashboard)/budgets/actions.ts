"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Unauthorized");
  return {
    orgId: session.user.tenantId,
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
        tenantId: orgId,
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
      where: { id: budgetId, tenantId: orgId },
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
      where: { id: budgetId, tenantId: orgId },
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
      where: { id: budgetId, tenantId: orgId },
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
    await prisma.budget.findFirstOrThrow({ where: { id: budgetId, tenantId: orgId } });

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
      where: { id: budgetId, tenantId: orgId, status: "APPROVED" },
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

export async function recordXpenxFlowOverride(data: {
  budgetId: string;
  versionId?: string;
  overrideType: "KEEP_FINOS" | "USE_EXTERNAL" | "MERGE";
  notes?: string;
  differencePercent?: number;
}) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    await prisma.budget.findFirstOrThrow({ where: { id: data.budgetId, tenantId: orgId } });

    await prisma.budgetOverrideLog.create({
      data: {
        budgetId: data.budgetId,
        budgetVersionId: data.versionId ?? null,
        overrideType: data.overrideType,
        approvedBy: userId,
        differencePercent: data.differencePercent ?? null,
        notes: data.notes ?? null,
      },
    });

    revalidatePath("/budgets/" + data.budgetId);
    revalidatePath("/settings/budgets");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to record override" };
  }
}

export async function createRevision(budgetId: string, currentVersionId: string, label: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();

    const budget = await prisma.budget.findFirst({
      where: { id: budgetId, tenantId: orgId },
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
