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

export default async function FxRevaluationDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  const [reval, tenant, customerCreditRows] = await Promise.all([
    prisma.fxRevaluation.findFirst({
      where: { id: params.id, tenantId: orgId },
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
    }),
    prisma.tenant.findUnique({ where: { id: orgId }, select: { currency: true } }),
    prisma.$queryRaw<Array<{
      exposure: unknown;
      booked: unknown;
      current: unknown;
      gainLoss: unknown;
    }>>`
      SELECT COALESCE(SUM(fri."foreign_balance"),0) AS "exposure",
             COALESCE(SUM(fri."carrying_base_amount"),0) AS "booked",
             COALESCE(SUM(fri."target_base_amount"),0) AS "current",
             COALESCE(SUM(-fri."adjustment_base_amount"),0) AS "gainLoss"
      FROM "fx_revaluation_items" fri
      WHERE fri."tenant_id"=${orgId}::uuid
        AND fri."fx_revaluation_id"=${params.id}
        AND fri."item_type"='CUSTOMER_CREDIT'
    `,
  ]);

  if (!reval) notFound();

  const baseCurrency = tenant?.currency.trim().toUpperCase() || "NGN";
  const net = Number(reval.unrealizedGainLoss);
  const sym = CURRENCY_SYMBOLS[reval.currency] ?? reval.currency;
  const creditExposure = Number(customerCreditRows[0]?.exposure ?? 0);
  const creditBooked = Number(customerCreditRows[0]?.booked ?? 0);
  const creditCurrent = Number(customerCreditRows[0]?.current ?? 0);
  const creditGainLoss = Number(customerCreditRows[0]?.gainLoss ?? 0);
  const totalExposure = Number(reval.arExposure) + Number(reval.apExposure) + creditExposure;
  const totalBooked = Number(reval.arBookedNGN) + Number(reval.apBookedNGN) + creditBooked;
  const totalCurrent = Number(reval.arCurrentNGN) + Number(reval.apCurrentNGN) + creditCurrent;
  const base = (value: number) => formatCurrency(value, baseCurrency);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">FX Revaluation — {reval.currency} {sym} / {reval.period}</h1>
            <span className={"px-2 py-0.5 rounded text-xs font-medium " + STATUS_COLORS[reval.status]}>{reval.status}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Revaluation date: {formatDate(reval.revaluationDate)} · Base currency: {baseCurrency}
            {reval.postedBy && " · Posted by " + reval.postedBy}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/accounting/fx-revaluation" className={buttonVariants({ variant: "outline" })}>Back</Link>
          {reval.status === "POSTED" && <ReverseButton revalId={reval.id} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Opening Rate</p>
          <p className="text-lg font-semibold">{Number(reval.openingRate).toFixed(4)}</p>
          <p className="text-xs text-muted-foreground">1 {reval.currency} = {baseCurrency}</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Closing Rate</p>
          <p className="text-lg font-semibold">{Number(reval.closingRate).toFixed(4)}</p>
          <p className="text-xs text-muted-foreground">1 {reval.currency} = {baseCurrency}</p>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Rate Movement</p>
          <p className="text-lg font-semibold">{(((Number(reval.closingRate) - Number(reval.openingRate)) / Number(reval.openingRate)) * 100).toFixed(2)}%</p>
          <p className="text-xs text-muted-foreground">Foreign currency vs {baseCurrency}</p>
        </div>
        <div className={"rounded-lg border p-4 text-center " + (net >= 0 ? "bg-green-50" : "bg-red-50")}>
          <p className="text-xs text-muted-foreground mb-1">Net Unrealised</p>
          <p className={"text-lg font-bold " + (net >= 0 ? "text-green-700" : "text-red-700")}>{base(Math.abs(net))}</p>
          <p className={"text-xs font-medium " + (net >= 0 ? "text-green-600" : "text-red-600")}>{net >= 0 ? "Gain" : "Loss"}</p>
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Component</th>
              <th className="text-right p-3 font-medium">Exposure ({reval.currency})</th>
              <th className="text-right p-3 font-medium">Booked {baseCurrency}</th>
              <th className="text-right p-3 font-medium">Current {baseCurrency}</th>
              <th className="text-right p-3 font-medium">Gain / Loss</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="p-3 font-medium">Accounts Receivable (AR)</td>
              <td className="p-3 text-right">{reval.currency} {Number(reval.arExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
              <td className="p-3 text-right">{base(Number(reval.arBookedNGN))}</td>
              <td className="p-3 text-right">{base(Number(reval.arCurrentNGN))}</td>
              <td className={"p-3 text-right font-medium " + (Number(reval.arGainLoss) >= 0 ? "text-green-600" : "text-red-600")}>{base(Number(reval.arGainLoss))}</td>
            </tr>
            <tr className="border-t">
              <td className="p-3 font-medium">Accounts Payable (AP)</td>
              <td className="p-3 text-right">{reval.currency} {Number(reval.apExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
              <td className="p-3 text-right">{base(Number(reval.apBookedNGN))}</td>
              <td className="p-3 text-right">{base(Number(reval.apCurrentNGN))}</td>
              <td className={"p-3 text-right font-medium " + (Number(reval.apGainLoss) >= 0 ? "text-green-600" : "text-red-600")}>{base(Number(reval.apGainLoss))}</td>
            </tr>
            <tr className="border-t">
              <td className="p-3 font-medium">Customer Credits</td>
              <td className="p-3 text-right">{reval.currency} {creditExposure.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
              <td className="p-3 text-right">{base(creditBooked)}</td>
              <td className="p-3 text-right">{base(creditCurrent)}</td>
              <td className={"p-3 text-right font-medium " + (creditGainLoss >= 0 ? "text-green-600" : "text-red-600")}>{base(creditGainLoss)}</td>
            </tr>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="p-3">Total</td>
              <td className="p-3 text-right">{reval.currency} {totalExposure.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
              <td className="p-3 text-right">{base(totalBooked)}</td>
              <td className="p-3 text-right">{base(totalCurrent)}</td>
              <td className={"p-3 text-right " + (net >= 0 ? "text-green-600" : "text-red-600")}>{base(net)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {reval.journalEntry && (
        <div className="rounded-lg border overflow-hidden">
          <div className="p-4 border-b bg-muted/30">
            <p className="font-medium">Journal Entry — {reval.journalEntry.entryNumber}</p>
            <p className="text-xs text-muted-foreground">{reval.journalEntry.description}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-3 font-medium">Account</th><th className="text-left p-3 font-medium">Description</th><th className="text-right p-3 font-medium">Debit ({baseCurrency})</th><th className="text-right p-3 font-medium">Credit ({baseCurrency})</th></tr></thead>
            <tbody>
              {reval.journalEntry.lines.map((line) => (
                <tr key={line.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{line.account.code}</td>
                  <td className="p-3 text-muted-foreground">{line.description ?? line.account.name}</td>
                  <td className="p-3 text-right">{Number(line.debit) > 0 ? base(Number(line.debit)) : ""}</td>
                  <td className="p-3 text-right">{Number(line.credit) > 0 ? base(Number(line.credit)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reval.notes && <div className="rounded-lg border p-4 text-sm text-muted-foreground"><span className="font-medium text-foreground">Notes: </span>{reval.notes}</div>}
    </div>
  );
}
