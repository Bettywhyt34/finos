"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeProjectStatus } from "../project-status-actions";

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: ["ACTIVE"],
  CANCELLED: ["ACTIVE"],
};

function label(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (value) => value.toUpperCase());
}

export function ProjectStatusControl({
  projectId,
  currentStatus,
}: {
  projectId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = useMemo(() => TRANSITIONS[currentStatus] ?? [], [currentStatus]);
  const [status, setStatus] = useState(options[0] ?? "");
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  if (!options.length) return null;

  function submit() {
    if (!status) return;
    startTransition(async () => {
      const result = await changeProjectStatus({ projectId, status, reason });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Project moved to ${label(status)}`);
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  if (!open) {
    return <Button type="button" variant="outline" onClick={() => setOpen(true)}>Change status</Button>;
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-[var(--app-border)] bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-[var(--text-primary)]">Change Project status</p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Status is operational only. Existing invoices, revenue, costs and journals are not reversed.</p>
      <select
        className="mt-4 h-10 w-full rounded-lg border border-[var(--app-border)] bg-white px-3 text-sm text-[var(--text-primary)]"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      >
        {options.map((option) => <option key={option} value={option}>{label(option)}</option>)}
      </select>
      <Input className="mt-3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (optional)" maxLength={1000} />
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => { setOpen(false); setReason(""); }}>Cancel</Button>
        <Button type="button" disabled={pending || !status} onClick={submit}>{pending ? "Updating…" : "Update status"}</Button>
      </div>
    </div>
  );
}
