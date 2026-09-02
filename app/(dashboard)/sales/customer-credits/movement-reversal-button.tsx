"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reverseCustomerCreditApplication, reverseCustomerCreditRefund } from "./reverse-actions";

export function CustomerCreditMovementReversal({ type, id, label }: { type:"application"|"refund"; id:string; label:string }) {
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [reason,setReason]=useState("");
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [pending,startTransition]=useTransition();

  function submit(){
    if(!reason.trim()){toast.error("Enter a reversal reason");return;}
    startTransition(async()=>{
      const result=type==="application"
        ? await reverseCustomerCreditApplication({applicationId:id,reason,reversalDate:date})
        : await reverseCustomerCreditRefund({refundId:id,reason,reversalDate:date});
      if("error" in result){toast.error(result.error);return;}
      toast.success(type==="application"?"Customer-credit application reversed":"Customer-credit refund reversed");
      setOpen(false);setReason("");router.refresh();
    });
  }

  return <>
    <Button size="sm" variant="outline" className="text-red-600" onClick={()=>setOpen(true)}><RotateCcw className="mr-1.5 h-3.5 w-3.5"/>Reverse</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Reverse {label}</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div className="space-y-1.5"><Label>Reversal date</Label><Input type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></div><div className="space-y-1.5"><Label>Reason *</Label><Input value={reason} maxLength={2000} onChange={(e)=>setReason(e.target.value)} placeholder="Why is this movement being reversed?"/></div><p className="text-xs leading-5 text-[var(--text-secondary)]">FINOS posts an exact reversal journal and restores the customer-credit liability. Application reversals also recompute the invoice balance from surviving receipts and credits.</p></div><DialogFooter><DialogClose render={<Button type="button" variant="outline"/>}>Cancel</DialogClose><Button type="button" variant="destructive" disabled={pending||!reason.trim()} onClick={submit}>{pending?"Reversing…":"Reverse movement"}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
