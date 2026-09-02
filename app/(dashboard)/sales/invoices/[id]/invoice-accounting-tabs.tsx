"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils";

export type InvoicePaymentTabRow = {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
};

export type InvoiceRecognitionTabRow = {
  id: string;
  kind: "Invoice" | "Project";
  date: string;
  amountBase: number;
  status: string;
  note: string | null;
};

export type InvoiceProjectTabRow = {
  id: string;
  description: string;
  projectName: string;
  projectCode: string | null;
  incomeAccount: string;
  invoiceAmountBase: number;
  contractAssetCleared: number;
  immediateRevenue: number;
  unearnedCreated: number;
};

export type InvoiceAuditTabRow = {
  id: string;
  date: string;
  source: string;
  reference: string | null;
  description: string;
};

const TABS = ["Payment", "Recognition", "Project", "VAT", "Audit"] as const;
type Tab = typeof TABS[number];

export function InvoiceAccountingTabs({
  baseCurrency,
  invoiceCurrency,
  payments,
  recognitions,
  projects,
  vatLines,
  taxTotal,
  audit,
}: {
  baseCurrency: string;
  invoiceCurrency: string;
  payments: InvoicePaymentTabRow[];
  recognitions: InvoiceRecognitionTabRow[];
  projects: InvoiceProjectTabRow[];
  vatLines: Array<{ description: string; taxName: string | null; taxRate: number; taxAmount: number }>;
  taxTotal: number;
  audit: InvoiceAuditTabRow[];
}) {
  const [active, setActive] = useState<Tab>("Payment");
  const base = (value: number) => formatCurrency(value, baseCurrency);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto border-b border-slate-200 bg-slate-50/70">
        <div className="flex min-w-max px-4">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActive(tab)}
              className={`border-b-2 px-4 py-3 text-sm font-medium ${active === tab ? "border-[var(--finos-accent)] text-[var(--finos-accent)]" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {active === "Payment" ? (
          payments.length ? (
            <Table headers={["Receipt", "Date", "Method", `Amount (${invoiceCurrency})`, "Status"]}>
              {payments.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-3 font-mono text-xs">{row.paymentNumber}</td>
                  <td className="px-3 py-3 text-slate-600">{row.paymentDate}</td>
                  <td className="px-3 py-3 text-slate-600">{humanise(row.method)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatCurrency(row.amount, row.currency)}</td>
                  <td className="px-3 py-3"><Status value={row.status} /></td>
                </tr>
              ))}
            </Table>
          ) : <Empty text="No receipts have been allocated to this invoice." />
        ) : null}

        {active === "Recognition" ? (
          recognitions.length ? (
            <Table headers={["Type", "Recognition date", `Amount (${baseCurrency})`, "Status", "Evidence / note"]}>
              {recognitions.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className="border-t border-slate-100">
                  <td className="px-3 py-3 font-medium">{row.kind}</td>
                  <td className="px-3 py-3 text-slate-600">{row.date}</td>
                  <td className="px-3 py-3 text-right font-mono">{base(row.amountBase)}</td>
                  <td className="px-3 py-3"><Status value={row.status} /></td>
                  <td className="px-3 py-3 text-slate-600">{row.note || "—"}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty text="No separate revenue-recognition events are linked to this invoice." />
        ) : null}

        {active === "Project" ? (
          projects.length ? (
            <Table headers={["Line", "Project", "Income account", `Billed service (${baseCurrency})`, "Contract Asset cleared", "Immediate revenue", "Unearned created"]}>
              {projects.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-3 text-slate-700">{row.description}</td>
                  <td className="px-3 py-3"><p className="font-medium">{row.projectName}</p>{row.projectCode ? <p className="font-mono text-[11px] text-slate-400">{row.projectCode}</p> : null}</td>
                  <td className="px-3 py-3 text-slate-600">{row.incomeAccount}</td>
                  <td className="px-3 py-3 text-right font-mono">{base(row.invoiceAmountBase)}</td>
                  <td className="px-3 py-3 text-right font-mono">{base(row.contractAssetCleared)}</td>
                  <td className="px-3 py-3 text-right font-mono">{base(row.immediateRevenue)}</td>
                  <td className="px-3 py-3 text-right font-mono">{base(row.unearnedCreated)}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty text="This invoice has no Project-linked lines." />
        ) : null}

        {active === "VAT" ? (
          vatLines.some((line) => line.taxAmount > 0.005) ? (
            <div className="space-y-4">
              <Table headers={["Line", "Tax", "Rate", `Tax amount (${invoiceCurrency})`]}>
                {vatLines.filter((line) => line.taxAmount > 0.005).map((line, index) => (
                  <tr key={`${line.description}-${index}`} className="border-t border-slate-100">
                    <td className="px-3 py-3 text-slate-700">{line.description}</td>
                    <td className="px-3 py-3 text-slate-600">{line.taxName || "Tax"}</td>
                    <td className="px-3 py-3 text-right font-mono">{line.taxRate.toFixed(2)}%</td>
                    <td className="px-3 py-3 text-right font-mono">{formatCurrency(line.taxAmount, invoiceCurrency)}</td>
                  </tr>
                ))}
              </Table>
              <p className="text-right text-sm font-medium text-slate-700">Invoice tax total: {formatCurrency(taxTotal, invoiceCurrency)}</p>
            </div>
          ) : <Empty text="No VAT or other tax is charged on this invoice." />
        ) : null}

        {active === "Audit" ? (
          audit.length ? (
            <Table headers={["Date", "Source", "Reference", "Description"]}>
              {audit.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-3 text-slate-600">{row.date}</td>
                  <td className="px-3 py-3 font-mono text-xs">{humanise(row.source)}</td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-600">{row.reference || "—"}</td>
                  <td className="px-3 py-3 text-slate-700">{row.description}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty text="No accounting audit entries are linked to this invoice yet." />
        ) : null}
      </div>
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{headers.map((header) => <th key={header} className="px-3 py-2.5 text-left font-medium last:text-right">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
function Status({ value }: { value: string }) { return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{humanise(value)}</span>; }
function Empty({ text }: { text: string }) { return <p className="py-8 text-center text-sm text-slate-500">{text}</p>; }
function humanise(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
