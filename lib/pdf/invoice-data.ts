/**
 * Invoice PDF data layer.
 *
 * Fetches and shapes all data needed to render an invoice in any template.
 * Pure data — no rendering logic here.
 */

import { prisma } from "@/lib/prisma";

// ─── Shape types ─────────────────────────────────────────────────────────────

export type InvoicePdfTenant = {
  name:     string;
  logoUrl:  string | null;
  address1: string | null;
  address2: string | null;
  city:     string | null;
  state:    string | null;
  zip:      string | null;
  phone:    string | null;
  email:    string | null; // stored in tenant.additionalFields.email if set
  website:  string | null;
  taxId:    string | null;
};

export type InvoicePdfCustomer = {
  companyName:     string;
  email:           string | null;
  phone:           string | null;
  billingAddress:  string | null;
  billingCity:     string | null;
  billingState:    string | null;
  billingCountry:  string | null;
};

export type InvoicePdfLine = {
  description: string;
  quantity:    number;
  rate:        number;
  amount:      number;
  taxRate:     number;
  itemCode:    string | null;
};

export type InvoicePdfPayment = {
  paymentNumber: string;
  paymentDate:   Date;
  method:        string;
  amount:        number;
};

export type InvoicePdfData = {
  tenant:         InvoicePdfTenant;
  customer:       InvoicePdfCustomer;
  invoice: {
    invoiceNumber:     string;
    reference:         string | null;
    issueDate:         Date;
    dueDate:           Date;
    status:            string;
    currency:          string;
    exchangeRate:      number;
    subtotal:          number;
    discountAmount:    number;
    taxAmount:         number;
    totalAmount:       number;
    amountPaid:        number;
    balanceDue:        number;
    recognitionPeriod: string;
    notes:             string | null;
  };
  lines:          InvoicePdfLine[];
  payments:       InvoicePdfPayment[];
  templateConfig: Record<string, unknown>;
  accentColor:    string;
  layoutKey:      string;
};

// ─── Data fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetches all invoice data needed for PDF rendering.
 *
 * Security: always scoped by tenantId.
 * Returns null if the invoice does not exist or belongs to a different tenant.
 *
 * Template resolution order (deterministic):
 *   1. Tenant's isDefault=true, isActive=true INVOICE template
 *   2. Active system Standard Template (layoutKey="standard") for INVOICE
 *   3. Any active system INVOICE template, oldest first
 *   4. Any active INVOICE template, oldest first
 *   5. Built-in standard renderer (layoutKey hard-falls back to "standard")
 *
 * Accent colour resolution order:
 *   NOTE: Branding Settings stores accent colour in localStorage only (per-browser).
 *   There is no DB-side user accent colour. The server-side source is:
 *   1. template.config.primaryColorFallback  (set per-template in DB)
 *   2. #1B3A6B                               (absolute hard fallback)
 */
export async function prepareInvoicePdfData(
  tenantId:  string,
  invoiceId: string,
): Promise<InvoicePdfData | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      customer: true,
      lines: {
        include: { item: { select: { itemCode: true } } },
        orderBy: { id: "asc" },
      },
      payments: {
        include: { payment: true },
        orderBy: { payment: { paymentDate: "asc" } },
      },
    },
  });
  if (!invoice) return null;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  // Fetch the tenant's active INVOICE PDF template — deterministic 4-step order
  const template =
    // 1. Tenant's explicit default
    (await prisma.pdfTemplate.findFirst({
      where: { tenantId, documentType: "INVOICE", isDefault: true, isActive: true },
    })) ??
    // 2. System Standard Template specifically
    (await prisma.pdfTemplate.findFirst({
      where: { tenantId, documentType: "INVOICE", isActive: true, isSystem: true, layoutKey: "standard" },
    })) ??
    // 3. Any active system INVOICE template, oldest first
    (await prisma.pdfTemplate.findFirst({
      where:   { tenantId, documentType: "INVOICE", isActive: true, isSystem: true },
      orderBy: { createdAt: "asc" },
    })) ??
    // 4. Any active INVOICE template, oldest first
    (await prisma.pdfTemplate.findFirst({
      where:   { tenantId, documentType: "INVOICE", isActive: true },
      orderBy: { createdAt: "asc" },
    }));
  // Step 5 (implicit): if template is null, layoutKey falls back to "standard" below.

  const templateConfig = (template?.config as Record<string, unknown>) ?? {};
  const layoutKey      = template?.layoutKey ?? "standard";

  // Resolve server-side accent colour for document rendering.
  // Branding Settings stores accent colour in localStorage only — not in DB.
  // The per-template primaryColorFallback in the DB is the correct server-side source.
  const accentColor =
    (typeof templateConfig.primaryColorFallback === "string"
      ? templateConfig.primaryColorFallback
      : null) ??
    "#1B3A6B";

  return {
    tenant: {
      name:     tenant.name,
      logoUrl:  tenant.logoUrl,
      address1: tenant.address1,
      address2: tenant.address2,
      city:     tenant.city,
      state:    tenant.state,
      zip:      tenant.zip,
      phone:    tenant.phone,
      email:    null,                // Tenant has no native email field; extend via additionalFields if needed
      website:  tenant.website ?? null,
      taxId:    tenant.taxId,
    },
    customer: {
      companyName:    invoice.customer.companyName,
      email:          invoice.customer.email,
      phone:          invoice.customer.phone,
      billingAddress: invoice.customer.billingAddress,
      billingCity:    invoice.customer.billingCity,
      billingState:   invoice.customer.billingState,
      billingCountry: invoice.customer.billingCountry,
    },
    invoice: {
      invoiceNumber:     invoice.invoiceNumber,
      reference:         invoice.reference,
      issueDate:         invoice.issueDate,
      dueDate:           invoice.dueDate,
      status:            invoice.status,
      currency:          invoice.currency,
      exchangeRate:      parseFloat(String(invoice.exchangeRate)),
      subtotal:          parseFloat(String(invoice.subtotal)),
      discountAmount:    parseFloat(String(invoice.discountAmount)),
      taxAmount:         parseFloat(String(invoice.taxAmount)),
      totalAmount:       parseFloat(String(invoice.totalAmount)),
      amountPaid:        parseFloat(String(invoice.amountPaid)),
      balanceDue:        parseFloat(String(invoice.balanceDue)),
      recognitionPeriod: invoice.recognitionPeriod,
      notes:             invoice.notes,
    },
    lines: invoice.lines.map((l) => ({
      description: l.description,
      quantity:    parseFloat(String(l.quantity)),
      rate:        parseFloat(String(l.rate)),
      amount:      parseFloat(String(l.amount)),
      taxRate:     parseFloat(String(l.taxRate)),
      itemCode:    l.item?.itemCode ?? null,
    })),
    payments: invoice.payments.map((alloc) => ({
      paymentNumber: alloc.payment.paymentNumber,
      paymentDate:   alloc.payment.paymentDate,
      method:        alloc.payment.method,
      amount:        parseFloat(String(alloc.amount)),
    })),
    templateConfig,
    accentColor,
    layoutKey,
  };
}
