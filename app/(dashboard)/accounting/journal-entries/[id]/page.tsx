import { prisma } from "@/lib/prisma";
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
            {entry.reference && " · Ref: " + entry.reference}
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
