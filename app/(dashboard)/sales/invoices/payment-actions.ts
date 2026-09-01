"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postJournalEntryInTransaction } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function recordCustomerPayment(data: {
  customerId: string;
  paymentDate: string;
  /** Cash actually received into the business. */
  amount: number;
  /** Tax withheld by the customer and recoverable by the business. */
  whtAmount?: number;
  method: string;
  reference?: string;
  notes?: string;
  /** Gross AR settled; allocations include both cash and WHT. */
  invoiceAllocations: { invoiceId: string; amount: number }[];
}) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  if (!tenantId || !userId) return { error: "Unauthorized" };

  const cashAmount = roundMoney(data.amount);
  const whtAmount = roundMoney(data.whtAmount ?? 0);
  const grossSettled = roundMoney(cashAmount + whtAmount);

  if (!Number.isFinite(cashAmount) || cashAmount < 0) {
    return { error: "Cash received cannot be negative" };
  }
  if (!Number.isFinite(whtAmount) || whtAmount < 0) {
    return { error: "WHT withheld cannot be negative" };
  }
  if (grossSettled <= 0) {
    return { error: "Gross amount settled must be greater than zero" };
  }
  if (!data.invoiceAllocations.length) {
    return { error: "Allocate the receipt to at least one invoice" };
  }

  const totalAllocated = roundMoney(
    data.invoiceAllocations.reduce((sum, allocation) => sum + allocation.amount, 0),
  );
  if (Math.abs(totalAllocated - grossSettled) > 0.01) {
    return {
      error: `Allocated amount must equal gross AR settled (${grossSettled.toFixed(2)})`,
    };
  }

  const paymentDate = new Date(data.paymentDate);
  if (Number.isNaN(paymentDate.getTime())) return { error: "A valid payment date is required" };

  try {
    const paymentId = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: data.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw new Error("Customer not found in this organisation");

      const invoiceIds = Array.from(new Set(data.invoiceAllocations.map((allocation) => allocation.invoiceId)));
      if (invoiceIds.length !== data.invoiceAllocations.length) {
        throw new Error("Duplicate invoice allocation detected");
      }

      const invoices = await tx.invoice.findMany({
        where: {
          tenantId,
          customerId: data.customerId,
          id: { in: invoiceIds },
        },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          amountPaid: true,
          balanceDue: true,
        },
      });
      if (invoices.length !== invoiceIds.length) {
        throw new Error("One or more allocated invoices are invalid or belong to another organisation/customer");
      }

      const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const allocation of data.invoiceAllocations) {
        if (!Number.isFinite(allocation.amount) || allocation.amount <= 0) {
          throw new Error("Invoice allocation must be greater than zero");
        }
        const invoice = invoiceMap.get(allocation.invoiceId)!;
        if (["DRAFT", "VOIDED", "PAID", "WRITTEN_OFF"].includes(invoice.status)) {
          throw new Error(`Invoice ${allocation.invoiceId} cannot receive a payment while ${invoice.status}`);
        }
        const outstanding = Number(invoice.balanceDue);
        if (allocation.amount - outstanding > 0.01) {
          throw new Error("An invoice allocation exceeds its outstanding balance");
        }
      }

      const arAccount = await resolveSystemAccount(tx, tenantId, "ACCOUNTS_RECEIVABLE", "CA-001");
      const bankAccount = cashAmount > 0
        ? await resolveSystemAccount(tx, tenantId, "DEFAULT_BANK", "CA-003")
        : null;
      const whtReceivableAccount = whtAmount > 0
        ? await resolveSystemAccount(tx, tenantId, "WHT_RECEIVABLE")
        : null;

      // Prevent receipt-number collisions for concurrent customer payments.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:customer-payment:${tenantId}`}))`;
      const count = await tx.customerPayment.count({ where: { tenantId } });
      const paymentNumber = `RCP-${String(count + 1).padStart(5, "0")}`;

      const payment = await tx.customerPayment.create({
        data: {
          tenantId,
          customerId: data.customerId,
          paymentNumber,
          paymentDate,
          amount: cashAmount,
          method: data.method as "BANK_TRANSFER" | "CHECK" | "CASH" | "CARD",
          reference: data.reference || null,
          notes: data.notes || null,
          allocations: {
            create: data.invoiceAllocations.map((allocation) => ({
              invoiceId: allocation.invoiceId,
              amount: allocation.amount,
            })),
          },
        },
        select: { id: true },
      });

      // Prisma schema sync for this additive field is deferred; keep the live
      // payment row and WHT snapshot in the same transaction via scoped SQL.
      await tx.$executeRaw`
        UPDATE "customer_payments"
        SET "wht_amount" = ${whtAmount}
        WHERE "id" = ${payment.id}
          AND "tenant_id" = ${tenantId}::uuid
      `;

      for (const allocation of data.invoiceAllocations) {
        const invoice = invoiceMap.get(allocation.invoiceId)!;
        const newPaid = roundMoney(Number(invoice.amountPaid) + allocation.amount);
        const newBalance = Math.max(0, roundMoney(Number(invoice.balanceDue) - allocation.amount));
        const newStatus = newBalance <= 0.01 ? "PAID" : "PARTIAL";

        await tx.invoice.update({
          where: { id: allocation.invoiceId },
          data: {
            amountPaid: newPaid,
            balanceDue: newBalance,
            status: newStatus,
            paidAt: newStatus === "PAID" ? paymentDate : null,
          },
        });
      }

      const lines = [] as Array<{
        accountId: string;
        description: string;
        debit: number;
        credit: number;
      }>;
      if (bankAccount && cashAmount > 0) {
        lines.push({
          accountId: bankAccount.id,
          description: `Cash receipt - ${paymentNumber}`,
          debit: cashAmount,
          credit: 0,
        });
      }
      if (whtReceivableAccount && whtAmount > 0) {
        lines.push({
          accountId: whtReceivableAccount.id,
          description: `WHT withheld by customer - ${paymentNumber}`,
          debit: whtAmount,
          credit: 0,
        });
      }
      lines.push({
        accountId: arAccount.id,
        description: `AR cleared - ${paymentNumber}`,
        debit: 0,
        credit: grossSettled,
      });

      await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: paymentDate,
        reference: paymentNumber,
        description: `Customer receipt ${paymentNumber}`,
        recognitionPeriod: getRecognitionPeriod(paymentDate),
        source: "customer_payment",
        sourceId: payment.id,
        lines,
      });

      return payment.id;
    });

    revalidatePath("/sales/invoices");
    revalidatePath("/sales/receipts");
    return { success: true, id: paymentId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
