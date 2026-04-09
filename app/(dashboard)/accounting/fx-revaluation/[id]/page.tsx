import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CURRENCY_SYMBOLS } from "@/lib/fx";
import { ReverseButton } from "./reverse-button";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  POSTED: "bg-green-100 text-green-700",
  REVERSED: "bg-red-100 text-red-700",
};

export default async function FxRevaluationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const reval = await prisma.fxRevaluation.findFirst({
    where: { id: params.id, organizationId: orgId },
    include: {
      journalEntry: {
        include: {
          lines: {
            include: { account: { select: { code: true, name: true } } },
            orderBy: { debit: "desc" },
          },
        },
      },
    },
  });

  if (!reval) notFound();

  const net = Number(reval.unrealizedGainLoss);
  const sym = CURRENCY_SYMBOLS[reval.currency] ?? reval.currency;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">
              FX Revaluation — {reval.currency} {sym} / {reval.period}
            </h1>
            <span className={"px-2 py-0.5 rounded text-xs font-medium " + STATUS_COLORS[reval.status]}>
              {reval.status}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Revaluation date: {formatDate(reval.revaluationDate)}
            {reval.postedBy && " · Posted by " + reval.postedBy}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/accounting/fx-revaluation" className={buttonVariants({ variant: "outline" })}>
            Back
          </Link>
          {reval.status === "POSTED" && (
            <ReverseButton revalId={reval.id} />
          )}
        </div>
      </div>

      {/* Rate card */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Opening Rate</p>
          <p className="text-lg font-semibold">{Number(reval.openingRate).toFixed(4)}</p>
          <p className="text-xs text-muted-foreground">1 {reval.currency} = ₦</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Closing Rate</p>
          <p className="text-lg font-semibold">{Number(reval.closingRate).toFixed(4)}</p>
          <p className="text-xs text-muted-foreground">1 {reval.currency} = ₦</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Rate Movement</p>
          <p className={"text-lg font-semibold " + (Number(reval.closingRate) >= Number(reval.openingRate) ? "text-amber-600" : "text-blue-600")}>
            {(((Number(reval.closingRate) - Number(reval.openingRate)) / Number(reval.openingRate)) * 100).toFixed(2)}%
          </p>
          <p className="text-xs text-muted-foreground">
            {Number(reval.closingRate) >= Number(reval.openingRate) ? "NGN weakened" : "NGN strengthened"}
          </p>
        </div>
        <div className={"rounded-lg border p-4 text-center " + (net >= 0 ? "bg-green-50" : "bg-red-50")}>
          <p className="text-xs text-muted-foreground mb-1">Net Unrealised</p>
          <p className={"text-lg font-bold " + (net >= 0 ? "text-green-700" : "text-red-700")}>
            {formatCurrency(Math.abs(net))}
          </p>
          <p className={"text-xs font-medium " + (net >= 0 ? "text-green-600" : "text-red-600")}>
            {net >= 0 ? "Gain" : "Loss"}
          </p>
        </div>
      </div>

      {/* Exposure table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Component</th>
              <th className="text-right p-3 font-medium">Exposure ({reval.currency})</th>
              <th className="text-right p-3 font-medium">Booked NGN</th>
              <th className="text-right p-3 font-medium">Current NGN</th>
              <th className="text-right p-3 font-medium">Gain / Loss</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="p-3 font-medium">Accounts Receivable (AR)</td>
              <td className="p-3 text-right">
                {reval.currency} {Number(reval.arExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
              </td>
              <td className="p-3 text-right">{formatCurrency(Number(reval.arBookedNGN))}</td>
              <td className="p-3 text-right">{formatCurrency(Number(reval.arCurrentNGN))}</td>
              <td className={"p-3 text-right font-medium " + (Number(reval.arGainLoss) >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(Number(reval.arGainLoss))}
              </td>
            </tr>
            <tr className="border-t">
              <td className="p-3 font-medium">Accounts Payable (AP)</td>
              <td className="p-3 text-right">
                {reval.currency} {Number(reval.apExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
              </td>
              <td className="p-3 text-right">{formatCurrency(Number(reval.apBookedNGN))}</td>
              <td className="p-3 text-right">{formatCurrency(Number(reval.apCurrentNGN))}</td>
              <td className={"p-3 text-right font-medium " + (Number(reval.apGainLoss) >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(Number(reval.apGainLoss))}
              </td>
            </tr>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="p-3">Total</td>
              <td className="p-3 text-right">
                {reval.currency} {(Number(reval.arExposure) + Number(reval.apExposure)).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
              </td>
              <td className="p-3 text-right">{formatCurrency(Number(reval.arBookedNGN) + Number(reval.apBookedNGN))}</td>
              <td className="p-3 text-right">{formatCurrency(Number(reval.arCurrentNGN) + Number(reval.apCurrentNGN))}</td>
              <td className={"p-3 text-right " + (net >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(net)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Journal entry */}
      {reval.journalEntry && (
        <div className="rounded-lg border overflow-hidden">
          <div className="p-4 border-b bg-muted/30">
            <p className="font-medium">Journal Entry — {reval.journalEntry.entryNumber}</p>
            <p className="text-xs text-muted-foreground">{reval.journalEntry.description}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Account</th>
                <th className="text-left p-3 font-medium">Description</th>
                <th className="text-right p-3 font-medium">Debit (₦)</th>
                <th className="text-right p-3 font-medium">Credit (₦)</th>
              </tr>
            </thead>
            <tbody>
              {reval.journalEntry.lines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{l.account.code}</td>
                  <td className="p-3 text-muted-foreground">{l.description ?? l.account.name}</td>
                  <td className="p-3 text-right">{Number(l.debit) > 0 ? formatCurrency(Number(l.debit)) : ""}</td>
                  <td className="p-3 text-right">{Number(l.credit) > 0 ? formatCurrency(Number(l.credit)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reval.notes && (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Notes: </span>
          {reval.notes}
        </div>
      )}
    </div>
  );
}
