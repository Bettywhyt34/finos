"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateTransactionNumber } from "@/lib/customization/service";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export interface QuoteLineInput {
  itemId?: string;
  description: string;
  quantity: number;
  rate: number;
  taxRateId?: string;
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  incomeAccountId?: string;
  projectId?: string;
  reportingTags?: Record<string, string>;
}

export async function createQuote(input: {
  customerId: string;
  issueDate: string;
  expiryDate: string;
  currency: string;
  exchangeRate: number;
  discountAmount?: number;
  reference?: string;
  orderNumber?: string;
  notes?: string;
  lines: QuoteLineInput[];
}): Promise<{ success: true; quoteId: string } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to create quotes." };
  }

  const issueDate = new Date(`${input.issueDate}T00:00:00`);
  const expiryDate = new Date(`${input.expiryDate}T00:00:00`);
  if (Number.isNaN(issueDate.getTime()) || Number.isNaN(expiryDate.getTime())) return { error: "Enter valid quote dates." };
  if (expiryDate < issueDate) return { error: "Quote expiry date cannot be before the issue date." };
  const currency = String(input.currency || "").trim().toUpperCase();
  const exchangeRate = roundRate(Number(input.exchangeRate));
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Enter a valid 3-letter currency." };
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return { error: "Enter a valid exchange rate." };
  if (currency === "NGN" && Math.abs(exchangeRate - 1) > 0.000001) return { error: "NGN quotes must use an exchange rate of 1." };
  if (!input.lines.length) return { error: "Add at least one quote line." };
  if (input.lines.length > 200) return { error: "A quote cannot contain more than 200 lines." };

  try {
    const quoteId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId, isActive: true }, select: { id: true } });
      if (!customer) throw new Error("Select an active customer in this entity.");

      const itemIds = [...new Set(input.lines.map((line) => line.itemId).filter((id): id is string => Boolean(id)))];
      if (itemIds.length) {
        const items = await tx.item.findMany({ where: { tenantId, id: { in: itemIds }, isActive: true }, select: { id: true } });
        if (items.length !== itemIds.length) throw new Error("One or more quote items are invalid or inactive.");
      }

      const taxIds = [...new Set(input.lines.map((line) => line.taxRateId).filter((id): id is string => Boolean(id)))];
      const taxRates = taxIds.length
        ? await tx.taxRate.findMany({ where: { tenantId, id: { in: taxIds }, isActive: true }, select: { id: true, name: true, rate: true } })
        : [];
      const taxMap = new Map(taxRates.map((tax) => [tax.id, tax]));
      if (taxMap.size !== taxIds.length) throw new Error("One or more quote tax rates are invalid or inactive.");

      const incomeIds = [...new Set(input.lines.map((line) => line.incomeAccountId).filter((id): id is string => Boolean(id)))];
      if (incomeIds.length) {
        const accounts = await tx.chartOfAccounts.findMany({ where: { tenantId, id: { in: incomeIds }, isActive: true, type: "INCOME" }, select: { id: true } });
        if (accounts.length !== incomeIds.length) throw new Error("One or more quote income accounts are invalid or inactive.");
      }

      const projectIds = [...new Set(input.lines.map((line) => line.projectId).filter((id): id is string => Boolean(id)))];
      if (projectIds.length) {
        const projects = await tx.project.findMany({ where: { tenantId, id: { in: projectIds }, customerId: input.customerId, status: { in: ["DRAFT", "ACTIVE", "ON_HOLD"] } }, select: { id: true } });
        if (projects.length !== projectIds.length) throw new Error("A selected Project is invalid, belongs to another customer, or cannot receive new sales documents.");
      }

      const calculated = input.lines.map((line, index) => {
        const description = line.description.trim();
        const quantity = Number(line.quantity);
        const rate = Number(line.rate);
        const discountType = line.discountType ?? "PERCENT";
        const discountValue = Number(line.discountValue ?? 0);
        if (!description) throw new Error(`Quote line ${index + 1} needs a description.`);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Quote line ${index + 1} needs a quantity greater than zero.`);
        if (!Number.isFinite(rate) || rate < 0) throw new Error(`Quote line ${index + 1} has an invalid rate.`);
        if (!Number.isFinite(discountValue) || discountValue < 0) throw new Error(`Quote line ${index + 1} has an invalid discount.`);
        if (!["PERCENT", "FIXED"].includes(discountType)) throw new Error(`Quote line ${index + 1} has an invalid discount type.`);

        const gross = roundMoney(quantity * rate);
        const rawDiscount = discountType === "PERCENT" ? gross * Math.min(discountValue, 100) / 100 : discountValue;
        const lineDiscount = roundMoney(Math.min(gross, rawDiscount));
        const net = roundMoney(gross - lineDiscount);
        const tax = line.taxRateId ? taxMap.get(line.taxRateId) : null;
        const taxRate = tax ? Number(tax.rate) : 0;
        const taxAmount = roundMoney(net * taxRate / 100);
        const lineTotal = roundMoney(net + taxAmount);
        return {
          id: crypto.randomUUID(), itemId: line.itemId || null, description, quantity, rate, amount: gross,
          taxRateId: line.taxRateId || null, taxName: tax?.name ?? null, taxRate, taxAmount,
          discountType, discountValue, discountAmount: lineDiscount, lineTotal,
          incomeAccountId: line.incomeAccountId || null, projectId: line.projectId || null,
          reportingTags: line.reportingTags ?? null,
        };
      });

      const subtotal = roundMoney(calculated.reduce((sum, line) => sum + line.amount, 0));
      const lineDiscounts = roundMoney(calculated.reduce((sum, line) => sum + line.discountAmount, 0));
      const taxAmount = roundMoney(calculated.reduce((sum, line) => sum + line.taxAmount, 0));
      const maxDocumentDiscount = Math.max(0, roundMoney(subtotal - lineDiscounts));
      const documentDiscount = roundMoney(Math.min(maxDocumentDiscount, Math.max(0, Number(input.discountAmount ?? 0))));
      const totalAmount = roundMoney(subtotal - lineDiscounts - documentDiscount + taxAmount);

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:quote-number:${tenantId}`}))`;
      const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS "count" FROM "quotes" WHERE "tenant_id" = ${tenantId}::uuid`;
      const quoteNumber = `QT-${String(Number(countRows[0]?.count ?? 0) + 1).padStart(5, "0")}`;

      await tx.$executeRaw`
        INSERT INTO "quotes" (
          "id", "tenant_id", "customer_id", "quote_number", "issue_date", "expiry_date", "status",
          "currency", "exchange_rate", "subtotal", "discount_amount", "tax_amount", "total_amount",
          "reference", "order_number", "notes", "created_by"
        ) VALUES (
          ${quoteId}, ${tenantId}::uuid, ${input.customerId}, ${quoteNumber}, ${issueDate}, ${expiryDate}, 'DRAFT',
          ${currency}, ${exchangeRate}, ${subtotal}, ${documentDiscount}, ${taxAmount}, ${totalAmount},
          ${input.reference?.trim() || null}, ${input.orderNumber?.trim() || null}, ${input.notes?.trim() || null}, ${userId}
        )
      `;

      for (const line of calculated) {
        await tx.$executeRaw`
          INSERT INTO "quote_lines" (
            "id", "quote_id", "item_id", "description", "quantity", "rate", "amount",
            "tax_rate_id", "tax_name", "tax_rate", "tax_amount", "discount_type", "discount_value",
            "discount_amount", "line_total", "income_account_id", "project_id", "reporting_tags"
          ) VALUES (
            ${line.id}, ${quoteId}, ${line.itemId}, ${line.description}, ${line.quantity}, ${line.rate}, ${line.amount},
            ${line.taxRateId}::uuid, ${line.taxName}, ${line.taxRate}, ${line.taxAmount}, ${line.discountType}, ${line.discountValue},
            ${line.discountAmount}, ${line.lineTotal}, ${line.incomeAccountId}, ${line.projectId}, ${JSON.stringify(line.reportingTags)}::jsonb
          )
        `;
      }
    });

    revalidatePath("/sales/quotes");
    return { success: true, quoteId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Quote could not be created." };
  }
}

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SENT", "REJECTED"],
  SENT: ["ACCEPTED", "REJECTED"],
};

export async function changeQuoteStatus(input: { quoteId: string; status: string }): Promise<{ success: true } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const role = session?.user?.role;
  if (!tenantId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to change quote status." };
  const requested = input.status.trim().toUpperCase();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:quote:${tenantId}:${input.quoteId}`}))`;
      const rows = await tx.$queryRaw<Array<{ status: string; expiryDate: Date }>>`
        SELECT "status", "expiry_date" AS "expiryDate" FROM "quotes"
        WHERE "id"=${input.quoteId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const quote = rows[0];
      if (!quote) throw new Error("Quote not found.");
      if (new Date(quote.expiryDate) < new Date() && ["DRAFT", "SENT"].includes(quote.status)) {
        throw new Error("This quote has expired and cannot be progressed.");
      }
      if (!(TRANSITIONS[quote.status] ?? []).includes(requested)) {
        throw new Error(`Quote cannot move directly from ${quote.status.toLowerCase()} to ${requested.toLowerCase()}.`);
      }
      await tx.$executeRaw`
        UPDATE "quotes"
        SET "status"=${requested}, "accepted_at"=CASE WHEN ${requested}='ACCEPTED' THEN now() ELSE "accepted_at" END, "updated_at"=now()
        WHERE "id"=${input.quoteId} AND "tenant_id"=${tenantId}::uuid
      `;
    });
    revalidatePath("/sales/quotes");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Quote status could not be changed." };
  }
}

export async function convertQuoteToDraftInvoice(quoteId: string): Promise<{ success: true; invoiceId: string } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to convert quotes." };

  try {
    const invoiceNumber = await generateTransactionNumber(tenantId, "INVOICE");
    let invoiceId = "";
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:quote:${tenantId}:${quoteId}`}))`;
      const quotes = await tx.$queryRaw<Array<{
        id: string; customerId: string; quoteNumber: string; status: string; currency: string; exchangeRate: unknown;
        subtotal: unknown; discountAmount: unknown; taxAmount: unknown; totalAmount: unknown; reference: string | null; orderNumber: string | null; notes: string | null;
        convertedInvoiceId: string | null;
      }>>`
        SELECT "id", "customer_id" AS "customerId", "quote_number" AS "quoteNumber", "status", "currency",
               "exchange_rate" AS "exchangeRate", "subtotal", "discount_amount" AS "discountAmount",
               "tax_amount" AS "taxAmount", "total_amount" AS "totalAmount", "reference", "order_number" AS "orderNumber",
               "notes", "converted_invoice_id" AS "convertedInvoiceId"
        FROM "quotes" WHERE "id"=${quoteId} AND "tenant_id"=${tenantId}::uuid LIMIT 1
      `;
      const quote = quotes[0];
      if (!quote) throw new Error("Quote not found.");
      if (quote.convertedInvoiceId || quote.status === "CONVERTED") throw new Error("This quote has already been converted.");
      if (quote.status !== "ACCEPTED") throw new Error("Only an accepted quote can be converted to an invoice.");

      const lines = await tx.$queryRaw<Array<{
        itemId: string | null; description: string; quantity: unknown; rate: unknown; amount: unknown; taxRateId: string | null;
        taxName: string | null; taxRate: unknown; taxAmount: unknown; discountType: string; discountValue: unknown;
        discountAmount: unknown; lineTotal: unknown; incomeAccountId: string | null; projectId: string | null; reportingTags: object | null;
      }>>`
        SELECT "item_id" AS "itemId", "description", "quantity", "rate", "amount", "tax_rate_id"::text AS "taxRateId",
               "tax_name" AS "taxName", "tax_rate" AS "taxRate", "tax_amount" AS "taxAmount", "discount_type" AS "discountType",
               "discount_value" AS "discountValue", "discount_amount" AS "discountAmount", "line_total" AS "lineTotal",
               "income_account_id" AS "incomeAccountId", "project_id" AS "projectId", "reporting_tags" AS "reportingTags"
        FROM "quote_lines" WHERE "quote_id"=${quoteId} ORDER BY "id"
      `;
      if (!lines.length) throw new Error("Quote has no lines to convert.");

      const customer = await tx.customer.findFirst({ where: { id: quote.customerId, tenantId, isActive: true }, select: { paymentTerms: true } });
      if (!customer) throw new Error("The quote customer is no longer active.");
      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + customer.paymentTerms);
      const recognitionPeriod = `${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, "0")}`;

      const invoice = await tx.invoice.create({
        data: {
          tenantId, customerId: quote.customerId, invoiceNumber, reference: quote.reference, orderNumber: quote.orderNumber,
          issueDate, dueDate, status: "DRAFT", currency: quote.currency, exchangeRate: Number(quote.exchangeRate),
          subtotal: Number(quote.subtotal), discountAmount: Number(quote.discountAmount), taxAmount: Number(quote.taxAmount),
          totalAmount: Number(quote.totalAmount), amountPaid: 0, balanceDue: Number(quote.totalAmount), recognitionPeriod,
          paymentTermsDays: customer.paymentTerms, recogniseRevenueOnInvoiceDate: false, notes: quote.notes,
          lines: {
            create: lines.map((line) => ({
              itemId: line.itemId, description: line.description, quantity: Number(line.quantity), rate: Number(line.rate),
              amount: Number(line.amount), taxRateId: line.taxRateId, taxName: line.taxName, taxRate: Number(line.taxRate),
              taxAmount: Number(line.taxAmount), discountType: line.discountType, discountValue: Number(line.discountValue),
              discountAmount: Number(line.discountAmount), lineTotal: Number(line.lineTotal), incomeAccountId: line.incomeAccountId,
              projectId: line.projectId, reportingTags: line.reportingTags ?? undefined,
            })),
          },
        },
        select: { id: true },
      });
      invoiceId = invoice.id;

      const updated = await tx.$executeRaw`
        UPDATE "quotes"
        SET "status"='CONVERTED', "converted_invoice_id"=${invoice.id}, "converted_at"=now(), "updated_at"=now()
        WHERE "id"=${quoteId} AND "tenant_id"=${tenantId}::uuid AND "status"='ACCEPTED' AND "converted_invoice_id" IS NULL
      `;
      if (updated !== 1) throw new Error("Quote changed before conversion could complete.");
    });

    revalidatePath("/sales/quotes");
    revalidatePath("/sales/invoices");
    return { success: true, invoiceId };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Quote could not be converted." };
  }
}
