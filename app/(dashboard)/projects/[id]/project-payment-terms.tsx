"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProjectPaymentTerms } from "../project-payment-terms-actions";

export function ProjectPaymentTerms({ projectId, initialDays, canManage }: { projectId: string; initialDays: number | null; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialDays == null ? "" : String(initialDays));

  if (!canManage) {
    return <p className="mt-1.5 text-sm font-medium text-[var(--text-primary)]">{initialDays == null ? "Inherit customer / organisation terms" : `${initialDays} day${initialDays === 1 ? "" : "s"}`}</p>;
  }

  function save() {
    const days = value.trim() === "" ? null : Number(value);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) {
      toast.error("Enter a whole number between 0 and 3650, or leave blank to inherit.");
      return;
    }
    startTransition(async () => {
      const result = await updateProjectPaymentTerms({ projectId, paymentTermsDays: days });
      if ("error" in result) { toast.error(result.error); return; }
      toast.success(days == null ? "Project payment terms override cleared" : "Project payment terms updated");
      router.refresh();
    });
  }

  return (
    <div className="mt-1.5 space-y-2">
      <div className="flex items-center gap-2">
        <Input type="number" min="0" max="3650" step="1" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Inherit" className="h-9 max-w-[180px]" />
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">Blank = inherit customer terms, then organisation default. A value here becomes the Project override for new invoices.</p>
    </div>
  );
}
