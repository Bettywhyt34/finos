import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";
import type { XFBill } from "./cdm";

type DbClient = Prisma.TransactionClient | typeof prisma;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function lineBaseAmount(line: XFBill["lines"][number]) {
  return roundMoney((Number(line.quantity) * Number(line.unit_price)) - Number(line.discount_amount ?? 0));
}

function lineTaxRate(base: number, taxAmount: number) {
  return base > 0 && taxAmount > 0 ? roundMoney((taxAmount / base) * 100) : 0;
}

async function resolveVendorId(db: DbClient, tenantId: string, xfVendorId: string) {
  const cached = await db.unifiedTransactionsCache.findFirst({
    where: {
      tenantId,
      sourceApp: "xpenxflow",
      sourceTable: "vendors",
      sourceId: xfVendorId,
    },
    select: { dataJson: true },
  });
  if (!cached?.dataJson) return null;

  const vendorCode = (cached.dataJson as unknown as { vendor_code?: string }).vendor_code;
  if (!vendorCode) return null;

  const vendor = await db.vendor.findUnique({
    where: { tenantId_vendorCode: { tenantId, vendorCode } },
    select: { id: true },
  });
  return vendor?.id ?? null;
}

export async function upsertXpenxflowBillAccounting(
  tenantId: string,
  xf: XFBill,
  accountMap: Map<string, string>,
): Promise<"created" | "updated"> {
  const vendorId = await resolveVendorId(prisma, tenantId, xf.vendor_id);
  if (!vendorId) {
    throw new Error(`Vendor "${xf.vendor_id}" not in FINOS. Sync vendors before bills.`);
  }

  const sourceStatus = xf.status;
  const shouldRecognise = ["approved", "partial", "paid", "overdue"].includes(sourceStatus);

  return prisma.$transaction(async (tx) => {
    const preparedLines = xf.lines.map((line) => {
      const accountId = accountMap.get(line.account_code);
      if (!accountId) {
        throw new Error(
          `No account mapping for code "${line.account_code}". Add it in Integration Settings > Account Mapping.`,
        );
      }
      const baseAmount = lineBaseAmount(line);
      const taxAmount = roundMoney(Number(line.tax_amount ?? 0));
      if (baseAmount < 0 || taxAmount < 0) {
        throw new Error(`Bill ${xf.bill_number} contains a negative purchase or VAT amount.`);
      }
      return {
        sourceLine: line,
        accountId,
        baseAmount,
        taxAmount,
        taxRate: lineTaxRate(baseAmount, taxAmount),
      };
    });

    const computedSubtotal = roundMoney(preparedLines.reduce((sum, line) => sum + line.baseAmount, 0));
    const computedLineTax = roundMoney(preparedLines.reduce((sum, line) => sum + line.taxAmount, 0));
    const headerTax = roundMoney(Number(xf.tax_amount ?? 0));
    if (computedLineTax > 0 && Math.abs(computedLineTax - headerTax) > 0.01) {
      throw new Error(
        `Bill ${xf.bill_number} line VAT (${computedLineTax}) does not agree with header VAT (${headerTax}).`,
      );
    }
    const effectiveTax = computedLineTax > 0 ? computedLineTax : headerTax;
    const headerTotal = roundMoney(Number(xf.total_amount));
    const expectedTotal = roundMoney(computedSubtotal - Number(xf.discount_amount ?? 0) + effectiveTax);
    if (Math.abs(expectedTotal - headerTotal) > 1) {
      throw new Error(
        `Bill ${xf.bill_number} components do not reconcile to the source total. Expected ${expectedTotal}, source ${headerTotal}.`,
      );
    }

    const existing = await tx.bill.findFirst({
      where: { tenantId, billNumber: xf.bill_number, vendorId },
      include: { lines: true },
    });
    const existingJournal = await tx.journalEntry.findFirst({
      where: { tenantId, source: "xpenxflow_bill", sourceId: xf.id },
      select: { id: true },
    });

    if (existingJournal && existing) {
      const amountsChanged =
        Math.abs(Number(existing.subtotal) - computedSubtotal) > 0.01 ||
        Math.abs(Number(existing.taxAmount) - effectiveTax) > 0.01 ||
        Math.abs(Number(existing.totalAmount) - headerTotal) > 0.01;
      if (amountsChanged) {
        throw new Error(
          `XpenxFlow bill ${xf.bill_number} changed after FINOS posted it. Reverse/correct the accounting before resyncing.`,
        );
      }
      return "updated";
    }

    const billData = {
      vendorId,
      billDate: new Date(xf.bill_date),
      dueDate: new Date(xf.due_date),
      currency: xf.currency,
      exchangeRate: Number(xf.exchange_rate) || 1,
      subtotal: computedSubtotal,
      taxAmount: effectiveTax,
      totalAmount: headerTotal,
      // XpenxFlow payment events are not exposed by the current client. FINOS therefore
      // recognises the liability but does not fabricate a paid/partial balance from status text.
      status: shouldRecognise ? ("RECORDED" as const) : ("DRAFT" as const),
      notes: xf.notes ?? undefined,
      vendorRef: xf.purchase_order_number ?? undefined,
    };

    let billId: string;
    let created = false;
    if (existing) {
      if (existing.status !== "DRAFT" && !existingJournal) {
        throw new Error(
          `FINOS bill ${xf.bill_number} is non-draft without an authoritative journal. Review before resyncing.`,
        );
      }
      await tx.bill.update({ where: { id: existing.id }, data: billData });
      await tx.billLine.deleteMany({ where: { billId: existing.id } });
      billId = existing.id;
    } else {
      const bill = await tx.bill.create({
        data: {
          ...billData,
          tenantId,
          billNumber: xf.bill_number,
          amountPaid: 0,
        },
        select: { id: true },
      });
      billId = bill.id;
      created = true;
    }

    for (const line of preparedLines) {
      const createdLine = await tx.billLine.create({
        data: {
          billId,
          accountId: line.accountId,
          description: line.sourceLine.description,
          quantity: Number(line.sourceLine.quantity),
          rate: Number(line.sourceLine.unit_price),
          amount: line.baseAmount,
        },
        select: { id: true },
      });
      await tx.$executeRaw`
        UPDATE "bill_lines"
        SET
          "tax_name" = ${line.taxAmount > 0 ? "VAT (XpenxFlow)" : null},
          "tax_rate" = ${line.taxRate},
          "tax_amount" = ${line.taxAmount}
        WHERE "id" = ${createdLine.id}::uuid
      `;
    }

    if (shouldRecognise) {
      const rate = Number(xf.exchange_rate) || 1;
      const ap = await resolveSystemAccount(tx, tenantId, "ACCOUNTS_PAYABLE", "CL-001");
      const inputVat = effectiveTax > 0.005
        ? await resolveSystemAccount(tx, tenantId, "INPUT_VAT")
        : null;

      const groupedCosts = new Map<string, number>();
      for (const line of preparedLines) {
        const ngn = toNGN(line.baseAmount, rate);
        groupedCosts.set(line.accountId, roundMoney((groupedCosts.get(line.accountId) ?? 0) + ngn));
      }

      const totalNGN = toNGN(headerTotal, rate);
      const vatNGN = inputVat ? toNGN(effectiveTax, rate) : 0;
      const journalLines: JournalPostingLine[] = Array.from(groupedCosts.entries()).map(([accountId, amount]) => ({
        accountId,
        description: `XpenxFlow bill cost - ${xf.bill_number}`,
        debit: amount,
        credit: 0,
      }));
      if (inputVat && vatNGN > 0.005) {
        journalLines.push({
          accountId: inputVat.id,
          description: `Recoverable Input VAT - ${xf.bill_number}`,
          debit: vatNGN,
          credit: 0,
        });
      }

      const debits = roundMoney(journalLines.reduce((sum, line) => sum + line.debit, 0));
      const diff = roundMoney(totalNGN - debits);
      if (Math.abs(diff) > 1) {
        throw new Error(`XpenxFlow bill ${xf.bill_number} journal differs from source total by ${diff} NGN.`);
      }
      if (diff !== 0 && journalLines.length) {
        journalLines[0].debit = roundMoney(journalLines[0].debit + diff);
      }
      journalLines.push({
        accountId: ap.id,
        description: `AP - ${xf.bill_number}`,
        debit: 0,
        credit: totalNGN,
      });

      await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: "xpenxflow",
        entryDate: new Date(xf.bill_date),
        reference: xf.bill_number,
        description: `XpenxFlow bill ${xf.bill_number}`,
        recognitionPeriod: getRecognitionPeriod(new Date(xf.bill_date)),
        source: "xpenxflow_bill",
        sourceId: xf.id,
        lines: journalLines,
      });
    }

    return created ? "created" : "updated";
  });
}
