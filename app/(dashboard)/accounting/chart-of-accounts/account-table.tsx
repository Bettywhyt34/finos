"use client";

import { useState, useMemo } from "react";
import { Search, Filter, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AccountForm } from "./account-form";
import { toggleAccountStatus } from "./actions";
import { formatCurrency, cn } from "@/lib/utils";
import type { AccountType } from "@prisma/client";

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  parentId: string | null;
  isActive: boolean;
}

interface AccountWithBalance extends Account {
  balance: number;
}

interface AccountTableProps {
  accounts: AccountWithBalance[];
}

const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expense",
};

const TYPE_BADGE: Record<AccountType, string> = {
  ASSET: "bg-blue-50 text-blue-700",
  LIABILITY: "bg-red-50 text-red-700",
  EQUITY: "bg-purple-50 text-purple-700",
  INCOME: "bg-green-50 text-green-700",
  EXPENSE: "bg-orange-50 text-orange-700",
};

/** Flatten accounts into parent-before-child order with depth for indentation */
function flattenHierarchy(accounts: AccountWithBalance[]) {
  const result: (AccountWithBalance & { depth: number })[] = [];

  function dfs(account: AccountWithBalance, depth: number) {
    result.push({ ...account, depth });
    accounts
      .filter((a) => a.parentId === account.id)
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((child) => dfs(child, depth + 1));
  }

  accounts
    .filter((a) => !a.parentId)
    .sort((a, b) => a.code.localeCompare(b.code))
    .forEach((root) => dfs(root, 0));

  return result;
}

export function AccountTable({ accounts }: AccountTableProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const flat = flattenHierarchy(accounts);
    return flat.filter((a) => {
      if (!showInactive && !a.isActive) return false;
      if (typeFilter !== "ALL" && a.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [accounts, search, typeFilter, showInactive]);

  async function handleToggle(id: string, current: boolean) {
    setToggling(id);
    const result = await toggleAccountStatus(id, !current);
    setToggling(null);
    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success(current ? "Account disabled" : "Account enabled");
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Search by code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "ALL")}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              {(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowInactive((v) => !v)}
          className="text-xs gap-1.5"
        >
          {showInactive ? (
            <ToggleRight className="h-4 w-4 text-slate-600" />
          ) : (
            <ToggleLeft className="h-4 w-4 text-slate-400" />
          )}
          Show inactive
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-28">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead className="w-32 text-right">Balance</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-slate-400 text-sm">
                  {search || typeFilter !== "ALL"
                    ? "No accounts match the filters"
                    : "No accounts yet — add your first account"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((account) => (
                <TableRow
                  key={account.id}
                  className={cn(!account.isActive && "opacity-50")}
                >
                  <TableCell className="font-mono text-xs text-slate-600">
                    {account.code}
                  </TableCell>
                  <TableCell>
                    <span
                      style={{ paddingLeft: `${account.depth * 16}px` }}
                      className="block truncate max-w-xs"
                    >
                      {account.depth > 0 && (
                        <span className="text-slate-300 mr-1.5">└</span>
                      )}
                      {account.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium",
                        TYPE_BADGE[account.type]
                      )}
                    >
                      {TYPE_LABELS[account.type]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCurrency(account.balance)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <AccountForm
                        accounts={accounts}
                        editAccount={account}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={toggling === account.id}
                        onClick={() => handleToggle(account.id, account.isActive)}
                        title={account.isActive ? "Disable account" : "Enable account"}
                      >
                        {account.isActive ? (
                          <ToggleRight className="h-3.5 w-3.5 text-slate-600" />
                        ) : (
                          <ToggleLeft className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-slate-400">
        {filtered.length} of {accounts.length} accounts
      </p>
    </div>
  );
}
