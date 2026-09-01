"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MoreVertical,
  Search,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AccountForm } from "./account-form";
import { toggleAccountStatus } from "./actions";
import { cn } from "@/lib/utils";
import type { AccountType, FinancialCategory } from "@prisma/client";

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  financialCategory?: FinancialCategory | null;
  parentId: string | null;
  isActive: boolean;
}

interface AccountTableProps {
  accounts: Account[];
}

type SectionKey =
  | "CURRENT_ASSETS"
  | "FIXED_ASSETS"
  | "CURRENT_LIABILITIES"
  | "LONG_TERM_LIABILITIES"
  | "EQUITY"
  | "INCOME"
  | "EXPENSES";

const SECTIONS: Array<{ key: SectionKey; label: string; description: string }> = [
  { key: "CURRENT_ASSETS", label: "Current Assets", description: "Assets expected to be converted to cash within one year." },
  { key: "FIXED_ASSETS", label: "Fixed Assets", description: "Long-term tangible assets used in operations." },
  { key: "CURRENT_LIABILITIES", label: "Current Liabilities", description: "Obligations due within one year." },
  { key: "LONG_TERM_LIABILITIES", label: "Long-term Liabilities", description: "Obligations due beyond one year." },
  { key: "EQUITY", label: "Equity", description: "Owner’s interest in the business." },
  { key: "INCOME", label: "Income", description: "Revenue earned from normal business operations." },
  { key: "EXPENSES", label: "Expenses", description: "Costs incurred in generating income." },
];

function normalized(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/[_-]+/g, " ");
}

function sectionFor(account: Account): SectionKey {
  const descriptor = `${normalized(account.subtype)} ${normalized(account.financialCategory)} ${normalized(account.name)}`;
  if (account.type === "ASSET") {
    if (descriptor.includes("fixed") || descriptor.includes("property") || descriptor.includes("plant") || descriptor.includes("equipment") || descriptor.includes("ppe") || descriptor.includes("non current") || descriptor.includes("accumulated depreciation")) return "FIXED_ASSETS";
    return "CURRENT_ASSETS";
  }
  if (account.type === "LIABILITY") {
    if (descriptor.includes("long term") || descriptor.includes("long-term") || descriptor.includes("non current") || descriptor.includes("non-current")) return "LONG_TERM_LIABILITIES";
    return "CURRENT_LIABILITIES";
  }
  if (account.type === "EQUITY") return "EQUITY";
  if (account.type === "INCOME") return "INCOME";
  return "EXPENSES";
}

function currentAssetGroup(account: Account) {
  const d = `${normalized(account.subtype)} ${normalized(account.financialCategory)} ${normalized(account.name)}`;
  if (d.includes("cash") && !d.includes("bank")) return "Cash & Cash Equivalents";
  if (d.includes("bank")) return "Bank";
  if (d.includes("receivable") || d.includes("debtor")) return "Accounts Receivable";
  if (d.includes("inventory") || d.includes("stock")) return "Inventory";
  return "Other Current Assets";
}

function fixedAssetGroup(account: Account) {
  const d = `${normalized(account.subtype)} ${normalized(account.financialCategory)} ${normalized(account.name)}`;
  if (d.includes("accumulated depreciation")) return "Accumulated Depreciation";
  if (d.includes("land") || d.includes("building")) return "Land & Buildings";
  if (d.includes("vehicle") || d.includes("motor")) return "Motor Vehicles";
  if (d.includes("computer") || d.includes("equipment") || d.includes("furniture")) return "Equipment & Furniture";
  return "Property, Plant & Equipment";
}

function currentLiabilityGroup(account: Account) {
  const d = `${normalized(account.subtype)} ${normalized(account.financialCategory)} ${normalized(account.name)}`;
  if (d.includes("payable") && !d.includes("tax") && !d.includes("vat") && !d.includes("wht") && !d.includes("paye")) return "Accounts Payable";
  if (d.includes("tax") || d.includes("vat") || d.includes("wht") || d.includes("paye")) return "Taxes Payable";
  if (d.includes("accru") || d.includes("salary") || d.includes("salaries")) return "Accruals";
  if (d.includes("unearned") || d.includes("deferred revenue") || d.includes("customer deposit")) return "Unearned Income & Deposits";
  return "Other Current Liabilities";
}

function longTermLiabilityGroup(account: Account) {
  const d = `${normalized(account.subtype)} ${normalized(account.financialCategory)} ${normalized(account.name)}`;
  if (d.includes("lease")) return "Lease Liabilities";
  if (d.includes("loan") || d.includes("borrow")) return "Long-term Loans & Borrowings";
  return "Other Long-term Liabilities";
}

function incomeGroup(account: Account) {
  const d = `${normalized(account.subtype)} ${normalized(account.financialCategory)} ${normalized(account.name)}`;
  if (d.includes("other income") || d.includes("interest") || d.includes("gain") || d.includes("investment")) return "Other Income";
  return "Operating Income";
}

function expenseGroup(account: Account) {
  const d = `${normalized(account.subtype)} ${normalized(account.financialCategory)} ${normalized(account.name)}`;
  if (d.includes("cost of sales") || d.includes("cost of goods") || d.includes("direct")) return "Cost of Sales / Direct Costs";
  if (d.includes("salary") || d.includes("wage") || d.includes("staff") || d.includes("employee") || d.includes("pension")) return "Employee Costs";
  if (d.includes("marketing") || d.includes("advert") || d.includes("promotion") || d.includes("selling")) return "Selling & Marketing";
  if (d.includes("interest") || d.includes("bank charge") || d.includes("finance cost") || d.includes("fx loss")) return "Finance Costs";
  if (d.includes("depreciation") || d.includes("amortisation") || d.includes("amortization")) return "Depreciation & Amortisation";
  if (d.includes("rent") || d.includes("utility") || d.includes("utilities") || d.includes("professional") || d.includes("office") || d.includes("admin")) return "Administrative Expenses";
  return "Other Expenses";
}

function groupFor(section: SectionKey, account: Account) {
  if (section === "CURRENT_ASSETS") return currentAssetGroup(account);
  if (section === "FIXED_ASSETS") return fixedAssetGroup(account);
  if (section === "CURRENT_LIABILITIES") return currentLiabilityGroup(account);
  if (section === "LONG_TERM_LIABILITIES") return longTermLiabilityGroup(account);
  if (section === "INCOME") return incomeGroup(account);
  if (section === "EXPENSES") return expenseGroup(account);
  return "Equity Accounts";
}

export function AccountTable({ accounts }: AccountTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(new Set(["CURRENT_ASSETS"]));
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<string | null>(null);

  const visibleAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (statusFilter === "ACTIVE" && !account.isActive) return false;
      if (statusFilter === "INACTIVE" && account.isActive) return false;
      if (!q) return true;
      return account.name.toLowerCase().includes(q) || account.code.toLowerCase().includes(q);
    });
  }, [accounts, search, statusFilter]);

  const grouped = useMemo(() => {
    const result = new Map<SectionKey, Map<string, Account[]>>();
    for (const section of SECTIONS) result.set(section.key, new Map());
    for (const account of visibleAccounts) {
      const section = sectionFor(account);
      const group = groupFor(section, account);
      const sectionGroups = result.get(section)!;
      const list = sectionGroups.get(group) ?? [];
      list.push(account);
      sectionGroups.set(group, list);
    }
    for (const [, groups] of result) {
      for (const [group, list] of groups) groups.set(group, [...list].sort((a, b) => a.code.localeCompare(b.code)));
    }
    return result;
  }, [visibleAccounts]);

  function toggleSection(section: SectionKey) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });
  }

  function toggleGroup(key: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setOpenSections(new Set(SECTIONS.map((section) => section.key)));
    const keys: string[] = [];
    for (const section of SECTIONS) for (const group of grouped.get(section.key)?.keys() ?? []) keys.push(`${section.key}:${group}`);
    setOpenGroups(new Set(keys));
  }

  function collapseAll() {
    setOpenSections(new Set());
    setOpenGroups(new Set());
  }

  async function handleToggle(id: string, current: boolean) {
    setToggling(id);
    const result = await toggleAccountStatus(id, !current);
    setToggling(null);
    if (result?.error) toast.error(result.error); else toast.success(current ? "Account disabled" : "Account enabled");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Search accounts..." value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? "ACTIVE")}>
            <SelectTrigger className="h-10 w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active Accounts</SelectItem>
              <SelectItem value="ALL">All Accounts</SelectItem>
              <SelectItem value="INACTIVE">Inactive Accounts</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button>
        <Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button>
      </div>

      <div className="space-y-2">
        {SECTIONS.map((section, sectionIndex) => {
          const groups = grouped.get(section.key) ?? new Map<string, Account[]>();
          const count = [...groups.values()].reduce((sum, items) => sum + items.length, 0);
          const isOpen = openSections.has(section.key);
          return (
            <div key={section.key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button type="button" onClick={() => toggleSection(section.key)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50">
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-emerald-800" /> : <ChevronRight className="h-4 w-4 shrink-0 text-emerald-800" />}
                <span className="font-semibold text-emerald-900">{sectionIndex + 1}. {section.label}</span>
                <span className="hidden text-sm text-slate-500 md:inline">{section.description}</span>
                <span className="ml-auto rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900">{count} {count === 1 ? "account" : "accounts"}</span>
                <MoreVertical className="h-4 w-4 text-slate-400" />
              </button>

              {isOpen && (
                <div className="border-t border-slate-200">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_120px_minmax(180px,1fr)_100px_92px] bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
                    <span className="pl-8">Account Name</span><span>Code</span><span>Account Group / Subgroup</span><span>Status</span><span />
                  </div>
                  {count === 0 ? <div className="px-6 py-8 text-center text-sm text-slate-400">No accounts in this section.</div> : (
                    [...groups.entries()].map(([group, items]) => {
                      const groupKey = `${section.key}:${group}`;
                      const groupOpen = openGroups.has(groupKey) || search.trim().length > 0;
                      return (
                        <div key={groupKey} className="border-t border-slate-100 first:border-t-0">
                          <button type="button" onClick={() => toggleGroup(groupKey)} className="grid w-full grid-cols-[minmax(0,1.6fr)_120px_minmax(180px,1fr)_100px_92px] items-center px-4 py-2.5 text-left hover:bg-slate-50">
                            <span className="flex items-center gap-2 pl-2 font-medium text-emerald-900">
                              {groupOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<Folder className="h-4 w-4" />{group}
                            </span>
                            <span className="text-sm text-slate-400">—</span><span className="text-sm text-slate-500">Subgroup</span><span className="text-xs font-medium text-emerald-800">Active</span><span className="text-right text-xs text-slate-400">{items.length}</span>
                          </button>
                          {groupOpen && items.map((account) => (
                            <div key={account.id} className={cn("grid grid-cols-[minmax(0,1.6fr)_120px_minmax(180px,1fr)_100px_92px] items-center border-t border-slate-100 px-4 py-2.5 text-sm", !account.isActive && "opacity-50")}>
                              <div className="pl-10"><Link href={`/reports/general-ledger?accountId=${account.id}`} className="font-medium text-emerald-900 underline-offset-2 hover:underline">{account.name}</Link></div>
                              <span className="font-mono text-xs text-slate-600">{account.code}</span><span className="text-slate-500">Account</span>
                              <span className={cn("w-fit rounded-md px-2 py-0.5 text-xs font-medium", account.isActive ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500")}>{account.isActive ? "Active" : "Inactive"}</span>
                              <div className="flex items-center justify-end gap-1">
                                <AccountForm accounts={accounts} editAccount={account} />
                                <Button variant="ghost" size="icon-sm" disabled={toggling === account.id} onClick={() => handleToggle(account.id, account.isActive)} title={account.isActive ? "Disable account" : "Enable account"}>
                                  {account.isActive ? <ToggleRight className="h-4 w-4 text-emerald-800" /> : <ToggleLeft className="h-4 w-4 text-slate-400" />}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
