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
import { createTransaction } from "./actions";

interface TransactionFormProps {
  bankAccountId: string;
}

export function TransactionForm({ bankAccountId }: TransactionFormProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txType, setTxType] = useState<string>("CREDIT");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    formData.set("type", txType);

    const result = await createTransaction(bankAccountId, formData);
    setLoading(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    toast.success("Transaction recorded");
    setOpen(false);
    setTxType("CREDIT");
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Transaction
      </Button>

      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Transaction</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="transactionDate">Date *</Label>
                <Input
                  id="transactionDate"
                  name="transactionDate"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <input type="hidden" name="type" value={txType} />
                <Select value={txType} onValueChange={(v) => setTxType(v ?? "CREDIT")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CREDIT">Credit (Money In)</SelectItem>
                    <SelectItem value="DEBIT">Debit (Money Out)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                name="description"
                placeholder="e.g. Customer payment from Acme Corp"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="amount">Amount *</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reference">Reference</Label>
                <Input
                  id="reference"
                  name="reference"
                  placeholder="e.g. TXN-001"
                />
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
                {loading ? "Saving…" : "Record Transaction"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
