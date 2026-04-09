"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { recordXpenxFlowOverride } from "../actions";

interface XpenxFlowOverrideDialogProps {
  budgetId: string;
  versionId: string;
  budgetName: string;
}

type OverrideType = "KEEP_FINOS" | "USE_EXTERNAL" | "MERGE";

const OVERRIDE_OPTIONS: { value: OverrideType; label: string; desc: string }[] = [
  {
    value: "KEEP_FINOS",
    label: "Keep FINOS",
    desc: "Discard XpenxFlow data, keep the current FINOS budget as-is.",
  },
  {
    value: "USE_EXTERNAL",
    label: "Use External",
    desc: "Replace FINOS budget lines with XpenxFlow data.",
  },
  {
    value: "MERGE",
    label: "Merge",
    desc: "Accept XpenxFlow values for selected accounts, keep FINOS for others.",
  },
];

export function XpenxFlowOverrideDialog({
  budgetId,
  versionId,
  budgetName,
}: XpenxFlowOverrideDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [overrideType, setOverrideType] = useState<OverrideType>("KEEP_FINOS");
  const [notes, setNotes] = useState("");
  const [diffPercent, setDiffPercent] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await recordXpenxFlowOverride({
      budgetId,
      versionId,
      overrideType,
      notes: notes.trim() || undefined,
      differencePercent: diffPercent ? parseFloat(diffPercent) : undefined,
    });
    setLoading(false);
    if ("error" in result && result.error) {
      toast.error(result.error);
    } else {
      toast.success("Override decision recorded in audit log");
      setOpen(false);
      setNotes("");
      setDiffPercent("");
      router.refresh();
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        XpenxFlow Override
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>XpenxFlow Budget Override</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-slate-500">
              Record a conflict resolution decision for{" "}
              <span className="font-medium text-slate-700">{budgetName}</span>. This creates an
              audit trail in the override log.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Override Decision</label>
              <div className="space-y-2">
                {OVERRIDE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50"
                  >
                    <input
                      type="radio"
                      name="overrideType"
                      value={opt.value}
                      checked={overrideType === opt.value}
                      onChange={() => setOverrideType(opt.value)}
                      className="mt-0.5 accent-slate-900"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{opt.label}</p>
                      <p className="text-xs text-slate-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Max Difference Detected (%)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={diffPercent}
                onChange={(e) => setDiffPercent(e.target.value)}
                placeholder="e.g. 15.50"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <p className="text-xs text-slate-400">
                Largest variance between FINOS and XpenxFlow (optional)
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Reason for this decision…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              />
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={loading}>
                {loading ? "Recording…" : "Record Override"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
