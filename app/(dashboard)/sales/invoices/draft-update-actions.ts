"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { LineItem } from "./actions";

type ResolvedLine = {
  id: string;
  itemId: string | null;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  taxRateId: string | null;
  taxName: string | null;
  taxRate: number;
  taxAmount: number;
  discountType: string;
  discountValue: number;
  discountAmount: number;
  lineTotal: number;
  incomeAccountId: string | null;
  projectId: string | null;
  reportingTags: Record<string, string>;
};

async function resolveDraftLines(tenantId: string, customerId: string, lines: LineItem[]): Promise<ResolvedLine[]> {
  const projectIds = Array.from(new Set(lines.map((line) => line.projectId?.trim() || "").filter(Boolean)));
  const validProjects = projectIds.length ? await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "projects"
    WHERE "tenant_id"=${tenantId} AND "customer_id"=${customerId}
      AND "id" IN (${Prisma.join(projectIds)})
  ` : [];
  const validProjectIds = new Set(validProjects.map((project) => project.id));
  if (projectIds.some((id) => !validProjectIds.has(id))) throw new Error("One or more selected Projects are invalid for this entity.");

  const submittedTagOptionIds = Array.from(new Set(lines.flatMap((line) => Object.values(line.reportingTags ?? {})).filter(Boolean)));
  const validTagOptions = submittedTagOptionIds.length ? await prisma.reportingTagOption.findMany({
    where: { tenantId, id: { in: submittedTagOptionIds }, isActive: true },
    select: { id: true },
  }) : [];
  const validTagOptionIds = new Set(validTagOptions.map((option) => option.id));
  if (submittedTagOptionIds.some((id) => !validTagOptionIds.has(id))) throw new Error("One or more Reporting Tags are invalid for this entity.");

  const taxIds = Array.from(new Set(lines.map((line) => line.taxRateId?.trim() || "").filter(Boolean)));
  const taxRows = taxIds.length ? await prisma.taxRate.findMany({
    where: { id: { in: taxIds }, tenantId, isActive: true },
    select: { id: true, name: true, rate: true },
  }) : [];
  const taxRateMap = new Map(taxRows.map((row) => [row.id, { name: row.name, rate: Number(row.rate) }]));

  const incomeIds = Array.from(new Set(lines.map((line) => line.incomeAccountId?.trim() || "").filter(Boolean)));
  const incomeRows = incomeIds.length ? await prisma.chartOfAccounts.findMany({
    where: { id: { in: incomeIds }, tenantId, type: "INCOME", isActive: true },
    select: { id: true },
  }) : [];
  const validIncomeIds = new Set(incomeRows.map((row) => row.id));
  if (incomeIds.some((id) => !validIncomeIds.has(id))) throw new Error("One or more income accounts are invalid, inactive, or do not belong to this organisation.");

  const fallback = await prisma.chartOfAccounts.findFirst({
    where: { tenantId, code: "IN-001", type: "INCOME", isActive: true },
    select: { id: true },
  }) ?? await prisma.chartOfAccounts.findFirst({
    where: { tenantId, type: "INCOME", isActive: true },
    orderBy: { code: "asc" },
    select: { id: true },
  });

  return lines.map((line) => {
    const gross = Number(line.quantity) * Number(line.rate);
    const discount = line.discountType === "FIXED"
      ? Math.min(Math.max(0, Number(line.discountValue)), gross)
      : gross * Math.min(Math.max(0, Number(line.discountValue)), 100) / 100;
    const taxable = gross - discount;
    const tax = taxRateMap.get(line.taxRateId?.trim() || "") ?? null;
    const taxAmount = Math.round(taxable * (tax?.rate ?? 0) / 100 * 100) / 100;
    const suppliedIncome = line.incomeAccountId?.trim() || "";
    return {
      id: crypto.randomUUID(),
      itemId: line.itemId || null,
      description: line.description,
      quantity: Number(line.quantity),
      rate: Number(line.rate),
      amount: gross,
      taxRateId: tax ? (line.taxRateId?.trim() || null) : null,
      taxName: tax?.name ?? null,
      taxRate: tax?.rate ?? 0,
      taxAmount,
      discountType: line.discountType,
      discountValue: Number(line.discountValue),
      discountAmount: Math.round(discount * 100) / 100,
      lineTotal: Math.round((taxable + taxAmount) * 100) / 100,
      incomeAccountId: suppliedIncome || fallback?.id || null,
      projectId: line.projectId?.trim() || null,
      reportingTags: Object.fromEntries(Object.entries(line.reportingTags ?? {}).filter(([, optionId]) => optionId)),
    };
  });
}

export async function updateDraftInvoiceControlled(id: string, data: {
  customerId: string;
  reference?: string;
  issueDate: string;
  dueDate: string;
  notes?: string;
  recognitionPeriod: string;
  discountAmount: number;
  currency: string;
  exchangeRate: number;
  lines: LineItem[];
  invoiceNumber?: string;
}) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Unauthorized" };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to edit draft invoices." };
  if (!data.lines.length) return { error: "At least one line item is required" };

  const [tenant, existing, customer] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    prisma.invoice.findFirst({ where: { id, tenantId }, select: { id: true, status: true, invoiceNumber: true } }),
    prisma.customer.findFirst({ where: { id: data.customerId, tenantId }, select: { id: true } }),
  ]);
  if (!tenant) return { error: "Organisation base currency could not be resolved." };
  if (!existing) return { error: "Invoice not found" };
  if (existing.status !== "DRAFT") return { error: "Only DRAFT invoices can be fully edited." };
  if (!customer) return { error: "Customer not found" };

  const issueDate = new Date(`${data.issueDate}T00:00:00`);
  const dueDate = new Date(`${data.dueDate}T00:00:00`);
  if (Number.isNaN(issueDate.getTime()) || Number.isNaN(dueDate.getTime())) return { error: "Enter valid invoice and due dates." };
  if (dueDate < issueDate) return { error: "Due date cannot be before the invoice date." };
  const baseCurrency = tenant.currency.trim().toUpperCase();
  const currency = data.currency.trim().toUpperCase();
  const exchangeRate = Number(data.exchangeRate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return { error: "Enter a valid invoice exchange rate." };
  if (currency === baseCurrency && Math.abs(exchangeRate - 1) > 0.000001) return { error: `${baseCurrency} invoices must use an exchange rate of 1.` };

  try {
    const resolved = await resolveDraftLines(tenantId, data.customerId, data.lines);
    const subtotal = resolved.reduce((sum, line) => sum + line.amount, 0);
    const lineDiscountTotal = resolved.reduce((sum, line) => sum + line.discountAmount, 0);
    const taxAmount = resolved.reduce((sum, line) => sum + line.taxAmount, 0);
    const maxDiscount = Math.max(0, subtotal - lineDiscountTotal);
    const invoiceDiscount = Math.min(Math.max(0, Number(data.discountAmount)), maxDiscount);
    const totalAmount = subtotal - lineDiscountTotal - invoiceDiscount + taxAmount;

    let finalNumber = existing.invoiceNumber;
    const requestedNumber = data.invoiceNumber?.trim();
    if (requestedNumber && requestedNumber !== existing.invoiceNumber) {
      const series = await prisma.transactionNumberSeries.findFirst({ where: { tenantId, module: "INVOICE" } });
      if (!series?.allowManualOverride) return { error: "Manual invoice number override is disabled." };
      if (series.preventDuplicates) {
        const duplicate = await prisma.invoice.findFirst({ where: { tenantId, invoiceNumber: requestedNumber, NOT: { id } }, select: { id: true } });
        if (duplicate) return { error: "This invoice number is already in use." };
      }
      finalNumber = requestedNumber;
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({
        where: { id, tenantId },
        data: {
          customerId: data.customerId,
          invoiceNumber: finalNumber,
          reference: data.reference || null,
          issueDate,
          dueDate,
          currency,
          exchangeRate: currency === baseCurrency ? 1 : exchangeRate,
          subtotal,
          discountAmount: invoiceDiscount,
          taxAmount,
          totalAmount,
          balanceDue: totalAmount,
          recognitionPeriod: data.recognitionPeriod,
          notes: data.notes || null,
          lines: {
            create: resolved.map((line) => ({
              id: line.id,
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              rate: line.rate,
              amount: line.amount,
              taxRateId: line.taxRateId,
              taxName: line.taxName,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              discountType: line.discountType,
              discountValue: line.discountValue,
              discountAmount: line.discountAmount,
              lineTotal: line.lineTotal,
              incomeAccountId: line.incomeAccountId,
            })),
          },
        },
      });
      for (const line of resolved) {
        await tx.$executeRaw`
          UPDATE "invoice_lines"
          SET "project_id"=${line.projectId}, "reporting_tags"=CAST(${JSON.stringify(line.reportingTags)} AS jsonb)
          WHERE "id"=${line.id} AND "invoice_id"=${id}
        `;
      }
    });

    revalidatePath(`/sales/invoices/${id}`);
    revalidatePath("/sales/invoices");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
