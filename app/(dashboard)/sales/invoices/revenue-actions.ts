"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postStandaloneInvoiceRevenueRecognition } from "@/lib/invoices/revenue-evidence";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function getStandaloneInvoiceDeferredState(invoiceId: string): Promise<{
  eligible: boolean;
  currency: string;
  remaining: number;
  reason?: string;
}> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return { eligible: false, currency: "NGN", remaining: 0, reason: "Your session has expired." };

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: {
      status: true,
      currency: true,
      exchangeRate: true,
      totalAmount: true,
      taxAmount: true,
      recogniseRevenueOnInvoiceDate: true,
      lines: { select: { projectId: true } },
    },
  });
  if (!invoice) return { eligible: false, currency: "NGN", remaining: 0, reason: "Invoice not found." };
  if (["DRAFT", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) {
    return { eligible: false, currency: invoice.currency, remaining: 0, reason: `Revenue cannot be recognised while the invoice is ${invoice.status}.` };
  }
  if (invoice.lines.some((line) => Boolean(line.projectId))) {
    return { eligible: false, currency: invoice.currency, remaining: 0, reason: "Use Project revenue recognition for this invoice." };
  }
  if (invoice.recogniseRevenueOnInvoiceDate) {
    return { eligible: false, currency: invoice.currency, remaining: 0, reason: "This invoice was already recognised as revenue when posted." };
  }

  const rate = Number(invoice.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { eligible: false, currency: invoice.currency, remaining: 0, reason: "Invoice exchange rate is invalid." };
  }

  const rows = await prisma.$queryRaw<Array<{ evidenceCount: bigint; remainingBase: unknown }>>`
    SELECT COUNT(*)::bigint AS "evidenceCount",
      COALESCE(SUM(
        ila."unearned_created"
        - COALESCE((SELECT SUM(a."base_amount")
          FROM "invoice_revenue_recognition_allocations" a
          JOIN "invoice_revenue_recognitions" r ON r."id" = a."recognition_id"
          WHERE a."invoice_line_allocation_id" = ila."id" AND r."status" = 'POSTED'), 0)
        - COALESCE((SELECT SUM(a."unearned_reversed")
          FROM "credit_note_service_allocations" a
          JOIN "credit_notes" c ON c."id" = a."credit_note_id"
          WHERE a."invoice_line_allocation_id" = ila."id" AND c."status" = 'APPLIED'), 0)
      ), 0) AS "remainingBase"
    FROM "invoice_line_revenue_allocations" ila
    WHERE ila."tenant_id" = ${tenantId}::uuid AND ila."invoice_id" = ${invoiceId}
  `;
  const evidenceCount = Number(rows[0]?.evidenceCount ?? 0);
  const remainingBase = evidenceCount > 0
    ? Math.max(0, roundMoney(Number(rows[0]?.remainingBase ?? 0)))
    : Math.max(0, roundMoney((Number(invoice.totalAmount) - Number(invoice.taxAmount)) * rate));
  const remaining = roundMoney(remainingBase / rate);
  return {
    eligible: remaining > 0.005,
    currency: invoice.currency,
    remaining,
    reason: remaining > 0.005 ? undefined : "There is no deferred service value left to recognise.",
  };
}

export async function recogniseStandaloneInvoiceRevenue(input: {
  invoiceId: string;
  amount: number;
  recognitionDate: string;
  note?: string;
}): Promise<{ success: true; recognitionId: string; amount: number } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to recognise revenue." };
  }

  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Recognition amount must be greater than zero." };
  const recognitionDate = new Date(`${input.recognitionDate}T00:00:00`);
  if (Number.isNaN(recognitionDate.getTime())) return { error: "Enter a valid recognition date." };
  if (recognitionDate > new Date()) return { error: "Recognition date cannot be in the future." };
  const note = input.note?.trim() || null;
  if (note && note.length > 2000) return { error: "Recognition note is too long." };

  try {
    const recognitionId = crypto.randomUUID();
    const result = await prisma.$transaction((tx) => postStandaloneInvoiceRevenueRecognition(tx, {
      tenantId,
      invoiceId: input.invoiceId,
      userId,
      recognitionId,
      recognitionDate,
      transactionAmount: amount,
      note,
    }));

    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${input.invoiceId}`);
    revalidatePath("/accounting/profit-loss");
    revalidatePath("/accounting/balance-sheet");
    return { success: true, recognitionId, amount: result.transactionAmount };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Revenue could not be recognised." };
  }
}
