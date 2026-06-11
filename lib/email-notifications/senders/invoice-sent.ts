/**
 * Sends the INVOICE_SENT email notification.
 * Called fire-and-forget from sendInvoice() — errors must not block the status update.
 */
import "server-only";
import { prisma }    from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  renderEmailSubject,
  renderEmailBody,
  type TemplateContext,
} from "@/lib/email-notifications/template-renderer";

export async function sendInvoiceEmail(opts: {
  tenantId:  string;
  invoiceId: string;
}): Promise<{ sent: true } | { sent: false; reason: string }> {
  const { tenantId, invoiceId } = opts;

  // Fetch invoice + customer
  const invoice = await prisma.invoice.findFirst({
    where:   { id: invoiceId, tenantId },
    include: { customer: true },
  });
  if (!invoice) return { sent: false, reason: "Invoice not found" };

  const customer = invoice.customer;

  if (!customer.email) {
    return { sent: false, reason: "Customer has no email address" };
  }

  // Fetch template
  const template = await prisma.emailNotificationTemplate.findFirst({
    where: { tenantId, event: "INVOICE_SENT" },
  });
  if (!template)         return { sent: false, reason: "INVOICE_SENT template not found" };
  if (!template.isEnabled) return { sent: false, reason: "INVOICE_SENT template is disabled" };

  // Fetch tenant for org context
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

  // Format dates
  function fmtDate(d: Date): string {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  }

  const currency = invoice.currency ?? "NGN";

  const ctx: TemplateContext = {
    organisation: {
      name:    tenant?.name ?? "",
      phone:   tenant?.phone ?? "",
      address: [tenant?.address1, tenant?.city].filter(Boolean).join(", ") || "",
      email:   "",
    },
    customer: {
      name:         customer.contactName
        ?? (`${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || customer.companyName),
      company_name: customer.companyName,
      email:        customer.email,
    },
    invoice: {
      number:      invoice.invoiceNumber,
      date:        fmtDate(invoice.issueDate),
      due_date:    fmtDate(invoice.dueDate),
      total:       `${currency} ${Number(invoice.totalAmount).toFixed(2)}`,
      balance_due: `${currency} ${Number(invoice.balanceDue).toFixed(2)}`,
    },
  };

  try {
    const subject  = renderEmailSubject(template.subject, ctx);
    const bodyHtml = renderEmailBody(template.bodyHtml, ctx);
    await sendEmail({ to: customer.email, subject, html: bodyHtml });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
