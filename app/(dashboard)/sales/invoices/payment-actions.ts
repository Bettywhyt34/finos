"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";
import { consumeFxAdjustment, getActiveArFxAdjustment } from "@/lib/accounting/open-item-fx";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function normaliseReportingTags(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const pairs = Object.entries(value).filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0).sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? Object.fromEntries(pairs) as Record<string, string> : null;
}

async function lockInvoices(tx: Prisma.TransactionClient, tenantId: string, invoiceIds: string[]) {
  for (const invoiceId of [...new Set(invoiceIds)].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice:${tenantId}:${invoiceId}`}))`;
  }
}

export async function recordCustomerPayment(data: {
  customerId: string;
  paymentDate: string;
  amount: number;
  whtAmount?: number;
  method: string;
  reference?: string;
  notes?: string;
  bankAccountId?: string;
  currency: string;
  exchangeRate: number;
  invoiceAllocations: { invoiceId: string; amount: number }[];
}) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Unauthorized" };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to record customer receipts." };

  const cashAmount = roundMoney(Number(data.amount));
  const whtAmount = roundMoney(Number(data.whtAmount ?? 0));
  const grossSettled = roundMoney(cashAmount + whtAmount);
  const currency = String(data.currency || "").trim().toUpperCase();
  const exchangeRate = roundRate(Number(data.exchangeRate));
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "A valid 3-letter receipt currency is required." };
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return { error: "A valid receipt exchange rate is required." };
  if (currency === "NGN" && Math.abs(exchangeRate - 1) > 0.000001) return { error: "NGN receipts must use an exchange rate of 1." };
  if (!Number.isFinite(cashAmount) || cashAmount < 0) return { error: "Cash received cannot be negative" };
  if (!Number.isFinite(whtAmount) || whtAmount < 0) return { error: "WHT withheld cannot be negative" };
  if (grossSettled <= 0) return { error: "Gross amount settled must be greater than zero" };
  if (cashAmount > 0 && !data.bankAccountId) return { error: "Select the account that received the cash." };
  if (!data.invoiceAllocations.length) return { error: "Allocate the receipt to at least one invoice" };
  const totalAllocated = roundMoney(data.invoiceAllocations.reduce((sum, a) => sum + Number(a.amount), 0));
  if (Math.abs(totalAllocated - grossSettled) > 0.01) return { error: `Allocated amount must equal gross AR settled (${grossSettled.toFixed(2)} ${currency})` };

  const paymentDate = new Date(`${data.paymentDate}T00:00:00`);
  if (Number.isNaN(paymentDate.getTime())) return { error: "A valid payment date is required" };
  if (paymentDate > new Date()) return { error: "Payment date cannot be in the future." };

  try {
    const paymentId = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: data.customerId, tenantId }, select: { id: true } });
      if (!customer) throw new Error("Customer not found in this organisation");
      const invoiceIds = Array.from(new Set(data.invoiceAllocations.map((a) => a.invoiceId)));
      if (invoiceIds.length !== data.invoiceAllocations.length) throw new Error("Duplicate invoice allocation detected");
      await lockInvoices(tx, tenantId, invoiceIds);

      const invoices = await tx.invoice.findMany({
        where: { tenantId, customerId: data.customerId, id: { in: invoiceIds } },
        select: { id: true, invoiceNumber: true, status: true, currency: true, exchangeRate: true, amountPaid: true, balanceDue: true },
      });
      if (invoices.length !== invoiceIds.length) throw new Error("One or more allocated invoices are invalid or belong to another organisation/customer");
      const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const allocation of data.invoiceAllocations) {
        const amount = roundMoney(Number(allocation.amount));
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invoice allocation must be greater than zero");
        const invoice = invoiceMap.get(allocation.invoiceId)!;
        if (invoice.currency.toUpperCase() !== currency) throw new Error("One receipt can only be allocated to invoices in the same currency as the receipt.");
        if (["DRAFT", "VOIDED", "PAID", "WRITTEN_OFF"].includes(invoice.status)) throw new Error(`Invoice ${invoice.invoiceNumber} cannot receive a payment while ${invoice.status}`);
        if (amount - Number(invoice.balanceDue) > 0.01) throw new Error(`Allocation to ${invoice.invoiceNumber} exceeds its outstanding balance.`);
      }

      const arAccount = await resolveSystemAccount(tx, tenantId, "ACCOUNTS_RECEIVABLE", "CA-001");
      const whtReceivableAccount = whtAmount > 0 ? await resolveSystemAccount(tx, tenantId, "WHT_RECEIVABLE") : null;
      let receivingLedgerAccountId: string | null = null;
      if (cashAmount > 0) {
        const bankRows = await tx.$queryRaw<Array<{ id: string; currency: string; ledgerAccountId: string | null; ledgerType: string | null; ledgerActive: boolean | null }>>`
          SELECT ba."id",ba."currency",ba."ledger_account_id" AS "ledgerAccountId",coa."type"::text AS "ledgerType",coa."is_active" AS "ledgerActive"
          FROM "bank_accounts" ba LEFT JOIN "chart_of_accounts" coa ON coa."id"=ba."ledger_account_id" AND coa."tenant_id"=ba."tenant_id"
          WHERE ba."id"=${data.bankAccountId} AND ba."tenant_id"=${tenantId}::uuid AND ba."is_active"=true LIMIT 1
        `;
        const bank = bankRows[0];
        if (!bank) throw new Error("Select an active receiving account that belongs to this entity.");
        if (bank.currency.toUpperCase() !== currency) throw new Error(`The selected receiving account is ${bank.currency}; this receipt is ${currency}.`);
        if (!bank.ledgerAccountId || bank.ledgerType !== "ASSET" || bank.ledgerActive !== true) throw new Error("The selected receiving account is not mapped to an active Asset ledger account. Map it in Banking before recording this receipt.");
        receivingLedgerAccountId = bank.ledgerAccountId;
      }

      const allocationEvidence = [] as Array<{ invoiceId: string; amount: number; baseHistoricalArAmount: number; fxUnrealizedConsumed: number; baseArAmount: number; baseSettlementAmount: number }>;
      for (const allocation of data.invoiceAllocations) {
        const invoice = invoiceMap.get(allocation.invoiceId)!;
        const amount = roundMoney(Number(allocation.amount));
        const invoiceRate = Number(invoice.exchangeRate);
        if (!Number.isFinite(invoiceRate) || invoiceRate <= 0) throw new Error(`Invoice ${invoice.invoiceNumber} has an invalid exchange rate.`);
        const activeAdjustment = currency === "NGN" ? 0 : await getActiveArFxAdjustment(tx, tenantId, invoice.id);
        const consumed = consumeFxAdjustment(activeAdjustment, amount, Number(invoice.balanceDue));
        const historical = roundMoney(amount * invoiceRate);
        allocationEvidence.push({
          invoiceId: invoice.id,
          amount,
          baseHistoricalArAmount: historical,
          fxUnrealizedConsumed: consumed,
          baseArAmount: roundMoney(historical + consumed),
          baseSettlementAmount: roundMoney(amount * exchangeRate),
        });
      }

      const baseSettlementAmount = roundMoney(allocationEvidence.reduce((s, a) => s + a.baseSettlementAmount, 0));
      const baseCashAmount = roundMoney(cashAmount * exchangeRate);
      const baseWhtAmount = roundMoney(whtAmount * exchangeRate);
      const baseArCleared = roundMoney(allocationEvidence.reduce((s, a) => s + a.baseArAmount, 0));
      const fxDifference = roundMoney(baseSettlementAmount - baseArCleared);
      let fxGainAccountId: string | null = null;
      let fxLossAccountId: string | null = null;
      if (fxDifference > 0.01) fxGainAccountId = (await resolveSystemAccount(tx, tenantId, "FX_GAIN")).id;
      if (fxDifference < -0.01) fxLossAccountId = (await resolveSystemAccount(tx, tenantId, "FX_LOSS")).id;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:customer-payment:${tenantId}`}))`;
      const count = await tx.customerPayment.count({ where: { tenantId } });
      const paymentNumber = `RCP-${String(count + 1).padStart(5, "0")}`;
      const payment = await tx.customerPayment.create({
        data: { tenantId, customerId: data.customerId, paymentNumber, paymentDate, amount: cashAmount, method: data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD", reference: data.reference?.trim() || null, notes: data.notes?.trim() || null,
          allocations: { create: allocationEvidence.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })) } },
        select: { id: true },
      });
      await tx.$executeRaw`UPDATE "customer_payments" SET "wht_amount"=${whtAmount},"bank_account_id"=${cashAmount > 0 ? data.bankAccountId! : null},"currency"=${currency},"exchange_rate"=${exchangeRate} WHERE "id"=${payment.id} AND "tenant_id"=${tenantId}::uuid`;

      for (const allocation of allocationEvidence) {
        const updated = await tx.$executeRaw`
          UPDATE "customer_payment_allocations"
          SET "base_historical_ar_amount"=${allocation.baseHistoricalArAmount},"fx_unrealized_consumed"=${allocation.fxUnrealizedConsumed},"base_ar_amount"=${allocation.baseArAmount},"base_settlement_amount"=${allocation.baseSettlementAmount}
          WHERE "payment_id"=${payment.id} AND "invoice_id"=${allocation.invoiceId}
        `;
        if (updated !== 1) throw new Error("Customer receipt allocation evidence could not be recorded.");
        const invoice = invoiceMap.get(allocation.invoiceId)!;
        const newPaid = roundMoney(Number(invoice.amountPaid) + allocation.amount);
        const newBalance = Math.max(0, roundMoney(Number(invoice.balanceDue) - allocation.amount));
        const newStatus = newBalance <= 0.01 ? "PAID" : "PARTIAL";
        await tx.invoice.update({ where: { id: allocation.invoiceId }, data: { amountPaid: newPaid, balanceDue: newBalance, status: newStatus, paidAt: newStatus === "PAID" ? paymentDate : null } });
      }

      const lines: JournalPostingLine[] = [];
      if (receivingLedgerAccountId && baseCashAmount > 0.005) lines.push({ accountId: receivingLedgerAccountId, description: `Cash receipt - ${paymentNumber}`, debit: baseCashAmount, credit: 0 });
      if (whtReceivableAccount && baseWhtAmount > 0.005) lines.push({ accountId: whtReceivableAccount.id, description: `WHT withheld by customer - ${paymentNumber}`, debit: baseWhtAmount, credit: 0 });
      if (fxDifference < -0.01 && fxLossAccountId) lines.push({ accountId: fxLossAccountId, description: `Realised FX loss - ${paymentNumber}`, debit: Math.abs(fxDifference), credit: 0 });
      lines.push({ accountId: arAccount.id, description: `AR carrying value cleared - ${paymentNumber}`, debit: 0, credit: baseArCleared });
      if (fxDifference > 0.01 && fxGainAccountId) lines.push({ accountId: fxGainAccountId, description: `Realised FX gain - ${paymentNumber}`, debit: 0, credit: fxDifference });

      await postJournalEntryInTransaction(tx, { tenantId, createdBy: userId, entryDate: paymentDate, reference: paymentNumber,
        description: `Customer receipt ${paymentNumber}${currency !== "NGN" ? ` (${currency} @ ${exchangeRate})` : ""}`,
        recognitionPeriod: getRecognitionPeriod(paymentDate), source: "customer_payment", sourceId: payment.id, lines });
      return payment.id;
    });
    revalidatePath("/sales/invoices");
    revalidatePath("/sales/receipts");
    return { success: true, id: paymentId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function reverseCustomerPayment(data: { paymentId: string; reason: string; reversalDate: string }): Promise<{ success: true } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Unauthorized" };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to reverse customer receipts." };
  const reason = data.reason.trim();
  if (!reason) return { error: "Enter a reversal reason." };
  if (reason.length > 2000) return { error: "Reversal reason is too long." };
  const reversalDate = new Date(`${data.reversalDate}T00:00:00`);
  if (Number.isNaN(reversalDate.getTime())) return { error: "Enter a valid reversal date." };
  if (reversalDate > new Date()) return { error: "Reversal date cannot be in the future." };

  try {
    await prisma.$transaction(async (tx) => {
      const payments = await tx.$queryRaw<Array<{ id: string; status: string; paymentNumber: string; paymentDate: Date }>>`
        SELECT "id","status"::text AS "status","payment_number" AS "paymentNumber","payment_date" AS "paymentDate"
        FROM "customer_payments" WHERE "id"=${data.paymentId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const payment = payments[0];
      if (!payment) throw new Error("Customer receipt not found.");
      if (payment.status === "REVERSED") throw new Error("This customer receipt has already been reversed.");
      const allocations = await tx.$queryRaw<Array<{ invoiceId: string; amount: unknown }>>`SELECT "invoice_id" AS "invoiceId","amount" FROM "customer_payment_allocations" WHERE "payment_id"=${payment.id} ORDER BY "invoice_id"`;
      if (!allocations.length) throw new Error("This receipt has no invoice allocation evidence and cannot be reversed automatically.");
      const invoiceIds = allocations.map((a) => a.invoiceId);
      await lockInvoices(tx, tenantId, invoiceIds);

      const laterRevaluation = await tx.$queryRaw<Array<{ period: string }>>`
        SELECT fr."period"
        FROM "fx_revaluation_items" fri JOIN "fx_revaluations" fr ON fr."id"=fri."fx_revaluation_id"
        WHERE fri."tenant_id"=${tenantId}::uuid AND fri."item_type"='AR' AND fri."invoice_id"=ANY(${invoiceIds}::text[])
          AND fr."status"='POSTED'::fx_revaluation_status AND fr."revaluation_date">${payment.paymentDate}
        ORDER BY fr."revaluation_date" DESC LIMIT 1
      `;
      if (laterRevaluation[0]) throw new Error(`A later FX revaluation (${laterRevaluation[0].period}) depends on this receipt. Reverse that revaluation first.`);

      const invoices = await tx.invoice.findMany({ where: { tenantId, id: { in: invoiceIds } }, select: { id: true, invoiceNumber: true, status: true, totalAmount: true, amountPaid: true, balanceDue: true } });
      if (invoices.length !== invoiceIds.length) throw new Error("One or more allocated invoices could not be found.");
      const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const allocation of allocations) {
        const invoice = invoiceMap.get(allocation.invoiceId)!;
        if (["DRAFT", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) throw new Error(`Receipt cannot be reversed while invoice ${invoice.invoiceNumber} is ${invoice.status}.`);
        if (Number(invoice.amountPaid) + 0.01 < roundMoney(Number(allocation.amount))) throw new Error(`Invoice ${invoice.invoiceNumber} no longer contains enough recorded payment to reverse this receipt safely.`);
      }

      const originalJournal = await tx.journalEntry.findFirst({ where: { tenantId, source: "customer_payment", sourceId: payment.id, isLocked: true }, include: { lines: true } });
      if (!originalJournal) throw new Error("The original receipt journal could not be found.");
      const duplicateReversal = await tx.journalEntry.findFirst({ where: { tenantId, source: "customer_payment_reversal", sourceId: payment.id }, select: { id: true } });
      if (duplicateReversal) throw new Error("A reversal journal already exists for this receipt.");
      const reversalLines: JournalPostingLine[] = originalJournal.lines.map((line) => ({ accountId: line.accountId, description: `Reverse - ${line.description ?? payment.paymentNumber}`, debit: Number(line.credit), credit: Number(line.debit), projectId: line.projectId ?? null, reportingTags: normaliseReportingTags(line.reportingTags) }));
      const reversalJournalId = await postJournalEntryInTransaction(tx, { tenantId, createdBy: userId, entryDate: reversalDate, reference: `REV-${payment.paymentNumber}`,
        description: `Reverse customer receipt ${payment.paymentNumber}: ${reason}`, recognitionPeriod: getRecognitionPeriod(reversalDate), source: "customer_payment_reversal", sourceId: payment.id, lines: reversalLines });

      for (const allocation of allocations) {
        const invoice = invoiceMap.get(allocation.invoiceId)!;
        const amount = roundMoney(Number(allocation.amount));
        const newPaid = Math.max(0, roundMoney(Number(invoice.amountPaid) - amount));
        const newBalance = Math.min(Number(invoice.totalAmount), roundMoney(Number(invoice.balanceDue) + amount));
        await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid, balanceDue: newBalance, status: newPaid <= 0.01 ? "SENT" : "PARTIAL", paidAt: null } });
      }
      const updated = await tx.$executeRaw`UPDATE "customer_payments" SET "status"='REVERSED'::customer_payment_status,"reversed_at"=${reversalDate},"reversed_by_user_id"=${userId},"reversal_reason"=${reason},"reversal_journal_entry_id"=${reversalJournalId} WHERE "id"=${payment.id} AND "tenant_id"=${tenantId}::uuid AND "status"='POSTED'::customer_payment_status`;
      if (updated !== 1) throw new Error("Receipt status changed before reversal could complete.");
    });
    revalidatePath("/sales/receipts");
    revalidatePath("/sales/invoices");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Customer receipt could not be reversed." };
  }
}
