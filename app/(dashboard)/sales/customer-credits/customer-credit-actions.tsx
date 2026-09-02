"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { applyCustomerCredit, refundCustomerCredit } from "./actions";

export interface CustomerCreditView { id:string; customerId:string; customerName:string; creditNumber:string; currency:string; exchangeRate:number; remainingAmount:number; }
export interface CreditInvoiceOption { id:string; customerId:string; invoiceNumber:string; currency:string; balanceDue:number; }
export interface CreditBankOption { id:string; accountName:string; bankName:string; currency:string; }

export function CustomerCreditActions({ credit, invoices, bankAccounts }: { credit:CustomerCreditView; invoices:CreditInvoiceOption[]; bankAccounts:CreditBankOption[] }) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [applyOpen,setApplyOpen]=useState(false);
  const [refundOpen,setRefundOpen]=useState(false);
  const eligibleInvoices=useMemo(()=>invoices.filter((invoice)=>invoice.customerId===credit.customerId&&invoice.currency===credit.currency&&invoice.balanceDue>0),[credit,invoices]);
  const eligibleBanks=useMemo(()=>bankAccounts.filter((bank)=>bank.currency===credit.currency),[credit,bankAccounts]);
  const [invoiceId,setInvoiceId]=useState(eligibleInvoices[0]?.id??"");
  const selectedInvoice=eligibleInvoices.find((invoice)=>invoice.id===invoiceId);
  const [applyAmount,setApplyAmount]=useState(Math.min(credit.remainingAmount,selectedInvoice?.balanceDue??credit.remainingAmount));
  const [applicationDate,setApplicationDate]=useState(new Date().toISOString().slice(0,10));
  const [bankId,setBankId]=useState(eligibleBanks[0]?.id??"");
  const [refundAmount,setRefundAmount]=useState(credit.remainingAmount);
  const [refundDate,setRefundDate]=useState(new Date().toISOString().slice(0,10));
  const [refundRate,setRefundRate]=useState(credit.currency==="NGN"?1:credit.exchangeRate);
  const [reference,setReference]=useState("");

  function apply(){
    if(!invoiceId||!selectedInvoice){toast.error("Select an invoice");return;}
    const max=Math.min(credit.remainingAmount,selectedInvoice.balanceDue);
    if(applyAmount<=0||applyAmount-max>0.01){toast.error(`Application cannot exceed ${formatCurrency(max,credit.currency)}`);return;}
    startTransition(async()=>{
      const result=await applyCustomerCredit({customerCreditId:credit.id,invoiceId,amount:applyAmount,applicationDate});
      if("error" in result){toast.error(result.error);return;}
      toast.success("Customer credit applied to invoice");setApplyOpen(false);router.refresh();
    });
  }

  function refund(){
    if(!bankId){toast.error("Select a refund bank account");return;}
    if(refundAmount<=0||refundAmount-credit.remainingAmount>0.01){toast.error(`Refund cannot exceed ${formatCurrency(credit.remainingAmount,credit.currency)}`);return;}
    if(!Number.isFinite(refundRate)||refundRate<=0){toast.error("Enter a valid refund exchange rate");return;}
    startTransition(async()=>{
      const result=await refundCustomerCredit({customerCreditId:credit.id,bankAccountId:bankId,amount:refundAmount,refundDate,exchangeRate:credit.currency==="NGN"?1:refundRate,reference});
      if("error" in result){toast.error(result.error);return;}
      toast.success("Customer credit refunded");setRefundOpen(false);router.refresh();
    });
  }

  return <div className="flex justify-end gap-2">
    <Button size="sm" variant="outline" disabled={!eligibleInvoices.length} onClick={()=>setApplyOpen(true)}>Apply to invoice</Button>
    <Button size="sm" disabled={!eligibleBanks.length} onClick={()=>setRefundOpen(true)}>Refund</Button>
    <Dialog open={applyOpen} onOpenChange={setApplyOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Apply customer credit</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div className="rounded-md bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-secondary)]">Available: <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(credit.remainingAmount,credit.currency)}</span>. This reduces AR; it does not count as cash received.</div><div className="space-y-1.5"><Label>Invoice</Label><Select value={invoiceId} onValueChange={(value)=>{setInvoiceId(value??"");const inv=eligibleInvoices.find((item)=>item.id===value);if(inv)setApplyAmount(Math.min(credit.remainingAmount,inv.balanceDue));}}><SelectTrigger><SelectValue placeholder="Select invoice"/></SelectTrigger><SelectContent>{eligibleInvoices.map((invoice)=><SelectItem key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {formatCurrency(invoice.balanceDue,invoice.currency)} outstanding</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Date</Label><Input type="date" value={applicationDate} onChange={(e)=>setApplicationDate(e.target.value)}/></div><div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0.01" step="0.01" value={applyAmount} onChange={(e)=>setApplyAmount(Number(e.target.value)||0)}/></div></div></div><DialogFooter><DialogClose render={<Button variant="outline" type="button"/>}>Cancel</DialogClose><Button type="button" disabled={pending} onClick={apply}>{pending?"Applying…":"Apply credit"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={refundOpen} onOpenChange={setRefundOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Refund customer credit</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div className="space-y-1.5"><Label>Refund from</Label><Select value={bankId} onValueChange={(value)=>setBankId(value??"")}><SelectTrigger><SelectValue placeholder="Select bank account"/></SelectTrigger><SelectContent>{eligibleBanks.map((bank)=><SelectItem key={bank.id} value={bank.id}>{bank.bankName} · {bank.accountName}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Date</Label><Input type="date" value={refundDate} onChange={(e)=>setRefundDate(e.target.value)}/></div><div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0.01" max={credit.remainingAmount} step="0.01" value={refundAmount} onChange={(e)=>setRefundAmount(Number(e.target.value)||0)}/></div></div>{credit.currency!=="NGN"?<div className="space-y-1.5"><Label>Refund exchange rate (NGN per {credit.currency})</Label><Input type="number" min="0.000001" step="0.000001" value={refundRate} onChange={(e)=>setRefundRate(Number(e.target.value)||0)}/></div>:null}<div className="space-y-1.5"><Label>Reference</Label><Input value={reference} onChange={(e)=>setReference(e.target.value)} placeholder="Bank transfer reference"/></div></div><DialogFooter><DialogClose render={<Button variant="outline" type="button"/>}>Cancel</DialogClose><Button type="button" disabled={pending} onClick={refund}>{pending?"Refunding…":"Refund credit"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
