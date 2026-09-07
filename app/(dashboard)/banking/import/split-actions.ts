"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";

const TOLERANCE = 0.01;

export type StatementSplitAllocation =
  | { kind: "ACCOUNT"; accountId: string; amount: number }
  | { kind: "CUSTOMER"; customerId: string; invoiceId: string; amount: number; whtAmount?: number }
  | { kind: "VENDOR"; vendorId: string; billId: string; amount: number; whtAmount?: number };

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
  baseCurrency: string;
  ledgerAccountId: string | null;
};

type MatchEvidence = {
  journalEntryLineId: string;
  amount: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normaliseCurrency(value: string) {
  return String(value || "").trim().toUpperCase();
}

async function requestContext() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;

  if (!tenantId || !userId) throw new Error("Unauthorized");
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    throw new Error("You do not have permission to post bank statement splits.");
  }

  return { tenantId, userId };
}

async function getStatementRow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  bankTransactionId: string,
): Promise<StatementRow> {
  const rows = await tx.$queryRaw<StatementRow[]>`
    SELECT
      bt."id",
      bt."bank_account_id" AS "bankAccountId",
      bt."transaction_date" AS "transactionDate",
      bt."description",
      bt."reference",
      bt."amount",
      bt."type"::text AS "type",
      bt."journal_entry_id" AS "journalEntryId",
      UPPER(ba."currency") AS "currency",
      UPPER(t."currency") AS "baseCurrency",
      ba."ledger_account_id" AS "ledgerAccountId"
    FROM "bank_transactions" bt
    INNER JOIN "bank_accounts" ba ON ba."id" = bt."bank_account_id"
    INNER JOIN "tenants" t ON t."id" = ba."tenant_id"
    WHERE bt."id" = ${bankTransactionId}
      AND ba."tenant_id" = ${tenantId}::uuid
      AND ba."is_active" = true
    LIMIT 1
  `;

  const statement = rows[0];
  if (!statement) throw new Error("Statement row not found in this organisation.");
  if (!statement.ledgerAccountId) {
    throw new Error("Map this bank account to its Bank/Cash ledger before posting a split.");
  }
  if (statement.journalEntryId) {
    throw new Error("This statement row is already linked to accounting evidence.");
  }
  return statement;
}

async function ensureNotAlreadyAllocated(
  tx: Prisma.TransactionClient,
  tenantId: string,
  statementId: string,
) {
  const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "bank_reconciliation_matches" brm
    INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
    WHERE brs."tenant_id" = ${tenantId}::uuid
      AND brm."bank_transaction_id" = ${statementId}
  `;
  if (Number(rows[0]?.count ?? 0n) > 0) {
    throw new Error("This statement row already has reconciliation match evidence.");
  }
}

async function getTargetSession(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  statement: StatementRow,
) {
  const date = statement.transactionDate.toISOString().slice(0, 10);

  const completed = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_reconciliation_sessions"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "bank_account_id" = ${statement.bankAccountId}
      AND "status" = 'COMPLETED'
      AND ${date}::date BETWEEN "statement_from" AND "statement_to"
    LIMIT 1
  `;
  if (completed[0]) {
    throw new Error("This statement date is already inside a completed reconciliation period.");
  }

  const open = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_reconciliation_sessions"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "bank_account_id" = ${statement.bankAccountId}
      AND "status" = 'OPEN'
      AND ${date}::date BETWEEN "statement_from" AND "statement_to"
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  if (open[0]) return open[0].id;

  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`finos:bank-statement-review:${tenantId}:${statement.bankAccountId}`})
    )
  `;

  const review = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "bank_reconciliation_sessions"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "bank_account_id" = ${statement.bankAccountId}
      AND "status" = 'REVIEW'
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  if (review[0]) return review[0].id;

  const created = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "bank_reconciliation_sessions"
      ("tenant_id", "bank_account_id", "statement_from", "statement_to",
       "statement_closing_balance", "status", "completed_by")
    VALUES
      (${tenantId}::uuid, ${statement.bankAccountId}, '1900-01-01'::date,
       '2999-12-31'::date, 0, 'REVIEW', ${userId})
    RETURNING "id"
  `;
  return created[0].id;
}

async function getBankLine(
  tx: Prisma.TransactionClient,
  journalEntryId: string,
  ledgerAccountId: string,
  direction: "CREDIT" | "DEBIT",
  expectedAmount: number,
): Promise<MatchEvidence> {
  const lines = await tx.$queryRaw<Array<{ id: string; debit: unknown; credit: unknown }>>`
    SELECT "id", "debit", "credit"
    FROM "journal_entry_lines"
    WHERE "entry_id" = ${journalEntryId}
      AND "account_id" = ${ledgerAccountId}
  `;
  if (lines.length !== 1) {
    throw new Error("A split journal did not contain exactly one bank-ledger line.");
  }

  const line = lines[0];
  const bankAmount = direction === "CREDIT" ? Number(line.debit) : Number(line.credit);
  const opposite = direction === "CREDIT" ? Number(line.credit) : Number(line.debit);

  if (opposite > TOLERANCE || Math.abs(bankAmount - expectedAmount) > TOLERANCE) {
    throw new Error("A split journal bank line does not agree with its cash allocation.");
  }

  return { journalEntryLineId: line.id, amount: expectedAmount };
}

function combineAmounts<T extends { key: string; amount: number; whtAmount?: number }>(items: T[]) {
  const grouped = new Map<string, { amount: number; whtAmount: number }>();
  for (const item of items) {
    const current = grouped.get(item.key) ?? { amount: 0, whtAmount: 0 };
    current.amount = roundMoney(current.amount + item.amount);
    current.whtAmount = roundMoney(current.whtAmount + Number(item.whtAmount ?? 0));
    grouped.set(item.key, current);
  }
  return grouped;
}

async function postCustomerGroup(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    userId: string;
    statement: StatementRow;
    customerId: string;
    lines: Array<{ invoiceId: string; amount: number; whtAmount: number }>;
  },
): Promise<MatchEvidence> {
  const { tenantId, userId, statement, customerId, lines } = args;
  if (statement.type !== "CREDIT") {
    throw new Error("Customer allocations are only available for Money In.");
  }

  const invoiceGrouped = combineAmounts(
    lines.map((line) => ({
      key: line.invoiceId,
      amount: line.amount,
      whtAmount: line.whtAmount,
    })),
  );
  const invoiceIds = [...invoiceGrouped.keys()].sort();
  if (!invoiceIds.length) throw new Error("Choose at least one invoice.");

  for (const invoiceId of invoiceIds) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice:${tenantId}:${invoiceId}`}))
    `;
  }

  const customer = await tx.customer.findFirst({
    where: { id: customerId, tenantId, isActive: true },
    select: { id: true },
  });
  if (!customer) throw new Error("One of the selected customers is invalid.");

  const invoices = await tx.invoice.findMany({
    where: { tenantId, customerId, id: { in: invoiceIds } },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      exchangeRate: true,
      amountPaid: true,
      balanceDue: true,
    },
  });
  if (invoices.length !== invoiceIds.length) {
    throw new Error("One or more selected invoices do not belong to the selected customer.");
  }

  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  let cashAmount = 0;
  let whtAmount = 0;
  const invoiceAllocations: Array<{
    invoiceId: string;
    amount: number;
    baseArAmount: number;
    baseSettlementAmount: number;
  }> = [];

  for (const invoiceId of invoiceIds) {
    const invoice = invoiceMap.get(invoiceId)!;
    const split = invoiceGrouped.get(invoiceId)!;
    const gross = roundMoney(split.amount + split.whtAmount);

    if (invoice.currency.toUpperCase() !== statement.currency) {
      throw new Error(`Invoice ${invoice.invoiceNumber} is ${invoice.currency}; this bank account is ${statement.currency}.`);
    }
    if (["DRAFT", "VOIDED", "PAID", "WRITTEN_OFF"].includes(invoice.status)) {
      throw new Error(`Invoice ${invoice.invoiceNumber} cannot receive a payment while ${invoice.status}.`);
    }
    if (gross - Number(invoice.balanceDue) > TOLERANCE) {
      throw new Error(`Allocation to ${invoice.invoiceNumber} exceeds its outstanding balance.`);
    }

    const invoiceRate = Number(invoice.exchangeRate);
    if (!Number.isFinite(invoiceRate) || invoiceRate <= 0) {
      throw new Error(`Invoice ${invoice.invoiceNumber} has an invalid exchange rate.`);
    }

    cashAmount = roundMoney(cashAmount + split.amount);
    whtAmount = roundMoney(whtAmount + split.whtAmount);
    invoiceAllocations.push({
      invoiceId,
      amount: gross,
      baseArAmount: roundMoney(gross * invoiceRate),
      baseSettlementAmount: gross,
    });
  }

  const grossSettled = roundMoney(cashAmount + whtAmount);
  const arAccount = await resolveSystemAccount(tx, tenantId, "ACCOUNTS_RECEIVABLE", "CA-001");
  const whtReceivable = whtAmount > 0
    ? await resolveSystemAccount(tx, tenantId, "WHT_RECEIVABLE")
    : null;

  const baseArCleared = roundMoney(
    invoiceAllocations.reduce((sum, allocation) => sum + allocation.baseArAmount, 0),
  );
  const fxDifference = roundMoney(grossSettled - baseArCleared);
  const fxGain = fxDifference > TOLERANCE
    ? await resolveSystemAccount(tx, tenantId, "FX_GAIN")
    : null;
  const fxLoss = fxDifference < -TOLERANCE
    ? await resolveSystemAccount(tx, tenantId, "FX_LOSS")
    : null;

  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`finos:customer-payment:${tenantId}`}))
  `;
  const count = await tx.customerPayment.count({ where: { tenantId } });
  const paymentNumber = `RCP-${String(count + 1).padStart(5, "0")}`;

  const payment = await tx.customerPayment.create({
    data: {
      tenantId,
      customerId,
      paymentNumber,
      paymentDate: statement.transactionDate,
      amount: cashAmount,
      method: "BANK_TRANSFER",
      reference: statement.reference,
      notes: `Created from imported bank statement split: ${statement.description}`,
      allocations: {
        create: invoiceAllocations.map((allocation) => ({
          invoiceId: allocation.invoiceId,
          amount: allocation.amount,
        })),
      },
    },
    select: { id: true },
  });

  await tx.$executeRaw`
    UPDATE "customer_payments"
    SET "wht_amount" = ${whtAmount},
        "bank_account_id" = ${statement.bankAccountId},
        "currency" = ${statement.currency},
        "exchange_rate" = 1
    WHERE "id" = ${payment.id}
      AND "tenant_id" = ${tenantId}::uuid
  `;

  for (const allocation of invoiceAllocations) {
    const updated = await tx.$executeRaw`
      UPDATE "customer_payment_allocations"
      SET "base_ar_amount" = ${allocation.baseArAmount},
          "base_settlement_amount" = ${allocation.baseSettlementAmount}
      WHERE "payment_id" = ${payment.id}
        AND "invoice_id" = ${allocation.invoiceId}
    `;
    if (updated !== 1) {
      throw new Error("Customer receipt allocation evidence could not be recorded.");
    }

    const invoice = invoiceMap.get(allocation.invoiceId)!;
    const newPaid = roundMoney(Number(invoice.amountPaid) + allocation.amount);
    const newBalance = Math.max(0, roundMoney(Number(invoice.balanceDue) - allocation.amount));
    const newStatus = newBalance <= TOLERANCE ? "PAID" : "PARTIAL";

    await tx.invoice.update({
      where: { id: allocation.invoiceId },
      data: {
        amountPaid: newPaid,
        balanceDue: newBalance,
        status: newStatus,
        paidAt: newStatus === "PAID" ? statement.transactionDate : null,
      },
    });
  }

  const journalEntryId = await postJournalEntryInTransaction(tx, {
    tenantId,
    createdBy: userId,
    entryDate: statement.transactionDate,
    reference: paymentNumber,
    description: `Customer receipt ${paymentNumber} from bank-statement split`,
    recognitionPeriod: getRecognitionPeriod(statement.transactionDate),
    source: "customer_payment",
    sourceId: payment.id,
    lines: [
      {
        accountId: statement.ledgerAccountId!,
        description: `Cash receipt - ${paymentNumber}`,
        debit: cashAmount,
        credit: 0,
      },
      ...(whtReceivable && whtAmount > TOLERANCE
        ? [{
            accountId: whtReceivable.id,
            description: `WHT withheld by customer - ${paymentNumber}`,
            debit: whtAmount,
            credit: 0,
          }]
        : []),
      ...(fxLoss && fxDifference < -TOLERANCE
        ? [{
            accountId: fxLoss.id,
            description: `Realised FX loss - ${paymentNumber}`,
            debit: Math.abs(fxDifference),
            credit: 0,
          }]
        : []),
      {
        accountId: arAccount.id,
        description: `AR cleared - ${paymentNumber}`,
        debit: 0,
        credit: baseArCleared,
      },
      ...(fxGain && fxDifference > TOLERANCE
        ? [{
            accountId: fxGain.id,
            description: `Realised FX gain - ${paymentNumber}`,
            debit: 0,
            credit: fxDifference,
          }]
        : []),
    ],
  });

  return getBankLine(tx, journalEntryId, statement.ledgerAccountId!, statement.type, cashAmount);
}

async function postVendorGroup(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    userId: string;
    statement: StatementRow;
    vendorId: string;
    lines: Array<{ billId: string; amount: number; whtAmount: number }>;
  },
): Promise<MatchEvidence> {
  const { tenantId, userId, statement, vendorId, lines } = args;
  if (statement.type !== "DEBIT") {
    throw new Error("Vendor allocations are only available for Money Out.");
  }

  const billGrouped = combineAmounts(
    lines.map((line) => ({
      key: line.billId,
      amount: line.amount,
      whtAmount: line.whtAmount,
    })),
  );
  const billIds = [...billGrouped.keys()].sort();
  if (!billIds.length) throw new Error("Choose at least one bill.");

  for (const billId of billIds) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`finos:bill:${tenantId}:${billId}`}))
    `;
  }

  const vendor = await tx.vendor.findFirst({
    where: { id: vendorId, tenantId, isActive: true },
    select: { id: true },
  });
  if (!vendor) throw new Error("One of the selected vendors is invalid.");

  const bills = await tx.bill.findMany({
    where: { tenantId, vendorId, id: { in: billIds } },
    select: {
      id: true,
      billNumber: true,
      status: true,
      currency: true,
      exchangeRate: true,
      totalAmount: true,
      amountPaid: true,
    },
  });
  if (bills.length !== billIds.length) {
    throw new Error("One or more selected bills do not belong to the selected vendor.");
  }

  const billMap = new Map(bills.map((bill) => [bill.id, bill]));
  let cashAmount = 0;
  let whtAmount = 0;
  let baseApCleared = 0;

  for (const billId of billIds) {
    const bill = billMap.get(billId)!;
    const split = billGrouped.get(billId)!;
    const gross = roundMoney(split.amount + split.whtAmount);

    if (bill.currency.toUpperCase() !== statement.currency) {
      throw new Error(`Bill ${bill.billNumber} is ${bill.currency}; this bank account is ${statement.currency}.`);
    }
    if (["DRAFT", "PAID"].includes(bill.status)) {
      throw new Error(`Bill ${bill.billNumber} cannot receive a payment while ${bill.status}.`);
    }
    const outstanding = roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid));
    if (gross - outstanding > TOLERANCE) {
      throw new Error(`Allocation to ${bill.billNumber} exceeds its outstanding balance.`);
    }

    const billRate = Number(bill.exchangeRate);
    if (!Number.isFinite(billRate) || billRate <= 0) {
      throw new Error(`Bill ${bill.billNumber} has an invalid exchange rate.`);
    }

    cashAmount = roundMoney(cashAmount + split.amount);
    whtAmount = roundMoney(whtAmount + split.whtAmount);
    baseApCleared = roundMoney(baseApCleared + roundMoney(gross * billRate));
  }

  const grossSettlement = roundMoney(cashAmount + whtAmount);
  const ap = await resolveSystemAccount(tx, tenantId, "ACCOUNTS_PAYABLE", "CL-001");
  const whtPayable = whtAmount > 0
    ? await resolveSystemAccount(tx, tenantId, "WHT_PAYABLE", "CL-002")
    : null;
  const fxDifference = roundMoney(grossSettlement - baseApCleared);
  const fxLoss = fxDifference > TOLERANCE
    ? await resolveSystemAccount(tx, tenantId, "FX_LOSS")
    : null;
  const fxGain = fxDifference < -TOLERANCE
    ? await resolveSystemAccount(tx, tenantId, "FX_GAIN")
    : null;

  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-payment:${tenantId}`}))
  `;
  const count = await tx.vendorPayment.count({ where: { tenantId } });
  const paymentNumber = `VPY-${String(count + 1).padStart(5, "0")}`;

  const payment = await tx.vendorPayment.create({
    data: {
      tenantId,
      vendorId,
      paymentNumber,
      paymentDate: statement.transactionDate,
      amount: grossSettlement,
      method: "BANK_TRANSFER",
      reference: statement.reference,
      whtAmount,
    },
    select: { id: true },
  });

  for (const billId of billIds) {
    const bill = billMap.get(billId)!;
    const split = billGrouped.get(billId)!;
    const gross = roundMoney(split.amount + split.whtAmount);
    const newPaid = roundMoney(Number(bill.amountPaid) + gross);
    const newBalance = Math.max(0, roundMoney(Number(bill.totalAmount) - newPaid));

    await tx.bill.update({
      where: { id: bill.id },
      data: {
        amountPaid: newPaid,
        status: newBalance <= TOLERANCE ? "PAID" : "PARTIAL",
      },
    });
  }

  const journalEntryId = await postJournalEntryInTransaction(tx, {
    tenantId,
    createdBy: userId,
    entryDate: statement.transactionDate,
    reference: paymentNumber,
    description: `Vendor payment ${paymentNumber} from bank-statement split`,
    recognitionPeriod: getRecognitionPeriod(statement.transactionDate),
    source: "vendor_payment",
    sourceId: payment.id,
    lines: [
      {
        accountId: ap.id,
        description: `AP settled - ${paymentNumber}`,
        debit: baseApCleared,
        credit: 0,
      },
      ...(fxLoss && fxDifference > TOLERANCE
        ? [{
            accountId: fxLoss.id,
            description: `Realised FX loss - ${paymentNumber}`,
            debit: fxDifference,
            credit: 0,
          }]
        : []),
      {
        accountId: statement.ledgerAccountId!,
        description: `Vendor payment - ${paymentNumber}`,
        debit: 0,
        credit: cashAmount,
      },
      ...(whtPayable && whtAmount > TOLERANCE
        ? [{
            accountId: whtPayable.id,
            description: `WHT payable - ${paymentNumber}`,
            debit: 0,
            credit: whtAmount,
          }]
        : []),
      ...(fxGain && fxDifference < -TOLERANCE
        ? [{
            accountId: fxGain.id,
            description: `Realised FX gain - ${paymentNumber}`,
            debit: 0,
            credit: Math.abs(fxDifference),
          }]
        : []),
    ],
  });

  return getBankLine(tx, journalEntryId, statement.ledgerAccountId!, statement.type, cashAmount);
}

async function postAccountGroup(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    userId: string;
    statement: StatementRow;
    allocations: Array<{ accountId: string; amount: number }>;
  },
): Promise<MatchEvidence> {
  const { tenantId, userId, statement } = args;
  const grouped = new Map<string, number>();
  for (const allocation of args.allocations) {
    grouped.set(
      allocation.accountId,
      roundMoney((grouped.get(allocation.accountId) ?? 0) + allocation.amount),
    );
  }

  const accountIds = [...grouped.keys()];
  const accounts = await tx.chartOfAccounts.findMany({
    where: { tenantId, id: { in: accountIds }, isActive: true },
    select: { id: true },
  });
  const valid = new Set(accounts.map((account) => account.id));

  if (accountIds.some((accountId) => !valid.has(accountId))) {
    throw new Error("One or more split accounts are invalid for this organisation.");
  }
  if (accountIds.includes(statement.ledgerAccountId!)) {
    throw new Error("Choose counterpart accounts, not the bank ledger itself.");
  }

  const cashAmount = roundMoney([...grouped.values()].reduce((sum, amount) => sum + amount, 0));
  const bankLine = statement.type === "CREDIT"
    ? {
        accountId: statement.ledgerAccountId!,
        description: statement.description,
        debit: cashAmount,
        credit: 0,
      }
    : {
        accountId: statement.ledgerAccountId!,
        description: statement.description,
        debit: 0,
        credit: cashAmount,
      };

  const counterpartLines = [...grouped.entries()].map(([accountId, amount]) =>
    statement.type === "CREDIT"
      ? { accountId, description: statement.description, debit: 0, credit: amount }
      : { accountId, description: statement.description, debit: amount, credit: 0 },
  );

  const journalEntryId = await postJournalEntryInTransaction(tx, {
    tenantId,
    createdBy: userId,
    entryDate: statement.transactionDate,
    reference: statement.reference,
    description: `Bank statement split - ${statement.description}`,
    recognitionPeriod: getRecognitionPeriod(statement.transactionDate),
    source: "bank_statement_split",
    sourceId: statement.id,
    lines: [bankLine, ...counterpartLines],
  });

  return getBankLine(tx, journalEntryId, statement.ledgerAccountId!, statement.type, cashAmount);
}

function validateAllocations(
  statement: StatementRow,
  allocations: StatementSplitAllocation[],
) {
  if (allocations.length < 2) {
    throw new Error("A split needs at least two allocation lines.");
  }

  let bankAllocated = 0;
  let hasSubledger = false;

  for (const allocation of allocations) {
    const amount = roundMoney(Number(allocation.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Every split line needs an amount greater than zero.");
    }
    bankAllocated = roundMoney(bankAllocated + amount);

    if (allocation.kind === "ACCOUNT") {
      if (!allocation.accountId) throw new Error("Choose an account for every account split line.");
      continue;
    }

    hasSubledger = true;
    const wht = roundMoney(Number(allocation.whtAmount ?? 0));
    if (!Number.isFinite(wht) || wht < 0) throw new Error("WHT cannot be negative.");

    if (allocation.kind === "CUSTOMER") {
      if (statement.type !== "CREDIT") {
        throw new Error("Customer allocations cannot be used on Money Out.");
      }
      if (!allocation.customerId || !allocation.invoiceId) {
        throw new Error("Choose a customer and invoice for every customer split line.");
      }
    } else if (allocation.kind === "VENDOR") {
      if (statement.type !== "DEBIT") {
        throw new Error("Vendor allocations cannot be used on Money In.");
      }
      if (!allocation.vendorId || !allocation.billId) {
        throw new Error("Choose a vendor and bill for every vendor split line.");
      }
    }
  }

  const statementAmount = roundMoney(Number(statement.amount));
  if (Math.abs(bankAllocated - statementAmount) > TOLERANCE) {
    throw new Error(
      `Split bank allocations must equal the statement amount (${statementAmount.toFixed(2)} ${statement.currency}).`,
    );
  }

  if (hasSubledger && normaliseCurrency(statement.currency) !== normaliseCurrency(statement.baseCurrency)) {
    throw new Error(
      `FX-aware mixed reconciliation is not enabled yet. For now, customer/vendor Split allocations are limited to ${statement.baseCurrency} bank accounts.`,
    );
  }

  return { statementAmount, hasSubledger };
}

export async function postStatementMixedSplit(input: {
  bankTransactionId: string;
  allocations: StatementSplitAllocation[];
}) {
  try {
    const { tenantId, userId } = await requestContext();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`finos:bank-statement-split:${tenantId}:${input.bankTransactionId}`})
        )
      `;

      const statement = await getStatementRow(tx, tenantId, input.bankTransactionId);
      const { statementAmount } = validateAllocations(statement, input.allocations);
      await ensureNotAlreadyAllocated(tx, tenantId, statement.id);

      const accountAllocations = input.allocations
        .filter((allocation): allocation is Extract<StatementSplitAllocation, { kind: "ACCOUNT" }> =>
          allocation.kind === "ACCOUNT")
        .map((allocation) => ({
          accountId: allocation.accountId,
          amount: roundMoney(Number(allocation.amount)),
        }));

      const customerGroups = new Map<
        string,
        Array<{ invoiceId: string; amount: number; whtAmount: number }>
      >();
      const vendorGroups = new Map<
        string,
        Array<{ billId: string; amount: number; whtAmount: number }>
      >();

      for (const allocation of input.allocations) {
        if (allocation.kind === "CUSTOMER") {
          const lines = customerGroups.get(allocation.customerId) ?? [];
          lines.push({
            invoiceId: allocation.invoiceId,
            amount: roundMoney(Number(allocation.amount)),
            whtAmount: roundMoney(Number(allocation.whtAmount ?? 0)),
          });
          customerGroups.set(allocation.customerId, lines);
        } else if (allocation.kind === "VENDOR") {
          const lines = vendorGroups.get(allocation.vendorId) ?? [];
          lines.push({
            billId: allocation.billId,
            amount: roundMoney(Number(allocation.amount)),
            whtAmount: roundMoney(Number(allocation.whtAmount ?? 0)),
          });
          vendorGroups.set(allocation.vendorId, lines);
        }
      }

      const evidence: MatchEvidence[] = [];

      if (accountAllocations.length) {
        evidence.push(await postAccountGroup(tx, {
          tenantId,
          userId,
          statement,
          allocations: accountAllocations,
        }));
      }

      for (const [customerId, lines] of [...customerGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        evidence.push(await postCustomerGroup(tx, {
          tenantId,
          userId,
          statement,
          customerId,
          lines,
        }));
      }

      for (const [vendorId, lines] of [...vendorGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        evidence.push(await postVendorGroup(tx, {
          tenantId,
          userId,
          statement,
          vendorId,
          lines,
        }));
      }

      const evidenceTotal = roundMoney(evidence.reduce((sum, item) => sum + item.amount, 0));
      if (Math.abs(evidenceTotal - statementAmount) > TOLERANCE) {
        throw new Error("Split posting produced bank evidence that does not equal the statement amount.");
      }

      const sessionId = await getTargetSession(tx, tenantId, userId, statement);
      for (const item of evidence) {
        await tx.$executeRaw`
          INSERT INTO "bank_reconciliation_matches"
            ("session_id", "bank_transaction_id", "journal_entry_line_id", "matched_amount")
          VALUES
            (${sessionId}, ${statement.id}, ${item.journalEntryLineId}, ${item.amount})
        `;
      }

      return {
        statementId: statement.id,
        journalCount: evidence.length,
        allocationCount: input.allocations.length,
      };
    });

    revalidatePath("/banking/reconciliation");
    revalidatePath("/banking/accounts");
    revalidatePath("/sales/invoices");
    revalidatePath("/sales/receipts");
    revalidatePath("/purchases/bills");
    revalidatePath("/purchases/payments");

    return { success: true, ...result };
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : "Could not post the mixed statement split.",
    };
  }
}
