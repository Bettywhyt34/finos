/**
 * Invoice Print Page — /sales/invoices/[id]/print
 *
 * Renders the invoice using the tenant's selected default PDF template.
 * Supports browser "Print / Save as PDF".
 *
 * Security:
 *   - Requires authenticated session
 *   - Invoice is fetched with tenantId scope (never trusts URL params)
 *   - Returns 404 if invoice not found or belongs to another tenant
 *
 * Template selection:
 *   1. Tenant's isDefault=true, isActive=true INVOICE template
 *   2. Any active INVOICE template (system templates preferred)
 *   3. "standard" layout if no templates exist
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prepareInvoicePdfData } from "@/lib/pdf/invoice-data";
import { resolveInvoiceLayoutKey } from "@/lib/pdf/invoice-template-registry";
import { PrintTrigger } from "./print-trigger";
import { StandardInvoiceTemplate } from "./_templates/standard";
import { ProfessionalBrandedTemplate } from "./_templates/professional-branded";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return { title: "Invoice" };

  const data = await prepareInvoicePdfData(tenantId, id);
  if (!data) return { title: "Invoice Not Found" };

  return {
    title: `Invoice ${data.invoice.invoiceNumber} — ${data.tenant.name}`,
  };
}

export default async function InvoicePrintPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) notFound();

  const data = await prepareInvoicePdfData(tenantId, id);
  if (!data) notFound();

  const layoutKey = resolveInvoiceLayoutKey(data.layoutKey);

  return (
    <>
      {/* Print-specific CSS */}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 12mm 10mm;
        }
        @media print {
          body { margin: 0; padding: 0; }
          .print\\:hidden { display: none !important; }
        }
        body {
          background: #f3f4f6;
        }
        @media print {
          body { background: #fff; }
        }
      `}</style>

      {/* Print / Close button bar — hidden when printing */}
      <PrintTrigger invoiceNumber={data.invoice.invoiceNumber} />

      {/* Invoice document */}
      <div
        style={{
          paddingTop:      "56px",  /* offset for the fixed PrintTrigger bar */
          backgroundColor: "#f3f4f6",
          minHeight:       "100vh",
        }}
      >
        <div
          className="print:!pt-0 print:!bg-transparent"
          style={{
            padding:         "24px",
            backgroundColor: "#f3f4f6",
          }}
        >
          {/* White document card — screen only; removed on print */}
          <div
            className="print:!shadow-none print:!rounded-none print:!p-0"
            style={{
              backgroundColor: "#fff",
              borderRadius:    "8px",
              boxShadow:       "0 2px 12px rgba(0,0,0,0.08)",
              overflow:        "hidden",
            }}
          >
            {layoutKey === "professional_branded_invoice" ? (
              <ProfessionalBrandedTemplate data={data} />
            ) : (
              <StandardInvoiceTemplate data={data} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
