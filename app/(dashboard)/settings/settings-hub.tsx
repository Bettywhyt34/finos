"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2, Users, FileText, Sliders, Palette, Zap, Target,
  ShoppingCart, CreditCard, Receipt, Package, Calculator,
  Plug, Code2, HelpCircle, Bell, MessageCircle, CalendarDays,
  Search, X, Landmark, Layers, Settings2, MessageSquare,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type IconType = React.ComponentType<{ className?: string; size?: number }>;

type SettingItem  = { label: string; href: string };
type SettingCard  = {
  id:         string;
  title:      string;
  Icon:       IconType;
  headerBg:   string;
  headerText: string;
  headerBorder: string;
  items:      SettingItem[];
};
type SettingSection = { id: string; title: string; cards: SettingCard[] };

// ─── Data config ──────────────────────────────────────────────────────────────

const SETTINGS: SettingSection[] = [
  {
    id: "organisation",
    title: "Organisation Settings",
    cards: [
      {
        id: "org-profile",
        title: "Organisation",
        Icon: Building2,
        headerBg:     "bg-emerald-50",
        headerText:   "text-emerald-700",
        headerBorder: "border-emerald-100",
        items: [
          { label: "Profile",           href: "/settings/organization" },
          { label: "Branding",          href: "/settings/organization/branding" },
          { label: "Fiscal Year",       href: "/settings/organization/fiscal-year" },
          { label: "Currencies",        href: "/settings/organization/currencies" },
          { label: "Locations",         href: "/settings/organization/locations" },
          { label: "Subscription",      href: "/settings/organization/subscription" },
        ],
      },
      {
        id: "users-roles",
        title: "Users & Roles",
        Icon: Users,
        headerBg:     "bg-rose-50",
        headerText:   "text-rose-700",
        headerBorder: "border-rose-100",
        items: [
          { label: "Users",             href: "/settings/users" },
          { label: "Roles",             href: "/settings/users/roles" },
          { label: "User Preferences",  href: "/settings/users/preferences" },
        ],
      },
      {
        id: "taxes",
        title: "Taxes & Compliance",
        Icon: FileText,
        headerBg:     "bg-blue-50",
        headerText:   "text-blue-700",
        headerBorder: "border-blue-100",
        items: [
          { label: "Tax Rates",         href: "/settings/taxes" },
          { label: "WHT Rates",         href: "/settings/taxes/wht" },
          { label: "VAT Settings",      href: "/settings/taxes/vat" },
        ],
      },
      {
        id: "setup",
        title: "Setup & Configuration",
        Icon: Sliders,
        headerBg:     "bg-orange-50",
        headerText:   "text-orange-700",
        headerBorder: "border-orange-100",
        items: [
          { label: "General",           href: "/settings/general" },
          { label: "Payment Terms",     href: "/settings/payment-terms" },
          { label: "Opening Balances",  href: "/settings/opening-balances" },
          { label: "Reminders",         href: "/settings/reminders" },
          { label: "Customer Portal",   href: "/settings/customer-portal" },
          { label: "Vendor Portal",     href: "/settings/vendor-portal" },
        ],
      },
      {
        id: "customisation",
        title: "Customisation",
        Icon: Palette,
        headerBg:     "bg-amber-50",
        headerText:   "text-amber-700",
        headerBorder: "border-amber-100",
        items: [
          { label: "Transaction Numbers", href: "/settings/transaction-numbers" },
          { label: "PDF Templates",       href: "/settings/pdf-templates" },
          { label: "Email Templates",     href: "/settings/email-templates" },
          { label: "Reporting Tags",      href: "/settings/reporting-tags" },
        ],
      },
      {
        id: "automation",
        title: "Automation",
        Icon: Zap,
        headerBg:     "bg-red-50",
        headerText:   "text-red-700",
        headerBorder: "border-red-100",
        items: [
          { label: "Workflow Rules",    href: "/settings/automation/workflows" },
          { label: "Workflow Actions",  href: "/settings/automation/actions" },
          { label: "Schedules",         href: "/settings/automation/schedules" },
          { label: "Audit Logs",        href: "/settings/automation/logs" },
        ],
      },
      {
        id: "budgets",
        title: "Budgets",
        Icon: Target,
        headerBg:     "bg-violet-50",
        headerText:   "text-violet-700",
        headerBorder: "border-violet-100",
        items: [
          { label: "Budget Settings",   href: "/settings/budgets" },
          { label: "Approval Workflow", href: "/settings/budgets/approvals" },
          { label: "Override Audit",    href: "/settings/budgets/overrides" },
        ],
      },
    ],
  },
  {
    id: "modules",
    title: "Module Settings",
    cards: [
      {
        id: "mod-general",
        title: "General",
        Icon: Layers,
        headerBg:     "bg-emerald-50",
        headerText:   "text-emerald-700",
        headerBorder: "border-emerald-100",
        items: [
          { label: "Customers & Vendors", href: "/settings/modules/customers-vendors" },
          { label: "Items & Categories",  href: "/settings/modules/items" },
          { label: "Accountant",          href: "/settings/modules/accountant" },
        ],
      },
      {
        id: "mod-banking",
        title: "Banking",
        Icon: Landmark,
        headerBg:     "bg-blue-50",
        headerText:   "text-blue-700",
        headerBorder: "border-blue-100",
        items: [
          { label: "Bank Accounts",       href: "/banking/accounts" },
          { label: "Reconciliation",      href: "/banking/reconciliation" },
          { label: "Import Settings",     href: "/settings/banking/import" },
          { label: "Statement Matching",  href: "/settings/banking/matching" },
        ],
      },
      {
        id: "mod-sales",
        title: "Sales",
        Icon: ShoppingCart,
        headerBg:     "bg-emerald-50",
        headerText:   "text-emerald-700",
        headerBorder: "border-emerald-100",
        items: [
          { label: "Quotes",             href: "/settings/sales/quotes" },
          { label: "Invoices",           href: "/settings/sales/invoices" },
          { label: "Receipts",           href: "/settings/sales/receipts" },
          { label: "Credit Notes",       href: "/settings/sales/credit-notes" },
          { label: "Payment Links",      href: "/settings/sales/payment-links" },
        ],
      },
      {
        id: "mod-purchases",
        title: "Purchases",
        Icon: CreditCard,
        headerBg:     "bg-teal-50",
        headerText:   "text-teal-700",
        headerBorder: "border-teal-100",
        items: [
          { label: "Bills",              href: "/settings/purchases/bills" },
          { label: "Payments Made",      href: "/settings/purchases/payments" },
          { label: "Purchase Orders",    href: "/settings/purchases/orders" },
          { label: "Vendor Credits",     href: "/settings/purchases/vendor-credits" },
        ],
      },
      {
        id: "mod-expenses",
        title: "Expenses",
        Icon: Receipt,
        headerBg:     "bg-orange-50",
        headerText:   "text-orange-700",
        headerBorder: "border-orange-100",
        items: [
          { label: "Expense Categories", href: "/expenses/categories" },
          { label: "Approval Rules",     href: "/settings/expenses/approvals" },
          { label: "Recurring Expenses", href: "/settings/expenses/recurring" },
        ],
      },
      {
        id: "mod-accounting",
        title: "Accounting",
        Icon: Calculator,
        headerBg:     "bg-violet-50",
        headerText:   "text-violet-700",
        headerBorder: "border-violet-100",
        items: [
          { label: "Chart of Accounts",  href: "/accounting/chart-of-accounts" },
          { label: "Journal Settings",   href: "/settings/accounting/journals" },
          { label: "Period Management",  href: "/accounting/period-close" },
          { label: "FX Revaluation",     href: "/accounting/fx-revaluation" },
          { label: "Trial Balance",      href: "/accounting/trial-balance" },
        ],
      },
      {
        id: "mod-items",
        title: "Items",
        Icon: Package,
        headerBg:     "bg-slate-50",
        headerText:   "text-slate-700",
        headerBorder: "border-slate-200",
        items: [
          { label: "All Items",          href: "/items" },
          { label: "Categories",         href: "/items/categories" },
          { label: "Price Lists",        href: "/settings/items/price-lists" },
          { label: "Units of Measure",   href: "/settings/items/units" },
        ],
      },
    ],
  },
  {
    id: "extensions",
    title: "Extensions & Integrations",
    cards: [
      {
        id: "integrations",
        title: "Integrations",
        Icon: Plug,
        headerBg:     "bg-emerald-50",
        headerText:   "text-emerald-700",
        headerBorder: "border-emerald-100",
        items: [
          { label: "All Integrations",   href: "/settings/integrations" },
          { label: "Revflow",            href: "/integrations/revflow/status" },
          { label: "XpenxFlow",          href: "/integrations/xpenxflow/status" },
          { label: "EARNMARK360",        href: "/integrations/earnmark360/status" },
          { label: "BettyWhyt",          href: "/integrations/bettywhyt/status" },
          { label: "FINOS POS",          href: "/integrations/finos_pos/status" },
        ],
      },
      {
        id: "developer",
        title: "Developer",
        Icon: Code2,
        headerBg:     "bg-orange-50",
        headerText:   "text-orange-700",
        headerBorder: "border-orange-100",
        items: [
          { label: "API Settings",       href: "/settings/developer/api" },
          { label: "Webhooks",           href: "/settings/developer/webhooks" },
          { label: "Data Management",    href: "/settings/developer/data" },
          { label: "Audit Trail",        href: "/settings/developer/audit" },
          { label: "Import / Export",    href: "/settings/developer/import-export" },
        ],
      },
    ],
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SettingsCard({ card }: { card: SettingCard }) {
  return (
    <div className="bg-white rounded-xl border border-[#eef0f4] shadow-sm overflow-hidden flex flex-col">
      {/* Card header */}
      <div className={`flex items-center gap-2.5 px-4 h-11 border-b ${card.headerBg} ${card.headerBorder}`}>
        <card.Icon size={15} className={card.headerText} />
        <span className={`text-[13px] font-semibold ${card.headerText}`}>{card.title}</span>
      </div>
      {/* Items */}
      <ul className="py-1">
        {card.items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block px-4 py-[7px] text-[13px] text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingsSection({ section }: { section: SettingSection }) {
  return (
    <section>
      <h2 className="text-[17px] font-semibold text-slate-800 mb-4">{section.title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[18px]">
        {section.cards.map((card) => (
          <SettingsCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        <Search size={22} className="text-slate-400" />
      </div>
      <p className="text-slate-700 font-semibold text-[15px]">No settings found</p>
      <p className="text-slate-400 text-sm mt-1">
        No results for &ldquo;{query}&rdquo;. Try a different keyword.
      </p>
    </div>
  );
}

function RightDock() {
  const items = [
    { Icon: HelpCircle,   label: "Help" },
    { Icon: Bell,         label: "Notifications" },
    { Icon: MessageCircle,label: "Chat" },
    { Icon: CalendarDays, label: "Calendar" },
    { Icon: Settings2,    label: "Settings" },
  ];
  return (
    <div className="fixed right-0 top-1/2 -translate-y-1/2 flex flex-col gap-1 pr-1 z-50 hidden xl:flex">
      {items.map(({ Icon, label }) => (
        <button
          key={label}
          title={label}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm transition-all"
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

function AssistanceButton() {
  return (
    <button className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-medium px-4 py-2.5 rounded-full shadow-lg transition-colors">
      <MessageSquare size={14} />
      Need Assistance?
    </button>
  );
}

// ─── Main hub ─────────────────────────────────────────────────────────────────

export function SettingsHub({ orgName }: { orgName: string }) {
  const [search, setSearch] = useState("");
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && search) {
        setSearch("");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [search]);

  // Search filter
  const filteredSections = useMemo<SettingSection[]>(() => {
    const q = search.toLowerCase().trim();
    if (!q) return SETTINGS;
    return SETTINGS.map((section) => ({
      ...section,
      cards: section.cards
        .map((card): SettingCard | null => {
          const titleMatch = card.title.toLowerCase().includes(q);
          const matchedItems = card.items.filter((item) =>
            item.label.toLowerCase().includes(q)
          );
          if (!titleMatch && matchedItems.length === 0) return null;
          return { ...card, items: titleMatch ? card.items : matchedItems };
        })
        .filter((c): c is SettingCard => c !== null),
    })).filter((s) => s.cards.length > 0);
  }, [search]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f7f8fb]">

      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1360px] mx-auto px-6 h-[68px] flex items-center gap-6">

          {/* Left: logo + title */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-black tracking-tight">F</span>
            </div>
            <div className="leading-tight">
              <p className="text-[13px] font-bold text-slate-900">All Settings</p>
              <p className="text-[11px] text-slate-400 truncate max-w-[180px]">{orgName}</p>
            </div>
          </div>

          {/* Center: search */}
          <div className="flex-1 flex justify-center">
            <div className="relative w-full max-w-[420px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search settings (Ctrl + /)"
                className="w-full pl-9 pr-8 py-[7px] text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 focus:bg-white placeholder:text-slate-400 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Right: close */}
          <button
            onClick={() => router.push("/")}
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Close Settings
            <X size={13} className="text-red-500 ml-0.5" />
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-[1360px] mx-auto px-6 pt-10 pb-24 space-y-10">
        {filteredSections.length === 0 ? (
          <EmptyState query={search} />
        ) : (
          filteredSections.map((section) => (
            <SettingsSection key={section.id} section={section} />
          ))
        )}
      </main>

      <RightDock />
      <AssistanceButton />
    </div>
  );
}
