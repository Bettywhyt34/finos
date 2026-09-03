"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";
import { recordCustomerPayment } from "@/app/(dashboard)/sales/invoices/payment-actions";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

async function context() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) throw new Error("Unauthorized");
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    throw new Error("You do not have permission to post bank statement activity.");
  }
  return { tenantId, userId };
}

type StatementRow = {
  id: string;
  bankAccountId: string;
  transactionDate: Date;
  description: string;
  reference: string | null;
  amount: Prisma.Decimal;
  type: "CREDIT" | "DEBIT";
  journalEntryId: string | null;
  currency: string;
  ledgerAccountId: string | null;
};

async function getStatementRow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  bankTransactionId: string,
): Promise<StatementRow> {
  const rows = await tx.$queryRaw<StatementRow[]>`
    SELECT bt."id",
           bt."bank_account_id" AS "bankAccountId",
           bt."transaction_date" AS "transactionDate",
           bt."description",
           bt."reference",
           bt."amount",
           bt."type"::text AS "type",
           bt."journal_entry_id" AS "journalEntryId",
           ba."currency",
           ba."ledger_account_id" AS "ledgerAccountId"
    FROM "bank_transactions" bt
    INNER JOIN "bank_accounts" ba ON ba."id" = bt."bank_account_id"
    WHERE bt."id" = ${bankTransactionId}
      AND ba."tenant_id" = ${tenantId}::uuid
      AND ba."is_active" = true
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Statement row not found in this organisation.");
  if (!row.ledgerAccountId) throw new Error("Map this bank account to its Bank/Cash ledger before posting statement activity.");
  return row;
}

function validateRate(currency: string, supplied: number) {
  const rate = roundRate(Number(supplied));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Enter a valid exchange rate.");
  if (currency === "NGN" && Math.abs(rate - 1) > 0.000001) throw new Error("NGN bank activity must use an exchange rate of 1.");
  return rate;
}

export async function postStatementAccountCoding(input: {
  bankTransactionId: string;
  exchangeRate: number;
  allocations: { accountId: string; amount: number }[];
}) {
  try {
    const { tenantId, userId } = await context();
    if (!input.allocations.length) return { error: "Choose at least one account." };

    const journalEntryId = await prisma.$transaction(async (tx) => {
      const statement = await getStatementRow(tx, tenantId, input.bankTransactionId);
      if (statement.journalEntryId) return statement.journalEntryId;

      const statementAmount = roundMoney(Number(statement.amount));
      const allocations = input.allocations.map((allocation) => ({
        accountId: allocation.accountId,
        amount: roundMoney(Number(allocation.amount)),
      }));
      if (allocations.some((allocation) => !allocation.accountId || !Number.isFinite(allocation.amount) || allocation.amount <= 0)) {
        throw new Error("Every split line needs an account and an amount greater than zero.");
      }
      const allocated = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
      if (Math.abs(allocated - statementAmount) > 0.01) {
        throw new Error(`Split total must equal the statement amount (${statementAmount.toFixed(2)} ${statement.currency}).`);
      }

      const accountIds = Array.from(new Set(allocations.map((allocation) => allocation.accountId)));
      const accounts = await tx.chartOfAccounts.findMany({
        where: { tenantId, id: { in: accountIds }, isActive: true },
        select: { id: true },
      });
      const valid = new Set(accounts.map((account) => account.id));
      if (accountIds.some((accountId) => !valid.has(accountId))) throw new Error("One or more selected accounts are invalid for this organisation.");
      if (accountIds.includes(statement.ledgerAccountId!)) throw new Error("Choose the counterpart account, not the bank ledger itself.");

      const rate = validateRate(statement.currency, input.exchangeRate);
      const baseAmount = roundMoney(statementAmount * rate);
      const baseAllocations = allocations.map((allocation, index) => ({
        accountId: allocation.accountId,
        amount: index === allocations.length - 1
          ? 0
          : roundMoney(allocation.amount * rate),
      }));
      const priorBase = baseAllocations.slice(0, -1).reduce((sum, allocation) => sum + allocation.amount, 0);
      baseAllocations[baseAllocations.length - 1].amount = roundMoney(baseAmount - priorBase);

      const bankLine = statement.type === "CREDIT"
        ? { accountId: statement.ledgerAccountId!, description: statement.description, debit: baseAmount, credit: 0 }
        : { accountId: statement.ledgerAccountId!, description: statement.description, debit: 0, credit: baseAmount };
      const counterpartLines = baseAllocations.map((allocation) => statement.type === "CREDIT"
        ? { accountId: allocation.accountId, description: statement.description, debit: 0, credit: allocation.amount }
        : { accountId: allocation.accountId, description: statement.description, debit: allocation.amount, credit: 0 });

      const entryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: statement.transactionDate,
        reference: statement.reference,
        description: `Bank statement activity - ${statement.description}${statement.currency !== "NGN" ? ` (${statement.currency} @ ${rate})` : ""}`,
        recognitionPeriod: getRecognitionPeriod(statement.transactionDate),
        source: "bank_statement_activity",
        sourceId: statement.id,
        lines: [bankLine, ...counterpartLines],
      });

      await tx.bankTransaction.update({
        where: { id: statement.id },
        data: { journalEntryId: entryId },
      });
      return entryId;
    });

    revalidatePath("/banking/reconciliation");
    revalidatePath("/banking/accounts");
    return { success: true, journalEntryId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Could not post statement activity." };
  }
}

export async function postStatementCustomerPayment(input: {
  bankTransactionId: string;
  customerId: string;
  exchangeRate: number;
  whtAmount?: number;
  invoiceAllocations: { invoiceId: string; amount: number }[];
}) {
  try {
    const { tenantId } = await context();
    const statement = await prisma.$transaction((tx) => getStatementRow(tx, tenantId, input.bankTransactionId));
    if (statement.type !== "CREDIT") return { error: "Customer payments must come from Money In statement rows." };
    if (statement.journalEntryId) return { error: "This statement row is already linked to accounting evidence." };

    const cash = roundMoney(Number(statement.amount));
    const whtAmount = roundMoney(Number(input.whtAmount ?? 0));
    const result = await recordCustomerPayment({
      customerId: input.customerId,
      paymentDate: statement.transactionDate.toISOString().slice(0, 10),
      amount: cash,
      whtAmount,
      method: "BANK_TRANSFER",
      reference: statement.reference ?? undefined,
      notes: `Created from imported bank statement: ${statement.description}`,
      bankAccountId: statement.bankAccountId,
      currency: statement.currency,
      exchangeRate: validateRate(statement.currency, input.exchangeRate),
      invoiceAllocations: input.invoiceAllocations,
    });
    if (result?.error || !result?.id) return { error: result?.error ?? "Customer payment could not be recorded." };

    const journal = await prisma.journalEntry.findFirst({
      where: { tenantId, source: "customer_payment", sourceId: result.id },
      select: { id: true },
    });
    if (!journal) return { error: "Customer payment posted, but its accounting journal could not be linked to the statement row." };

    await prisma.bankTransaction.update({
      where: { id: statement.id },
      data: { journalEntryId: journal.id },
    });

    revalidatePath("/banking/reconciliation");
    revalidatePath("/sales/receipts");
    return { success: true, paymentId: result.id, journalEntryId: journal.id };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Could not record customer payment." };
  }
}

export async function postStatementVendorPayment(input: {
  bankTransactionId: string;
  vendorId: string;
  exchangeRate: number;
  whtAmount?: number;
  billAllocations: { billId: string; amount: number }[];
}) {
  try {
    const { tenantId, userId } = await context();
    const paymentId = await prisma.$transaction(async (tx) => {
      const statement = await getStatementRow(tx, tenantId, input.bankTransactionId);
      if (statement.type !== "DEBIT") throw new Error("Vendor payments must come from Money Out statement rows.");
      if (statement.journalEntryId) throw new Error("This statement row is already linked to accounting evidence.");

      const cashAmount = roundMoney(Number(statement.amount));
      const whtAmount = roundMoney(Number(input.whtAmount ?? 0));
      if (!Number.isFinite(whtAmount) || whtAmount < 0) throw new Error("WHT cannot be negative.");
      const grossSettlement = roundMoney(cashAmount + whtAmount);
      if (!input.billAllocations.length) throw new Error("Allocate the vendor payment to at least one bill.");
      const allocated = roundMoney(input.billAllocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0));
      if (Math.abs(allocated - grossSettlement) > 0.01) {
        throw new Error(`Bill allocations must equal cash plus WHT (${grossSettlement.toFixed(2)} ${statement.currency}).`);
      }

      const vendor = await tx.vendor.findFirst({ where: { id: input.vendorId, tenantId }, select: { id: true } });
      if (!vendor) throw new Error("Vendor not found in this organisation.");

      const billIds = Array.from(new Set(input.billAllocations.map((allocation) => allocation.billId)));
      if (billIds.length !== input.billAllocations.length) throw new Error("Duplicate bill allocation detected.");
      const bills = await tx.bill.findMany({
        where: { tenantId, vendorId: input.vendorId, id: { in: billIds } },
        select: { id: true, billNumber: true, status: true, currency: true, exchangeRate: true, totalAmount: true, amountPaid: true },
      });
      if (bills.length !== billIds.length) throw new Error("One or more selected bills are invalid for this vendor.");
      const billMap = new Map(bills.map((bill) => [bill.id, bill]));
      for (const allocation of input.billAllocations) {
        const amount = roundMoney(Number(allocation.amount));
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Bill allocation must be greater than zero.");
        const bill = billMap.get(allocation.billId)!;
        if (bill.currency.toUpperCase() !== statement.currency.toUpperCase()) {
          throw new Error(`Bill ${bill.billNumber} is ${bill.currency}; this bank account is ${statement.currency}.`);
        }
        if (["DRAFT", "PAID"].includes(bill.status)) throw new Error(`Bill ${bill.billNumber} cannot receive this payment while ${bill.status}.`);
        const outstanding = roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid));
        if (amount - outstanding > 0.01) throw new Error(`Allocation to ${bill.billNumber} exceeds its outstanding balance.`);
      }

      const rate = validateRate(statement.currency, input.exchangeRate);
      const ap = await resolveSystemAccount(tx, tenantId, "ACCOUNTS_PAYABLE", "CL-001");
      const whtPayable = whtAmount > 0 ? await resolveSystemAccount(tx, tenantId, "WHT_PAYABLE", "CL-002") : null;

      const baseCash = roundMoney(cashAmount * rate);
      const baseWht = roundMoney(whtAmount * rate);
      const baseSettlement = roundMoney(grossSettlement * rate);
      let baseApCleared = 0;
      for (const allocation of input.billAllocations) {
        const bill = billMap.get(allocation.billId)!;
        baseApCleared = roundMoney(baseApCleared + roundMoney(Number(allocation.amount) * Number(bill.exchangeRate)));
      }
      const fxDifference = roundMoney(baseSettlement - baseApCleared);
      const fxLoss = fxDifference > 0.01 ? await resolveSystemAccount(tx, tenantId, "FX_LOSS") : null;
      const fxGain = fxDifference < -0.01 ? await resolveSystemAccount(tx, tenantId, "FX_GAIN") : null;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-payment:${tenantId}`}))`;
      const count = await tx.vendorPayment.count({ where: { tenantId } });
      const paymentNumber = `VPY-${String(count + 1).padStart(5, "0")}`;
      const payment = await tx.vendorPayment.create({
        data: {
          tenantId,
          vendorId: input.vendorId,
          paymentNumber,
          paymentDate: statement.transactionDate,
          amount: grossSettlement,
          method: "BANK_TRANSFER",
          reference: statement.reference,
          whtAmount,
        },
        select: { id: true },
      });

      for (const allocation of input.billAllocations) {
        const bill = billMap.get(allocation.billId)!;
        const amount = roundMoney(Number(allocation.amount));
        const newPaid = roundMoney(Number(bill.amountPaid) + amount);
        const newBalance = roundMoney(Number(bill.totalAmount) - newPaid);
        await tx.bill.update({
          where: { id: bill.id },
          data: { amountPaid: newPaid, status: newBalance <= 0.01 ? "PAID" : "PARTIAL" },
        });
      }

      const lines = [
        { accountId: ap.id, description: `AP settled - ${paymentNumber}`, debit: baseApCleared, credit: 0 },
        ...(fxLoss ? [{ accountId: fxLoss.id, description: `Realised FX loss - ${paymentNumber}`, debit: fxDifference, credit: 0 }] : []),
        { accountId: statement.ledgerAccountId!, description: `Vendor payment - ${paymentNumber}`, debit: 0, credit: baseCash },
        ...(whtPayable && baseWht > 0 ? [{ accountId: whtPayable.id, description: `WHT payable - ${paymentNumber}`, debit: 0, credit: baseWht }] : []),
        ...(fxGain ? [{ accountId: fxGain.id, description: `Realised FX gain - ${paymentNumber}`, debit: 0, credit: Math.abs(fxDifference) }] : []),
      ];
      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: statement.transactionDate,
        reference: paymentNumber,
        description: `Vendor payment ${paymentNumber}${statement.currency !== "NGN" ? ` (${statement.currency} @ ${rate})` : ""}`,
        recognitionPeriod: getRecognitionPeriod(statement.transactionDate),
        source: "vendor_payment",
        sourceId: payment.id,
        lines,
      });

      await tx.bankTransaction.update({ where: { id: statement.id }, data: { journalEntryId } });
      return payment.id;
    });

    revalidatePath("/purchases/bills");
    revalidatePath("/purchases/payments");
    revalidatePath("/banking/reconciliation");
    return { success: true, paymentId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Could not record vendor payment." };
  }
}
