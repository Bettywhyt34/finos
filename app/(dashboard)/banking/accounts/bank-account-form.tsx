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
import { createBankAccount, updateBankAccount } from "./actions";

const NIGERIAN_BANKS = [
  "GTBank",
  "Access Bank",
  "UBA",
  "Zenith Bank",
  "First Bank",
  "Fidelity Bank",
  "Stanbic IBTC",
  "Sterling Bank",
  "Wema Bank",
  "Union Bank",
  "Polaris Bank",
  "Keystone Bank",
  "Ecobank",
  "FCMB",
  "Heritage Bank",
  "Providus Bank",
  "Standard Chartered",
];

const CURRENCIES = ["NGN", "USD", "GBP", "EUR"];

interface BankAccountFormProps {
  mode?: "create" | "edit";
  account?: {
    id: string;
    accountName: string;
    accountNumber: string;
    bankName: string;
    currency: string;
    openingBalance: number;
  };
}

export function BankAccountForm({ mode = "create", account }: BankAccountFormProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [currency, setCurrency] = useState(account?.currency ?? "NGN");

  function handleOpen() {
    setBankName(account?.bankName ?? "");
    setCurrency(account?.currency ?? "NGN");
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    formData.set("bankName", bankName);
    formData.set("currency", currency);

    const result =
      mode === "edit" && account
        ? await updateBankAccount(account.id, formData)
        : await createBankAccount(formData);

    setLoading(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    toast.success(mode === "edit" ? "Bank account updated" : "Bank account created");
    setOpen(false);
  }

  return (
    <>
      {mode === "edit" ? (
        <Button variant="ghost" size="sm" onClick={handleOpen}>
          <Pencil className="h-3.5 w-3.5 mr-1" />
          Edit
        </Button>
      ) : (
        <Button onClick={handleOpen}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Bank Account
        </Button>
      )}

      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "edit" ? "Edit Bank Account" : "New Bank Account"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="accountName">Account Name *</Label>
              <Input
                id="accountName"
                name="accountName"
                placeholder="e.g. GTBank Current Account"
                defaultValue={account?.accountName}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="accountNumber">Account Number *</Label>
                <Input
                  id="accountNumber"
                  name="accountNumber"
                  placeholder="0123456789"
                  defaultValue={account?.accountNumber}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <input type="hidden" name="currency" value={currency} />
                <Select value={currency} onValueChange={(v) => setCurrency(v ?? "NGN")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Bank Name *</Label>
              <input type="hidden" name="bankName" value={bankName} />
              <Select value={bankName} onValueChange={(v) => setBankName(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select bank…" />
                </SelectTrigger>
                <SelectContent>
                  {NIGERIAN_BANKS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="openingBalance">Opening Balance</Label>
              <Input
                id="openingBalance"
                name="openingBalance"
                type="number"
                step="0.01"
                defaultValue={account?.openingBalance ?? 0}
                placeholder="0.00"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
            )}

            <DialogFooter>
              <DialogClose
                render={<Button variant="outline" type="button" />}
                onClick={() => setOpen(false)}
              >
                Cancel
              </DialogClose>
              <Button type="submit" disabled={loading || !bankName}>
                {loading
                  ? mode === "edit"
                    ? "Saving…"
                    : "Creating…"
                  : mode === "edit"
                  ? "Save Changes"
                  : "Create Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
