"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, BookOpen, Boxes, BrainCircuit, Building2, CalendarRange,
  ChevronDown, CircleDollarSign, Home, Landmark, Package, Plug,
  Settings, UserRound, WalletCards,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

interface NavChild { label: string; href: string; }
interface NavSection {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  children?: NavChild[];
  disabled?: boolean;
  badge?: number;
}

const BASE_NAV: NavSection[] = [
  { key: "home", label: "Home", icon: Home, href: "/" },
  { key: "items", label: "Items", icon: Package, children: [
    { label: "All Items", href: "/items" },
    { label: "Categories", href: "/items/categories" },
  ] },
  { key: "money-in", label: "Money In", icon: CircleDollarSign, children: [
    { label: "Customers", href: "/customers" },
    { label: "Quotes", href: "/sales/quotes" },
    { label: "Invoices", href: "/sales/invoices" },
    { label: "Receipts", href: "/sales/receipts" },
    { label: "Credit Notes", href: "/sales/credit-notes" },
    { label: "Customer Credits", href: "/sales/customer-credits" },
  ] },
  { key: "money-out", label: "Money Out", icon: WalletCards, children: [
    { label: "Vendors", href: "/vendors" },
    { label: "Bills", href: "/purchases/bills" },
    { label: "Payments Made", href: "/purchases/payments" },
    { label: "Accruals", href: "/purchases/accruals" },
    { label: "Expenses", href: "/expenses" },
  ] },
  { key: "banking", label: "Banking", icon: Landmark, children: [
    { label: "Bank Accounts", href: "/banking/accounts" },
    { label: "Reconciliation", href: "/banking/reconciliation" },
  ] },
  { key: "assets", label: "Assets", icon: Building2, disabled: true },
  { key: "planning", label: "Planning", icon: CalendarRange, children: [
    { label: "Budgets", href: "/budgets" },
    { label: "New Budget", href: "/budgets/new" },
  ] },
  { key: "accounting", label: "Accounting", icon: BookOpen, children: [
    { label: "Journal Entries", href: "/accounting/journal-entries" },
    { label: "Chart of Accounts", href: "/accounting/chart-of-accounts" },
    { label: "Trial Balance", href: "/accounting/trial-balance" },
    { label: "Period Close", href: "/accounting/period-close" },
    { label: "FX Revaluation", href: "/accounting/fx-revaluation" },
    { label: "Projects", href: "/projects" },
  ] },
  { key: "reports", label: "Reports", icon: BarChart3, href: "/reports/profit-loss" },
  { key: "intelligence", label: "FINOS Intelligence", icon: BrainCircuit, href: "/settings/organization/ai" },
  { key: "connected-apps", label: "Connected Apps", icon: Plug, children: [
    { label: "Revflow", href: "/integrations/revflow/status" },
    { label: "XpenxFlow", href: "/integrations/xpenxflow/status" },
    { label: "EARNMARK360", href: "/integrations/earnmark360/status" },
  ] },
  { key: "settings", label: "Settings", icon: Settings, href: "/settings" },
];

interface SidebarProps {
  userName?: string | null;
  userRole?: string | null;
  connectedAppCount?: number;
  showBettywhyt?: boolean;
  showFinosPos?: boolean;
}

export function Sidebar({ userName, userRole, connectedAppCount = 0, showBettywhyt, showFinosPos }: SidebarProps) {
  const pathname = usePathname();
  const nav = BASE_NAV.map((section) => {
    if (section.key !== "connected-apps") return section;
    const extra: NavChild[] = [];
    if (showBettywhyt) extra.push({ label: "BettyWhyt", href: "/integrations/bettywhyt/status" });
    if (showFinosPos) extra.push({ label: "FINOS POS", href: "/integrations/finos_pos/status" });
    return { ...section, badge: connectedAppCount, children: [...(section.children ?? []), ...extra] };
  });
  const defaultOpen = nav.filter((section) => section.children?.some(
    (child) => pathname === child.href || pathname.startsWith(`${child.href}/`)
  )).map((section) => section.key);
  const initials = userName
    ? userName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  return (
    <aside className="flex h-screen w-[282px] shrink-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] text-[var(--sidebar-text)]">
      <div className="flex h-[88px] shrink-0 items-center border-b border-[var(--sidebar-border)] px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-white/10"><Boxes className="h-5 w-5 text-white" /></div>
          <span className="font-serif text-[28px] font-semibold tracking-[0.08em] text-white">FINOS</span>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
        <Accordion defaultValue={defaultOpen} className="space-y-1">
          {nav.map((section) => {
            const isChildActive = section.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`));
            const isDirectActive = section.href ? pathname === section.href || (section.href !== "/" && pathname.startsWith(`${section.href}/`)) : false;
            const Icon = section.icon;

            if (section.children) {
              return (
                <AccordionItem key={section.key} value={section.key} className="border-none">
                  <AccordionTrigger className={cn("min-h-11 rounded-lg px-3 py-2.5 text-[15px] font-medium text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:no-underline", isChildActive && "bg-white/10 text-white")}>
                    <Icon className="h-[19px] w-[19px] shrink-0" /><span className="ml-3 flex-1 text-left">{section.label}</span>{section.badge ? <span className="mr-2 rounded-md bg-white/15 px-2 py-0.5 text-xs font-semibold text-white">{section.badge}</span> : null}
                  </AccordionTrigger>
                  <AccordionContent className="pb-1 pt-1"><div className="ml-[21px] border-l border-white/15 pl-4">
                    {section.children.map((child) => {
                      const active = pathname === child.href || pathname.startsWith(`${child.href}/`);
                      return <Link key={child.href} href={child.href} className={cn("relative mb-0.5 block rounded-md px-3 py-2 text-sm text-[var(--sidebar-muted)] transition-colors hover:bg-white/10 hover:text-white", active && "bg-[var(--sidebar-active)] text-white before:absolute before:-left-[17px] before:top-0 before:h-full before:w-0.5 before:bg-[#55d6b8]")}>{child.label}</Link>;
                    })}
                  </div></AccordionContent>
                </AccordionItem>
              );
            }

            if (section.disabled) return <div key={section.key} aria-disabled="true" className="flex min-h-11 items-center rounded-lg px-3 py-2.5 text-[15px] font-medium text-[var(--sidebar-text)] opacity-75"><Icon className="h-[19px] w-[19px]" /><span className="ml-3 flex-1">{section.label}</span><ChevronDown className="h-4 w-4" /></div>;

            return <Link key={section.key} href={section.href!} className={cn("flex min-h-11 items-center rounded-lg px-3 py-2.5 text-[15px] font-medium text-[var(--sidebar-text)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-white", isDirectActive && "bg-[var(--sidebar-active)] text-white")}><Icon className="h-[19px] w-[19px]" /><span className="ml-3">{section.label}</span></Link>;
          })}
        </Accordion>
      </nav>

      <div className="shrink-0 border-t border-[var(--sidebar-border)] p-5"><div className="flex items-center gap-3 rounded-lg px-1 py-1"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--sidebar-active)] text-sm font-semibold text-white">{initials}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{userName ?? "User"}</p><p className="truncate text-xs text-[var(--sidebar-muted)]">{userRole ?? "Team member"}</p></div><UserRound className="h-4 w-4 text-[var(--sidebar-muted)]" /></div></div>
    </aside>
  );
}
