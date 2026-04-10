"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  Truck,
  Package,
  ShoppingCart,
  CreditCard,
  Receipt,
  Calculator,
  BarChart3,
  Settings,
  Target,
  Plug,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

interface NavChild {
  label: string;
  href: string;
}

interface NavSection {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  children?: NavChild[];
}

const NAV: NavSection[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/" },
  {
    key: "banking",
    label: "Banking",
    icon: Building2,
    children: [
      { label: "Bank Accounts", href: "/banking/accounts" },
      { label: "Reconciliation", href: "/banking/reconciliation" },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    icon: Users,
    children: [
      { label: "All Customers", href: "/customers" },
      { label: "Invoices", href: "/customers/invoices" },
      { label: "Receipts", href: "/customers/receipts" },
    ],
  },
  {
    key: "vendors",
    label: "Vendors",
    icon: Truck,
    children: [
      { label: "All Vendors", href: "/vendors" },
      { label: "Bills", href: "/vendors/bills" },
      { label: "Payments", href: "/vendors/payments" },
    ],
  },
  {
    key: "items",
    label: "Items",
    icon: Package,
    children: [
      { label: "All Items", href: "/items" },
      { label: "Categories", href: "/items/categories" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    icon: ShoppingCart,
    children: [
      { label: "Quotes", href: "/sales/quotes" },
      { label: "Invoices", href: "/sales/invoices" },
      { label: "Credit Notes", href: "/sales/credit-notes" },
    ],
  },
  {
    key: "purchases",
    label: "Purchases",
    icon: CreditCard,
    children: [
      { label: "Purchase Orders", href: "/purchases/orders" },
      { label: "Bills", href: "/purchases/bills" },
      { label: "Vendor Credits", href: "/purchases/vendor-credits" },
    ],
  },
  {
    key: "expenses",
    label: "Expenses",
    icon: Receipt,
    children: [
      { label: "All Expenses", href: "/expenses" },
      { label: "Categories", href: "/expenses/categories" },
      { label: "Approvals", href: "/expenses/approvals" },
    ],
  },
  {
    key: "budgets",
    label: "Budgets",
    icon: Target,
    children: [
      { label: "All Budgets", href: "/budgets" },
      { label: "New Budget", href: "/budgets/new" },
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    icon: Calculator,
    children: [
      { label: "Journal Entries", href: "/accounting/journal-entries" },
      { label: "Chart of Accounts", href: "/accounting/chart-of-accounts" },
      { label: "Trial Balance", href: "/accounting/trial-balance" },
      { label: "Period Close", href: "/accounting/period-close" },
      { label: "FX Revaluation", href: "/accounting/fx-revaluation" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: BarChart3,
    children: [
      { label: "Profit & Loss", href: "/reports/profit-loss" },
      { label: "Balance Sheet", href: "/reports/balance-sheet" },
      { label: "Cash Flow", href: "/reports/cash-flow" },
      { label: "AR Aging", href: "/reports/ar-aging" },
      { label: "AP Aging", href: "/reports/ap-aging" },
      { label: "General Ledger", href: "/reports/general-ledger" },
      { label: "FX Exposure", href: "/reports/fx-exposure" },
      { label: "Budget vs Actual", href: "/reports/budget-vs-actual" },
    ],
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: Plug,
    children: [
      { label: "Revflow",      href: "/integrations/revflow/status" },
      { label: "XpenxFlow",    href: "/integrations/xpenxflow/status" },
      { label: "EARNMARK360",  href: "/integrations/earnmark360/status" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    icon: Settings,
    children: [
      { label: "Organization", href: "/settings/organization" },
      { label: "Users", href: "/settings/users" },
      { label: "Taxes", href: "/settings/taxes" },
      { label: "Budget Settings", href: "/settings/budgets" },
    ],
  },
];

interface SidebarProps {
  orgName: string;
  showBettywhyt?: boolean;
}

export function Sidebar({ orgName, showBettywhyt }: SidebarProps) {
  const pathname = usePathname();

  const nav = NAV.map((section) => {
    if (section.key === "integrations" && showBettywhyt) {
      return {
        ...section,
        children: [
          ...(section.children ?? []),
          { label: "BettyWhyt", href: "/integrations/bettywhyt/status" },
        ],
      };
    }
    return section;
  });

  // Open accordion sections where a child route is active
  const defaultOpen = nav.filter((s) =>
    s.children?.some(
      (c) => pathname === c.href || pathname.startsWith(c.href + "/")
    )
  ).map((s) => s.key);

  const simpleLinks = nav.filter((s) => !s.children);
  const expandable = nav.filter((s) => s.children);

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col h-screen overflow-y-auto shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-200 shrink-0">
        <p className="text-lg font-bold text-slate-900 leading-tight">FINOS</p>
        <p className="text-xs text-slate-500 truncate mt-0.5">{orgName}</p>
      </div>

      {/* Top-level simple links (Dashboard) */}
      <div className="px-3 pt-3 shrink-0">
        {simpleLinks.map((s) => (
          <Link
            key={s.key}
            href={s.href!}
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors no-underline",
              pathname === s.href
                ? "bg-slate-100 text-slate-900"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            <s.icon className="h-4 w-4 shrink-0" />
            {s.label}
          </Link>
        ))}
      </div>

      {/* Expandable sections */}
      <div className="px-3 pb-4 flex-1">
        <Accordion
          defaultValue={defaultOpen}
          className="space-y-0.5 gap-0"
        >
          {expandable.map((section) => {
            const isChildActive = section.children?.some(
              (c) => pathname === c.href || pathname.startsWith(c.href + "/")
            );

            return (
              <AccordionItem
                key={section.key}
                value={section.key}
                className="border-none"
              >
                <AccordionTrigger
                  className={cn(
                    "flex w-full items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium no-underline hover:no-underline transition-colors",
                    isChildActive
                      ? "text-slate-900"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <section.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">{section.label}</span>
                </AccordionTrigger>
                <AccordionContent className="pb-0 pt-0.5 [&>div]:h-auto [&>div]:pb-0">
                  <div className="ml-6 space-y-0.5 border-l border-slate-100 pl-3">
                    {section.children!.map((child) => {
                      const active =
                        pathname === child.href ||
                        pathname.startsWith(child.href + "/");
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "block px-2.5 py-1.5 rounded-md text-sm transition-colors no-underline",
                            active
                              ? "bg-slate-100 text-slate-900 font-medium"
                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </aside>
  );
}
