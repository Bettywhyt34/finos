/**
 * Standard Invoice template renderer.
 *
 * Clean, minimal layout — works for any tenant.
 * Does not use branding colours.
 *
 * Shared between the dashboard invoice detail preview and the print/PDF route.
 */

import type { InvoicePdfData } from "@/lib/pdf/invoice-data";
import { formatCurrency, formatDate } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "4px 0", color: "#6b7280", fontSize: "12px", width: "50%" }}>
        {label}
      </td>
      <td
        style={{
          padding:    "4px 0",
          fontSize:   "12px",
          fontWeight: bold ? 700 : 400,
          textAlign:  "right",
          fontFamily: "monospace",
        }}
      >
        {value}
      </td>
    </tr>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StandardInvoiceTemplate({ data }: { data: InvoicePdfData }) {
  const { tenant, customer, invoice, lines, payments, taxBreakdown } = data;
  const cur = invoice.currency;
  const isNGN = cur === "NGN";
  const hasLineDiscounts    = invoice.lineDiscountTotal > 0;
  const hasInvoiceDiscount  = invoice.discountAmount > 0;
  const hasDiscount         = hasLineDiscounts || hasInvoiceDiscount;
  const hasTax              = taxBreakdown.length > 0;
  const hasPaid             = invoice.amountPaid > 0;
  const hasPayments         = payments.length > 0;

  const tenantAddress = [
    tenant.address1,
    tenant.address2,
    [tenant.city, tenant.state, tenant.zip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const customerAddress = [
    customer.billingAddress,
    [customer.billingCity, customer.billingState].filter(Boolean).join(", "),
    customer.billingCountry,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      style={{
        maxWidth:   "740px",
        margin:     "0 auto",
        padding:    "32px 40px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color:      "#111827",
        fontSize:   "13px",
        lineHeight: "1.5",
      }}
    >
      {/* DRAFT watermark — only while invoice has not been issued */}
      {invoice.status === "DRAFT" && (
        <div
          style={{
            backgroundColor: "#fef3c7",
            border:          "2px solid #f59e0b",
            borderRadius:    "6px",
            padding:         "10px 18px",
            marginBottom:    "20px",
            display:         "flex",
            alignItems:      "center",
            gap:             "12px",
          }}
        >
          <span
            style={{
              backgroundColor: "#f59e0b",
              color:           "#fff",
              fontSize:        "11px",
              fontWeight:      700,
              letterSpacing:   "0.1em",
              padding:         "3px 10px",
              borderRadius:    "3px",
              flexShrink:      0,
            }}
          >
            DRAFT
          </span>
          <span style={{ fontSize: "12px", color: "#78350f" }}>
            This invoice has not been issued. It is not a valid tax document until it is marked as Sent.
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <div style={{ fontSize: "22px", fontWeight: 700, marginBottom: "4px" }}>
            {tenant.name}
          </div>
          {tenantAddress && (
            <div style={{ color: "#6b7280", fontSize: "12px" }}>{tenantAddress}</div>
          )}
          {tenant.phone && (
            <div style={{ color: "#6b7280", fontSize: "12px" }}>T: {tenant.phone}</div>
          )}
          {tenant.email && (
            <div style={{ color: "#6b7280", fontSize: "12px" }}>{tenant.email}</div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "26px", fontWeight: 700, marginBottom: "4px" }}>INVOICE</div>
          <div style={{ fontFamily: "monospace", fontSize: "14px", fontWeight: 600 }}>
            {invoice.invoiceNumber}
          </div>
          {!isNGN && (
            <div
              style={{
                marginTop:   "4px",
                fontSize:    "11px",
                color:       "#92400e",
                fontWeight:  600,
              }}
            >
              {cur} Invoice
            </div>
          )}
        </div>
      </div>

      {/* Bill To / Metadata */}
      <div
        style={{
          display:       "grid",
          gridTemplateColumns: "1fr 1fr",
          gap:           "24px",
          marginBottom:  "24px",
          paddingBottom: "24px",
          borderBottom:  "1px solid #e5e7eb",
        }}
      >
        <div>
          <div
            style={{
              fontSize:     "11px",
              fontWeight:   700,
              color:        "#6b7280",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            Bill To
          </div>
          <div style={{ fontWeight: 600, marginBottom: "2px" }}>{customer.companyName}</div>
          {customerAddress && (
            <div style={{ color: "#374151", fontSize: "12px" }}>{customerAddress}</div>
          )}
          {customer.email && (
            <div style={{ color: "#6b7280", fontSize: "12px" }}>{customer.email}</div>
          )}
        </div>
        <div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ padding: "3px 0", color: "#6b7280", fontSize: "12px" }}>
                  Invoice Date
                </td>
                <td style={{ padding: "3px 0", fontSize: "12px", textAlign: "right" }}>
                  {formatDate(invoice.issueDate)}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "3px 0", color: "#6b7280", fontSize: "12px" }}>
                  Due Date
                </td>
                <td style={{ padding: "3px 0", fontSize: "12px", textAlign: "right", fontWeight: 600 }}>
                  {formatDate(invoice.dueDate)}
                </td>
              </tr>
              {invoice.reference && (
                <tr>
                  <td style={{ padding: "3px 0", color: "#6b7280", fontSize: "12px" }}>
                    Reference
                  </td>
                  <td style={{ padding: "3px 0", fontSize: "12px", textAlign: "right" }}>
                    {invoice.reference}
                  </td>
                </tr>
              )}
              <tr>
                <td style={{ padding: "3px 0", color: "#6b7280", fontSize: "12px" }}>
                  Period
                </td>
                <td
                  style={{
                    padding:    "3px 0",
                    fontSize:   "12px",
                    textAlign:  "right",
                    fontFamily: "monospace",
                  }}
                >
                  {invoice.recognitionPeriod}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Line items table */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #111827" }}>
            <th style={{ textAlign: "left",  padding: "8px 0", fontSize: "11px", color: "#374151", fontWeight: 600 }}>
              Description
            </th>
            <th style={{ textAlign: "right", padding: "8px 4px", fontSize: "11px", color: "#374151", fontWeight: 600, width: "50px" }}>
              Qty
            </th>
            <th style={{ textAlign: "right", padding: "8px 4px", fontSize: "11px", color: "#374151", fontWeight: 600, width: "100px" }}>
              Rate ({cur})
            </th>
            {hasLineDiscounts && (
              <th style={{ textAlign: "right", padding: "8px 4px", fontSize: "11px", color: "#374151", fontWeight: 600, width: "60px" }}>
                Disc.
              </th>
            )}
            {hasTax && (
              <th style={{ textAlign: "right", padding: "8px 4px", fontSize: "11px", color: "#374151", fontWeight: 600, width: "80px" }}>
                Tax
              </th>
            )}
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: "11px", color: "#374151", fontWeight: 600, width: "100px" }}>
              Total ({cur})
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={i}
              style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: i % 2 === 1 ? "#f9fafb" : "#fff" }}
            >
              <td style={{ padding: "8px 0" }}>
                <div style={{ fontWeight: 500 }}>{line.description}</div>
                {line.itemCode && (
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>{line.itemCode}</div>
                )}
              </td>
              <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "monospace", fontSize: "12px" }}>
                {line.quantity}
              </td>
              <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "monospace", fontSize: "12px" }}>
                {formatCurrency(line.rate, cur)}
              </td>
              {hasLineDiscounts && (
                <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "monospace", fontSize: "12px", color: "#6b7280" }}>
                  {line.discountAmount > 0 ? `-${formatCurrency(line.discountAmount, cur)}` : "—"}
                </td>
              )}
              {hasTax && (
                <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "monospace", fontSize: "12px", color: "#6b7280" }}>
                  {line.taxRate > 0
                    ? (line.taxName ? `${line.taxName} [${line.taxRate}%]` : `${line.taxRate}%`)
                    : "—"}
                </td>
              )}
              <td style={{ padding: "8px 0", textAlign: "right", fontFamily: "monospace", fontSize: "12px", fontWeight: 500 }}>
                {formatCurrency(line.lineTotal, cur)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "24px" }}>
        <table style={{ width: "300px", borderCollapse: "collapse" }}>
          <tbody>
            <Row label="Subtotal" value={formatCurrency(invoice.subtotal, cur)} />
            {hasLineDiscounts && (
              <Row label="Line Discounts" value={`-${formatCurrency(invoice.lineDiscountTotal, cur)}`} />
            )}
            {hasInvoiceDiscount && (
              <Row label="Additional Invoice Discount" value={`-${formatCurrency(invoice.discountAmount, cur)}`} />
            )}
            {taxBreakdown.map((row) => (
              <Row key={row.label} label={row.label} value={formatCurrency(row.amount, cur)} />
            ))}
            <tr>
              <td colSpan={2} style={{ borderTop: "1px solid #d1d5db", padding: "4px 0" }} />
            </tr>
            <Row label={`Total (${cur})`} value={formatCurrency(invoice.totalAmount, cur)} bold />
            {hasPaid && (
              <Row label="Amount Paid" value={`-${formatCurrency(invoice.amountPaid, cur)}`} />
            )}
            <tr style={{ borderTop: "2px solid #111827" }}>
              <td style={{ padding: "8px 0", fontSize: "14px", fontWeight: 700 }}>
                Balance Due ({cur})
              </td>
              <td
                style={{
                  padding:    "8px 0",
                  fontSize:   "14px",
                  fontWeight: 700,
                  textAlign:  "right",
                  fontFamily: "monospace",
                  color:      invoice.balanceDue > 0 ? "#b45309" : "#16a34a",
                }}
              >
                {formatCurrency(invoice.balanceDue, cur)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Payment history */}
      {hasPayments && (
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              fontSize:     "11px",
              fontWeight:   700,
              color:        "#6b7280",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            Payment History
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #d1d5db" }}>
                <th style={{ textAlign: "left",  padding: "6px 0", fontWeight: 600, color: "#374151" }}>Reference</th>
                <th style={{ textAlign: "left",  padding: "6px 0", fontWeight: 600, color: "#374151" }}>Date</th>
                <th style={{ textAlign: "left",  padding: "6px 0", fontWeight: 600, color: "#374151" }}>Method</th>
                <th style={{ textAlign: "right", padding: "6px 0", fontWeight: 600, color: "#374151" }}>Amount (NGN)</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "5px 0", fontFamily: "monospace" }}>{p.paymentNumber}</td>
                  <td style={{ padding: "5px 0" }}>{formatDate(p.paymentDate)}</td>
                  <td style={{ padding: "5px 0", color: "#6b7280" }}>
                    {p.method.replace(/_/g, " ")}
                  </td>
                  <td style={{ padding: "5px 0", textAlign: "right", fontFamily: "monospace", color: "#16a34a" }}>
                    {formatCurrency(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      {invoice.notes && (
        <div
          style={{
            borderTop:   "1px solid #e5e7eb",
            paddingTop:  "16px",
            marginTop:   "16px",
          }}
        >
          <div
            style={{
              fontSize:     "11px",
              fontWeight:   700,
              color:        "#6b7280",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            Notes
          </div>
          <p style={{ fontSize: "12px", color: "#374151", margin: 0 }}>{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}
