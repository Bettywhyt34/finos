/**
 * Shared invoice posting service.
 *
 * Marks a DRAFT invoice as SENT and posts the matching billing journal atomically.
 * Billing and revenue recognition are separate accounting events. For Project lines,
 * billing first clears any revenue already earned into Contract Asset. Only the
 * residual amount becomes immediate Revenue or Unearned Income.
 *
 * JournalEntry + JournalEntryLine is the authoritative GL.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";
import { sendInvoiceEmail } from "@/lib/email-notifications/senders/invoice-sent";
import { COA_AR_CODE, COA_OUTPUT_VAT_CODE } from "@/lib/constants";
import { getSystemAccount, resolveSystemAccount } from "@/lib/accounting/system-accounts";
import {
  postJournalEntryInTransaction,
  type JournalPostingLine,
} from "@/lib/journal";

export interface PostInvoiceOptions {
  tenantId: string;
  invoiceId: string;
  userId: string;
  /** Operational sent date. Must be today or earlier. */
  sentAt: Date;
  /** Defaults to true. Bulk posting may set false. */
  sendEmail?: boolean;
}

type ReportingTags = Record<string, string> | null;

type SourceLineAllocation = {
  invoiceLineId: string;
  incomeAccountId: string;
  projectId: string | null;
  reportingTags: ReportingTags;
  amount: number;
};

type ProjectAccountingRow = {
  id: string;
  unearnedIncomeAccountId: string | null;
  contractAssetAccountId: string | null;
};

type ContractAssetRecognitionRow = {
  id: string;
  projectId: string;
  accountId: string | null;
  remaining: unknown;
};

type ContractClearance = {
  recognitionId: string;
  accountId: string;
  amount: number;
};

function normaliseReportingTags(value: Prisma.JsonValue | null): ReportingTags {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;

  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .map(([tagId, optionId]) => [tagId, optionId as string] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  return pairs.length ? Object.fromEntries(pairs) : null;
}

export async function postInvoiceAndMarkSent(
  opts: PostInvoiceOptions,
): Promise<{ success: true } | { error: string }> {
  const { tenantId, invoiceId, userId, sendEmail = true } = opts;

  const now = new Date();
  const todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  if (!(opts.sentAt instanceof Date) || Number.isNaN(opts.sentAt.getTime())) {
    return { error: "A valid sent date is required." };
  }
  if (opts.sentAt > todayEnd) {
    return { error: "Sent date cannot be in the future. Please select today or a past date." };
  }
  const sentAt = opts.sentAt;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      lines: {
        select: {
          id: true,
          amount: true,
          discountAmount: true,
          taxAmount: true,
          incomeAccountId: true,
          projectId: true,
          reportingTags: true,
        },
      },
    },
  });

  if (!invoice) return { error: "Invoice not found" };
  if (invoice.status !== "DRAFT") {
    return {
      error: `Invoice is already ${invoice.status}. Only DRAFT invoices can be marked as sent.`,
    };
  }
  if (invoice.lines.length === 0) {
    return { error: "Invoice has no line items. Add at least one line before marking as sent." };
  }

  const missingIncomeLine = invoice.lines.find((line) => !line.incomeAccountId);
  if (missingIncomeLine) {
    return {
      error:
        "One or more invoice lines are missing an income account. " +
        "Edit the invoice and assign an income account to every line.",
    };
  }

  const incomeAccountIds = Array.from(
    new Set(invoice.lines.map((line) => line.incomeAccountId!).filter(Boolean)),
  );
  const validIncomeAccounts = await prisma.chartOfAccounts.findMany({
    where: {
      tenantId,
      id: { in: incomeAccountIds },
      type: "INCOME",
      isActive: true,
    },
    select: { id: true },
  });
  const validIncomeIds = new Set(validIncomeAccounts.map((account) => account.id));
  if (incomeAccountIds.some((id) => !validIncomeIds.has(id))) {
    return {
      error:
        "One or more income accounts on this invoice are inactive or do not belong to this organisation. " +
        "Edit the invoice to reselect valid income accounts.",
    };
  }

  const projectIds = Array.from(
    new Set(invoice.lines.map((line) => line.projectId).filter((id): id is string => Boolean(id))),
  ).sort();
  if (projectIds.length) {
    const projectCount = await prisma.project.count({ where: { tenantId, id: { in: projectIds } } });
    if (projectCount !== projectIds.length) {
      return { error: "One or more Projects on this invoice are no longer available to this organisation." };
    }
  }

  const rate = parseFloat(String(invoice.exchangeRate));
  const totalAmountNGN = toNGN(parseFloat(String(invoice.totalAmount)), rate);
  const taxAmountNGN = toNGN(parseFloat(String(invoice.taxAmount)), rate);
  const invoiceDiscountNGN = toNGN(parseFloat(String(invoice.discountAmount)), rate);

  let arAccount;
  try {
    arAccount = await getSystemAccount(
      tenantId,
      "ACCOUNTS_RECEIVABLE",
      COA_AR_CODE,
    );
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Accounts Receivable is not configured." };
  }

  let vatAccountId: string | null = null;
  if (taxAmountNGN > 0.001) {
    try {
      const vatAccount = await getSystemAccount(
        tenantId,
        "OUTPUT_VAT",
        COA_OUTPUT_VAT_CODE,
      );
      vatAccountId = vatAccount.id;
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : "Output VAT is not configured." };
    }
  }

  const existingJournal = await prisma.journalEntry.findFirst({
    where: { tenantId, source: "invoice", sourceId: invoiceId },
    select: { id: true },
  });
  if (existingJournal) {
    return {
      error:
        "A journal entry already exists for this invoice. Duplicate posting prevented. " +
        "Review the invoice status before retrying.",
    };
  }

  // Preserve one evidence amount per source line. All values below are base-currency
  // amounts so the allocation evidence always agrees with the authoritative GL.
  const sourceLineAllocations: SourceLineAllocation[] = invoice.lines.map((line) => ({
    invoiceLineId: line.id,
    incomeAccountId: line.incomeAccountId!,
    projectId: line.projectId ?? null,
    reportingTags: normaliseReportingTags(line.reportingTags),
    amount: toNGN(
      parseFloat(String(line.amount)) - parseFloat(String(line.discountAmount)),
      rate,
    ),
  }));

  if (invoiceDiscountNGN > 0.001) {
    const beforeInvoiceDiscount = sourceLineAllocations.reduce((sum, line) => sum + line.amount, 0);
    if (beforeInvoiceDiscount > 0) {
      for (const line of sourceLineAllocations) {
        const reduction = Math.round(
          invoiceDiscountNGN * (line.amount / beforeInvoiceDiscount) * 100,
        ) / 100;
        line.amount = Math.round((line.amount - reduction) * 100) / 100;
      }
    }
  }

  const expectedNetSales = Math.round((totalAmountNGN - taxAmountNGN) * 100) / 100;
  const sourceLineTotal = sourceLineAllocations.reduce((sum, line) => sum + line.amount, 0);
  const sourceLineRounding = Math.round((expectedNetSales - sourceLineTotal) * 100) / 100;
  if (Math.abs(sourceLineRounding) > 1) {
    return {
      error:
        `Invoice line allocation imbalance exceeds tolerance (${sourceLineRounding} NGN). ` +
        "Please review the invoice totals.",
    };
  }
  if (sourceLineRounding !== 0 && sourceLineAllocations.length) {
    let largest = sourceLineAllocations[0];
    for (const line of sourceLineAllocations) {
      if (line.amount > largest.amount) largest = line;
    }
    largest.amount = Math.round((largest.amount + sourceLineRounding) * 100) / 100;
  }

  const fxNote = rate !== 1 ? ` (${invoice.currency} @ ${rate})` : "";

  try {
    await prisma.$transaction(async (tx) => {
      const liveInvoice = await tx.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        select: { status: true },
      });
      if (!liveInvoice) throw new Error("Invoice not found.");
      if (liveInvoice.status !== "DRAFT") {
        throw new Error(
          `Invoice is already ${liveInvoice.status}. Another request may have posted it concurrently.`,
        );
      }

      const duplicateJournal = await tx.journalEntry.findFirst({
        where: { tenantId, source: "invoice", sourceId: invoiceId },
        select: { id: true },
      });
      if (duplicateJournal) {
        throw new Error("A journal entry already exists for this invoice. Concurrent duplicate prevented.");
      }

      // Recognition and billing for the same Project share this lock. Sorting the IDs
      // gives multi-Project invoices a deterministic lock order and avoids deadlocks.
      for (const projectId of projectIds) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:project-revenue:${tenantId}:${projectId}`}))`;
      }

      const liveProjects = projectIds.length
        ? await tx.project.findMany({
            where: { tenantId, id: { in: projectIds } },
            select: {
              id: true,
              unearnedIncomeAccountId: true,
              contractAssetAccountId: true,
            },
          })
        : [];
      if (liveProjects.length !== projectIds.length) {
        throw new Error("One or more Projects changed before invoice posting could complete.");
      }
      const projectMap = new Map<string, ProjectAccountingRow>(liveProjects.map((project) => [project.id, project]));

      // Read the live, uncleared Contract Asset only after taking the Project locks.
      const contractByProject = new Map<string, Array<ContractAssetRecognitionRow & { remainingAmount: number }>>();
      for (const projectId of projectIds) {
        const recognitions = await tx.$queryRaw<ContractAssetRecognitionRow[]>`
          SELECT
            prr."id"::text AS "id",
            prr."project_id" AS "projectId",
            prr."contract_asset_account_id" AS "accountId",
            (
              prr."contract_asset_created" -
              COALESCE(SUM(
                CASE
                  WHEN ila."contract_asset_cleared" > 0 AND i."status" <> 'VOIDED' THEN rria."amount"
                  ELSE 0
                END
              ), 0)
            ) AS "remaining"
          FROM "project_revenue_recognitions" prr
          LEFT JOIN "revenue_recognition_invoice_allocations" rria
            ON rria."recognition_id" = prr."id"
          LEFT JOIN "invoice_line_revenue_allocations" ila
            ON ila."id" = rria."invoice_line_allocation_id"
          LEFT JOIN "invoices" i
            ON i."id" = ila."invoice_id" AND i."tenant_id" = ila."tenant_id"
          WHERE prr."tenant_id" = ${tenantId}::uuid
            AND prr."project_id" = ${projectId}
            AND prr."status" = 'POSTED'
            AND prr."contract_asset_created" > 0
          GROUP BY prr."id", prr."project_id", prr."contract_asset_account_id", prr."contract_asset_created",
            prr."recognition_date", prr."created_at"
          HAVING (
            prr."contract_asset_created" -
            COALESCE(SUM(
              CASE
                WHEN ila."contract_asset_cleared" > 0 AND i."status" <> 'VOIDED' THEN rria."amount"
                ELSE 0
              END
            ), 0)
          ) > 0.005
          ORDER BY prr."recognition_date" ASC, prr."created_at" ASC, prr."id" ASC
        `;

        const queue = recognitions.map((recognition) => ({
          ...recognition,
          remainingAmount: Math.round(Number(recognition.remaining ?? 0) * 100) / 100,
        }));
        for (const recognition of queue) {
          if (!recognition.accountId) {
            throw new Error("An outstanding Project Contract Asset recognition is missing its ledger account. Review the recognition history before billing.");
          }
          const account = await tx.chartOfAccounts.findFirst({
            where: { id: recognition.accountId, tenantId, type: "ASSET", isActive: true },
            select: { id: true },
          });
          if (!account) {
            throw new Error("An outstanding Project Contract Asset account is inactive or invalid. Correct the accounting configuration before billing.");
          }
        }
        contractByProject.set(projectId, queue);
      }

      let defaultUnearnedAccountId: string | null = null;
      const unearnedByProject = new Map<string, string>();
      const resolveUnearnedAccount = async (projectId: string | null) => {
        if (projectId) {
          const cached = unearnedByProject.get(projectId);
          if (cached) return cached;
          const project = projectMap.get(projectId);
          const override = project?.unearnedIncomeAccountId ?? null;
          if (override) {
            const account = await tx.chartOfAccounts.findFirst({
              where: { id: override, tenantId, type: "LIABILITY", isActive: true },
              select: { id: true },
            });
            if (!account) throw new Error("A Project Unearned Income account is inactive or invalid.");
            unearnedByProject.set(projectId, override);
            return override;
          }
        }
        if (!defaultUnearnedAccountId) {
          defaultUnearnedAccountId = (await resolveSystemAccount(tx, tenantId, "UNEARNED_REVENUE")).id;
        }
        return defaultUnearnedAccountId;
      };

      const journalLines: JournalPostingLine[] = [{
        accountId: arAccount.id,
        description: `AR - ${invoice.invoiceNumber}${fxNote}`,
        debit: totalAmountNGN,
        credit: 0,
      }];

      const evidence: Array<{
        source: SourceLineAllocation;
        contractAssetCleared: number;
        immediateRevenue: number;
        unearnedCreated: number;
        clearances: ContractClearance[];
      }> = [];

      for (const source of sourceLineAllocations) {
        let residual = source.amount;
        const clearances: ContractClearance[] = [];

        if (source.projectId && residual > 0.005) {
          const queue = contractByProject.get(source.projectId) ?? [];
          for (const recognition of queue) {
            if (residual <= 0.005) break;
            if (recognition.remainingAmount <= 0.005) continue;
            const cleared = Math.round(Math.min(residual, recognition.remainingAmount) * 100) / 100;
            if (cleared <= 0) continue;
            clearances.push({
              recognitionId: recognition.id,
              accountId: recognition.accountId!,
              amount: cleared,
            });
            journalLines.push({
              accountId: recognition.accountId!,
              description: `Contract Asset cleared - ${invoice.invoiceNumber}${fxNote}`,
              debit: 0,
              credit: cleared,
              projectId: source.projectId,
            });
            recognition.remainingAmount = Math.round((recognition.remainingAmount - cleared) * 100) / 100;
            residual = Math.round((residual - cleared) * 100) / 100;
          }
        }

        const contractAssetCleared = Math.round(clearances.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
        let immediateRevenue = 0;
        let unearnedCreated = 0;

        if (residual > 0.005) {
          if (invoice.recogniseRevenueOnInvoiceDate) {
            immediateRevenue = residual;
            journalLines.push({
              accountId: source.incomeAccountId,
              description: `Revenue - ${invoice.invoiceNumber}${fxNote}`,
              debit: 0,
              credit: residual,
              projectId: source.projectId,
              reportingTags: source.reportingTags,
            });
          } else {
            unearnedCreated = residual;
            const unearnedAccountId = await resolveUnearnedAccount(source.projectId);
            journalLines.push({
              accountId: unearnedAccountId,
              description: `Unearned Income - ${invoice.invoiceNumber}${fxNote}`,
              debit: 0,
              credit: residual,
              projectId: source.projectId,
              reportingTags: source.reportingTags,
            });
          }
        }

        evidence.push({
          source,
          contractAssetCleared,
          immediateRevenue,
          unearnedCreated,
          clearances,
        });
      }

      if (taxAmountNGN > 0.001 && vatAccountId) {
        journalLines.push({
          accountId: vatAccountId,
          description: `Output VAT - ${invoice.invoiceNumber}${fxNote}`,
          debit: 0,
          credit: taxAmountNGN,
        });
      }

      const creditTotal = journalLines.reduce((sum, line) => sum + line.credit, 0);
      const debitTotal = journalLines.reduce((sum, line) => sum + line.debit, 0);
      if (Math.abs(debitTotal - creditTotal) > 0.005) {
        throw new Error(`Invoice posting split is unbalanced: debits ${debitTotal.toFixed(2)} vs credits ${creditTotal.toFixed(2)}.`);
      }

      await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: invoice.issueDate,
        reference: invoice.invoiceNumber,
        description: `Invoice ${invoice.invoiceNumber}${fxNote}`,
        recognitionPeriod: getRecognitionPeriod(invoice.issueDate),
        source: "invoice",
        sourceId: invoiceId,
        lines: journalLines,
      });

      for (const item of evidence) {
        if (!item.source.projectId || item.source.amount <= 0) continue;
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "invoice_line_revenue_allocations" (
            "tenant_id", "project_id", "invoice_id", "invoice_line_id", "income_account_id",
            "currency", "invoice_amount", "contract_asset_cleared", "immediate_revenue", "unearned_created"
          ) VALUES (
            ${tenantId}::uuid, ${item.source.projectId}, ${invoice.id}, ${item.source.invoiceLineId},
            ${item.source.incomeAccountId}, 'NGN', ${item.source.amount}, ${item.contractAssetCleared},
            ${item.immediateRevenue}, ${item.unearnedCreated}
          )
          RETURNING "id"::text AS "id"
        `;
        const invoiceLineAllocationId = inserted[0]?.id;
        if (!invoiceLineAllocationId) throw new Error("Project invoice allocation could not be recorded.");

        for (const clearance of item.clearances) {
          await tx.$executeRaw`
            INSERT INTO "revenue_recognition_invoice_allocations" (
              "tenant_id", "recognition_id", "invoice_line_allocation_id", "amount"
            ) VALUES (
              ${tenantId}::uuid, ${clearance.recognitionId}::uuid, ${invoiceLineAllocationId}::uuid, ${clearance.amount}
            )
          `;
        }
      }

      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, tenantId, status: "DRAFT" },
        data: { status: "SENT", sentAt },
      });
      if (updated.count !== 1) {
        throw new Error(
          "Invoice status changed before the update could complete. Transaction rolled back.",
        );
      }
    });
  } catch (error: unknown) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to post invoice. Invoice status was not changed.",
    };
  }

  if (sendEmail) {
    void sendInvoiceEmail({ tenantId, invoiceId })
      .then((result) => {
        if (!result.sent) {
          console.warn(`[INVOICE_SENT] Email not sent for invoice ${invoiceId}: ${result.reason}`);
        }
      })
      .catch((error: unknown) => {
        console.error(`[INVOICE_SENT] Unexpected email error for invoice ${invoiceId}:`, error);
      });
  }

  return { success: true };
}
