"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { consumeFxAdjustment, getActiveArFxAdjustment } from "@/lib/accounting/open-item-fx";
import { buildCreditNoteServiceReduction } from "@/lib/invoices/credit-note-service";
import { getRecognitionPeriod } from "@/lib/utils";

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
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to create credit notes." };

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
    const affectedProjects = new Set<string>();

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
          lines: {
            select: {
              id: true,
              projectId: true,
              amount: true,
              discountAmount: true,
              reportingTags: true,
            },
          },
        },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (["DRAFT", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) throw new Error(`A credit note cannot be applied while the invoice is ${invoice.status}.`);
      if (issueDate < invoice.issueDate) throw new Error("Credit note date cannot be before the invoice date.");

      const priorCredits = await tx.$queryRaw<Array<{ amount: unknown }>>`
        SELECT COALESCE(SUM("amount"),0) AS "amount"
        FROM "credit_notes"
        WHERE "tenant_id"=${tenantId}::uuid AND "invoice_id"=${invoice.id} AND "status"='APPLIED'::"CreditNoteStatus"
      `;
      const totalAmount = roundMoney(Number(invoice.totalAmount));
      const alreadyCredited = roundMoney(Number(priorCredits[0]?.amount ?? 0));
      const remainingCreditable = Math.max(0, roundMoney(totalAmount - alreadyCredited));
      if (remainingCreditable <= 0.01) throw new Error("This invoice has already been fully credited.");
      if (amount - remainingCreditable > 0.01) throw new Error(`Credit amount cannot exceed the remaining creditable invoice value of ${remainingCreditable.toFixed(2)} ${invoice.currency}.`);

      const outstanding = Math.max(0, roundMoney(Number(invoice.balanceDue)));
      const arAppliedAmount = Math.min(outstanding, amount);
      const customerCreditAmount = Math.max(0, roundMoney(amount - arAppliedAmount));
      const exchangeRate = Number(invoice.exchangeRate);
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
      const vatLines = originalJournal.lines.filter((line) => Number(line.credit) > 0.005 && (line.description ?? "").startsWith("Output VAT -"));
      if (Number(invoice.taxAmount) > 0.005 && vatLines.length !== 1) throw new Error("The original Output VAT posting cannot be identified safely.");

      const baseAmount = roundMoney(amount * exchangeRate);
      const historicalArBaseAmount = roundMoney(arAppliedAmount * exchangeRate);
      const customerCreditBaseAmount = roundMoney(customerCreditAmount * exchangeRate);
      const vatBaseAmount = vatLines.length ? roundMoney(Number(vatLines[0].credit) * ratio) : 0;
      const serviceBaseAmount = roundMoney(baseAmount - vatBaseAmount);
      if (serviceBaseAmount < -0.01) throw new Error("Credit note VAT allocation exceeds its base amount.");

      const activeArAdjustment = arAppliedAmount > 0.005
        ? await getActiveArFxAdjustment(tx, tenantId, invoice.id)
        : 0;
      const fxUnrealizedConsumed = arAppliedAmount > 0.005
        ? consumeFxAdjustment(activeArAdjustment, arAppliedAmount, outstanding)
        : 0;
      const arBaseAmount = roundMoney(historicalArBaseAmount + fxUnrealizedConsumed);

      const service = await buildCreditNoteServiceReduction(tx, {
        tenantId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        serviceBaseAmount,
        ratio,
        lines: invoice.lines,
      });
      service.projectIds.forEach((id) => affectedProjects.add(id));

      const journalLines: JournalPostingLine[] = [...service.journalLines];
      if (vatBaseAmount > 0.005) journalLines.push({
        accountId: vatLines[0].accountId,
        description: `Credit note - Output VAT ${invoice.invoiceNumber}`,
        debit: vatBaseAmount,
        credit: 0,
      });
      if (arBaseAmount > 0.005) journalLines.push({
        accountId: arLine.accountId,
        description: `Credit note - AR carrying value ${invoice.invoiceNumber}`,
        debit: 0,
        credit: arBaseAmount,
      });
      if (customerCreditBaseAmount > 0.005) {
        const customerCreditAccount = await resolveSystemAccount(tx, tenantId, "CUSTOMER_CREDIT");
        journalLines.push({
          accountId: customerCreditAccount.id,
          description: `Customer credit liability - ${invoice.invoiceNumber}`,
          debit: 0,
          credit: customerCreditBaseAmount,
        });
      }
      if (fxUnrealizedConsumed > 0.01) {
        const fxGain = await resolveSystemAccount(tx, tenantId, "FX_GAIN");
        journalLines.push({
          accountId: fxGain.id,
          description: `Reverse unrealised FX gain on credited AR - ${invoice.invoiceNumber}`,
          debit: fxUnrealizedConsumed,
          credit: 0,
        });
      } else if (fxUnrealizedConsumed < -0.01) {
        const fxLoss = await resolveSystemAccount(tx, tenantId, "FX_LOSS");
        journalLines.push({
          accountId: fxLoss.id,
          description: `Reverse unrealised FX loss on credited AR - ${invoice.invoiceNumber}`,
          debit: 0,
          credit: Math.abs(fxUnrealizedConsumed),
        });
      }

      const debitTotal = roundMoney(journalLines.reduce((sum, line) => sum + line.debit, 0));
      const creditTotal = roundMoney(journalLines.reduce((sum, line) => sum + line.credit, 0));
      if (Math.abs(debitTotal - creditTotal) > 0.01) throw new Error(`Credit note journal is not balanced (${debitTotal.toFixed(2)} vs ${creditTotal.toFixed(2)}).`);

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:credit-note:${tenantId}`}))`;
      const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count" FROM "credit_notes" WHERE "tenant_id"=${tenantId}::uuid
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
          "id","tenant_id","customer_id","credit_number","invoice_id","issue_date","amount","reason","status","currency","exchange_rate","base_amount",
          "ar_applied_amount","customer_credit_amount","service_base_amount","vat_base_amount","fx_unrealized_consumed","journal_entry_id","applied_at","created_by"
        ) VALUES (
          ${creditNoteId},${tenantId}::uuid,${invoice.customerId},${creditNumber},${invoice.id},${issueDate},${amount},${reason},'APPLIED'::"CreditNoteStatus",${invoice.currency},${exchangeRate},${baseAmount},
          ${arAppliedAmount},${customerCreditAmount},${serviceBaseAmount},${vatBaseAmount},${fxUnrealizedConsumed},${journalEntryId},now(),${userId}
        )
      `;

      if (customerCreditAmount > 0.005) {
        const customerCreditId = crypto.randomUUID();
        await tx.$executeRaw`
          INSERT INTO "customer_credits" (
            "id","tenant_id","customer_id","credit_note_id","currency","exchange_rate","original_amount","remaining_amount","original_base_amount","remaining_base_amount","status"
          ) VALUES (
            ${customerCreditId},${tenantId}::uuid,${invoice.customerId},${creditNoteId},${invoice.currency},${exchangeRate},${customerCreditAmount},${customerCreditAmount},${customerCreditBaseAmount},${customerCreditBaseAmount},'OPEN'
          )
        `;
      }

      for (const allocation of service.serviceAllocations) {
        await tx.$executeRaw`
          INSERT INTO "credit_note_service_allocations" (
            "tenant_id","credit_note_id","invoice_line_allocation_id","service_base_amount","unearned_reversed","revenue_reversed","contract_asset_restored"
          ) VALUES (
            ${tenantId}::uuid,${creditNoteId},${allocation.invoiceLineAllocationId}::uuid,${allocation.serviceBaseAmount},
            ${allocation.unearnedReversed},${allocation.revenueReversed},${allocation.contractAssetRestored}
          )
        `;
      }
      for (const adjustment of service.projectAdjustments) {
        await tx.$executeRaw`
          INSERT INTO "credit_note_project_adjustments" (
            "tenant_id","credit_note_id","invoice_line_allocation_id","source_allocation_id","source_recognition_id","adjustment_type","amount"
          ) VALUES (
            ${tenantId}::uuid,${creditNoteId},${adjustment.invoiceLineAllocationId}::uuid,${adjustment.sourceAllocationId}::uuid,
            ${adjustment.sourceRecognitionId}::uuid,${adjustment.adjustmentType},${adjustment.amount}
          )
        `;
      }

      for (const projectId of service.projectIds) {
        const projectService = roundMoney(service.serviceAllocations
          .filter((allocation) => {
            const line = invoice.lines.find((item) => item.id === service.serviceAllocations.find((a) => a.invoiceLineAllocationId === allocation.invoiceLineAllocationId)?.invoiceLineAllocationId);
            return line?.projectId === projectId;
          })
          .reduce((sum, allocation) => sum + allocation.serviceBaseAmount, 0));
        await tx.$executeRaw`
          INSERT INTO "project_activities" (
            "tenant_id","project_id","event_type","title","description","actor_id","actor_name","metadata"
          ) VALUES (
            ${tenantId}::uuid,${projectId},'CREDIT_NOTE_APPLIED','Credit note applied',
            ${`Credit note ${creditNumber} reduced Project billing/earning evidence.`},${userId},${session.user.email ?? null},
            CAST(${JSON.stringify({ creditNoteId, creditNumber, invoiceId: invoice.id, projectService })} AS jsonb)
          )
        `;
      }

      const newBalance = Math.max(0, roundMoney(outstanding - arAppliedAmount));
      await tx.invoice.update({ where: { id: invoice.id }, data: { balanceDue: newBalance } });
    });

    revalidatePath("/sales/credit-notes");
    revalidatePath("/sales/customer-credits");
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${input.invoiceId}`);
    for (const projectId of affectedProjects) {
      revalidatePath(`/projects/${projectId}`);
      revalidatePath(`/projects/${projectId}?tab=revenue`);
    }
    revalidatePath("/projects");
    revalidatePath("/accounting/profit-loss");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/fx-revaluation");
    return { success: true, creditNoteId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Credit note could not be applied." };
  }
}
