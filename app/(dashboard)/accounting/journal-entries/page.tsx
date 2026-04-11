import { prisma } from "@/lib/prisma";
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
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  const { period, source, search } = searchParams;

  const entries = await prisma.journalEntry.findMany({
    where: {
      tenantId: orgId,
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
