"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { applyVendorCredit, refundVendorCredit } from "./movement-actions";

export interface VendorCreditView {
  id: string;
  vendorId: string;
  creditNumber: string;
  currency: string;
  exchangeRate: number;
  remainingAmount: number;
}

export interface VendorCreditBillOption {
  id: string;
  vendorId: string;
  billNumber: string;
  currency: string;
  outstanding: number;
}

export interface VendorCreditBankOption {
  id: string;
  accountName: string;
  bankName: string;
  currency: string;
}

export function VendorCreditActions({
  credit,
  bills,
  bankAccounts,
  baseCurrency,
}: {
  credit: VendorCreditView;
  bills: VendorCreditBillOption[];
  bankAccounts: VendorCreditBankOption[];
  baseCurrency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [applyOpen, setApplyOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  const eligibleBills = useMemo(
    () => bills.filter((bill) => bill.vendorId === credit.vendorId && bill.currency === credit.currency && bill.outstanding > 0.005),
    [bills, credit.currency, credit.vendorId],
  );
  const eligibleBanks = useMemo(
    () => bankAccounts.filter((bank) => bank.currency === credit.currency),
    [bankAccounts, credit.currency],
  );

  const [billId, setBillId] = useState(eligibleBills[0]?.id ?? "");
  const selectedBill = eligibleBills.find((bill) => bill.id === billId);
  const [applyAmount, setApplyAmount] = useState(Math.min(credit.remainingAmount, selectedBill?.outstanding ?? credit.remainingAmount));
  const [applicationDate, setApplicationDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankId, setBankId] = useState(eligibleBanks[0]?.id ?? "");
  const [refundAmount, setRefundAmount] = useState(credit.remainingAmount);
  const [refundDate, setRefundDate] = useState(new Date().toISOString().slice(0, 10));
  const [refundRate, setRefundRate] = useState(credit.currency === baseCurrency ? 1 : credit.exchangeRate);
  const [reference, setReference] = useState("");

  function apply() {
    if (!billId || !selectedBill) return toast.error("Select a Bill");
    const max = Math.min(credit.remainingAmount, selectedBill.outstanding);
    if (applyAmount <= 0 || applyAmount - max > 0.01) return toast.error(`Application cannot exceed ${formatCurrency(max, credit.currency)}`);
    startTransition(async () => {
      const result = await applyVendorCredit({ vendorCreditId: credit.id, billId, amount: applyAmount, applicationDate });
      if ("error" in result) return toast.error(result.error);
      toast.success("Vendor credit applied to Bill");
      setApplyOpen(false);
      router.refresh();
    });
  }

  function refund() {
    if (!bankId) return toast.error("Select the receiving bank account");
    if (refundAmount <= 0 || refundAmount - credit.remainingAmount > 0.01) return toast.error(`Refund cannot exceed ${formatCurrency(credit.remainingAmount, credit.currency)}`);
    if (!Number.isFinite(refundRate) || refundRate <= 0) return toast.error("Enter a valid refund exchange rate");
    startTransition(async () => {
      const result = await refundVendorCredit({
        vendorCreditId: credit.id,
        bankAccountId: bankId,
        amount: refundAmount,
        refundDate,
        exchangeRate: credit.currency === baseCurrency ? 1 : refundRate,
        reference,
      });
      if ("error" in result) return toast.error(result.error);
      toast.success("Supplier refund recorded");
      setRefundOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" disabled={!eligibleBills.length} onClick={() => setApplyOpen(true)}>Apply to Bill</Button>
      <Button size="sm" disabled={!eligibleBanks.length} onClick={() => setRefundOpen(true)}>Supplier refund</Button>

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Apply Vendor Credit</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              Available: <span className="font-semibold text-slate-900">{formatCurrency(credit.remainingAmount, credit.currency)}</span>. This reduces AP; it is not a cash payment.
            </div>
            <div className="space-y-1.5">
              <Label>Bill</Label>
              <Select value={billId} onValueChange={(value) => {
                setBillId(value ?? "");
                const bill = eligibleBills.find((item) => item.id === value);
                if (bill) setApplyAmount(Math.min(credit.remainingAmount, bill.outstanding));
              }}>
                <SelectTrigger><SelectValue placeholder="Select Bill" /></SelectTrigger>
                <SelectContent>
                  {eligibleBills.map((bill) => <SelectItem key={bill.id} value={bill.id}>{bill.billNumber} · {formatCurrency(bill.outstanding, bill.currency)} outstanding</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={applicationDate} onChange={(e) => setApplicationDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0.01" step="0.01" value={applyAmount} onChange={(e) => setApplyAmount(Number(e.target.value) || 0)} /></div>
            </div>
          </div>
          <DialogFooter><DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose><Button type="button" disabled={pending} onClick={apply}>{pending ? "Applying…" : "Apply credit"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record supplier refund</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">Record cash actually received from the supplier against this open Vendor Credit.</div>
            <div className="space-y-1.5">
              <Label>Receive into</Label>
              <Select value={bankId} onValueChange={(value) => setBankId(value ?? "")}>
                <SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger>
                <SelectContent>{eligibleBanks.map((bank) => <SelectItem key={bank.id} value={bank.id}>{bank.bankName} · {bank.accountName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0.01" max={credit.remainingAmount} step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(Number(e.target.value) || 0)} /></div>
            </div>
            {credit.currency !== baseCurrency && <div className="space-y-1.5"><Label>Refund exchange rate ({baseCurrency} per {credit.currency})</Label><Input type="number" min="0.000001" step="0.000001" value={refundRate} onChange={(e) => setRefundRate(Number(e.target.value) || 0)} /></div>}
            <div className="space-y-1.5"><Label>Reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank transfer reference" /></div>
          </div>
          <DialogFooter><DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose><Button type="button" disabled={pending} onClick={refund}>{pending ? "Recording…" : "Record refund"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
