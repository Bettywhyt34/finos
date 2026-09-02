"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { getRecognitionPeriod } from "@/lib/utils";
import { ensureStandaloneInvoiceRevenueEvidence } from "@/lib/invoices/revenue-evidence";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function applyInvoiceCreditNote(input: {
  invoiceId: string;
  amount: number;
  issueDate: string;
  reason: string;
}): Promise<{ success: true; creditNoteId: string } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to create credit notes." };
  }

  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Credit amount must be greater than zero." };
  const reason = input.reason.trim();
  if (!reason) return { error: "Enter a reason for the credit note." };
  if (reason.length > 2000) return { error: "Credit note reason is too long." };
  const issueDate = new Date(`${input.issueDate}T00:00:00`);
  if (Number.isNaN(issueDate.getTime())) return { error: "Enter a valid credit note date." };
  if (issueDate > new Date()) return { error: "Credit note date cannot be in the future." };

  try {
    const creditNoteId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice:${tenantId}:${input.invoiceId}`}))`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice-revenue:${tenantId}:${input.invoiceId}`}))`;

      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, tenantId },
        select: {
          id: true,
          customerId: true,
          invoiceNumber: true,
          issueDate: true,
          status: true,
          currency: true,
          exchangeRate: true,
          totalAmount: true,
          taxAmount: true,
          amountPaid: true,
          balanceDue: true,
          lines: { select: { projectId: true } },
        },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (["DRAFT", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) {
        throw new Error(`A credit note cannot be applied while the invoice is ${invoice.status}.`);
      }
      if (issueDate < invoice.issueDate) throw new Error("Credit note date cannot be before the invoice date.");
      if (invoice.lines.some((line) => Boolean(line.projectId))) {
        throw new Error("Project-linked invoice credit notes remain blocked until Project revenue-allocation adjustments are enabled.");
      }

      const outstanding = roundMoney(Number(invoice.balanceDue));
      if (outstanding <= 0.01) throw new Error("This invoice has no outstanding balance to credit.");
      if (amount - outstanding > 0.01) {
        throw new Error(`Credit amount cannot exceed the current outstanding balance of ${outstanding.toFixed(2)} ${invoice.currency}.`);
      }
      const totalAmount = Number(invoice.totalAmount);
      const exchangeRate = Number(invoice.exchangeRate);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error("Invoice total is invalid.");
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("Invoice exchange rate is invalid.");
      const ratio = amount / totalAmount;

      const originalJournal = await tx.journalEntry.findFirst({
        where: { tenantId, source: "invoice", sourceId: invoice.id, isLocked: true },
        include: { lines: true },
      });
      if (!originalJournal) throw new Error("The original invoice journal could not be found.");

      const arLines = originalJournal.lines.filter((line) => Number(line.debit) > 0.005 && Number(line.credit) <= 0.005);
      if (arLines.length !== 1) throw new Error("The original Accounts Receivable posting cannot be identified safely.");
      const arLine = arLines[0];
      const vatLines = originalJournal.lines.filter((line) =>
        Number(line.credit) > 0.005 && (line.description ?? "").startsWith("Output VAT -"),
      );
      if (Number(invoice.taxAmount) > 0.005 && vatLines.length !== 1) {
        throw new Error("The original Output VAT posting cannot be identified safely.");
      }

      const baseAmount = roundMoney(amount * exchangeRate);
      const vatBaseAmount = vatLines.length ? roundMoney(Number(vatLines[0].credit) * ratio) : 0;
      const serviceBaseAmount = roundMoney(baseAmount - vatBaseAmount);
      if (serviceBaseAmount < -0.01) throw new Error("Credit note VAT allocation exceeds its base amount.");

      const evidence = await ensureStandaloneInvoiceRevenueEvidence(tx, tenantId, invoice.id);
      const usageRows = await tx.$queryRaw<Array<{
        id: string;
        recognised: unknown;
        priorUnearnedCredit: unknown;
        priorRevenueCredit: unknown;
      }>>`
        SELECT ila."id"::text AS "id",
          COALESCE((SELECT SUM(irra."base_amount")
            FROM "invoice_revenue_recognition_allocations" irra
            JOIN "invoice_revenue_recognitions" irr ON irr."id" = irra."recognition_id"
            WHERE irra."invoice_line_allocation_id" = ila."id" AND irr."status" = 'POSTED'), 0) AS "recognised",
          COALESCE((SELECT SUM(cnsa."unearned_reversed")
            FROM "credit_note_service_allocations" cnsa
            JOIN "credit_notes" cn ON cn."id" = cnsa."credit_note_id"
            WHERE cnsa."invoice_line_allocation_id" = ila."id" AND cn."status" = 'APPLIED'), 0) AS "priorUnearnedCredit",
          COALESCE((SELECT SUM(cnsa."revenue_reversed")
            FROM "credit_note_service_allocations" cnsa
            JOIN "credit_notes" cn ON cn."id" = cnsa."credit_note_id"
            WHERE cnsa."invoice_line_allocation_id" = ila."id" AND cn."status" = 'APPLIED'), 0) AS "priorRevenueCredit"
        FROM "invoice_line_revenue_allocations" ila
        WHERE ila."tenant_id" = ${tenantId}::uuid AND ila."invoice_id" = ${invoice.id}
      `;
      const usage = new Map(usageRows.map((row) => [row.id, row]));
      const state = evidence.map((row) => {
        const item = usage.get(row.id);
        const recognised = Number(item?.recognised ?? 0);
        const priorUnearned = Number(item?.priorUnearnedCredit ?? 0);
        const priorRevenue = Number(item?.priorRevenueCredit ?? 0);
        const unearnedRemaining = Math.max(0, roundMoney(row.unearnedCreated - recognised - priorUnearned));
        const revenueRemaining = Math.max(0, roundMoney(row.immediateRevenue + recognised - priorRevenue));
        return {
          ...row,
          unearnedRemaining,
          revenueRemaining,
          serviceRemaining: roundMoney(unearnedRemaining + revenueRemaining),
          target: 0,
        };
      });

      for (const row of state) row.target = Math.min(row.serviceRemaining, roundMoney(row.invoiceAmount * ratio));
      let allocatedService = roundMoney(state.reduce((sum, row) => sum + row.target, 0));
      let serviceDifference = roundMoney(serviceBaseAmount - allocatedService);
      if (serviceDifference > 0.005) {
        for (const row of state.sort((a, b) => a.invoiceLineId.localeCompare(b.invoiceLineId))) {
          if (serviceDifference <= 0.005) break;
          const capacity = roundMoney(row.serviceRemaining - row.target);
          if (capacity <= 0) continue;
          const extra = roundMoney(Math.min(capacity, serviceDifference));
          row.target = roundMoney(row.target + extra);
          serviceDifference = roundMoney(serviceDifference - extra);
        }
      } else if (serviceDifference < -0.005) {
        for (const row of state.sort((a, b) => b.target - a.target || a.invoiceLineId.localeCompare(b.invoiceLineId))) {
          if (serviceDifference >= -0.005) break;
          const reduction = roundMoney(Math.min(row.target, Math.abs(serviceDifference)));
          row.target = roundMoney(row.target - reduction);
          serviceDifference = roundMoney(serviceDifference + reduction);
        }
      }
      allocatedService = roundMoney(state.reduce((sum, row) => sum + row.target, 0));
      if (Math.abs(allocatedService - serviceBaseAmount) > 0.01) {
        throw new Error("The credit note service reduction exceeds the remaining invoice service value.");
      }

      const serviceAllocations: Array<{
        row: typeof state[number];
        unearnedReversed: number;
        revenueReversed: number;
      }> = [];
      const journalLines: JournalPostingLine[] = [];
      for (const row of state.filter((item) => item.target > 0.005)) {
        const unearnedReversed = roundMoney(Math.min(row.target, row.unearnedRemaining));
        const revenueReversed = roundMoney(row.target - unearnedReversed);
        if (unearnedReversed > 0.005) {
          if (!row.unearnedIncomeAccountId) throw new Error("Original Unearned Revenue account evidence is missing.");
          journalLines.push({
            accountId: row.unearnedIncomeAccountId,
            description: `Credit note - unearned service ${invoice.invoiceNumber}`,
            debit: unearnedReversed,
            credit: 0,
            reportingTags: row.reportingTags,
          });
        }
        if (revenueReversed > 0.005) {
          journalLines.push({
            accountId: row.incomeAccountId,
            description: `Credit note - earned service ${invoice.invoiceNumber}`,
            debit: revenueReversed,
            credit: 0,
            reportingTags: row.reportingTags,
          });
        }
        serviceAllocations.push({ row, unearnedReversed, revenueReversed });
      }
      if (vatBaseAmount > 0.005) {
        journalLines.push({
          accountId: vatLines[0].accountId,
          description: `Credit note - Output VAT ${invoice.invoiceNumber}`,
          debit: vatBaseAmount,
          credit: 0,
        });
      }
      journalLines.push({
        accountId: arLine.accountId,
        description: `Credit note - AR ${invoice.invoiceNumber}`,
        debit: 0,
        credit: baseAmount,
      });

      const debitTotal = roundMoney(journalLines.reduce((sum, line) => sum + line.debit, 0));
      const creditTotal = roundMoney(journalLines.reduce((sum, line) => sum + line.credit, 0));
      if (Math.abs(debitTotal - creditTotal) > 0.01) {
        throw new Error(`Credit note journal is not balanced (${debitTotal.toFixed(2)} vs ${creditTotal.toFixed(2)}).`);
      }

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:credit-note:${tenantId}`}))`;
      const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count" FROM "credit_notes" WHERE "tenant_id" = ${tenantId}::uuid
      `;
      const creditNumber = `CN-${String(Number(countRows[0]?.count ?? 0) + 1).padStart(5, "0")}`;

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: issueDate,
        reference: creditNumber,
        description: `Credit note ${creditNumber} against ${invoice.invoiceNumber}: ${reason}`,
        recognitionPeriod: getRecognitionPeriod(issueDate),
        source: "credit_note",
        sourceId: creditNoteId,
        lines: journalLines,
      });

      await tx.$executeRaw`
        INSERT INTO "credit_notes" (
          "id", "tenant_id", "customer_id", "credit_number", "invoice_id", "issue_date",
          "amount", "reason", "status", "currency", "exchange_rate", "base_amount",
          "ar_applied_amount", "customer_credit_amount", "service_base_amount", "vat_base_amount",
          "journal_entry_id", "applied_at", "created_by"
        ) VALUES (
          ${creditNoteId}, ${tenantId}::uuid, ${invoice.customerId}, ${creditNumber}, ${invoice.id}, ${issueDate},
          ${amount}, ${reason}, 'APPLIED'::"CreditNoteStatus", ${invoice.currency}, ${exchangeRate}, ${baseAmount},
          ${amount}, 0, ${serviceBaseAmount}, ${vatBaseAmount},
          ${journalEntryId}, now(), ${userId}
        )
      `;

      for (const allocation of serviceAllocations) {
        await tx.$executeRaw`
          INSERT INTO "credit_note_service_allocations" (
            "tenant_id", "credit_note_id", "invoice_line_allocation_id", "service_base_amount",
            "unearned_reversed", "revenue_reversed"
          ) VALUES (
            ${tenantId}::uuid, ${creditNoteId}, ${allocation.row.id}::uuid, ${allocation.row.target},
            ${allocation.unearnedReversed}, ${allocation.revenueReversed}
          )
        `;
      }

      const newBalance = Math.max(0, roundMoney(outstanding - amount));
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          balanceDue: newBalance,
          status: Number(invoice.amountPaid) > 0 ? "PARTIAL" : invoice.status,
          paidAt: null,
        },
      });
    });

    revalidatePath("/sales/credit-notes");
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${input.invoiceId}`);
    revalidatePath("/accounting/profit-loss");
    revalidatePath("/accounting/balance-sheet");
    return { success: true, creditNoteId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Credit note could not be applied." };
  }
}
