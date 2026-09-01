"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod, toNGN } from "@/lib/utils";
import { sendToBettywhyt } from "@/lib/integrations/bettywhyt/webhook-sender";

async function getNextBillNumber(orgId: string): Promise<string> {
  const count = await prisma.bill.count({ where: { tenantId: orgId } });
  return `BILL-${String(count + 1).padStart(5, "0")}`;
}

export interface BillLineItem {
  itemId?: string;
  description: string;
  quantity: number;
  rate: number;
  accountId: string;
  projectId?: string;
  reportingTags?: Record<string, string>;
}

function normaliseTags(value: Prisma.JsonValue | null | undefined): Record<string, string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? Object.fromEntries(pairs) as Record<string, string> : null;
}

function lineKey(accountId: string, projectId: string | null, tags: Record<string, string> | null) {
  return JSON.stringify([
    accountId,
    projectId,
    tags ? Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)) : [],
  ]);
}

export async function createBill(data: {
  vendorId: string;
  vendorRef?: string;
  billDate: string;
  dueDate: string;
  notes?: string;
  currency: string;
  exchangeRate: number;
  lines: BillLineItem[];
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return { error: "Unauthorized" };

  if (data.lines.length === 0) return { error: "At least one line item is required" };
  if (data.lines.some((line) => !line.accountId)) {
    return { error: "Each line must have an expense or asset account" };
  }

  const vendor = await prisma.vendor.findFirst({
    where: { id: data.vendorId, tenantId: orgId },
    select: { id: true },
  });
  if (!vendor) return { error: "Vendor not found in this organisation" };

  const accountIds = Array.from(new Set(data.lines.map((line) => line.accountId)));
  const accounts = await prisma.chartOfAccounts.findMany({
    where: {
      tenantId: orgId,
      id: { in: accountIds },
      isActive: true,
      type: { in: ["ASSET", "EXPENSE"] },
    },
    select: { id: true },
  });
  const validAccountIds = new Set(accounts.map((account) => account.id));
  if (accountIds.some((id) => !validAccountIds.has(id))) {
    return { error: "One or more bill accounts are invalid, inactive, or belong to another organisation" };
  }

  const projectIds = Array.from(new Set(data.lines.map((line) => line.projectId?.trim() || "").filter(Boolean)));
  if (projectIds.length) {
    const projects = await prisma.project.findMany({
      where: { tenantId: orgId, id: { in: projectIds } },
      select: { id: true },
    });
    const validProjectIds = new Set(projects.map((project) => project.id));
    if (projectIds.some((id) => !validProjectIds.has(id))) {
      return { error: "One or more selected Projects are invalid for this organisation" };
    }
  }

  const tagOptionIds = Array.from(
    new Set(data.lines.flatMap((line) => Object.values(line.reportingTags ?? {})).filter(Boolean)),
  );
  if (tagOptionIds.length) {
    const options = await prisma.reportingTagOption.findMany({
      where: { tenantId: orgId, id: { in: tagOptionIds }, isActive: true },
      select: { id: true },
    });
    const validOptionIds = new Set(options.map((option) => option.id));
    if (tagOptionIds.some((id) => !validOptionIds.has(id))) {
      return { error: "One or more Reporting Tags are invalid for this organisation" };
    }
  }

  const rate = data.exchangeRate || 1;
  const subtotal = data.lines.reduce((sum, line) => sum + line.quantity * line.rate, 0);
  const billNumber = await getNextBillNumber(orgId);

  try {
    const bill = await prisma.bill.create({
      data: {
        tenantId: orgId,
        vendorId: data.vendorId,
        billNumber,
        vendorRef: data.vendorRef || null,
        billDate: new Date(data.billDate),
        dueDate: new Date(data.dueDate),
        status: "DRAFT",
        currency: data.currency,
        exchangeRate: rate,
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        amountPaid: 0,
        notes: data.notes || null,
        lines: {
          create: data.lines.map((line) => ({
            itemId: line.itemId || null,
            description: line.description,
            quantity: line.quantity,
            rate: line.rate,
            amount: line.quantity * line.rate,
            accountId: line.accountId,
            projectId: line.projectId?.trim() || null,
            reportingTags: line.reportingTags ?? undefined,
          })),
        },
      },
    });

    // DRAFT is an editable operational document and must not affect the GL.
    revalidatePath("/purchases/bills");
    return { success: true, id: bill.id };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Post a draft bill to AP. The bill status and GL entry commit together. */
export async function postBill(id: string) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  const bill = await prisma.bill.findFirst({
    where: { id, tenantId: orgId },
    include: { lines: true },
  });
  if (!bill) return { error: "Bill not found" };
  if (bill.status !== "DRAFT") return { error: `Bill is already ${bill.status}.` };
  if (!bill.lines.length) return { error: "Bill has no line items" };

  const rate = Number(bill.exchangeRate) || 1;
  const totalNGN = toNGN(Number(bill.totalAmount), rate);
  const fxNote = rate !== 1 ? ` (${bill.currency} @ ${rate})` : "";

  try {
    await prisma.$transaction(async (tx) => {
      const live = await tx.bill.findFirst({
        where: { id, tenantId: orgId },
        select: { status: true },
      });
      if (!live || live.status !== "DRAFT") {
        throw new Error("Bill status changed before posting could complete.");
      }

      const apAccount = await resolveSystemAccount(tx, orgId, "ACCOUNTS_PAYABLE", "CL-001");

      const groups = new Map<string, {
        accountId: string;
        projectId: string | null;
        reportingTags: Record<string, string> | null;
        amount: number;
      }>();

      for (const line of bill.lines) {
        const projectId = line.projectId ?? null;
        const reportingTags = normaliseTags(line.reportingTags);
        const key = lineKey(line.accountId, projectId, reportingTags);
        const amount = toNGN(Number(line.amount), rate);
        const current = groups.get(key);
        if (current) current.amount = Math.round((current.amount + amount) * 100) / 100;
        else groups.set(key, { accountId: line.accountId, projectId, reportingTags, amount });
      }

      const debitTotal = Array.from(groups.values()).reduce((sum, group) => sum + group.amount, 0);
      const roundingDifference = Math.round((totalNGN - debitTotal) * 100) / 100;
      if (Math.abs(roundingDifference) > 1) {
        throw new Error(`Bill journal differs from the bill total by ${roundingDifference} NGN.`);
      }
      if (roundingDifference !== 0 && groups.size) {
        let largest: ReturnType<typeof groups.get> = undefined;
        for (const group of groups.values()) {
          if (!largest || group.amount > largest.amount) largest = group;
        }
        if (largest) largest.amount = Math.round((largest.amount + roundingDifference) * 100) / 100;
      }

      const journalLines: JournalPostingLine[] = [
        ...Array.from(groups.values()).map((group) => ({
          accountId: group.accountId,
          description: `Bill cost - ${bill.billNumber}${fxNote}`,
          debit: group.amount,
          credit: 0,
          projectId: group.projectId,
          reportingTags: group.reportingTags,
        })),
        {
          accountId: apAccount.id,
          description: `AP - ${bill.billNumber}${fxNote}`,
          debit: 0,
          credit: totalNGN,
        },
      ];

      await postJournalEntryInTransaction(tx, {
        tenantId: orgId,
        createdBy: userId,
        entryDate: bill.billDate,
        reference: bill.billNumber,
        description: `Bill ${bill.billNumber}${fxNote}`,
        recognitionPeriod: getRecognitionPeriod(bill.billDate),
        source: "bill",
        sourceId: bill.id,
        lines: journalLines,
      });

      const updated = await tx.bill.updateMany({
        where: { id, tenantId: orgId, status: "DRAFT" },
        data: { status: "RECORDED" },
      });
      if (updated.count !== 1) throw new Error("Bill status changed. Posting was rolled back.");
    });

    void sendToBettywhyt(orgId, "stock_received", {
      billId: bill.id,
      billNumber: bill.billNumber,
      items: bill.lines
        .filter((line) => line.itemId)
        .map((line) => ({
          itemId: line.itemId!,
          description: line.description,
          quantity: Number(line.quantity),
        })),
    });

    revalidatePath(`/purchases/bills/${id}`);
    revalidatePath("/purchases/bills");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function recordBillPayment(data: {
  vendorId: string;
  paymentDate: string;
  amount: number;
  method: string;
  reference?: string;
  whtAmount: number;
  billAllocations: { billId: string; amount: number }[];
}) {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!orgId || !userId) return { error: "Unauthorized" };

  if (!Number.isFinite(data.amount) || data.amount <= 0) return { error: "Payment amount must be greater than zero" };
  if (!Number.isFinite(data.whtAmount) || data.whtAmount < 0 || data.whtAmount > data.amount) {
    return { error: "WHT amount must be between zero and the payment amount" };
  }
  const totalAllocated = data.billAllocations.reduce((sum, alloc) => sum + alloc.amount, 0);
  if (Math.abs(totalAllocated - data.amount) > 0.01) {
    return { error: "Allocated amount must equal payment amount" };
  }
  if (!data.billAllocations.length) return { error: "Allocate the payment to at least one bill" };

  const paymentDate = new Date(data.paymentDate);
  if (Number.isNaN(paymentDate.getTime())) return { error: "A valid payment date is required" };
  const netAmount = Math.round((data.amount - data.whtAmount) * 100) / 100;

  try {
    const paymentId = await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.findFirst({
        where: { id: data.vendorId, tenantId: orgId },
        select: { id: true },
      });
      if (!vendor) throw new Error("Vendor not found in this organisation");

      const billIds = Array.from(new Set(data.billAllocations.map((alloc) => alloc.billId)));
      if (billIds.length !== data.billAllocations.length) throw new Error("Duplicate bill allocation detected");

      const bills = await tx.bill.findMany({
        where: { tenantId: orgId, vendorId: data.vendorId, id: { in: billIds } },
        select: { id: true, totalAmount: true, amountPaid: true, status: true },
      });
      if (bills.length !== billIds.length) {
        throw new Error("One or more allocated bills are invalid or belong to another organisation/vendor");
      }

      const billMap = new Map(bills.map((bill) => [bill.id, bill]));
      for (const alloc of data.billAllocations) {
        if (!Number.isFinite(alloc.amount) || alloc.amount <= 0) throw new Error("Bill allocation must be greater than zero");
        const bill = billMap.get(alloc.billId)!;
        if (bill.status === "DRAFT") throw new Error("Draft bills must be posted before payment can be recorded");
        if (bill.status === "PAID") throw new Error("A paid bill cannot receive another allocation");
        const outstanding = Number(bill.totalAmount) - Number(bill.amountPaid);
        if (alloc.amount - outstanding > 0.01) {
          throw new Error("A bill allocation exceeds its outstanding balance");
        }
      }

      const apAccount = await resolveSystemAccount(tx, orgId, "ACCOUNTS_PAYABLE", "CL-001");
      const bankAccount = await resolveSystemAccount(tx, orgId, "DEFAULT_BANK", "CA-003");
      const whtAccount = data.whtAmount > 0
        ? await resolveSystemAccount(tx, orgId, "WHT_PAYABLE", "CL-002")
        : null;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-payment:${orgId}`}))`;
      const count = await tx.vendorPayment.count({ where: { tenantId: orgId } });
      const paymentNumber = `VPY-${String(count + 1).padStart(5, "0")}`;

      const payment = await tx.vendorPayment.create({
        data: {
          tenantId: orgId,
          vendorId: data.vendorId,
          paymentNumber,
          paymentDate,
          amount: data.amount,
          method: data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD",
          reference: data.reference || null,
          whtAmount: data.whtAmount,
        },
        select: { id: true },
      });

      for (const alloc of data.billAllocations) {
        const bill = billMap.get(alloc.billId)!;
        const newPaid = Math.round((Number(bill.amountPaid) + alloc.amount) * 100) / 100;
        const newBalance = Math.round((Number(bill.totalAmount) - newPaid) * 100) / 100;
        const newStatus = newBalance <= 0.01 ? "PAID" : "PARTIAL";
        await tx.bill.update({
          where: { id: alloc.billId },
          data: { amountPaid: newPaid, status: newStatus },
        });
      }

      const lines: JournalPostingLine[] = [
        { accountId: apAccount.id, description: `AP settled - ${paymentNumber}`, debit: data.amount, credit: 0 },
        { accountId: bankAccount.id, description: `Payment - ${paymentNumber}`, debit: 0, credit: netAmount },
      ];
      if (whtAccount && data.whtAmount > 0) {
        lines.push({
          accountId: whtAccount.id,
          description: `WHT payable - ${paymentNumber}`,
          debit: 0,
          credit: data.whtAmount,
        });
      }

      await postJournalEntryInTransaction(tx, {
        tenantId: orgId,
        createdBy: userId,
        entryDate: paymentDate,
        reference: paymentNumber,
        description: `Vendor payment ${paymentNumber}`,
        recognitionPeriod: getRecognitionPeriod(paymentDate),
        source: "vendor_payment",
        sourceId: payment.id,
        lines,
      });

      return payment.id;
    });

    revalidatePath("/purchases/bills");
    revalidatePath("/purchases/payments");
    return { success: true, id: paymentId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
