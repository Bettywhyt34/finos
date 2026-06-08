"use client";

import { useState }         from "react";
import { Plus, X, AlertTriangle, Info } from "lucide-react";
import type { TenantCurrencyRow }       from "@/lib/setup-configurations/service";
import { cn }               from "@/lib/utils";

// ─── Static ISO 4217 catalogue (used only in the New Currency selector) ───────

const CURRENCY_CATALOGUE = [
  { code: "USD", name: "US Dollar",               symbol: "$"    },
  { code: "GBP", name: "British Pound",            symbol: "£"    },
  { code: "EUR", name: "Euro",                     symbol: "€"    },
  { code: "JPY", name: "Japanese Yen",             symbol: "¥"    },
  { code: "CAD", name: "Canadian Dollar",          symbol: "CA$"  },
  { code: "AUD", name: "Australian Dollar",        symbol: "A$"   },
  { code: "CHF", name: "Swiss Franc",              symbol: "CHF"  },
  { code: "ZAR", name: "South African Rand",       symbol: "R"    },
  { code: "GHS", name: "Ghanaian Cedi",            symbol: "GH₵"  },
  { code: "NGN", name: "Nigerian Naira",           symbol: "₦"    },
  { code: "KES", name: "Kenyan Shilling",          symbol: "KSh"  },
  { code: "EGP", name: "Egyptian Pound",           symbol: "E£"   },
  { code: "MAD", name: "Moroccan Dirham",          symbol: "د.م." },
  { code: "XOF", name: "West African CFA Franc",   symbol: "CFA"  },
  { code: "CNY", name: "Chinese Yuan",             symbol: "¥"    },
  { code: "INR", name: "Indian Rupee",             symbol: "₹"    },
  { code: "BRL", name: "Brazilian Real",           symbol: "R$"   },
  { code: "MXN", name: "Mexican Peso",             symbol: "$"    },
  { code: "SGD", name: "Singapore Dollar",         symbol: "S$"   },
  { code: "AED", name: "UAE Dirham",               symbol: "AED"  },
  { code: "SAR", name: "Saudi Riyal",              symbol: "SAR"  },
  { code: "SEK", name: "Swedish Krona",            symbol: "kr"   },
  { code: "NOK", name: "Norwegian Krone",          symbol: "kr"   },
  { code: "DKK", name: "Danish Krone",             symbol: "kr"   },
  { code: "NZD", name: "New Zealand Dollar",       symbol: "NZ$"  },
  { code: "HKD", name: "Hong Kong Dollar",         symbol: "HK$"  },
  { code: "TRY", name: "Turkish Lira",             symbol: "₺"    },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  baseCurrency: string | null;
  currencies:   TenantCurrencyRow[];
}

export function CurrenciesClient({ baseCurrency, currencies }: Props) {
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [drawerError, setDrawerError] = useState(false);

  const [newCode,   setNewCode]   = useState("");
  const [newRate,   setNewRate]   = useState("");
  const [newStatus, setNewStatus] = useState<"active" | "inactive">("active");

  const selectedCurrency = CURRENCY_CATALOGUE.find((c) => c.code === newCode);

  // Filter out codes already in the table
  const activeCodes        = new Set(currencies.map((c) => c.code));
  const availableCurrencies = CURRENCY_CATALOGUE.filter((c) => !activeCodes.has(c.code));

  function openDrawer() {
    setNewCode("");
    setNewRate("");
    setNewStatus("active");
    setDrawerError(false);
    setDrawerOpen(true);
  }

  function handleAddCurrency() {
    // Backend not connected — show honest error
    setDrawerError(true);
  }

  return (
    <div className="px-8 py-8">

      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Currencies</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-xl">
            Manage the currencies your organisation uses for customers, vendors, invoices, bills,
            and reporting.
          </p>
        </div>
        <button
          type="button"
          onClick={openDrawer}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-md hover:opacity-90 transition-opacity shrink-0 ml-4"
        >
          <Plus className="h-4 w-4" />
          New Currency
        </button>
      </div>

      {/* Backend notice */}
      <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <Info className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
        <p className="text-sm text-slate-500">
          Showing base currency from organisation settings. Currency management backend is not
          connected yet.
        </p>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Symbol</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Code</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Exchange Rate</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {currencies.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                  No currencies found. Unable to load organisation data.
                </td>
              </tr>
            ) : (
              currencies.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{row.name}</span>
                      {row.isBase && (
                        <span className="px-1.5 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-500 rounded">
                          Base
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.symbol}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                      {row.code}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.isBase ? "1.00 (Base)" : row.exchangeRate.toFixed(4)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                      row.status === "active"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    )}>
                      {row.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.isBase ? (
                      <span className="text-xs text-slate-400">Cannot disable base</span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-red-600 transition-colors"
                      >
                        Disable
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── New Currency Drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60] flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/30"
            onClick={() => setDrawerOpen(false)}
          />

          {/* Panel */}
          <div className="w-[420px] bg-white h-full shadow-2xl flex flex-col">

            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <h2 className="text-base font-semibold text-slate-900">New Currency</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

              {drawerError && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-800">Currency backend is not connected yet.</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Currency</label>
                <select
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                >
                  <option value="">Select a currency…</option>
                  {availableCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Currency Code</label>
                <input
                  type="text"
                  value={newCode}
                  readOnly
                  placeholder="Auto-filled from selection"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-slate-50 text-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Symbol</label>
                <input
                  type="text"
                  value={selectedCurrency?.symbol ?? ""}
                  readOnly
                  placeholder="Auto-filled from selection"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-slate-50 text-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Exchange Rate to Base Currency
                  {baseCurrency && newCode && (
                    <span className="font-normal text-slate-400 ml-1 text-xs">
                      (1 {newCode} = ? {baseCurrency})
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  value={newRate}
                  min={0}
                  step="any"
                  onChange={(e) => setNewRate(e.target.value)}
                  placeholder="e.g. 1600.00"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as "active" | "inactive")}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

            </div>

            {/* Drawer footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddCurrency}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--finos-accent)] rounded-md hover:opacity-90 transition-opacity"
              >
                Add Currency
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
