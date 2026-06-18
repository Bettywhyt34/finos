import type { InvoicePdfData } from "@/lib/pdf/invoice-data";
import { resolveInvoiceLayoutKey } from "@/lib/pdf/invoice-template-registry";
import { StandardInvoiceTemplate } from "./templates/standard-invoice-template";
import { ProfessionalBrandedTemplate } from "./templates/professional-branded-invoice-template";

/**
 * Renders the correct invoice template based on the layoutKey stored in pdfData.
 * Used by both the dashboard detail page (preview) and could be used anywhere
 * an invoice needs to be rendered as HTML.
 */
export function InvoicePreview({ data }: { data: InvoicePdfData }) {
  const layoutKey = resolveInvoiceLayoutKey(data.layoutKey);

  if (layoutKey === "professional_branded_invoice") {
    return <ProfessionalBrandedTemplate data={data} />;
  }
  return <StandardInvoiceTemplate data={data} />;
}
