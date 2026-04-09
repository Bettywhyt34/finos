import fs from "fs";
import path from "path";

const root = process.cwd();

// ─── List Page ────────────────────────────────────────────────────────────────
const listDir = path.join(root, "app", "(dashboard)", "accounting", "fx-revaluation");
fs.mkdirSync(listDir, { recursive: true });

const listPage = `import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CURRENCY_SYMBOLS } from "@/lib/fx";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  POSTED: "bg-green-100 text-green-700",
  REVERSED: "bg-red-100 text-red-700",
};

export default async function FxRevaluationPage() {
  const session = await getServerSession(authOptions);
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  const revaluations = await prisma.fxRevaluation.findMany({
    where: { organizationId: orgId },
    orderBy: [{ period: "desc" }, { currency: "asc" }],
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">FX Revaluation</h1>
          <p className="text-sm text-muted-foreground">
            Month-end unrealised foreign exchange gains and losses
          </p>
        </div>
        <Link href="/accounting/fx-revaluation/new" className={buttonVariants()}>
          New Revaluation
        </Link>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Period</th>
              <th className="text-left p-3 font-medium">Currency</th>
              <th className="text-right p-3 font-medium">Rate</th>
              <th className="text-right p-3 font-medium">AR Exposure</th>
              <th className="text-right p-3 font-medium">AP Exposure</th>
              <th className="text-right p-3 font-medium">AR Gain/Loss</th>
              <th className="text-right p-3 font-medium">AP Gain/Loss</th>
              <th className="text-right p-3 font-medium">Net</th>
              <th className="text-left p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {revaluations.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  No revaluations yet. Run your first month-end revaluation to recognise unrealised FX gains/losses.
                </td>
              </tr>
            )}
            {revaluations.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="p-3">
                  <Link
                    href={"/accounting/fx-revaluation/" + r.id}
                    className="font-medium hover:underline"
                  >
                    {r.period}
                  </Link>
                </td>
                <td className="p-3 font-medium">
                  {r.currency} {CURRENCY_SYMBOLS[r.currency] ?? ""}
                </td>
                <td className="p-3 text-right text-muted-foreground">
                  {Number(r.closingRate).toFixed(4)}
                </td>
                <td className="p-3 text-right">
                  {r.currency}&nbsp;
                  {Number(r.arExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                </td>
                <td className="p-3 text-right">
                  {r.currency}&nbsp;
                  {Number(r.apExposure).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                </td>
                <td
                  className={
                    "p-3 text-right " +
                    (Number(r.arGainLoss) >= 0 ? "text-green-600" : "text-red-600")
                  }
                >
                  {formatCurrency(Number(r.arGainLoss))}
                </td>
                <td
                  className={
                    "p-3 text-right " +
                    (Number(r.apGainLoss) >= 0 ? "text-green-600" : "text-red-600")
                  }
                >
                  {formatCurrency(Number(r.apGainLoss))}
                </td>
                <td
                  className={
                    "p-3 text-right font-semibold " +
                    (Number(r.unrealizedGainLoss) >= 0 ? "text-green-600" : "text-red-600")
                  }
                >
                  {formatCurrency(Number(r.unrealizedGainLoss))}
                </td>
                <td className="p-3">
                  <span
                    className={
                      "px-2 py-0.5 rounded text-xs font-medium " + STATUS_COLORS[r.status]
                    }
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(listDir, "page.tsx"), listPage);
console.log("Written: accounting/fx-revaluation/page.tsx");

// ─── New Revaluation Page ─────────────────────────────────────────────────────
const newDir = path.join(listDir, "new");
fs.mkdirSync(newDir, { recursive: true });

const newPage = `import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { RevaluationForm } from "./revaluation-form";

export default async function NewRevaluationPage() {
  const session = await getServerSession(authOptions);
  const orgId = session?.user?.organizationId;
  if (!orgId) return null;

  // Load FX-eligible account codes for the gain/loss selectors
  const accounts = await prisma.chartOfAccounts.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      type: { in: ["INCOME", "EXPENSE"] },
    },
    select: { code: true, name: true, type: true },
    orderBy: { code: "asc" },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New FX Revaluation</h1>
        <p className="text-sm text-muted-foreground">
          Revalue outstanding foreign-currency AR and AP balances at the period-end closing rate.
        </p>
      </div>
      <RevaluationForm orgId={orgId} accounts={accounts} />
    </div>
  );
}
`;

fs.writeFileSync(path.join(newDir, "page.tsx"), newPage);
console.log("Written: accounting/fx-revaluation/new/page.tsx");

// ─── Revaluation Form (client) ────────────────────────────────────────────────
const revalForm = `"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as Select from "@base-ui-components/react/select";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { formatCurrency, getRecognitionPeriod } from "@/lib/utils";
import { calculateFXExposure, postFXRevaluation } from "../actions";
import type { FXExposureResult } from "../actions";
import { toast } from "sonner";

interface Account {
  code: string;
  name: string;
  type: string;
}

interface Props {
  orgId: string;
  accounts: Account[];
}

export function RevaluationForm({ orgId, accounts }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const today = new Date().toISOString().split("T")[0];
  const currentPeriod = getRecognitionPeriod();

  const [period, setPeriod] = useState(currentPeriod);
  const [currency, setCurrency] = useState("USD");
  const [revalDate, setRevalDate] = useState(today);
  const [closingRate, setClosingRate] = useState("");
  const [openingRate, setOpeningRate] = useState("1");
  const [fxGainCode, setFxGainCode] = useState("");
  const [fxLossCode, setFxLossCode] = useState("");
  const [notes, setNotes] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [exposure, setExposure] = useState<FXExposureResult | null>(null);

  const foreignCurrencies = SUPPORTED_CURRENCIES.filter((c) => c !== "NGN");
  const incomeAccounts = accounts.filter((a) => a.type === "INCOME");
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");

  async function fetchRate() {
    if (!currency) return;
    setIsFetching(true);
    try {
      const res = await fetch(
        "https://api.frankfurter.app/latest?from=" + currency + "&to=NGN"
      );
      const json = await res.json();
      const rate = json?.rates?.NGN;
      if (rate) {
        setClosingRate(String(rate));
        toast.success("Rate fetched: 1 " + currency + " = ₦" + rate.toLocaleString("en-NG", { minimumFractionDigits: 4 }));
      } else {
        toast.error("Rate not available");
      }
    } catch {
      toast.error("Failed to fetch rate");
    } finally {
      setIsFetching(false);
    }
  }

  async function handleCalculate() {
    if (!closingRate || isNaN(Number(closingRate))) {
      toast.error("Enter a valid closing rate first");
      return;
    }
    setIsCalculating(true);
    try {
      const result = await calculateFXExposure(orgId, currency, Number(closingRate));
      setExposure(result);
      if (result.arItems.length === 0 && result.apItems.length === 0) {
        toast.info("No outstanding " + currency + " invoices or bills found");
      }
    } catch (err) {
      toast.error("Calculation failed");
    } finally {
      setIsCalculating(false);
    }
  }

  function handlePost() {
    if (!exposure) { toast.error("Calculate exposure first"); return; }
    if (!fxGainCode) { toast.error("Select FX Gain account"); return; }
    if (!fxLossCode) { toast.error("Select FX Loss account"); return; }

    startTransition(async () => {
      const result = await postFXRevaluation({
        period,
        currency,
        revaluationDate: revalDate,
        openingRate: Number(openingRate),
        closingRate: Number(closingRate),
        arExposure: exposure.arExposure,
        apExposure: exposure.apExposure,
        arBookedNGN: exposure.arBookedNGN,
        apBookedNGN: exposure.apBookedNGN,
        arCurrentNGN: exposure.arCurrentNGN,
        apCurrentNGN: exposure.apCurrentNGN,
        arGainLoss: exposure.arGainLoss,
        apGainLoss: exposure.apGainLoss,
        unrealizedGainLoss: exposure.unrealizedGainLoss,
        fxGainAccountCode: fxGainCode,
        fxLossAccountCode: fxLossCode,
        notes,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("FX revaluation posted");
        router.push("/accounting/fx-revaluation/" + result.id);
      }
    });
  }

  const gl = exposure?.unrealizedGainLoss ?? 0;

  return (
    <div className="space-y-6">
      {/* Step 1: Parameters */}
      <div className="rounded-lg border p-5 space-y-4">
        <h2 className="font-semibold text-base">1. Revaluation Parameters</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Period</Label>
            <Input
              type="month"
              value={period}
              onChange={(e) => { setPeriod(e.target.value); setExposure(null); }}
            />
          </div>
          <div className="space-y-1">
            <Label>Date</Label>
            <Input
              type="date"
              value={revalDate}
              onChange={(e) => setRevalDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Foreign Currency</Label>
            <Select.Root
              value={currency}
              onValueChange={(v) => { setCurrency(v ?? "USD"); setExposure(null); setClosingRate(""); }}
            >
              <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                <Select.Value />
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner>
                  <Select.Popup className="z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover shadow-md">
                    <Select.Viewport className="p-1">
                      {foreignCurrencies.map((c) => (
                        <Select.Option
                          key={c}
                          value={c}
                          className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                        >
                          <Select.OptionText>{c}</Select.OptionText>
                        </Select.Option>
                      ))}
                    </Select.Viewport>
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          </div>
          <div className="space-y-1">
            <Label>Opening Rate (1 {currency} = ₦)</Label>
            <Input
              type="number"
              step="0.0001"
              placeholder="1.0000"
              value={openingRate}
              onChange={(e) => setOpeningRate(e.target.value)}
            />
          </div>
        </div>

        {/* Closing Rate */}
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <Label>Closing Rate (1 {currency} = ₦)</Label>
            <Input
              type="number"
              step="0.0001"
              placeholder="e.g. 1620.50"
              value={closingRate}
              onChange={(e) => { setClosingRate(e.target.value); setExposure(null); }}
            />
          </div>
          <Button type="button" variant="outline" onClick={fetchRate} disabled={isFetching}>
            {isFetching ? "Fetching..." : "Fetch Live Rate"}
          </Button>
          <Button type="button" onClick={handleCalculate} disabled={isCalculating || !closingRate}>
            {isCalculating ? "Calculating..." : "Calculate Exposure"}
          </Button>
        </div>
      </div>

      {/* Step 2: Exposure Results */}
      {exposure && (
        <div className="rounded-lg border p-5 space-y-4">
          <h2 className="font-semibold text-base">2. Exposure Summary — {exposure.currency}</h2>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">AR Exposure ({currency})</p>
              <p className="font-semibold">{currency} {exposure.arExposure.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">AP Exposure ({currency})</p>
              <p className="font-semibold">{currency} {exposure.apExposure.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">AR Gain/Loss (₦)</p>
              <p className={"font-semibold " + (exposure.arGainLoss >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(exposure.arGainLoss)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">AP Gain/Loss (₦)</p>
              <p className={"font-semibold " + (exposure.apGainLoss >= 0 ? "text-green-600" : "text-red-600")}>
                {formatCurrency(exposure.apGainLoss)}
              </p>
            </div>
          </div>

          <div className={"rounded-lg p-4 text-center " + (gl >= 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200")}>
            <p className="text-sm font-medium mb-1">
              Net Unrealised {gl >= 0 ? "Gain" : "Loss"}
            </p>
            <p className={"text-2xl font-bold " + (gl >= 0 ? "text-green-700" : "text-red-700")}>
              {formatCurrency(Math.abs(gl))}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Closing rate {Number(closingRate).toFixed(4)} vs opening {Number(openingRate).toFixed(4)}
            </p>
          </div>

          {/* AR detail */}
          {exposure.arItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">AR Detail</h3>
              <table className="w-full text-xs border rounded overflow-hidden">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Invoice</th>
                    <th className="text-left p-2">Customer</th>
                    <th className="text-right p-2">Balance ({currency})</th>
                    <th className="text-right p-2">Original Rate</th>
                    <th className="text-right p-2">Booked NGN</th>
                    <th className="text-right p-2">Current NGN</th>
                    <th className="text-right p-2">Gain/Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.arItems.map((item) => {
                    const currentNGN = item.foreignBalance * Number(closingRate);
                    const gl = currentNGN - item.bookedNGN;
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="p-2">{item.invoiceNumber}</td>
                        <td className="p-2">{item.customerName}</td>
                        <td className="p-2 text-right">{item.foreignBalance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                        <td className="p-2 text-right">{item.originalRate.toFixed(4)}</td>
                        <td className="p-2 text-right">{formatCurrency(item.bookedNGN)}</td>
                        <td className="p-2 text-right">{formatCurrency(currentNGN)}</td>
                        <td className={"p-2 text-right " + (gl >= 0 ? "text-green-600" : "text-red-600")}>
                          {formatCurrency(gl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* AP detail */}
          {exposure.apItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">AP Detail</h3>
              <table className="w-full text-xs border rounded overflow-hidden">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Bill</th>
                    <th className="text-left p-2">Vendor</th>
                    <th className="text-right p-2">Balance ({currency})</th>
                    <th className="text-right p-2">Original Rate</th>
                    <th className="text-right p-2">Booked NGN</th>
                    <th className="text-right p-2">Current NGN</th>
                    <th className="text-right p-2">Gain/Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.apItems.map((item) => {
                    const currentNGN = item.foreignBalance * Number(closingRate);
                    const gl = item.bookedNGN - currentNGN;
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="p-2">{item.billNumber}</td>
                        <td className="p-2">{item.vendorName}</td>
                        <td className="p-2 text-right">{item.foreignBalance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
                        <td className="p-2 text-right">{item.originalRate.toFixed(4)}</td>
                        <td className="p-2 text-right">{formatCurrency(item.bookedNGN)}</td>
                        <td className="p-2 text-right">{formatCurrency(currentNGN)}</td>
                        <td className={"p-2 text-right " + (gl >= 0 ? "text-green-600" : "text-red-600")}>
                          {formatCurrency(gl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Step 3: GL Accounts */}
      {exposure && (
        <div className="rounded-lg border p-5 space-y-4">
          <h2 className="font-semibold text-base">3. Journal Account Codes</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>FX Gain Account (Income)</Label>
              <Select.Root value={fxGainCode} onValueChange={(v) => setFxGainCode(v ?? "")}>
                <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <Select.Value placeholder="Select income account" />
                </Select.Trigger>
                <Select.Portal>
                  <Select.Positioner>
                    <Select.Popup className="z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover shadow-md">
                      <Select.Viewport className="p-1 max-h-48 overflow-y-auto">
                        {incomeAccounts.map((a) => (
                          <Select.Option
                            key={a.code}
                            value={a.code}
                            className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                          >
                            <Select.OptionText>{a.code} — {a.name}</Select.OptionText>
                          </Select.Option>
                        ))}
                      </Select.Viewport>
                    </Select.Popup>
                  </Select.Positioner>
                </Select.Portal>
              </Select.Root>
            </div>
            <div className="space-y-1">
              <Label>FX Loss Account (Expense)</Label>
              <Select.Root value={fxLossCode} onValueChange={(v) => setFxLossCode(v ?? "")}>
                <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <Select.Value placeholder="Select expense account" />
                </Select.Trigger>
                <Select.Portal>
                  <Select.Positioner>
                    <Select.Popup className="z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover shadow-md">
                      <Select.Viewport className="p-1 max-h-48 overflow-y-auto">
                        {expenseAccounts.map((a) => (
                          <Select.Option
                            key={a.code}
                            value={a.code}
                            className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                          >
                            <Select.OptionText>{a.code} — {a.name}</Select.OptionText>
                          </Select.Option>
                        ))}
                      </Select.Viewport>
                    </Select.Popup>
                  </Select.Positioner>
                </Select.Portal>
              </Select.Root>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. March 2026 USD revaluation" />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        {exposure && (
          <Button type="button" onClick={handlePost} disabled={isPending || !fxGainCode || !fxLossCode}>
            {isPending ? "Posting..." : "Post Revaluation"}
          </Button>
        )}
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(newDir, "revaluation-form.tsx"), revalForm);
console.log("Written: accounting/fx-revaluation/new/revaluation-form.tsx");

// ─── Detail Page ──────────────────────────────────────────────────────────────
const idDir = path.join(listDir, "[id]");
fs.mkdirSync(idDir, { recursive: true });

const detailPage = `import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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
  const session = await getServerSession(authOptions);
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
`;

fs.writeFileSync(path.join(idDir, "page.tsx"), detailPage);
console.log("Written: accounting/fx-revaluation/[id]/page.tsx");

// Reverse button (client component)
const reverseButton = `"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reverseFXRevaluation } from "../actions";
import { toast } from "sonner";

export function ReverseButton({ revalId }: { revalId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleReverse() {
    if (!confirm("Post a reversing journal entry for this revaluation?")) return;
    startTransition(async () => {
      const result = await reverseFXRevaluation(revalId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Revaluation reversed");
        router.refresh();
      }
    });
  }

  return (
    <Button type="button" variant="outline" onClick={handleReverse} disabled={isPending}>
      {isPending ? "Reversing..." : "Reverse"}
    </Button>
  );
}
`;

fs.writeFileSync(path.join(idDir, "reverse-button.tsx"), reverseButton);
console.log("Written: accounting/fx-revaluation/[id]/reverse-button.tsx");

console.log("\nAll FX Revaluation pages written successfully.");
