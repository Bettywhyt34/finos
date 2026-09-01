"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileInput, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { changeQuoteStatus, convertQuoteToDraftInvoice } from "./actions";

export function QuoteRowActions({ quoteId, status, expired }: { quoteId: string; status: string; expired: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(nextStatus: string) {
    startTransition(async () => {
      const result = await changeQuoteStatus({ quoteId, status: nextStatus });
      if ("error" in result) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(`Quote ${nextStatus.toLowerCase()}`);
      router.refresh();
    });
  }

  function convert() {
    startTransition(async () => {
      const result = await convertQuoteToDraftInvoice(quoteId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft invoice created from quote");
      router.push(`/sales/invoices/${result.invoiceId}/edit`);
    });
  }

  if (expired && ["DRAFT", "SENT"].includes(status)) return <span className="text-xs text-[var(--text-secondary)]">Expired</span>;
  if (status === "DRAFT") {
    return (
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => change("REJECTED")}><X className="mr-1 h-3.5 w-3.5" /> Reject</Button>
        <Button type="button" size="sm" disabled={pending} onClick={() => change("SENT")}><Send className="mr-1 h-3.5 w-3.5" /> Mark sent</Button>
      </div>
    );
  }
  if (status === "SENT") {
    return (
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => change("REJECTED")}><X className="mr-1 h-3.5 w-3.5" /> Reject</Button>
        <Button type="button" size="sm" disabled={pending} onClick={() => change("ACCEPTED")}><Check className="mr-1 h-3.5 w-3.5" /> Accept</Button>
      </div>
    );
  }
  if (status === "ACCEPTED") {
    return <Button type="button" size="sm" disabled={pending} onClick={convert}><FileInput className="mr-1.5 h-3.5 w-3.5" /> {pending ? "Converting…" : "Convert to invoice"}</Button>;
  }
  return null;
}
