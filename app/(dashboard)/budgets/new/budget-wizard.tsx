"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createBudget } from "../actions";
import { toast } from "sonner";

interface PriorBudget { id: string; name: string; type: string; fiscalYear: number; }

interface Props {
  currentYear: number;
  priorBudgets: PriorBudget[];
}

const TYPE_INFO = {
  OPERATING: { label: "Operating Budget", desc: "Revenue, salaries, overhead — day-to-day operations" },
  CAPEX: { label: "Capital Expenditure", desc: "Equipment, infrastructure, long-term assets" },
  CASHFLOW: { label: "Cash Flow Budget", desc: "Cash inflows and outflows by period" },
};

export function BudgetWizard({ currentYear, priorBudgets }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [type, setType] = useState<"OPERATING" | "CAPEX" | "CASHFLOW">("OPERATING");
  const [name, setName] = useState("");
  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [description, setDescription] = useState("");
  const [copyFromId, setCopyFromId] = useState("");

  const matchingPrior = priorBudgets.filter((b) => b.type === type);

  function handleCreate() {
    if (!name.trim()) { toast.error("Budget name is required"); return; }

    startTransition(async () => {
      const result = await createBudget({
        name: name.trim(),
        type,
        fiscalYear,
        description: description.trim() || undefined,
        copyFromBudgetId: copyFromId || undefined,
      });

      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Budget created");
      router.push("/budgets/" + result.id + "?versionId=" + result.versionId);
    });
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Type */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">Budget Type</Label>
        <div className="grid grid-cols-3 gap-3">
          {(["OPERATING", "CAPEX", "CASHFLOW"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setType(t); setCopyFromId(""); }}
              className={
                "rounded-lg border p-4 text-left transition-colors " +
                (type === t ? "border-primary bg-primary/5" : "hover:bg-muted/30")
              }
            >
              <p className="font-medium text-sm">{TYPE_INFO[t].label}</p>
              <p className="text-xs text-muted-foreground mt-1">{TYPE_INFO[t].desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Details */}
      <div className="rounded-lg border p-4 space-y-4">
        <p className="font-semibold text-sm">Budget Details</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1">
            <Label>Budget Name *</Label>
            <Input
              placeholder={"e.g. FY" + fiscalYear + " Operating Budget"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Fiscal Year</Label>
            <Select value={String(fiscalYear)} onValueChange={(v) => setFiscalYear(parseInt(v ?? String(currentYear)))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Description (optional)</Label>
            <Input
              placeholder="Brief description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Step 3: Copy from prior */}
      <div className="rounded-lg border p-4 space-y-3">
        <p className="font-semibold text-sm">Starting Point</p>
        {matchingPrior.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              Copy amounts from a prior approved {TYPE_INFO[type].label.toLowerCase()} to save time.
            </p>
            <div className="space-y-1">
              <Label>Copy from (optional)</Label>
              <Select value={copyFromId} onValueChange={(v) => setCopyFromId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Start fresh (blank)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Start fresh (blank)</SelectItem>
                  {matchingPrior.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      FY{b.fiscalYear} — {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No prior year {TYPE_INFO[type].label.toLowerCase()} found. Starting fresh.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="button" onClick={handleCreate} disabled={isPending || !name.trim()}>
          {isPending ? "Creating..." : "Create Budget"}
        </Button>
      </div>
    </div>
  );
}
