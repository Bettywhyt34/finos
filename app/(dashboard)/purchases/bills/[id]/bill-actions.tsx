"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { postBill } from "../actions";
import { recordBillPayment } from "../vendor-payment-actions";
import { formatCurrency } from "@/lib/utils";

interface OpenBill { id: string; billNumber: string; balance: number; }
interface BankAccountOption { id: string; accountName: string; bankName: string; currency: string; }
interface Props {
  bill: {
    id: string;
    status: string;
    vendorId: string;
    balance: number;
    isWhtEligible: boolean;
    currency: string;
    exchangeRate: number;
    baseCurrency: string;
  };
  openBills: OpenBill[];
  bankAccounts: BankAccountOption[];
}

interface Allocation { billId: string; billNumber: string; maxAmount: number; amount: number; }

export function BillActions({ bill, openBills, bankAccounts }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState(bill.balance);
  const [whtAmount, setWhtAmount] = useState(0);
  const [exchangeRate, setExchangeRate] = useState(bill.currency === bill.baseCurrency ? 1 : bill.exchangeRate);
  const [bankAccountId, setBankAccountId] = useState("");
  const [allocations, setAllocations] = useState<Allocation[]>(() =>
    openBills.map((b) => ({
      billId: b.id,
      billNumber: b.billNumber,
      maxAmount: b.balance,
      amount: b.id === bill.id ? Math.min(bill.balance, b.balance) : 0,
    }))
  );

  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
  const netCash = Math.max(0, amount - whtAmount);

  function autoAllocate(total: number) {
    let remaining = total;
    setAllocations((prev) =>
      prev.map((a) => {
        const allocated = Math.min(remaining, a.maxAmount);
        remaining = Math.max(0, remaining - allocated);
        return { ...a, amount: Math.round(allocated * 100) / 100 };
      })
    );
  }

  async function handlePost() {
    setPosting(true);
    const result = await postBill(bill.id);
    setPosting(false);
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Bill posted to Accounts Payable");
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (Math.abs(totalAllocated - amount) > 0.01) {
      toast.error(`Allocated ${formatCurrency(totalAllocated, bill.currency)} ≠ amount settled ${formatCurrency(amount, bill.currency)}`);
      return;
    }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      toast.error("Enter a valid exchange rate");
      return;
    }
    if (netCash > 0.005 && !bankAccountId) {
      toast.error(`Select a ${bill.currency} account for this payment`);
      return;
    }

    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const result = await recordBillPayment({
      vendorId: bill.vendorId,
      paymentDate,
      amount,
      method,
      reference: String(fd.get("reference") || ""),
      whtAmount,
      bankAccountId: bankAccountId || undefined,
      currency: bill.currency,
      exchangeRate,
      exchangeRateSource: "MANUAL",
      billAllocations: allocations.filter((a) => a.amount > 0).map((a) => ({ billId: a.billId, amount: a.amount })),
    });
    setLoading(false);
    if (result?.error) { toast.error(result.error); return; }
    toast.success("Payment recorded");
    setOpen(false);
    router.refresh();
  }

  const isDraft = bill.status === "DRAFT";
  const canPay = !isDraft && bill.balance > 0 && bill.status !== "PAID";
  const isBaseCurrency = bill.currency === bill.baseCurrency;

  return (
    <>
      <div className="flex items-center gap-2">
        {isDraft && (
          <Button size="sm" onClick={handlePost} disabled={posting}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            {posting ? "Posting…" : "Post Bill"}
          </Button>
        )}
        {canPay && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <CreditCard className="h-3.5 w-3.5 mr-1.5" />
            Record Payment
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Vendor Payment</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Payment Date</Label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Amount Settled ({bill.currency})</Label>
                <Input type="number" min="0.01" step="0.01" value={amount}
                  onChange={(e) => { const v = parseFloat(e.target.value) || 0; setAmount(v); autoAllocate(v); }} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input value={bill.currency} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>Exchange Rate (1 {bill.currency} = {bill.baseCurrency})</Label>
                <Input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={exchangeRate}
                  disabled={isBaseCurrency}
                  onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)}
                  required
                />
                {!isBaseCurrency && <p className="text-xs text-slate-500">Enter the actual rate used for this payment.</p>}
              </div>
            </div>

            {netCash > 0.005 && (
              <div className="space-y-1.5">
                <Label>Paid From ({bill.currency})</Label>
                <Select value={bankAccountId} onValueChange={(v) => setBankAccountId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder={`Select ${bill.currency} account`} /></SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.accountName} · {account.bankName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {bankAccounts.length === 0 && (
                  <p className="text-xs text-amber-600">No active {bill.currency} bank/cash account is available. Add or map one in Banking first.</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v ?? "BANK_TRANSFER")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                    <SelectItem value="CHECK">Cheque</SelectItem>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reference">Reference</Label>
                <Input id="reference" name="reference" />
              </div>
            </div>

            {bill.isWhtEligible && (
              <div className="space-y-1.5">
                <Label>WHT Amount ({bill.currency})</Label>
                <Input type="number" min="0" max={amount} step="0.01" value={whtAmount}
                  onChange={(e) => setWhtAmount(parseFloat(e.target.value) || 0)} />
                {whtAmount > 0 && (
                  <p className="text-xs text-slate-500">Cash paid to vendor: {formatCurrency(netCash, bill.currency)}. Gross AP settled remains {formatCurrency(amount, bill.currency)}.</p>
                )}
              </div>
            )}

            {openBills.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Allocate to {bill.currency} Bills</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => autoAllocate(amount)}>
                    Auto-allocate
                  </Button>
                </div>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {allocations.map((alloc) => (
                    <div key={alloc.billId} className="flex items-center gap-3 px-3 py-2">
                      <span className="font-mono text-xs text-slate-600 w-24">{alloc.billNumber}</span>
                      <span className="text-xs text-slate-400 flex-1">max {formatCurrency(alloc.maxAmount, bill.currency)}</span>
                      <Input type="number" min="0" max={alloc.maxAmount} step="0.01" value={alloc.amount}
                        onChange={(e) => setAllocations((prev) =>
                          prev.map((a) => a.billId === alloc.billId ? { ...a, amount: parseFloat(e.target.value) || 0 } : a)
                        )}
                        className="h-7 w-28 text-xs text-right" />
                    </div>
                  ))}
                </div>
                <div className={`text-xs text-right ${Math.abs(totalAllocated - amount) > 0.01 ? "text-red-500" : "text-green-600"}`}>
                  Allocated: {formatCurrency(totalAllocated, bill.currency)} / {formatCurrency(amount, bill.currency)}
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={loading || (netCash > 0.005 && bankAccounts.length === 0)}>{loading ? "Saving…" : "Record Payment"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
