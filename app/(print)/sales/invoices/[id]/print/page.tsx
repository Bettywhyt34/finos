/**
 * Invoice Print Page — /sales/invoices/[id]/print
 *
 * Renders the invoice using the template and branding resolved by the shared
 * invoice PDF data layer. Issued invoices use their stored presentation snapshot
 * when available; drafts use current tenant configuration.
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

  return { title: `Invoice ${data.invoice.invoiceNumber} — ${data.tenant.name}` };
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
      <style>{`
        @page { size: A4 portrait; margin: 12mm 10mm; }
        @media print {
          body { margin: 0; padding: 0; background: #fff; }
          .print\\:hidden { display: none !important; }
        }
        body { background: #f3f4f6; }
      `}</style>

      <PrintTrigger invoiceNumber={data.invoice.invoiceNumber} />

      <div style={{ paddingTop: "56px", backgroundColor: "#f3f4f6", minHeight: "100vh" }}>
        <div className="print:!pt-0 print:!bg-transparent" style={{ padding: "24px", backgroundColor: "#f3f4f6" }}>
          <div
            className="print:!shadow-none print:!rounded-none print:!p-0"
            style={{ backgroundColor: "#fff", borderRadius: "8px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", overflow: "hidden" }}
          >
            {data.invoice.orderNumber ? (
              <div
                style={{
                  padding: "8px 28px",
                  borderBottom: "1px solid #e5e7eb",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                  fontSize: "11px",
                  backgroundColor: "#fafafa",
                }}
              >
                <span style={{ color: "#6b7280", fontWeight: 600 }}>Order Number</span>
                <span style={{ color: "#111827", fontFamily: "monospace", fontWeight: 700 }}>{data.invoice.orderNumber}</span>
              </div>
            ) : null}

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
