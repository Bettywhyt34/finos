/**
 * Professional Branded Invoice template renderer.
 *
 * Uses the tenant's branding accent colour for:
 *   - Full-width header banner
 *   - Line items table header
 *   - Section headings
 *   - Balance Due emphasis
 *
 * Layout:
 *   1. Branded header band (org name left, INVOICE right)
 *   2. Address strip (org details left, Balance Due right)
 *   3. Bill To / metadata columns
 *   4. Line items table with accent header
 *   5. Totals (right-aligned)
 *   6. Payment history (if any)
 *   7. Notes / payment terms footer (if any)
 *
 * All colours resolved from data.accentColor — never hardcoded blue.
 */

import type { InvoicePdfData } from "@/lib/pdf/invoice-data";
import { formatCurrency, formatDate } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lighten an accent colour for alternating row tinting. */
function getAltRowColor(config: Record<string, unknown>): string {
  return typeof config.alternateRowColor === "string"
    ? config.alternateRowColor
    : "#EBF1FA";
}

function getBorderColor(config: Record<string, unknown>): string {
  return typeof config.borderColor === "string" ? config.borderColor : "#CCCCCC";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfessionalBrandedTemplate({ data }: { data: InvoicePdfData }) {
  const { tenant, customer, invoice, lines, payments, accentColor, templateConfig } = data;

  const altRow    = getAltRowColor(templateConfig);
  const border    = getBorderColor(templateConfig);
  const cur       = invoice.currency;
  const isNGN     = cur === "NGN";
  const hasDiscount = invoice.discountAmount > 0;
  const hasTax    = invoice.taxAmount > 0;
  const hasPaid   = invoice.amountPaid > 0;

  const showNotes        = templateConfig.showNotes !== false;
  const showPaymentTerms = templateConfig.showPaymentTerms !== false;

  // Build display strings
  const tenantAddressLine = [
    tenant.address1,
    tenant.address2,
    [tenant.city, tenant.state, tenant.zip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const customerBillingBlock = [
    customer.billingAddress,
    [customer.billingCity, customer.billingState].filter(Boolean).join(", "),
    customer.billingCountry,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      style={{
        maxWidth:   "794px",  // A4 width at 96dpi
        margin:     "0 auto",
        fontFamily: "system-ui, -apple-system, Arial, sans-serif",
        color:      "#1f2937",
        fontSize:   "12px",
        lineHeight: "1.5",
        backgroundColor: "#fff",
      }}
    >
      {/* ── 1. Header band ────────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: accentColor,
          color:           "#fff",
          padding:         "20px 28px 18px",
          display:         "flex",
          justifyContent:  "space-between",
          alignItems:      "flex-start",
        }}
      >
        {/* Left: org name */}
        <div>
          {tenant.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={tenant.logoUrl}
              alt={tenant.name}
              style={{ maxHeight: "52px", maxWidth: "160px", objectFit: "contain", marginBottom: "6px" }}
            />
          ) : null}
          <div
            style={{
              fontSize:   "22px",
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            {tenant.name}
          </div>
        </div>

        {/* Right: INVOICE title + number */}
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize:   "30px",
              fontWeight: 800,
              letterSpacing: "0.04em",
              opacity:    0.95,
            }}
          >
            INVOICE
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize:   "14px",
              fontWeight: 600,
              marginTop:  "4px",
              opacity:    0.9,
            }}
          >
            {invoice.invoiceNumber}
          </div>
          {!isNGN && (
            <div style={{ fontSize: "11px", opacity: 0.8, marginTop: "2px" }}>
              {cur} Invoice
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Address / Balance Due strip ──────────────────────────────── */}
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "flex-start",
          padding:        "14px 28px",
          borderBottom:   `2px solid ${accentColor}`,
          backgroundColor: "#fafafa",
        }}
      >
        {/* Left: org contact details */}
        <div style={{ fontSize: "11px", color: "#4b5563" }}>
          {tenantAddressLine && <div>{tenantAddressLine}</div>}
          {tenant.phone   && <div>T: {tenant.phone}</div>}
          {tenant.email   && <div>{tenant.email}</div>}
          {tenant.website && <div>{tenant.website}</div>}
          {tenant.taxId   && <div style={{ marginTop: "2px" }}>RC/Tax ID: {tenant.taxId}</div>}
        </div>

        {/* Right: Balance Due (hero) */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
            Balance Due
          </div>
          <div
            style={{
              fontSize:   "22px",
              fontWeight: 800,
              color:      accentColor,
              fontFamily: "monospace",
              marginTop:  "2px",
            }}
          >
            {formatCurrency(invoice.balanceDue, cur)}
          </div>
        </div>
      </div>

      {/* ── 3. Bill To / Metadata ────────────────────────────────────────── */}
      <div
        style={{
          display:             "grid",
          gridTemplateColumns: "1fr 1fr",
          gap:                 "24px",
          padding:             "20px 28px",
          borderBottom:        `1px solid ${border}`,
        }}
      >
        {/* Bill To */}
        <div>
          <div
            style={{
              fontSize:      "10px",
              fontWeight:    700,
              color:         accentColor,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom:  "8px",
            }}
          >
            Bill To
          </div>
          <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "4px" }}>
            {customer.companyName}
          </div>
          {customerBillingBlock &&
            customerBillingBlock.split("\n").map((line, i) => (
              <div key={i} style={{ fontSize: "12px", color: "#374151" }}>
                {line}
              </div>
            ))}
          {customer.email && (
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
              {customer.email}
            </div>
          )}
          {customer.phone && (
            <div style={{ fontSize: "11px", color: "#6b7280" }}>
              {customer.phone}
            </div>
          )}
        </div>

        {/* Invoice metadata */}
        <div>
          <div
            style={{
              fontSize:      "10px",
              fontWeight:    700,
              color:         accentColor,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom:  "8px",
            }}
          >
            Invoice Details
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <tbody>
              <MetaRow label="Invoice Date"  value={formatDate(invoice.issueDate)} />
              <MetaRow label="Due Date"      value={formatDate(invoice.dueDate)}   bold />
              <MetaRow label="Period"        value={invoice.recognitionPeriod}     mono />
              {invoice.reference && (
                <MetaRow label="P.O. / Ref"  value={invoice.reference} />
              )}
              {!isNGN && (
                <MetaRow
                  label="Currency"
                  value={`${cur} @ ${invoice.exchangeRate.toLocaleString("en-NG", { maximumFractionDigits: 4 })}`}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4. Line items table ──────────────────────────────────────────── */}
      <div style={{ padding: "20px 28px 0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                backgroundColor: accentColor,
                color:           "#fff",
              }}
            >
              <th style={{ padding: "9px 8px 9px 10px", textAlign: "left",  fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", width: "28px" }}>
                #
              </th>
              <th style={{ padding: "9px 8px", textAlign: "left",  fontSize: "11px", fontWeight: 700 }}>
                Item &amp; Description
              </th>
              <th style={{ padding: "9px 8px", textAlign: "right", fontSize: "11px", fontWeight: 700, width: "50px" }}>
                Qty
              </th>
              <th style={{ padding: "9px 8px", textAlign: "right", fontSize: "11px", fontWeight: 700, width: "110px" }}>
                Rate ({cur})
              </th>
              <th style={{ padding: "9px 10px 9px 8px", textAlign: "right", fontSize: "11px", fontWeight: 700, width: "110px" }}>
                Amount ({cur})
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr
                key={i}
                style={{
                  backgroundColor: i % 2 === 1 ? altRow : "#fff",
                  borderBottom:    `1px solid ${border}`,
                }}
              >
                <td style={{ padding: "9px 8px 9px 10px", fontSize: "12px", color: "#9ca3af", textAlign: "center" }}>
                  {i + 1}
                </td>
                <td style={{ padding: "9px 8px" }}>
                  <div style={{ fontWeight: 500, fontSize: "12px" }}>{line.description}</div>
                  {line.itemCode && (
                    <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>
                      {line.itemCode}
                    </div>
                  )}
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right", fontFamily: "monospace", fontSize: "12px" }}>
                  {line.quantity % 1 === 0 ? line.quantity.toString() : line.quantity.toFixed(2)}
                </td>
                <td style={{ padding: "9px 8px", textAlign: "right", fontFamily: "monospace", fontSize: "12px" }}>
                  {formatCurrency(line.rate, cur)}
                </td>
                <td style={{ padding: "9px 10px 9px 8px", textAlign: "right", fontFamily: "monospace", fontSize: "12px", fontWeight: 600 }}>
                  {formatCurrency(line.amount, cur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 5. Totals ────────────────────────────────────────────────────── */}
      <div
        style={{
          display:        "flex",
          justifyContent: "flex-end",
          padding:        "16px 28px 20px",
          borderBottom:   `1px solid ${border}`,
        }}
      >
        <table style={{ width: "300px", borderCollapse: "collapse" }}>
          <tbody>
            <TotalRow label="Sub Total"    value={formatCurrency(invoice.subtotal, cur)} />
            {hasDiscount && (
              <TotalRow
                label="Discount"
                value={`-${formatCurrency(invoice.discountAmount, cur)}`}
              />
            )}
            {hasTax && (
              <TotalRow label="Tax / VAT"  value={formatCurrency(invoice.taxAmount, cur)} />
            )}
            <tr>
              <td
                colSpan={2}
                style={{ borderTop: `1px solid ${border}`, padding: "2px 0" }}
              />
            </tr>
            <TotalRow
              label={`Total (${cur})`}
              value={formatCurrency(invoice.totalAmount, cur)}
              bold
            />
            {hasPaid && (
              <TotalRow
                label="Payments / Credits"
                value={`-${formatCurrency(invoice.amountPaid, cur)}`}
              />
            )}
            {/* Balance Due — hero row */}
            <tr
              style={{
                backgroundColor: accentColor,
                color:           "#fff",
              }}
            >
              <td
                style={{
                  padding:    "10px 10px 10px 12px",
                  fontSize:   "13px",
                  fontWeight: 700,
                }}
              >
                Balance Due ({cur})
              </td>
              <td
                style={{
                  padding:    "10px 12px 10px 8px",
                  fontSize:   "14px",
                  fontWeight: 800,
                  textAlign:  "right",
                  fontFamily: "monospace",
                }}
              >
                {formatCurrency(invoice.balanceDue, cur)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── 6. Payment history ───────────────────────────────────────────── */}
      {payments.length > 0 && (
        <div style={{ padding: "16px 28px", borderBottom: `1px solid ${border}` }}>
          <div
            style={{
              fontSize:      "10px",
              fontWeight:    700,
              color:         accentColor,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom:  "8px",
            }}
          >
            Payment History
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${border}` }}>
                <th style={{ textAlign: "left",  padding: "5px 0", fontWeight: 600, color: "#6b7280" }}>Reference</th>
                <th style={{ textAlign: "left",  padding: "5px 0", fontWeight: 600, color: "#6b7280" }}>Date</th>
                <th style={{ textAlign: "left",  padding: "5px 0", fontWeight: 600, color: "#6b7280" }}>Method</th>
                <th style={{ textAlign: "right", padding: "5px 0", fontWeight: 600, color: "#6b7280" }}>Amount (NGN)</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: `1px solid ${border}`, backgroundColor: i % 2 === 1 ? altRow : "#fff" }}
                >
                  <td style={{ padding: "6px 0", fontFamily: "monospace", color: "#1d4ed8" }}>
                    {p.paymentNumber}
                  </td>
                  <td style={{ padding: "6px 0" }}>{formatDate(p.paymentDate)}</td>
                  <td style={{ padding: "6px 0", color: "#6b7280" }}>
                    {p.method.replace(/_/g, " ")}
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right", fontFamily: "monospace", color: "#16a34a" }}>
                    {formatCurrency(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 7. Footer: Notes + Payment Terms ─────────────────────────────── */}
      {(showNotes && invoice.notes) || showPaymentTerms ? (
        <div style={{ padding: "16px 28px 24px" }}>
          {showNotes && invoice.notes && (
            <div style={{ marginBottom: "12px" }}>
              <div
                style={{
                  fontSize:      "10px",
                  fontWeight:    700,
                  color:         accentColor,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  marginBottom:  "5px",
                }}
              >
                Notes
              </div>
              <p style={{ fontSize: "12px", color: "#374151", margin: 0 }}>
                {invoice.notes}
              </p>
            </div>
          )}
          {showPaymentTerms && (
            <div>
              <div
                style={{
                  fontSize:      "10px",
                  fontWeight:    700,
                  color:         accentColor,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  marginBottom:  "5px",
                }}
              >
                Payment Terms
              </div>
              <p style={{ fontSize: "12px", color: "#374151", margin: 0 }}>
                Payment is due by {formatDate(invoice.dueDate)}.
                {!isNGN &&
                  ` All amounts in ${cur}. Exchange rate: 1 ${cur} = ₦${invoice.exchangeRate.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}.`}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetaRow({
  label,
  value,
  bold,
  mono,
}: {
  label: string;
  value: string;
  bold?: boolean;
  mono?: boolean;
}) {
  return (
    <tr>
      <td style={{ padding: "3px 8px 3px 0", color: "#6b7280", fontSize: "11px", whiteSpace: "nowrap" }}>
        {label}
      </td>
      <td
        style={{
          padding:    "3px 0",
          fontSize:   "12px",
          fontWeight: bold ? 700 : 400,
          fontFamily: mono ? "monospace" : "inherit",
          textAlign:  "right",
        }}
      >
        {value}
      </td>
    </tr>
  );
}

function TotalRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <tr>
      <td
        style={{
          padding:    "4px 8px 4px 4px",
          fontSize:   "12px",
          fontWeight: bold ? 700 : 400,
          color:      bold ? "#111827" : "#4b5563",
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding:    "4px 4px",
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
