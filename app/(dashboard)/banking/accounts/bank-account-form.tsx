"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
import { createBankAccount } from "./actions";

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
];

const CURRENCIES = ["NGN", "USD", "GBP", "EUR"];

export function BankAccountForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankName, setBankName] = useState("");
  const [currency, setCurrency] = useState("NGN");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    formData.set("bankName", bankName);
    formData.set("currency", currency);

    const result = await createBankAccount(formData);
    setLoading(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    toast.success("Bank account created");
    setOpen(false);
    setBankName("");
    setCurrency("NGN");
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Bank Account
      </Button>

      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Bank Account</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="accountName">Account Name *</Label>
              <Input
                id="accountName"
                name="accountName"
                placeholder="e.g. GTBank Current Account"
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
                defaultValue="0"
                placeholder="0.00"
              />
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
              <Button type="submit" disabled={loading || !bankName}>
                {loading ? "Creating…" : "Create Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
