"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { createManualJournalEntry } from "../actions";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface JournalLine {
  id: string;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

interface Props {
  accounts: Account[];
  defaultDate: string;
  defaultPeriod: string;
}

function newLine(): JournalLine {
  return { id: Math.random().toString(36).slice(2), accountId: "", description: "", debit: "", credit: "" };
}

export function JournalForm({ accounts, defaultDate, defaultPeriod }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [entryDate, setEntryDate] = useState(defaultDate);
  const [period, setPeriod] = useState(defaultPeriod);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [isReversing, setIsReversing] = useState(false);
  const [lines, setLines] = useState<JournalLine[]>([newLine(), newLine()]);
  const [search, setSearch] = useState<Record<string, string>>({});

  const totalDebits = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = Math.abs(totalDebits - totalCredits);
  const isBalanced = diff < 0.005;

  function updateLine(id: string, field: keyof JournalLine, value: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        // Debit and credit are mutually exclusive
        if (field === "debit" && value) return { ...l, debit: value, credit: "" };
        if (field === "credit" && value) return { ...l, credit: value, debit: "" };
        return { ...l, [field]: value };
      })
    );
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(id: string) {
    if (lines.length <= 2) { toast.error("Minimum 2 lines required"); return; }
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  function handleSubmit(post: boolean) {
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!isBalanced) { toast.error("Debits must equal credits before saving"); return; }
    const filledLines = lines.filter((l) => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (filledLines.length < 2) { toast.error("At least 2 lines with accounts required"); return; }

    startTransition(async () => {
      const result = await createManualJournalEntry({
        entryDate,
        description,
        recognitionPeriod: period,
        reference: reference || undefined,
        isReversing,
        lines: filledLines.map((l) => ({
          accountId: l.accountId,
          description: l.description || undefined,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
        })),
      });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      if (post) {
        const { postJournalEntry } = await import("../actions");
        const postResult = await postJournalEntry(result.id!);
        if ("error" in postResult) {
          toast.warning("Saved as draft — " + postResult.error);
          router.push("/accounting/journal-entries/" + result.id);
          return;
        }
        toast.success("Journal entry posted");
      } else {
        toast.success("Saved as draft");
      }
      router.push("/accounting/journal-entries/" + result.id);
    });
  }

  const filteredAccounts = (lineId: string) => {
    const q = (search[lineId] ?? "").toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  };

  return (
    <div className="space-y-5">
      {/* Header fields */}
      <div className="rounded-lg border p-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="space-y-1">
          <Label>Entry Date</Label>
          <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Recognition Period</Label>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Reference (optional)</Label>
          <Input
            placeholder="Auto-assigned if blank"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Description *</Label>
          <Input
            placeholder="Purpose of this entry"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border overflow-hidden">
        <div className="p-3 border-b bg-muted/30 text-sm font-medium">Journal Lines</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium w-8">#</th>
                <th className="text-left p-2 font-medium min-w-[200px]">Account</th>
                <th className="text-left p-2 font-medium min-w-[160px]">Description</th>
                <th className="text-right p-2 font-medium w-36">Debit (NGN)</th>
                <th className="text-right p-2 font-medium w-36">Credit (NGN)</th>
                <th className="p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={line.id} className="border-t">
                  <td className="p-2 text-muted-foreground text-xs">{idx + 1}</td>
                  <td className="p-2">
                    <div className="space-y-1">
                      <Input
                        placeholder="Search account..."
                        className="h-7 text-xs mb-1"
                        value={search[line.id] ?? ""}
                        onChange={(e) => setSearch((s) => ({ ...s, [line.id]: e.target.value }))}
                      />
                      <Select
                        value={line.accountId}
                        onValueChange={(v) => updateLine(line.id, "accountId", v ?? "")}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredAccounts(line.id).map((a) => (
                            <SelectItem key={a.id} value={a.id} className="text-xs">
                              {a.code} — {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </td>
                  <td className="p-2">
                    <Input
                      className="h-7 text-xs"
                      placeholder="Line description"
                      value={line.description}
                      onChange={(e) => updateLine(line.id, "description", e.target.value)}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-7 text-xs text-right"
                      placeholder="0.00"
                      value={line.debit}
                      onChange={(e) => updateLine(line.id, "debit", e.target.value)}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-7 text-xs text-right"
                      placeholder="0.00"
                      value={line.credit}
                      onChange={(e) => updateLine(line.id, "credit", e.target.value)}
                    />
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr>
                <td colSpan={3} className="p-2">
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-xs text-primary flex items-center gap-1 hover:underline"
                  >
                    <Plus size={12} /> Add line
                  </button>
                </td>
                <td className="p-2 text-right font-semibold">
                  {formatCurrency(totalDebits)}
                </td>
                <td className="p-2 text-right font-semibold">
                  {formatCurrency(totalCredits)}
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={6} className="px-2 pb-2">
                  {isBalanced ? (
                    <span className="text-xs text-green-600 font-medium">
                      ✓ Balanced — debits equal credits
                    </span>
                  ) : (
                    <span className="text-xs text-red-600 font-medium">
                      ⚠ Out of balance by {formatCurrency(diff)}
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Reversing */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="reversing"
          checked={isReversing}
          onChange={(e) => setIsReversing(e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="reversing" className="text-sm">
          Auto-reverse next period (creates reversal entry at start of next period)
        </label>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending || !isBalanced}
          onClick={() => handleSubmit(false)}
        >
          Save as Draft
        </Button>
        <Button
          type="button"
          disabled={isPending || !isBalanced}
          onClick={() => handleSubmit(true)}
        >
          {isPending ? "Posting..." : "Post Entry"}
        </Button>
      </div>
    </div>
  );
}
