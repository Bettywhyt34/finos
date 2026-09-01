"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRecognitionPeriod } from "@/lib/utils";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";

interface DeferredAllocationRow {
  id: string;
  incomeAccountId: string;
  reportingTags: Prisma.JsonValue | null;
  remaining: unknown;
}

type ReportingTags = Record<string, string> | null;

function normaliseReportingTags(value: Prisma.JsonValue | null): ReportingTags {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .map(([tagId, optionId]) => [tagId, optionId as string] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? Object.fromEntries(pairs) : null;
}

function groupKey(accountId: string, reportingTags: ReportingTags) {
  return JSON.stringify([
    accountId,
    reportingTags ? Object.entries(reportingTags).sort(([a], [b]) => a.localeCompare(b)) : [],
  ]);
}

export async function recogniseDeferredProjectRevenue(input: {
  projectId: string;
  amount: number;
  recognitionDate: string;
  note?: string;
}): Promise<{ success: true; recognitionId: string } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to recognise project revenue." };
  }

  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a revenue amount greater than zero." };
  const recognitionDate = new Date(`${input.recognitionDate}T00:00:00`);
  if (Number.isNaN(recognitionDate.getTime())) return { error: "Enter a valid recognition date." };
  if (recognitionDate > new Date()) return { error: "Revenue recognition date cannot be in the future." };
  const note = input.note?.trim() || null;
  if (note && note.length > 2000) return { error: "Recognition note is too long." };

  try {
    const recognitionId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:project-revenue:${tenantId}:${input.projectId}`}))`;

      const project = await tx.project.findFirst({
        where: { id: input.projectId, tenantId },
        select: { id: true, name: true, status: true, unearnedIncomeAccountId: true },
      });
      if (!project) throw new Error("Project not found.");
      if (project.status === "DRAFT" || project.status === "CANCELLED") {
        throw new Error("Revenue can only be recognised for an active, on-hold or completed Project.");
      }

      let unearnedAccountId = project.unearnedIncomeAccountId;
      if (unearnedAccountId) {
        const account = await tx.chartOfAccounts.findFirst({
          where: { id: unearnedAccountId, tenantId, type: "LIABILITY", isActive: true },
          select: { id: true },
        });
        if (!account) throw new Error("The Project Unearned Income account is inactive or invalid.");
      } else {
        unearnedAccountId = (await resolveSystemAccount(tx, tenantId, "UNEARNED_REVENUE")).id;
      }

      const allocations = await tx.$queryRaw<DeferredAllocationRow[]>`
        SELECT
          ila."id",
          ila."income_account_id" AS "incomeAccountId",
          il."reporting_tags" AS "reportingTags",
          (ila."unearned_created" - COALESCE(SUM(CASE WHEN prr."status" = 'POSTED' THEN rria."amount" ELSE 0 END), 0)) AS "remaining"
        FROM "invoice_line_revenue_allocations" ila
        INNER JOIN "invoice_lines" il ON il."id" = ila."invoice_line_id"
        INNER JOIN "invoices" i ON i."id" = ila."invoice_id" AND i."tenant_id" = ila."tenant_id"
        LEFT JOIN "revenue_recognition_invoice_allocations" rria
          ON rria."invoice_line_allocation_id" = ila."id"
        LEFT JOIN "project_revenue_recognitions" prr
          ON prr."id" = rria."recognition_id"
        WHERE ila."tenant_id" = ${tenantId}::uuid
          AND ila."project_id" = ${project.id}
          AND ila."unearned_created" > 0
          AND i."status" <> 'VOIDED'
        GROUP BY ila."id", ila."income_account_id", il."reporting_tags", ila."unearned_created", ila."posted_at"
        HAVING (ila."unearned_created" - COALESCE(SUM(CASE WHEN prr."status" = 'POSTED' THEN rria."amount" ELSE 0 END), 0)) > 0.005
        ORDER BY ila."posted_at" ASC, ila."id" ASC
      `;

      const available = Math.round(allocations.reduce((sum, allocation) => sum + Number(allocation.remaining ?? 0), 0) * 100) / 100;
      if (available + 0.005 < amount) {
        throw new Error(`Only ${available.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NGN remains in Unearned Income for this Project.`);
      }

      let amountLeft = amount;
      const chosen: Array<{ allocationId: string; amount: number; incomeAccountId: string; reportingTags: ReportingTags }> = [];
      for (const allocation of allocations) {
        if (amountLeft <= 0.005) break;
        const remaining = Math.round(Number(allocation.remaining ?? 0) * 100) / 100;
        const used = Math.min(remaining, amountLeft);
        if (used <= 0) continue;
        chosen.push({
          allocationId: allocation.id,
          amount: Math.round(used * 100) / 100,
          incomeAccountId: allocation.incomeAccountId,
          reportingTags: normaliseReportingTags(allocation.reportingTags),
        });
        amountLeft = Math.round((amountLeft - used) * 100) / 100;
      }
      if (Math.abs(amountLeft) > 0.005) throw new Error("Could not fully allocate the revenue recognition amount.");

      const creditGroups = new Map<string, { accountId: string; reportingTags: ReportingTags; amount: number }>();
      for (const allocation of chosen) {
        const key = groupKey(allocation.incomeAccountId, allocation.reportingTags);
        const current = creditGroups.get(key);
        if (current) current.amount = Math.round((current.amount + allocation.amount) * 100) / 100;
        else creditGroups.set(key, { accountId: allocation.incomeAccountId, reportingTags: allocation.reportingTags, amount: allocation.amount });
      }

      const lines: JournalPostingLine[] = [{
        accountId: unearnedAccountId,
        description: `Unearned Income released — ${project.name}`,
        debit: amount,
        credit: 0,
        projectId: project.id,
      }];
      for (const group of creditGroups.values()) {
        lines.push({
          accountId: group.accountId,
          description: `Revenue recognised — ${project.name}`,
          debit: 0,
          credit: group.amount,
          projectId: project.id,
          reportingTags: group.reportingTags,
        });
      }

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: recognitionDate,
        reference: `PRR-${recognitionId.slice(0, 8).toUpperCase()}`,
        description: `Project revenue recognition — ${project.name}`,
        recognitionPeriod: getRecognitionPeriod(recognitionDate),
        source: "project_revenue_recognition",
        sourceId: recognitionId,
        lines,
      });

      const primaryIncomeAccountId = chosen[0]?.incomeAccountId;
      if (!primaryIncomeAccountId) throw new Error("Revenue income account could not be resolved.");

      await tx.$executeRaw`
        INSERT INTO "project_revenue_recognitions" (
          "id", "tenant_id", "project_id", "recognition_date", "amount", "unearned_used",
          "contract_asset_created", "currency", "income_account_id", "unearned_income_account_id",
          "contract_asset_account_id", "journal_entry_id", "note", "created_by", "status"
        ) VALUES (
          ${recognitionId}::uuid, ${tenantId}::uuid, ${project.id}, ${recognitionDate}, ${amount}, ${amount},
          0, 'NGN', ${primaryIncomeAccountId}, ${unearnedAccountId}, null, ${journalEntryId}, ${note}, ${userId}, 'POSTED'
        )
      `;

      for (const allocation of chosen) {
        await tx.$executeRaw`
          INSERT INTO "revenue_recognition_invoice_allocations" (
            "tenant_id", "recognition_id", "invoice_line_allocation_id", "amount"
          ) VALUES (${tenantId}::uuid, ${recognitionId}::uuid, ${allocation.allocationId}::uuid, ${allocation.amount})
        `;
      }

      await tx.$executeRaw`
        INSERT INTO "project_activities" (
          "tenant_id", "project_id", "event_type", "title", "description", "actor_id", "actor_name", "metadata"
        ) VALUES (
          ${tenantId}::uuid, ${project.id}, 'REVENUE_RECOGNISED', 'Revenue recognised',
          ${`Recognised ${amount.toFixed(2)} NGN from previously billed Unearned Income.`},
          ${userId}, ${session.user.email ?? null},
          CAST(${JSON.stringify({ recognitionId, amount, currency: "NGN", journalEntryId })} AS jsonb)
        )
      `;
    });

    revalidatePath(`/projects/${input.projectId}`);
    revalidatePath(`/projects/${input.projectId}?tab=revenue`);
    revalidatePath("/projects");
    return { success: true, recognitionId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Revenue recognition could not be posted." };
  }
}

export async function reverseProjectRevenueRecognition(input: {
  recognitionId: string;
  reason: string;
}): Promise<{ success: true } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to reverse project revenue." };

  const reason = input.reason.trim();
  if (!reason) return { error: "Enter a reversal reason." };
  if (reason.length > 2000) return { error: "Reversal reason is too long." };

  try {
    let projectId = "";
    await prisma.$transaction(async (tx) => {
      const recognition = await tx.$queryRaw<Array<{
        id: string;
        projectId: string;
        status: string;
        journalEntryId: string;
      }>>`
        SELECT "id"::text AS "id", "project_id" AS "projectId", "status", "journal_entry_id" AS "journalEntryId"
        FROM "project_revenue_recognitions"
        WHERE "id" = ${input.recognitionId}::uuid AND "tenant_id" = ${tenantId}::uuid
        LIMIT 1
      `;
      const row = recognition[0];
      if (!row) throw new Error("Revenue recognition not found.");
      if (row.status === "REVERSED") throw new Error("This revenue recognition has already been reversed.");
      projectId = row.projectId;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:project-revenue:${tenantId}:${projectId}`}))`;

      const journal = await tx.journalEntry.findFirst({
        where: { id: row.journalEntryId, tenantId },
        include: { lines: true },
      });
      if (!journal) throw new Error("The original revenue recognition journal could not be found.");

      const reversedAt = new Date();
      const reversalLines: JournalPostingLine[] = journal.lines.map((line) => ({
        accountId: line.accountId,
        description: `Reverse — ${line.description ?? journal.description}`,
        debit: Number(line.credit),
        credit: Number(line.debit),
        projectId: line.projectId ?? null,
        reportingTags: normaliseReportingTags(line.reportingTags),
      }));

      const reversalJournalId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: reversedAt,
        reference: `REV-${journal.reference ?? row.id.slice(0, 8)}`,
        description: `Reverse project revenue recognition: ${reason}`,
        recognitionPeriod: getRecognitionPeriod(reversedAt),
        source: "project_revenue_recognition_reversal",
        sourceId: row.id,
        lines: reversalLines,
      });

      await tx.$executeRaw`
        UPDATE "project_revenue_recognitions"
        SET "status" = 'REVERSED',
            "reversal_journal_entry_id" = ${reversalJournalId},
            "reversed_at" = ${reversedAt},
            "reversed_by" = ${userId},
            "reversal_reason" = ${reason}
        WHERE "id" = ${row.id}::uuid AND "tenant_id" = ${tenantId}::uuid AND "status" = 'POSTED'
      `;

      await tx.$executeRaw`
        INSERT INTO "project_activities" (
          "tenant_id", "project_id", "event_type", "title", "description", "actor_id", "actor_name", "metadata"
        ) VALUES (
          ${tenantId}::uuid, ${projectId}, 'REVENUE_RECOGNITION_REVERSED', 'Revenue recognition reversed',
          ${reason}, ${userId}, ${session.user.email ?? null},
          CAST(${JSON.stringify({ recognitionId: row.id, reversalJournalId })} AS jsonb)
        )
      `;
    });

    if (projectId) {
      revalidatePath(`/projects/${projectId}`);
      revalidatePath(`/projects/${projectId}?tab=revenue`);
    }
    revalidatePath("/projects");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Revenue recognition could not be reversed." };
  }
}
