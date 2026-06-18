"use client";

/**
 * Print trigger bar — screen only, hidden when printing.
 * Provides "Print / Save as PDF" and "Close" buttons.
 */
export function PrintTrigger({ invoiceNumber }: { invoiceNumber: string }) {
  return (
    <div
      className="print:hidden"
      style={{
        position:        "fixed",
        top:             0,
        left:            0,
        right:           0,
        zIndex:          50,
        backgroundColor: "#fff",
        borderBottom:    "1px solid #e2e8f0",
        padding:         "10px 16px",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "space-between",
        boxShadow:       "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151" }}>
        Invoice {invoiceNumber}
      </span>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => window.print()}
          style={{
            padding:         "6px 14px",
            fontSize:        "13px",
            fontWeight:      500,
            backgroundColor: "#1d4ed8",
            color:           "#fff",
            border:          "none",
            borderRadius:    "6px",
            cursor:          "pointer",
          }}
        >
          Print / Save as PDF
        </button>
        <button
          onClick={() => window.close()}
          style={{
            padding:         "6px 14px",
            fontSize:        "13px",
            fontWeight:      500,
            backgroundColor: "#fff",
            color:           "#374151",
            border:          "1px solid #d1d5db",
            borderRadius:    "6px",
            cursor:          "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
