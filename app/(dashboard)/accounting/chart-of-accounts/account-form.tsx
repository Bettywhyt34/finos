"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAccount, updateAccount } from "./actions";
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

interface AccountFormProps {
  accounts: Account[];
  editAccount?: Account;
  trigger?: React.ReactNode;
}

type UiCategory =
  | "CURRENT_ASSETS"
  | "FIXED_ASSETS"
  | "CURRENT_LIABILITIES"
  | "LONG_TERM_LIABILITIES"
  | "EQUITY"
  | "INCOME"
  | "EXPENSES";

const CATEGORY_LABELS: Record<UiCategory, string> = {
  CURRENT_ASSETS: "Current Assets",
  FIXED_ASSETS: "Fixed Assets",
  CURRENT_LIABILITIES: "Current Liabilities",
  LONG_TERM_LIABILITIES: "Long-term Liabilities",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSES: "Expenses",
};

const GROUPS: Record<UiCategory, string[]> = {
  CURRENT_ASSETS: [
    "Cash & Cash Equivalents",
    "Bank",
    "Accounts Receivable",
    "Inventory",
    "Other Current Assets",
  ],
  FIXED_ASSETS: [
    "Property, Plant & Equipment",
    "Accumulated Depreciation",
    "Intangible Assets",
    "Other Fixed Assets",
  ],
  CURRENT_LIABILITIES: [
    "Accounts Payable",
    "Taxes Payable",
    "Accruals",
    "Unearned Income",
    "Other Current Liabilities",
  ],
  LONG_TERM_LIABILITIES: [
    "Long-term Loans",
    "Lease Liabilities",
    "Other Long-term Liabilities",
  ],
  EQUITY: [
    "Share Capital",
    "Retained Earnings",
    "Reserves",
    "Other Equity",
  ],
  INCOME: [
    "Operating Income",
    "Other Income",
  ],
  EXPENSES: [
    "Cost of Sales / Direct Costs",
    "Employee Costs",
    "Administrative Expenses",
    "Selling & Marketing",
    "Finance Costs",
    "Depreciation & Amortisation",
    "Other Expenses",
  ],
};

const CODE_START: Record<UiCategory, number> = {
  CURRENT_ASSETS: 1000,
  FIXED_ASSETS: 1500,
  CURRENT_LIABILITIES: 2000,
  LONG_TERM_LIABILITIES: 2500,
  EQUITY: 3000,
  INCOME: 4000,
  EXPENSES: 5000,
};

function categoryFromAccount(account?: Account): UiCategory {
  if (!account) return "CURRENT_ASSETS";
  switch (account.financialCategory) {
    case "CURRENT_ASSET":
      return "CURRENT_ASSETS";
    case "NON_CURRENT_ASSET":
      return "FIXED_ASSETS";
    case "CURRENT_LIABILITY":
      return "CURRENT_LIABILITIES";
    case "NON_CURRENT_LIABILITY":
      return "LONG_TERM_LIABILITIES";
    case "EQUITY":
      return "EQUITY";
    case "INCOME":
    case "OTHER_INCOME":
      return "INCOME";
    case "COST_OF_SALES":
    case "DIRECT_EXPENSES":
    case "EXPENSES":
    case "OTHER_EXPENSES":
      return "EXPENSES";
    default:
      if (account.type === "LIABILITY") return "CURRENT_LIABILITIES";
      if (account.type === "EQUITY") return "EQUITY";
      if (account.type === "INCOME") return "INCOME";
      if (account.type === "EXPENSE") return "EXPENSES";
      return "CURRENT_ASSETS";
  }
}

function accountMatchesCategory(account: Account, category: UiCategory) {
  return categoryFromAccount(account) === category;
}

function suggestedCode(accounts: Account[], category: UiCategory) {
  const numericCodes = accounts
    .filter((a) => accountMatchesCategory(a, category))
    .map((a) => Number(a.code))
    .filter((n) => Number.isInteger(n));

  if (numericCodes.length === 0) return String(CODE_START[category]);
  return String(Math.max(...numericCodes) + 1);
}

export function AccountForm({ accounts, editAccount, trigger }: AccountFormProps) {
  const isEdit = !!editAccount;
  const initialCategory = categoryFromAccount(editAccount);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<UiCategory>(initialCategory);
  const [group, setGroup] = useState(editAccount?.subtype || GROUPS[initialCategory][0]);
  const [code, setCode] = useState(editAccount?.code || suggestedCode(accounts, initialCategory));
  const [isSubAccount, setIsSubAccount] = useState(Boolean(editAccount?.parentId));
  const [parentId, setParentId] = useState(editAccount?.parentId ?? "");

  const parentOptions = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.id !== editAccount?.id &&
          a.isActive &&
          accountMatchesCategory(a, category) &&
          (!group || a.subtype === group)
      ),
    [accounts, category, editAccount?.id, group]
  );

  function handleCategoryChange(value: string | null) {
    const next = (value || "CURRENT_ASSETS") as UiCategory;
    setCategory(next);
    setGroup(GROUPS[next][0]);
    setParentId("");
    setIsSubAccount(false);
    if (!isEdit) setCode(suggestedCode(accounts, next));
  }

  function handleGroupChange(value: string | null) {
    setGroup(value || GROUPS[category][0]);
    setParentId("");
    setIsSubAccount(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    formData.set("category", category);
    formData.set("group", group);
    formData.set("code", code);
    formData.set("parentId", isSubAccount ? parentId : "");

    const result = isEdit
      ? await updateAccount(editAccount!.id, formData)
      : await createAccount(formData);

    setLoading(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    toast.success(isEdit ? "Account updated" : "Account created");
    setOpen(false);

    if (!isEdit) {
      setCategory("CURRENT_ASSETS");
      setGroup(GROUPS.CURRENT_ASSETS[0]);
      setCode(suggestedCode(accounts, "CURRENT_ASSETS"));
      setParentId("");
      setIsSubAccount(false);
    }
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} className="cursor-pointer">
          {trigger}
        </span>
      ) : isEdit ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
          title="Edit account"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Account
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Account" : "New Account"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Account Name *</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Prepaid Insurance"
                defaultValue={editAccount?.name}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Account Category *</Label>
              <Select value={category} onValueChange={handleCategoryChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as UiCategory[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {CATEGORY_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Account Group *</Label>
              <Select value={group} onValueChange={handleGroupChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUPS[category].map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="code">Account Code *</Label>
              <Input
                id="code"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. 1215"
                required
              />
              {!isEdit && (
                <p className="text-xs text-slate-400">
                  Suggested next code. You can change it to match your organisation's numbering structure.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">
                Description <span className="font-normal text-slate-400">(Optional)</span>
              </Label>
              <textarea
                id="description"
                name="description"
                rows={3}
                placeholder="e.g. Insurance payments relating to future periods"
                className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-md py-1">
              <input
                type="checkbox"
                checked={isSubAccount}
                onChange={(e) => {
                  setIsSubAccount(e.target.checked);
                  if (!e.target.checked) setParentId("");
                }}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">Make this a sub-account</span>
                <span className="block text-xs text-slate-400">Parent account appears only when selected.</span>
              </span>
            </label>

            {isSubAccount && (
              <div className="space-y-1.5">
                <Label>Parent Account *</Label>
                <Select value={parentId} onValueChange={(v) => setParentId(v || "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select parent account" />
                  </SelectTrigger>
                  <SelectContent>
                    {parentOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} – {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {parentOptions.length === 0 && (
                  <p className="text-xs text-slate-400">
                    No active parent accounts exist in this account group yet.
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <DialogFooter>
              <DialogClose
                render={<Button variant="outline" type="button" />}
                onClick={() => setOpen(false)}
              >
                Cancel
              </DialogClose>
              <Button type="submit" disabled={loading || (isSubAccount && !parentId)}>
                {loading ? "Saving…" : isEdit ? "Save Changes" : "Create Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
