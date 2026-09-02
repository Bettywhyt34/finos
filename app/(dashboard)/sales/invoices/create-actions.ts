"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createInvoice, type LineItem } from "./actions";

export async function createInvoiceControlled(data: {
  customerId: string;
  reference?: string;
  orderNumber?: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  recognitionPeriod: string;
  discountAmount: number;
  currency: string;
  exchangeRate: number;
  paymentTermsDays: number;
  recogniseRevenueOnInvoiceDate: boolean;
  customDueDate?: boolean;
  lines: LineItem[];
  invoiceNumber?: string;
  source?: string;
}) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const role = session?.user?.role;
  if (!tenantId) return { error: "Unauthorized" };

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) return { error: "Organisation base currency could not be resolved." };
  const baseCurrency = tenant.currency.trim().toUpperCase();
  const currency = data.currency.trim().toUpperCase();
  const exchangeRate = Number(data.exchangeRate);
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Select a valid invoice currency." };
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return { error: "Enter a valid invoice exchange rate." };
  if (currency === baseCurrency && Math.abs(exchangeRate - 1) > 0.000001) {
    return { error: `${baseCurrency} invoices must use an exchange rate of 1.` };
  }

  const issueDate = new Date(`${data.issueDate}T00:00:00`);
  const dueDate = new Date(`${data.dueDate}T00:00:00`);
  if (Number.isNaN(issueDate.getTime()) || Number.isNaN(dueDate.getTime())) return { error: "Enter valid invoice and due dates." };
  if (dueDate < issueDate) return { error: "Due date cannot be before the invoice date." };
  if (data.customDueDate && !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role ?? "")) {
    return { error: "You do not have permission to set a custom invoice due date." };
  }
  const paymentTermsDays = Number(data.paymentTermsDays);
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) {
    return { error: "Payment terms must be between 0 and 3650 days." };
  }

  const { customDueDate: _customDueDate, ...safeData } = data;
  return createInvoice({
    ...safeData,
    currency,
    exchangeRate: currency === baseCurrency ? 1 : exchangeRate,
    paymentTermsDays,
  });
}
