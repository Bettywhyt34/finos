"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { postVendorCredit } from "./actions";

interface CreditLineOption {
  id: string;
  description: string;
  serviceAmount: number;
  taxAmount: number;
  availableServiceAmount: number;
}

interface CreditBillOption {
  id: string;
  billNumber: string;
  vendorName: string;
  currency: string;
  exchangeRate: number;
  baseCurrency: string;
  outstanding: number;
  lines: CreditLineOption[];
}

export function VendorCreditForm({ bills }: { bills: CreditBillOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [billId, setBillId] = useState("");
  const [creditDate, setCreditDate] = useState(new Date().toISOString().split("T")[0]);
  const [exchangeRate, setExchangeRate] = useState(1);
  const [vendorReference, setVendorReference] = useState("");
  const [notes, setNotes] = useState("");
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const bill = useMemo(() => bills.find((item) => item.id === billId) ?? null, [bills, billId]);
  const selectedLines = bill?.lines.filter((line) => (amounts[line.id] ?? 0) > 0) ?? [];
  const subtotal = selectedLines.reduce((sum, line) => sum + (amounts[line.id] ?? 0), 0);
  const tax = selectedLines.reduce((sum, line) => {
    const amount = amounts[line.id] ?? 0;
    const ratio = line.serviceAmount > 0 ? line.taxAmount / line.serviceAmount : 0;
    return sum + amount * ratio;
  }, 0);
  const total = Math.round((subtotal + tax + Number.EPSILON) * 100) / 100;
  const sourceApplied = bill ? Math.min(total, bill.outstanding) : 0;
  const openCredit = Math.max(0, total - sourceApplied);

  function selectBill(value: string | null) {
    const nextId = value ?? "";
    const next = bills.find((item) => item.id === nextId);
    setBillId(nextId);
    setAmounts({});
    setExchangeRate(next ? (next.currency === next.baseCurrency ? 1 : next.exchangeRate) : 1);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bill || selectedLines.length === 0) {
      toast.error("Select a bill and enter at least one credit amount.");
      return;
    }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      toast.error("Enter a valid exchange rate.");
      return;
    }

    setSaving(true);
    const result = await postVendorCredit({
      billId: bill.id,
      creditDate,
      exchangeRate,
      vendorReference,
      notes,
      lines: selectedLines.map((line) => ({ billLineId: line.id, serviceAmount: amounts[line.id] })),
    });
    setSaving(false);
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Vendor credit posted");
    setOpen(false);
    setBillId("");
    setAmounts({});
    setVendorReference("");
    setNotes("");
    router.refresh();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={bills.length === 0}>
        <Plus className="mr-1.5 h-3.5 w-3.5" /> New Vendor Credit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Vendor Credit</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label>Source Bill</Label>
              <Select value={billId} onValueChange={selectBill}>
                <SelectTrigger><SelectValue placeholder="Select a posted bill" /></SelectTrigger>
                <SelectContent>
                  {bills.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.billNumber} · {item.vendorName} · {formatCurrency(item.outstanding, item.currency)} open
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {bill && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Credit Date</Label>
                    <Input type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Vendor Credit Reference</Label>
                    <Input value={vendorReference} onChange={(e) => setVendorReference(e.target.value)} placeholder="Optional supplier reference" />
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
                      disabled={bill.currency === bill.baseCurrency}
                      onChange={(e) => setExchangeRate(Number(e.target.value))}
                      required
                    />
                    {bill.currency !== bill.baseCurrency && (
                      <p className="text-xs text-slate-500">Enter the actual rate applicable on the vendor credit date.</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Credit Original Bill Lines</Label>
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="grid grid-cols-[1fr_120px_140px] gap-3 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                      <span>Original line</span><span className="text-right">Available</span><span className="text-right">Credit</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {bill.lines.filter((line) => line.availableServiceAmount > 0.005).map((line) => (
                        <div key={line.id} className="grid grid-cols-[1fr_120px_140px] items-center gap-3 px-3 py-2.5">
                          <div><p className="text-sm font-medium text-slate-800">{line.description}</p>{line.taxAmount > 0 && <p className="text-xs text-slate-400">VAT reverses proportionately</p>}</div>
                          <span className="text-right font-mono text-xs">{formatCurrency(line.availableServiceAmount, bill.currency)}</span>
                          <Input
                            className="h-8 text-right"
                            type="number"
                            min="0"
                            max={line.availableServiceAmount}
                            step="0.01"
                            value={amounts[line.id] ?? ""}
                            onChange={(e) => setAmounts((current) => ({ ...current, [line.id]: Number(e.target.value) || 0 }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Vendor credit total</span><span className="font-mono font-semibold">{formatCurrency(total, bill.currency)}</span></div>
                  <div className="mt-1 flex justify-between"><span className="text-slate-500">Applied to source bill</span><span className="font-mono">{formatCurrency(sourceApplied, bill.currency)}</span></div>
                  {openCredit > 0.005 && <div className="mt-1 flex justify-between text-emerald-700"><span>Open vendor credit</span><span className="font-mono font-semibold">{formatCurrency(openCredit, bill.currency)}</span></div>}
                </div>

                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional internal note" />
                </div>
              </>
            )}

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={!bill || total <= 0 || saving}>{saving ? "Posting…" : "Post Vendor Credit"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
