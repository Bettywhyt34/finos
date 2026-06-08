"use client";

import { useState }              from "react";
import { AlertTriangle, Info }  from "lucide-react";
import { Toggle, SectionTitle } from "@/components/settings/settings-shell";
import { cn }              from "@/lib/utils";

// ─── Static config ────────────────────────────────────────────────────────────

const MODULES = [
  { id: "quotes",           label: "Quotes",                    desc: "Create and send sales quotes to customers"         },
  { id: "salesInvoices",    label: "Sales Invoices",            desc: "Issue invoices and track receivables"              },
  { id: "customerPayments", label: "Customer Payments",         desc: "Record and allocate customer receipts"             },
  { id: "bills",            label: "Bills",                     desc: "Enter and manage vendor bills"                     },
  { id: "vendorPayments",   label: "Vendor Payments",           desc: "Process payments to vendors with WHT support"      },
  { id: "expenses",         label: "Expenses",                  desc: "Track employee and operational expenses"           },
  { id: "banking",          label: "Banking & Reconciliation",  desc: "Manage bank accounts and statement reconciliation" },
  { id: "journalEntries",   label: "Journal Entries",           desc: "Post manual journal entries"                       },
  { id: "budgets",          label: "Budgets",                   desc: "Create and track budgets by period"                },
  { id: "reports",          label: "Reports",                   desc: "P&L, Balance Sheet, Cash Flow, and more"           },
] as const;

const WORK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const ADDRESS_FORMATS = [
  { value: "ng",       label: "Nigeria (Street, Area, LGA, State)"                },
  { value: "standard", label: "Standard (Street, City, State, ZIP, Country)"      },
  { value: "uk",       label: "UK (House number, Street, Town, County, Postcode)" },
  { value: "us",       label: "US (Street, City, State, ZIP)"                     },
  { value: "ca",       label: "Canada (Street, City, Province, Postal Code)"      },
  { value: "au",       label: "Australia (Street, Suburb, State, Postcode)"       },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function GeneralClient() {
  const [saveAttempted, setSaveAttempted] = useState(false);

  // Modules
  const [modules, setModules] = useState<Record<string, boolean>>(
    Object.fromEntries(MODULES.map((m) => [m.id, true]))
  );

  // Work week
  const [workDays, setWorkDays] = useState<Set<string>>(
    new Set(["Mon", "Tue", "Wed", "Thu", "Fri"])
  );

  // PDF preferences
  const [pdfOnInvoice,  setPdfOnInvoice]  = useState(true);
  const [pdfOnBill,     setPdfOnBill]     = useState(false);
  const [pdfTaxSummary, setPdfTaxSummary] = useState(true);

  // Discounts
  const [discountsEnabled, setDiscountsEnabled] = useState(true);
  const [discountLevel,    setDiscountLevel]    = useState("item");

  // Additional charges
  const [chargesEnabled, setChargesEnabled] = useState(false);

  // Tax display
  const [taxDisplay, setTaxDisplay] = useState<"exclusive" | "inclusive">("exclusive");

  // Rounding
  const [rounding, setRounding] = useState<"none" | "off" | "up" | "down">("none");

  // Salesperson
  const [salesperson, setSalesperson] = useState(false);

  // Profit margin
  const [profitMargin, setProfitMargin] = useState(false);

  // Billable
  const [billableBills,    setBillableBills]    = useState(false);
  const [billableExpenses, setBillableExpenses] = useState(false);

  // Document copy labels
  const [copyLabels, setCopyLabels] = useState({
    original:   "Original",
    duplicate:  "Duplicate",
    triplicate: "Triplicate",
  });

  // Weekly summary
  const [weeklySummary, setWeeklySummary] = useState(false);
  const [summaryDay,    setSummaryDay]    = useState("Monday");

  // Payment retention
  const [retentionDays, setRetentionDays] = useState(30);

  // Address format
  const [addressFormat, setAddressFormat] = useState("ng");

  function toggleWorkDay(day: string) {
    setWorkDays((prev) => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  }

  function handleSave() {
    setSaveAttempted(true);
  }

  function handleCancel() {
    // Reset all form fields to application defaults, then clear the banner
    setModules(Object.fromEntries(MODULES.map((m) => [m.id, true])));
    setWorkDays(new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]));
    setPdfOnInvoice(true);
    setPdfOnBill(false);
    setPdfTaxSummary(true);
    setDiscountsEnabled(true);
    setDiscountLevel("item");
    setChargesEnabled(false);
    setTaxDisplay("exclusive");
    setRounding("none");
    setSalesperson(false);
    setProfitMargin(false);
    setBillableBills(false);
    setBillableExpenses(false);
    setCopyLabels({ original: "Original", duplicate: "Duplicate", triplicate: "Triplicate" });
    setWeeklySummary(false);
    setSummaryDay("Monday");
    setRetentionDays(30);
    setAddressFormat("ng");
    setSaveAttempted(false);
  }

  return (
    <div className="flex flex-col min-h-full">

      {/* Page header */}
      <div className="px-8 pt-8 pb-6 border-b border-slate-200 bg-white shrink-0">
        <h1 className="text-xl font-semibold text-slate-900">General</h1>
        <p className="mt-1 text-sm text-slate-500 max-w-2xl">
          Choose the modules, document preferences, transaction rules, and default behaviours your
          organisation uses in FINOS.
        </p>
      </div>

      {/* Sections */}
      <div className="flex-1 px-8 py-8">
        <div className="max-w-2xl space-y-8">

          {/* Persistent backend status notice */}
          <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <Info className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
            <p className="text-sm text-slate-500">
              These are default values. The backend for saving general preferences is not yet
              connected — changes will not persist until the database model is implemented.
            </p>
          </div>

          {/* Save-attempt error banner */}
          {saveAttempted && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800">
                General preferences backend is not connected yet.
              </p>
            </div>
          )}

          {/* ── Enabled Modules ── */}
          <section>
            <SectionTitle title="Enabled Modules" />
            <div className="mt-4 space-y-3">
              {MODULES.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{m.label}</p>
                    <p className="text-xs text-slate-500">{m.desc}</p>
                  </div>
                  <Toggle
                    checked={modules[m.id] ?? true}
                    onChange={(v) => setModules((p) => ({ ...p, [m.id]: v }))}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* ── Work Week ── */}
          <section>
            <SectionTitle title="Work Week" />
            <div className="mt-4 flex flex-wrap gap-2">
              {WORK_DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleWorkDay(day)}
                  className={cn(
                    "w-12 h-10 rounded-md text-sm font-medium border transition-colors",
                    workDays.has(day)
                      ? "bg-[var(--finos-accent)] border-[var(--finos-accent)] text-white"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {day}
                </button>
              ))}
            </div>
          </section>

          {/* ── PDF Attachment Preferences ── */}
          <section>
            <SectionTitle title="PDF Attachment Preferences" />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-700">Attach PDF to invoice emails</p>
                <Toggle checked={pdfOnInvoice} onChange={setPdfOnInvoice} />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-700">Attach PDF to bill emails</p>
                <Toggle checked={pdfOnBill} onChange={setPdfOnBill} />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-700">Include tax summary in PDF</p>
                <Toggle checked={pdfTaxSummary} onChange={setPdfTaxSummary} />
              </div>
            </div>
          </section>

          {/* ── Discounts ── */}
          <section>
            <SectionTitle title="Discounts" />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-700">Enable discounts on transactions</p>
                <Toggle checked={discountsEnabled} onChange={setDiscountsEnabled} />
              </div>
              {discountsEnabled && (
                <div className="flex items-center gap-3">
                  <label className="text-sm text-slate-600 shrink-0">Apply discount at</label>
                  <select
                    value={discountLevel}
                    onChange={(e) => setDiscountLevel(e.target.value)}
                    className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                  >
                    <option value="item">Item Level</option>
                    <option value="transaction">Transaction Level</option>
                    <option value="both">Both (Item &amp; Transaction)</option>
                  </select>
                </div>
              )}
            </div>
          </section>

          {/* ── Additional Charges ── */}
          <section>
            <SectionTitle title="Additional Charges" />
            <div className="mt-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-700">Enable additional charges</p>
                <p className="text-xs text-slate-500">Add shipping, handling, or other charges to invoices and bills</p>
              </div>
              <Toggle checked={chargesEnabled} onChange={setChargesEnabled} />
            </div>
          </section>

          {/* ── Tax Display Preference ── */}
          <section>
            <SectionTitle title="Tax Display Preference" />
            <div className="mt-4 space-y-2">
              {(
                [
                  ["exclusive", "Tax Exclusive — tax shown separately on documents"],
                  ["inclusive", "Tax Inclusive — tax included in line item price"],
                ] as const
              ).map(([val, label]) => (
                <label key={val} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="taxDisplay"
                    value={val}
                    checked={taxDisplay === val}
                    onChange={() => setTaxDisplay(val)}
                    className="accent-[var(--finos-accent)]"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* ── Rounding Preference ── */}
          <section>
            <SectionTitle title="Rounding Preference" />
            <div className="mt-4 space-y-2">
              {(
                [
                  ["none", "No Rounding"],
                  ["off",  "Round Off (nearest whole number)"],
                  ["up",   "Round Up"],
                  ["down", "Round Down"],
                ] as const
              ).map(([val, label]) => (
                <label key={val} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="rounding"
                    value={val}
                    checked={rounding === val}
                    onChange={() => setRounding(val)}
                    className="accent-[var(--finos-accent)]"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* ── Salesperson Field ── */}
          <section>
            <SectionTitle title="Salesperson Field" />
            <div className="mt-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-700">Show salesperson field on invoices</p>
                <p className="text-xs text-slate-500">Assign a salesperson to invoices for reporting and commissions</p>
              </div>
              <Toggle checked={salesperson} onChange={setSalesperson} />
            </div>
          </section>

          {/* ── Profit Margin ── */}
          <section>
            <SectionTitle title="Profit Margin" />
            <div className="mt-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-700">Track and display profit margin</p>
                <p className="text-xs text-slate-500">Show margin % on invoices and reports</p>
              </div>
              <Toggle checked={profitMargin} onChange={setProfitMargin} />
            </div>
          </section>

          {/* ── Billable Bills and Expenses ── */}
          <section>
            <SectionTitle title="Billable Bills and Expenses" />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-700">Mark bills as billable to customers</p>
                  <p className="text-xs text-slate-500">Re-invoice vendor bills to customers</p>
                </div>
                <Toggle checked={billableBills} onChange={setBillableBills} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-700">Mark expenses as billable to customers</p>
                  <p className="text-xs text-slate-500">Re-invoice employee expenses to customers</p>
                </div>
                <Toggle checked={billableExpenses} onChange={setBillableExpenses} />
              </div>
            </div>
          </section>

          {/* ── Document Copy Labels ── */}
          <section>
            <SectionTitle title="Document Copy Labels" />
            <div className="mt-4 grid grid-cols-3 gap-4">
              {(["original", "duplicate", "triplicate"] as const).map((key) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-600 mb-1 capitalize">{key}</label>
                  <input
                    type="text"
                    value={copyLabels[key]}
                    onChange={(e) => setCopyLabels((p) => ({ ...p, [key]: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* ── Weekly Summary Report ── */}
          <section>
            <SectionTitle title="Weekly Summary Report" />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-700">Send weekly summary email</p>
                  <p className="text-xs text-slate-500">Receive a summary of transactions and KPIs each week</p>
                </div>
                <Toggle checked={weeklySummary} onChange={setWeeklySummary} />
              </div>
              {weeklySummary && (
                <div className="flex items-center gap-3">
                  <label className="text-sm text-slate-600 shrink-0">Send on</label>
                  <select
                    value={summaryDay}
                    onChange={(e) => setSummaryDay(e.target.value)}
                    className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                  >
                    {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </section>

          {/* ── Payment Retention ── */}
          <section>
            <SectionTitle title="Payment Retention" />
            <div className="mt-4 flex items-center gap-3">
              <label className="text-sm text-slate-600 shrink-0">Retain payment link data for</label>
              <input
                type="number"
                value={retentionDays}
                min={1}
                max={365}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="w-20 text-sm border border-slate-200 rounded-md px-3 py-1.5 text-slate-700 text-center focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
              />
              <span className="text-sm text-slate-500">days</span>
            </div>
          </section>

          {/* ── Organisation Address Format ── */}
          <section className="pb-4">
            <SectionTitle title="Organisation Address Format" />
            <div className="mt-4">
              <select
                value={addressFormat}
                onChange={(e) => setAddressFormat(e.target.value)}
                className="w-full max-w-sm text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
              >
                {ADDRESS_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </section>

        </div>
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-8 py-4 flex items-center justify-end gap-3 shrink-0">
        <button
          type="button"
          onClick={handleCancel}
          className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-md hover:opacity-90 transition-opacity"
        >
          Save Preferences
        </button>
      </div>
    </div>
  );
}
