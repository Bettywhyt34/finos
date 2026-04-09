"use client";

import { useState } from "react";
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

interface AccountFormProps {
  accounts: Account[];
  editAccount?: Account;
  trigger?: React.ReactNode;
}

const ACCOUNT_TYPES: AccountType[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "EXPENSE",
];

const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expense",
};

export function AccountForm({ accounts, editAccount, trigger }: AccountFormProps) {
  const isEdit = !!editAccount;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>(editAccount?.type ?? "ASSET");
  const [parentId, setParentId] = useState<string>(editAccount?.parentId ?? "");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    // Inject controlled select values
    formData.set("type", type);
    formData.set("parentId", parentId);

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
    // Reset form state for next open
    if (!isEdit) {
      setType("ASSET");
      setParentId("");
    }
  }

  // Potential parents: accounts of same type, excluding self and children
  const parentOptions = accounts.filter(
    (a) => a.id !== editAccount?.id && a.type === type && a.isActive
  );

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
          <Plus className="h-4 w-4 mr-1.5" />
          Add Account
        </Button>
      )}

      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit Account" : "New Account"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="code">Account Code *</Label>
                <Input
                  id="code"
                  name="code"
                  placeholder="e.g. CA-001"
                  defaultValue={editAccount?.code}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Account Type *</Label>
                <input type="hidden" name="type" value={type} />
                <Select value={type} onValueChange={(v) => { setType(v ?? "ASSET"); setParentId(""); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name">Account Name *</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Cash and Cash Equivalents"
                defaultValue={editAccount?.name}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="subtype">Subtype</Label>
                <Input
                  id="subtype"
                  name="subtype"
                  placeholder="e.g. Current Asset"
                  defaultValue={editAccount?.subtype ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Parent Account</Label>
                <input type="hidden" name="parentId" value={parentId} />
                <Select
                  value={parentId}
                  onValueChange={(v) => setParentId(!v || v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {parentOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} – {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
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
              <Button type="submit" disabled={loading}>
                {loading ? "Saving…" : isEdit ? "Save Changes" : "Create Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
