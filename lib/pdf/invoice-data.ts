/**
 * Invoice PDF data layer.
 *
 * Draft invoices use the tenant's current branding/template. Once issued, FINOS
 * prefers the immutable document snapshot captured when DRAFT became SENT.
 * Legacy issued invoices without a snapshot retain the prior live-template fallback.
 */

import { prisma } from "@/lib/prisma";

export type InvoicePdfTenant = {
  name: string;
  logoUrl: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxId: string | null;
};

export type InvoicePdfCustomer = {
  companyName: string;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingCountry: string | null;
};

export type InvoicePdfLine = {
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
  itemCode: string | null;
  incomeAccountId: string | null;
  incomeAccountCode: string | null;
  incomeAccountName: string | null;
};

export type InvoicePdfPayment = {
  paymentNumber: string;
  paymentDate: Date;
  method: string;
  amount: number;
};

export type InvoicePdfData = {
  tenant: InvoicePdfTenant;
  customer: InvoicePdfCustomer;
  invoice: {
    invoiceNumber: string;
    reference: string | null;
    orderNumber: string | null;
    issueDate: Date;
    dueDate: Date;
    status: string;
    currency: string;
    exchangeRate: number;
    subtotal: number;
    discountAmount: number;
    lineDiscountTotal: number;
    taxAmount: number;
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
    recognitionPeriod: string;
    notes: string | null;
  };
  lines: InvoicePdfLine[];
  payments: InvoicePdfPayment[];
  taxBreakdown: Array<{ label: string; amount: number }>;
  templateConfig: Record<string, unknown>;
  accentColor: string;
  layoutKey: string;
};

type IssuedSnapshot = {
  version?: number;
  branding?: Partial<InvoicePdfTenant>;
  template?: {
    id?: string | null;
    layoutKey?: string | null;
    config?: Record<string, unknown> | null;
    accentColor?: string | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseSnapshot(value: unknown): IssuedSnapshot | null {
  const root = asRecord(value);
  if (!root) return null;
  const branding = asRecord(root.branding);
  const template = asRecord(root.template);
  return {
    version: typeof root.version === "number" ? root.version : undefined,
    branding: branding ? branding as Partial<InvoicePdfTenant> : undefined,
    template: template ? {
      id: typeof template.id === "string" ? template.id : null,
      layoutKey: typeof template.layoutKey === "string" ? template.layoutKey : null,
      config: asRecord(template.config),
      accentColor: typeof template.accentColor === "string" ? template.accentColor : null,
    } : undefined,
  };
}

export async function prepareInvoicePdfData(
  tenantId: string,
  invoiceId: string,
): Promise<InvoicePdfData | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      customer: true,
      lines: {
        include: {
          item: { select: { itemCode: true } },
          incomeAccount: { select: { code: true, name: true } },
        },
        orderBy: { id: "asc" },
      },
      payments: {
        include: { payment: true },
        orderBy: { payment: { paymentDate: "asc" } },
      },
    },
  });
  if (!invoice) return null;

  const [tenant, snapshotRows] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.$queryRaw<Array<{ snapshot: unknown }>>`
      SELECT "issued_document_snapshot" AS "snapshot"
      FROM "invoices"
      WHERE "id"=${invoiceId} AND "tenant_id"=${tenantId}::uuid
      LIMIT 1
    `,
  ]);

  const issuedSnapshot = invoice.status !== "DRAFT"
    ? parseSnapshot(snapshotRows[0]?.snapshot)
    : null;

  const liveTemplate = issuedSnapshot ? null : (
    (await prisma.pdfTemplate.findFirst({
      where: { tenantId, documentType: "INVOICE", isDefault: true, isActive: true },
    })) ??
    (await prisma.pdfTemplate.findFirst({
      where: { tenantId, documentType: "INVOICE", isActive: true, isSystem: true, layoutKey: "standard" },
    })) ??
    (await prisma.pdfTemplate.findFirst({
      where: { tenantId, documentType: "INVOICE", isActive: true, isSystem: true },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.pdfTemplate.findFirst({
      where: { tenantId, documentType: "INVOICE", isActive: true },
      orderBy: { createdAt: "asc" },
    }))
  );

  const liveTemplateConfig = (liveTemplate?.config as Record<string, unknown>) ?? {};
  const templateConfig = issuedSnapshot?.template?.config ?? liveTemplateConfig;
  const layoutKey = issuedSnapshot?.template?.layoutKey ?? liveTemplate?.layoutKey ?? "standard";
  const accentColor = issuedSnapshot?.template?.accentColor
    ?? (typeof templateConfig.primaryColorFallback === "string" ? templateConfig.primaryColorFallback : null)
    ?? "#1B3A6B";

  const liveTenant: InvoicePdfTenant = {
    name: tenant.name,
    logoUrl: tenant.logoUrl,
    address1: tenant.address1,
    address2: tenant.address2,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    phone: tenant.phone,
    email: null,
    website: tenant.website ?? null,
    taxId: tenant.taxId,
  };
  const snapshotBranding = issuedSnapshot?.branding;
  const renderedTenant: InvoicePdfTenant = snapshotBranding ? {
    name: typeof snapshotBranding.name === "string" ? snapshotBranding.name : liveTenant.name,
    logoUrl: snapshotBranding.logoUrl ?? null,
    address1: snapshotBranding.address1 ?? null,
    address2: snapshotBranding.address2 ?? null,
    city: snapshotBranding.city ?? null,
    state: snapshotBranding.state ?? null,
    zip: snapshotBranding.zip ?? null,
    phone: snapshotBranding.phone ?? null,
    email: snapshotBranding.email ?? null,
    website: snapshotBranding.website ?? null,
    taxId: snapshotBranding.taxId ?? null,
  } : liveTenant;

  const pdfLines: InvoicePdfLine[] = invoice.lines.map((line) => ({
    description: line.description,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    amount: Number(line.amount),
    taxRateId: line.taxRateId ?? null,
    taxName: line.taxName ?? null,
    taxRate: Number(line.taxRate),
    taxAmount: Number(line.taxAmount ?? 0),
    discountType: line.discountType ?? "PERCENT",
    discountValue: Number(line.discountValue ?? 0),
    discountAmount: Number(line.discountAmount ?? 0),
    lineTotal: Number(line.lineTotal ?? line.amount),
    itemCode: line.item?.itemCode ?? null,
    incomeAccountId: line.incomeAccountId ?? null,
    incomeAccountCode: line.incomeAccount?.code ?? null,
    incomeAccountName: line.incomeAccount?.name ?? null,
  }));

  const lineDiscountTotal = pdfLines.reduce((sum, line) => sum + line.discountAmount, 0);
  const taxMap = new Map<string, number>();
  for (const line of pdfLines) {
    if (line.taxAmount <= 0) continue;
    const label = line.taxName ? `${line.taxName} [${line.taxRate}%]` : `Tax [${line.taxRate}%]`;
    taxMap.set(label, (taxMap.get(label) ?? 0) + line.taxAmount);
  }

  return {
    tenant: renderedTenant,
    customer: {
      companyName: invoice.customer.companyName,
      email: invoice.customer.email,
      phone: invoice.customer.phone,
      billingAddress: invoice.customer.billingAddress,
      billingCity: invoice.customer.billingCity,
      billingState: invoice.customer.billingState,
      billingCountry: invoice.customer.billingCountry,
    },
    invoice: {
      invoiceNumber: invoice.invoiceNumber,
      reference: invoice.reference,
      orderNumber: invoice.orderNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      currency: invoice.currency,
      exchangeRate: Number(invoice.exchangeRate),
      subtotal: Number(invoice.subtotal),
      discountAmount: Number(invoice.discountAmount),
      lineDiscountTotal,
      taxAmount: Number(invoice.taxAmount),
      totalAmount: Number(invoice.totalAmount),
      amountPaid: Number(invoice.amountPaid),
      balanceDue: Number(invoice.balanceDue),
      recognitionPeriod: invoice.recognitionPeriod,
      notes: invoice.notes,
    },
    lines: pdfLines,
    payments: invoice.payments.map((allocation) => ({
      paymentNumber: allocation.payment.paymentNumber,
      paymentDate: allocation.payment.paymentDate,
      method: allocation.payment.method,
      amount: Number(allocation.amount),
    })),
    taxBreakdown: Array.from(taxMap.entries()).map(([label, amount]) => ({ label, amount })),
    templateConfig,
    accentColor,
    layoutKey,
  };
}
