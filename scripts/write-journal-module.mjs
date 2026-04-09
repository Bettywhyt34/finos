import fs from "fs";
import path from "path";

const root = process.cwd();
const jeDir = path.join(root, "app", "(dashboard)", "accounting", "journal-entries");
const newDir = path.join(jeDir, "new");
const idDir = path.join(jeDir, "[id]");
fs.mkdirSync(newDir, { recursive: true });
fs.mkdirSync(idDir, { recursive: true });

// ─── actions.ts ───────────────────────────────────────────────────────────────
const actions = `"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function getOrgAndUser() {
  const session = await auth();
  if (!session?.user?.organizationId) throw new Error("Unauthorized");
  return {
    orgId: session.user.organizationId,
    userId: (session.user as { id?: string }).id ?? "system",
  };
}

async function getNextEntryNumber(orgId: string): Promise<string> {
  const count = await prisma.journalEntry.count({ where: { organizationId: orgId } });
  return "MJE-" + String(count + 1).padStart(5, "0");
}

async function checkPeriodLocked(orgId: string, period: string) {
  const ap = await prisma.accountingPeriod.findUnique({
    where: { organizationId_period: { organizationId: orgId, period } },
  });
  if (ap?.isClosed) throw new Error("Period " + period + " is closed. Reopen it before posting.");
}

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
}

export async function createManualJournalEntry(data: {
  entryDate: string;
  description: string;
  recognitionPeriod: string;
  reference?: string;
  isReversing: boolean;
  attachmentUrl?: string;
  lines: JournalLineInput[];
}) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    await checkPeriodLocked(orgId, data.recognitionPeriod);

    const totalDebits = data.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = data.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      return { error: "Journal imbalance: debits " + totalDebits.toFixed(2) + " \u2260 credits " + totalCredits.toFixed(2) };
    }

    const entryNumber = await getNextEntryNumber(orgId);

    const entry = await prisma.journalEntry.create({
      data: {
        organizationId: orgId,
        entryNumber,
        entryDate: new Date(data.entryDate),
        reference: data.reference ?? null,
        description: data.description,
        recognitionPeriod: data.recognitionPeriod,
        isReversing: data.isReversing,
        isLocked: false, // DRAFT until posted
        source: "manual",
        sourceId: entryNumber,
        attachmentUrl: data.attachmentUrl ?? null,
        createdBy: userId,
        lines: {
          create: data.lines
            .filter((l) => l.debit > 0 || l.credit > 0)
            .map((l) => ({
              accountId: l.accountId,
              description: l.description ?? null,
              debit: l.debit,
              credit: l.credit,
            })),
        },
      },
    });

    revalidatePath("/accounting/journal-entries");
    return { success: true, id: entry.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create entry" };
  }
}

export async function postJournalEntry(entryId: string) {
  try {
    const { orgId } = await getOrgAndUser();
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, organizationId: orgId },
      include: { lines: true },
    });
    if (!entry) return { error: "Entry not found" };
    if (entry.isLocked) return { error: "Entry is already posted" };

    await checkPeriodLocked(orgId, entry.recognitionPeriod);

    const totalDebits = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredits = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      return { error: "Journal imbalance — fix lines before posting" };
    }

    await prisma.journalEntry.update({
      where: { id: entryId },
      data: { isLocked: true },
    });

    revalidatePath("/accounting/journal-entries");
    revalidatePath("/accounting/journal-entries/" + entryId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to post entry" };
  }
}

export async function reverseJournalEntry(entryId: string, reason: string) {
  try {
    const { orgId, userId } = await getOrgAndUser();
    const original = await prisma.journalEntry.findFirst({
      where: { id: entryId, organizationId: orgId, isLocked: true },
      include: { lines: { include: { account: { select: { id: true, code: true } } } } },
    });
    if (!original) return { error: "Entry not found or not posted" };

    // Check not already reversed
    const existingReversal = await prisma.journalEntry.findFirst({
      where: { organizationId: orgId, reversedById: entryId },
    });
    if (existingReversal) return { error: "Entry has already been reversed" };

    const today = new Date();
    const period = today.toISOString().slice(0, 7);
    await checkPeriodLocked(orgId, period);

    const entryNumber = await getNextEntryNumber(orgId);

    const reversal = await prisma.journalEntry.create({
      data: {
        organizationId: orgId,
        entryNumber,
        entryDate: today,
        reference: "REV-" + original.entryNumber,
        description: "Reversal of " + original.entryNumber + ": " + original.description,
        recognitionPeriod: period,
        isReversing: true,
        reversedById: entryId,
        reversalReason: reason,
        isLocked: true,
        source: "reversal",
        sourceId: entryId,
        createdBy: userId,
        lines: {
          create: original.lines.map((l) => ({
            accountId: l.accountId,
            description: "REVERSAL: " + (l.description ?? ""),
            debit: Number(l.credit),
            credit: Number(l.debit),
          })),
        },
      },
    });

    revalidatePath("/accounting/journal-entries");
    revalidatePath("/accounting/journal-entries/" + entryId);
    return { success: true, reversalId: reversal.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reverse entry" };
  }
}

export async function updateJournalEntry(
  entryId: string,
  data: {
    entryDate: string;
    description: string;
    recognitionPeriod: string;
    reference?: string;
    attachmentUrl?: string;
    lines: JournalLineInput[];
  }
) {
  try {
    const { orgId } = await getOrgAndUser();
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, organizationId: orgId },
    });
    if (!entry) return { error: "Entry not found" };
    if (entry.isLocked) return { error: "Cannot edit a posted entry" };

    const totalDebits = data.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = data.lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      return { error: "Journal imbalance: debits " + totalDebits.toFixed(2) + " \u2260 credits " + totalCredits.toFixed(2) };
    }

    await prisma.journalEntryLine.deleteMany({ where: { entryId } });
    await prisma.journalEntry.update({
      where: { id: entryId },
      data: {
        entryDate: new Date(data.entryDate),
        reference: data.reference ?? null,
        description: data.description,
        recognitionPeriod: data.recognitionPeriod,
        attachmentUrl: data.attachmentUrl ?? null,
        lines: {
          create: data.lines
            .filter((l) => l.debit > 0 || l.credit > 0)
            .map((l) => ({
              accountId: l.accountId,
              description: l.description ?? null,
              debit: l.debit,
              credit: l.credit,
            })),
        },
      },
    });

    revalidatePath("/accounting/journal-entries");
    revalidatePath("/accounting/journal-entries/" + entryId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update entry" };
  }
}
`;

fs.writeFileSync(path.join(jeDir, "actions.ts"), actions);
console.log("Written: journal-entries/actions.ts");

// ─── List page ────────────────────────────────────────────────────────────────
const listPage = `import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  invoice: "Invoice",
  bill: "Bill",
  payment: "Payment",
  "bank-import": "Bank",
  "fx-revaluation": "FX Reval",
  reversal: "Reversal",
};

function getStatus(isLocked: boolean, isReversed: boolean) {
  if (isReversed) return { label: "Reversed", cls: "bg-gray-100 text-gray-600" };
  if (isLocked) return { label: "Posted", cls: "bg-green-100 text-green-700" };
  return { label: "Draft", cls: "bg-amber-100 text-amber-700" };
}

export default async function JournalEntriesPage({
  searchParams,
}: {
  searchParams: { period?: string; source?: string; search?: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const { period, source, search } = searchParams;

  const entries = await prisma.journalEntry.findMany({
    where: {
      organizationId: orgId,
      ...(period ? { recognitionPeriod: period } : {}),
      ...(source ? { source } : {}),
      ...(search
        ? {
            OR: [
              { entryNumber: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              { reference: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      lines: { select: { debit: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { entryDate: "desc" },
    take: 200,
  });

  // Mark reversed entries
  const reversedIds = new Set(
    entries.filter((e) => e.reversedById).map((e) => e.reversedById as string)
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Journal Entries</h1>
          <p className="text-sm text-muted-foreground">Manual and auto-posted ledger entries</p>
        </div>
        <Link href="/accounting/journal-entries/new" className={buttonVariants()}>
          New Journal Entry
        </Link>
      </div>

      {/* Filters */}
      <form method="GET" className="flex gap-3 items-end flex-wrap">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Period</label>
          <input
            type="month"
            name="period"
            defaultValue={period ?? ""}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Source</label>
          <select
            name="source"
            defaultValue={source ?? ""}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="">All sources</option>
            <option value="manual">Manual</option>
            <option value="invoice">Invoice</option>
            <option value="bill">Bill</option>
            <option value="payment">Payment</option>
            <option value="fx-revaluation">FX Revaluation</option>
            <option value="reversal">Reversal</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <input
            type="text"
            name="search"
            defaultValue={search ?? ""}
            placeholder="Entry #, description..."
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-48"
          />
        </div>
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Filter
        </button>
        <Link href="/accounting/journal-entries" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Clear
        </Link>
      </form>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Entry #</th>
              <th className="text-left p-3 font-medium">Date</th>
              <th className="text-left p-3 font-medium">Period</th>
              <th className="text-left p-3 font-medium">Description</th>
              <th className="text-left p-3 font-medium">Source</th>
              <th className="text-right p-3 font-medium">Amount</th>
              <th className="text-left p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No journal entries found
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const totalDebits = e.lines.reduce((s, l) => s + Number(l.debit), 0);
              const isReversed = reversedIds.has(e.id);
              const status = getStatus(e.isLocked, isReversed);
              return (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Link
                      href={"/accounting/journal-entries/" + e.id}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {e.entryNumber}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{formatDate(e.entryDate)}</td>
                  <td className="p-3 font-mono text-xs">{e.recognitionPeriod}</td>
                  <td className="p-3 max-w-xs truncate">{e.description}</td>
                  <td className="p-3">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                      {SOURCE_LABELS[e.source] ?? e.source}
                    </span>
                  </td>
                  <td className="p-3 text-right font-medium">
                    {totalDebits.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3">
                    <span className={"px-2 py-0.5 rounded text-xs font-medium " + status.cls}>
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(jeDir, "page.tsx"), listPage);
console.log("Written: journal-entries/page.tsx");

// ─── New page ─────────────────────────────────────────────────────────────────
const newPage = `import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { JournalForm } from "./journal-form";

export default async function NewJournalEntryPage() {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const accounts = await prisma.chartOfAccounts.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: "asc" },
  });

  const today = new Date().toISOString().split("T")[0];
  const currentPeriod = today.slice(0, 7);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">New Journal Entry</h1>
        <p className="text-sm text-muted-foreground">
          Manual double-entry posting. Debits must equal credits before posting.
        </p>
      </div>
      <JournalForm accounts={accounts} defaultDate={today} defaultPeriod={currentPeriod} />
    </div>
  );
}
`;

fs.writeFileSync(path.join(newDir, "page.tsx"), newPage);
console.log("Written: journal-entries/new/page.tsx");

// ─── Journal Form (client) ────────────────────────────────────────────────────
const journalForm = `"use client";

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
                      \u2713 Balanced — debits equal credits
                    </span>
                  ) : (
                    <span className="text-xs text-red-600 font-medium">
                      \u26a0 Out of balance by {formatCurrency(diff)}
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
`;

fs.writeFileSync(path.join(newDir, "journal-form.tsx"), journalForm);
console.log("Written: journal-entries/new/journal-form.tsx");

// ─── Detail page ──────────────────────────────────────────────────────────────
const detailPage = `import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatCurrency } from "@/lib/utils";
import { JournalActions } from "./journal-actions";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  invoice: "Invoice",
  bill: "Bill",
  payment: "Payment",
  "bank-import": "Bank Import",
  "fx-revaluation": "FX Revaluation",
  reversal: "Reversal",
};

export default async function JournalEntryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const entry = await prisma.journalEntry.findFirst({
    where: { id: params.id, organizationId: orgId },
    include: {
      lines: {
        include: {
          account: { select: { code: true, name: true, type: true } },
        },
        orderBy: { debit: "desc" },
      },
    },
  });

  if (!entry) notFound();

  // Check if already reversed
  const reversal = await prisma.journalEntry.findFirst({
    where: { organizationId: orgId, reversedById: entry.id },
    select: { id: true, entryNumber: true },
  });

  // Find source entry if this is a reversal
  const sourceEntry =
    entry.reversedById
      ? await prisma.journalEntry.findFirst({
          where: { id: entry.reversedById, organizationId: orgId },
          select: { id: true, entryNumber: true },
        })
      : null;

  const totalDebits = entry.lines.reduce((s, l) => s + Number(l.debit), 0);

  let status = "Draft";
  let statusCls = "bg-amber-100 text-amber-700";
  if (reversal) { status = "Reversed"; statusCls = "bg-gray-100 text-gray-600"; }
  else if (entry.isLocked) { status = "Posted"; statusCls = "bg-green-100 text-green-700"; }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold font-mono">{entry.entryNumber}</h1>
            <span className={"px-2 py-0.5 rounded text-xs font-medium " + statusCls}>
              {status}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
              {SOURCE_LABELS[entry.source] ?? entry.source}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(entry.entryDate)} &middot; Period: {entry.recognitionPeriod}
            {entry.reference && " \u00b7 Ref: " + entry.reference}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/accounting/journal-entries" className={buttonVariants({ variant: "outline" })}>
            Back
          </Link>
          <JournalActions
            entryId={entry.id}
            isLocked={entry.isLocked}
            isReversed={!!reversal}
            source={entry.source}
          />
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-1">
        <p className="font-medium">{entry.description}</p>
        {entry.reversalReason && (
          <p className="text-sm text-muted-foreground">Reason: {entry.reversalReason}</p>
        )}
        {sourceEntry && (
          <p className="text-sm">
            Reversal of:{" "}
            <Link
              href={"/accounting/journal-entries/" + sourceEntry.id}
              className="text-primary hover:underline font-mono"
            >
              {sourceEntry.entryNumber}
            </Link>
          </p>
        )}
        {reversal && (
          <p className="text-sm">
            Reversed by:{" "}
            <Link
              href={"/accounting/journal-entries/" + reversal.id}
              className="text-primary hover:underline font-mono"
            >
              {reversal.entryNumber}
            </Link>
          </p>
        )}
        <p className="text-xs text-muted-foreground">Created by: {entry.createdBy}</p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Account</th>
              <th className="text-left p-3 font-medium">Description</th>
              <th className="text-right p-3 font-medium">Debit (NGN)</th>
              <th className="text-right p-3 font-medium">Credit (NGN)</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-3">
                  <span className="font-mono text-xs text-muted-foreground mr-2">{l.account.code}</span>
                  {l.account.name}
                </td>
                <td className="p-3 text-muted-foreground text-xs">{l.description ?? ""}</td>
                <td className="p-3 text-right">
                  {Number(l.debit) > 0 ? formatCurrency(Number(l.debit)) : ""}
                </td>
                <td className="p-3 text-right">
                  {Number(l.credit) > 0 ? formatCurrency(Number(l.credit)) : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td colSpan={2} className="p-3">Total</td>
              <td className="p-3 text-right">{formatCurrency(totalDebits)}</td>
              <td className="p-3 text-right">{formatCurrency(totalDebits)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {entry.attachmentUrl && (
        <div className="rounded-lg border p-3 text-sm">
          <span className="font-medium">Attachment: </span>
          <a href={entry.attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            View document
          </a>
        </div>
      )}
    </div>
  );
}
`;

fs.writeFileSync(path.join(idDir, "page.tsx"), detailPage);
console.log("Written: journal-entries/[id]/page.tsx");

// ─── Journal Actions (client) ─────────────────────────────────────────────────
const journalActions = `"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { postJournalEntry, reverseJournalEntry } from "../actions";
import { toast } from "sonner";

interface Props {
  entryId: string;
  isLocked: boolean;
  isReversed: boolean;
  source: string;
}

export function JournalActions({ entryId, isLocked, isReversed, source }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [reason, setReason] = useState("");

  function handlePost() {
    startTransition(async () => {
      const result = await postJournalEntry(entryId);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Entry posted");
      router.refresh();
    });
  }

  function handleReverse() {
    if (!reason.trim()) { toast.error("Reversal reason required"); return; }
    startTransition(async () => {
      const result = await reverseJournalEntry(entryId, reason);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Reversal entry created");
      setShowReverseDialog(false);
      router.refresh();
    });
  }

  return (
    <>
      {!isLocked && source === "manual" && (
        <Button type="button" onClick={handlePost} disabled={isPending}>
          {isPending ? "Posting..." : "Post"}
        </Button>
      )}
      {isLocked && !isReversed && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowReverseDialog(true)}
          disabled={isPending}
        >
          Reverse
        </Button>
      )}

      <Dialog open={showReverseDialog} onOpenChange={setShowReverseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Journal Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              A reversing entry will be created with all debits and credits swapped, posted to today&apos;s period.
            </p>
            <div className="space-y-1">
              <Label>Reason for reversal *</Label>
              <Input
                placeholder="e.g. Incorrect account coding"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="button" onClick={handleReverse} disabled={isPending || !reason.trim()}>
              {isPending ? "Reversing..." : "Create Reversal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
`;

fs.writeFileSync(path.join(idDir, "journal-actions.tsx"), journalActions);
console.log("Written: journal-entries/[id]/journal-actions.tsx");

console.log("\nAll journal entry files written.");
