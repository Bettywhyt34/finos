"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { getActiveCustomerCreditFxAdjustment } from "@/lib/accounting/open-item-fx";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normaliseReportingTags(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? Object.fromEntries(pairs) as Record<string, string> : null;
}

async function actor() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) throw new Error("Your session has expired. Please sign in again.");
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) throw new Error("You do not have permission to reverse customer-credit movements.");
  return { tenantId, userId };
}

function parseReversal(reasonInput: string, dateInput: string) {
  const reason = reasonInput.trim();
  if (!reason) throw new Error("Enter a reversal reason.");
  if (reason.length > 2000) throw new Error("Reversal reason is too long.");
  const reversalDate = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(reversalDate.getTime()) || reversalDate > new Date()) throw new Error("Enter a valid reversal date.");
  return { reason, reversalDate };
}

async function assertNoLaterCreditRevaluation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  customerCreditId: string,
  movementDate: Date,
) {
  const rows = await tx.$queryRaw<Array<{ period: string }>>`
    SELECT fr."period"
    FROM "fx_revaluation_items" fri
    INNER JOIN "fx_revaluations" fr ON fr."id"=fri."fx_revaluation_id"
    WHERE fri."tenant_id"=${tenantId}::uuid
      AND fri."item_type"='CUSTOMER_CREDIT'
      AND fri."customer_credit_id"=${customerCreditId}
      AND fr."status"='POSTED'::fx_revaluation_status
      AND fr."revaluation_date">${movementDate}
    ORDER BY fr."revaluation_date" DESC
    LIMIT 1
  `;
  if (rows[0]) throw new Error(`A later FX revaluation (${rows[0].period}) depends on this movement. Reverse that revaluation first.`);
}

async function restoreCreditCarryingValue(
  tx: Prisma.TransactionClient,
  tenantId: string,
  customerCreditId: string,
  restoredRemaining: number,
  creditRate: number,
) {
  const activeAdjustment = await getActiveCustomerCreditFxAdjustment(tx, tenantId, customerCreditId);
  await tx.$executeRaw`
    UPDATE "customer_credits"
    SET "remaining_amount"=${restoredRemaining},
        "remaining_base_amount"=${roundMoney(restoredRemaining * creditRate + activeAdjustment)},
        "status"='OPEN',
        "updated_at"=now()
    WHERE "id"=${customerCreditId} AND "tenant_id"=${tenantId}::uuid
  `;
}

export async function reverseCustomerCreditApplication(input: { applicationId: string; reason: string; reversalDate: string }) {
  try {
    const { tenantId, userId } = await actor();
    const { reason, reversalDate } = parseReversal(input.reason, input.reversalDate);

    await prisma.$transaction(async (tx) => {
      const apps = await tx.$queryRaw<Array<{ id:string; customerCreditId:string; invoiceId:string; amount:unknown; status:string; journalEntryId:string; appliedAt:Date }>>`
        SELECT "id","customer_credit_id" AS "customerCreditId","invoice_id" AS "invoiceId","amount","status",
               "journal_entry_id" AS "journalEntryId","applied_at" AS "appliedAt"
        FROM "customer_credit_applications"
        WHERE "id"=${input.applicationId} AND "tenant_id"=${tenantId}::uuid
        LIMIT 1
      `;
      const application = apps[0];
      if (!application) throw new Error("Customer-credit application not found.");
      if (application.status !== "POSTED") throw new Error("This customer-credit application has already been reversed.");

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:customer-credit:${tenantId}:${application.customerCreditId}`}))`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice:${tenantId}:${application.invoiceId}`}))`;
      await assertNoLaterCreditRevaluation(tx, tenantId, application.customerCreditId, application.appliedAt);

      const creditRows = await tx.$queryRaw<Array<{ remainingAmount:unknown; exchangeRate:unknown; originalAmount:unknown }>>`
        SELECT "remaining_amount" AS "remainingAmount","exchange_rate" AS "exchangeRate","original_amount" AS "originalAmount"
        FROM "customer_credits" WHERE "id"=${application.customerCreditId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const credit = creditRows[0];
      if (!credit) throw new Error("Customer-credit liability evidence is missing.");

      const invoice = await tx.invoice.findFirst({
        where: { id: application.invoiceId, tenantId },
        select: { id:true, invoiceNumber:true, totalAmount:true, amountPaid:true, balanceDue:true, dueDate:true, status:true, paidAt:true },
      });
      if (!invoice) throw new Error("Target invoice not found.");

      const originalJournal = await tx.journalEntry.findFirst({ where: { id:application.journalEntryId, tenantId, source:"customer_credit_application", sourceId:application.id, isLocked:true }, include:{ lines:true } });
      if (!originalJournal || !originalJournal.lines.length) throw new Error("Original customer-credit application journal is missing.");
      const duplicate = await tx.journalEntry.findFirst({ where:{ tenantId, source:"customer_credit_application_reversal", sourceId:application.id }, select:{ id:true } });
      if (duplicate) throw new Error("A reversal journal already exists for this customer-credit application.");

      const reversalLines:JournalPostingLine[]=originalJournal.lines.map((line)=>({
        accountId:line.accountId,
        description:`Reverse - ${line.description ?? invoice.invoiceNumber}`,
        debit:Number(line.credit),
        credit:Number(line.debit),
        projectId:line.projectId ?? null,
        reportingTags:normaliseReportingTags(line.reportingTags),
      }));
      const reversalJournalId=await postJournalEntryInTransaction(tx,{
        tenantId,createdBy:userId,entryDate:reversalDate,reference:`REV-CCAPP-${application.id.slice(0,8).toUpperCase()}`,
        description:`Reverse customer-credit application to ${invoice.invoiceNumber}: ${reason}`,
        recognitionPeriod:getRecognitionPeriod(reversalDate),source:"customer_credit_application_reversal",sourceId:application.id,lines:reversalLines,
      });

      const updated = await tx.$executeRaw`
        UPDATE "customer_credit_applications"
        SET "status"='REVERSED',"reversal_journal_entry_id"=${reversalJournalId},"reversed_at"=${reversalDate},"reversed_by"=${userId},"reversal_reason"=${reason}
        WHERE "id"=${application.id} AND "tenant_id"=${tenantId}::uuid AND "status"='POSTED'
      `;
      if (updated !== 1) throw new Error("Customer-credit application status changed before reversal could complete.");

      const restoredRemaining=roundMoney(Number(credit.remainingAmount)+Number(application.amount));
      if (restoredRemaining-Number(credit.originalAmount)>0.01) throw new Error("Reversal would overstate the customer-credit balance.");
      await restoreCreditCarryingValue(tx, tenantId, application.customerCreditId, restoredRemaining, Number(credit.exchangeRate));

      const settlementRows=await tx.$queryRaw<Array<{ receipts:unknown; creditNotes:unknown; customerCredits:unknown }>>`
        SELECT
          COALESCE((SELECT SUM(cpa."amount") FROM "customer_payment_allocations" cpa JOIN "customer_payments" cp ON cp."id"=cpa."payment_id" WHERE cpa."invoice_id"=${invoice.id} AND cp."status"='POSTED'::customer_payment_status),0) AS "receipts",
          COALESCE((SELECT SUM(cn."ar_applied_amount") FROM "credit_notes" cn WHERE cn."invoice_id"=${invoice.id} AND cn."status"='APPLIED'::"CreditNoteStatus"),0) AS "creditNotes",
          COALESCE((SELECT SUM(cca."amount") FROM "customer_credit_applications" cca WHERE cca."invoice_id"=${invoice.id} AND cca."status"='POSTED'),0) AS "customerCredits"
      `;
      const settlement=settlementRows[0];
      const balance=Math.max(0,roundMoney(Number(invoice.totalAmount)-Number(settlement?.receipts??0)-Number(settlement?.creditNotes??0)-Number(settlement?.customerCredits??0)));
      let status=invoice.status;
      let paidAt=invoice.paidAt;
      if(balance>0.01){
        paidAt=null;
        status=Number(invoice.amountPaid)>0.01?"PARTIAL":(invoice.dueDate<reversalDate?"OVERDUE":"SENT");
      }
      await tx.invoice.update({ where:{id:invoice.id}, data:{balanceDue:balance,status,paidAt} });
    });

    revalidatePath("/sales/customer-credits");
    revalidatePath("/sales/invoices");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/fx-revaluation");
    return { success:true as const };
  } catch(error:unknown){ return { error:error instanceof Error?error.message:"Customer-credit application could not be reversed." }; }
}

export async function reverseCustomerCreditRefund(input: { refundId:string; reason:string; reversalDate:string }) {
  try {
    const { tenantId,userId }=await actor();
    const { reason,reversalDate }=parseReversal(input.reason,input.reversalDate);
    await prisma.$transaction(async(tx)=>{
      const rows=await tx.$queryRaw<Array<{ id:string; customerCreditId:string; amount:unknown; status:string; journalEntryId:string; refundedAt:Date }>>`
        SELECT "id","customer_credit_id" AS "customerCreditId","amount","status","journal_entry_id" AS "journalEntryId","refunded_at" AS "refundedAt"
        FROM "customer_credit_refunds" WHERE "id"=${input.refundId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const refund=rows[0];
      if(!refund) throw new Error("Customer-credit refund not found.");
      if(refund.status!=="POSTED") throw new Error("This customer-credit refund has already been reversed.");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:customer-credit:${tenantId}:${refund.customerCreditId}`}))`;
      await assertNoLaterCreditRevaluation(tx, tenantId, refund.customerCreditId, refund.refundedAt);

      const creditRows = await tx.$queryRaw<Array<{ remainingAmount:unknown; exchangeRate:unknown; originalAmount:unknown }>>`
        SELECT "remaining_amount" AS "remainingAmount","exchange_rate" AS "exchangeRate","original_amount" AS "originalAmount"
        FROM "customer_credits" WHERE "id"=${refund.customerCreditId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const credit=creditRows[0];
      if(!credit) throw new Error("Customer-credit liability evidence is missing.");
      const originalJournal=await tx.journalEntry.findFirst({where:{id:refund.journalEntryId,tenantId,source:"customer_credit_refund",sourceId:refund.id,isLocked:true},include:{lines:true}});
      if(!originalJournal||!originalJournal.lines.length) throw new Error("Original customer-credit refund journal is missing.");
      const duplicate=await tx.journalEntry.findFirst({where:{tenantId,source:"customer_credit_refund_reversal",sourceId:refund.id},select:{id:true}});
      if(duplicate) throw new Error("A reversal journal already exists for this customer-credit refund.");
      const reversalJournalId=await postJournalEntryInTransaction(tx,{
        tenantId,createdBy:userId,entryDate:reversalDate,reference:`REV-CCREF-${refund.id.slice(0,8).toUpperCase()}`,
        description:`Reverse customer-credit refund: ${reason}`,recognitionPeriod:getRecognitionPeriod(reversalDate),source:"customer_credit_refund_reversal",sourceId:refund.id,
        lines:originalJournal.lines.map((line)=>({accountId:line.accountId,description:`Reverse - ${line.description??"customer credit refund"}`,debit:Number(line.credit),credit:Number(line.debit),projectId:line.projectId??null,reportingTags:normaliseReportingTags(line.reportingTags)})),
      });
      const updated=await tx.$executeRaw`
        UPDATE "customer_credit_refunds" SET "status"='REVERSED',"reversal_journal_entry_id"=${reversalJournalId},"reversed_at"=${reversalDate},"reversed_by"=${userId},"reversal_reason"=${reason}
        WHERE "id"=${refund.id} AND "tenant_id"=${tenantId}::uuid AND "status"='POSTED'
      `;
      if(updated!==1) throw new Error("Customer-credit refund status changed before reversal could complete.");
      const restoredRemaining=roundMoney(Number(credit.remainingAmount)+Number(refund.amount));
      if(restoredRemaining-Number(credit.originalAmount)>0.01) throw new Error("Reversal would overstate the customer-credit balance.");
      await restoreCreditCarryingValue(tx, tenantId, refund.customerCreditId, restoredRemaining, Number(credit.exchangeRate));
    });
    revalidatePath("/sales/customer-credits");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/fx-revaluation");
    return {success:true as const};
  } catch(error:unknown){return {error:error instanceof Error?error.message:"Customer-credit refund could not be reversed."};}
}
