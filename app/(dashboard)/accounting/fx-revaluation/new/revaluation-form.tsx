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
      const json = (await res.json()) as { rates?: Record<string, number> };
      const rate = json?.rates?.NGN;
      if (rate) {
        setClosingRate(String(rate));
        toast.success(
          "Rate fetched: 1 " +
            currency +
            " = N" +
            rate.toLocaleString("en-NG", { minimumFractionDigits: 4 })
        );
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
    } catch {
      toast.error("Calculation failed");
    } finally {
      setIsCalculating(false);
    }
  }

  function handlePost() {
    if (!exposure) {
      toast.error("Calculate exposure first");
      return;
    }
    if (!fxGainCode) {
      toast.error("Select FX Gain account");
      return;
    }
    if (!fxLossCode) {
      toast.error("Select FX Loss account");
      return;
    }

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
              onChange={(e) => {
                setPeriod(e.target.value);
                setExposure(null);
              }}
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
            <Select
              value={currency}
              onValueChange={(v) => {
                setCurrency(v ?? "USD");
                setExposure(null);
                setClosingRate("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {foreignCurrencies.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Opening Rate (1 {currency} = N)</Label>
            <Input
              type="number"
              step="0.0001"
              placeholder="1.0000"
              value={openingRate}
              onChange={(e) => setOpeningRate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <Label>Closing Rate (1 {currency} = N)</Label>
            <Input
              type="number"
              step="0.0001"
              placeholder="e.g. 1620.50"
              value={closingRate}
              onChange={(e) => {
                setClosingRate(e.target.value);
                setExposure(null);
              }}
            />
          </div>
          <Button type="button" variant="outline" onClick={fetchRate} disabled={isFetching}>
            {isFetching ? "Fetching..." : "Fetch Live Rate"}
          </Button>
          <Button
            type="button"
            onClick={handleCalculate}
            disabled={isCalculating || !closingRate}
          >
            {isCalculating ? "Calculating..." : "Calculate Exposure"}
          </Button>
        </div>
      </div>

      {/* Step 2: Exposure Results */}
      {exposure && (
        <div className="rounded-lg border p-5 space-y-4">
          <h2 className="font-semibold text-base">
            2. Exposure Summary — {exposure.currency}
          </h2>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">
                AR Exposure ({currency})
              </p>
              <p className="font-semibold">
                {currency}{" "}
                {exposure.arExposure.toLocaleString("en-NG", {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">
                AP Exposure ({currency})
              </p>
              <p className="font-semibold">
                {currency}{" "}
                {exposure.apExposure.toLocaleString("en-NG", {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">AR Gain/Loss (N)</p>
              <p
                className={
                  "font-semibold " +
                  (exposure.arGainLoss >= 0 ? "text-green-600" : "text-red-600")
                }
              >
                {formatCurrency(exposure.arGainLoss)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">AP Gain/Loss (N)</p>
              <p
                className={
                  "font-semibold " +
                  (exposure.apGainLoss >= 0 ? "text-green-600" : "text-red-600")
                }
              >
                {formatCurrency(exposure.apGainLoss)}
              </p>
            </div>
          </div>

          <div
            className={
              "rounded-lg p-4 text-center " +
              (gl >= 0
                ? "bg-green-50 border border-green-200"
                : "bg-red-50 border border-red-200")
            }
          >
            <p className="text-sm font-medium mb-1">
              Net Unrealised {gl >= 0 ? "Gain" : "Loss"}
            </p>
            <p
              className={
                "text-2xl font-bold " + (gl >= 0 ? "text-green-700" : "text-red-700")
              }
            >
              {formatCurrency(Math.abs(gl))}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Closing rate {Number(closingRate).toFixed(4)} vs opening{" "}
              {Number(openingRate).toFixed(4)}
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
                    <th className="text-right p-2">Rate</th>
                    <th className="text-right p-2">Booked NGN</th>
                    <th className="text-right p-2">Current NGN</th>
                    <th className="text-right p-2">Gain/Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.arItems.map((item) => {
                    const currentNGN = item.foreignBalance * Number(closingRate);
                    const itemGl = currentNGN - item.bookedNGN;
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="p-2">{item.invoiceNumber}</td>
                        <td className="p-2">{item.customerName}</td>
                        <td className="p-2 text-right">
                          {item.foreignBalance.toLocaleString("en-NG", {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-2 text-right">
                          {item.originalRate.toFixed(4)}
                        </td>
                        <td className="p-2 text-right">
                          {formatCurrency(item.bookedNGN)}
                        </td>
                        <td className="p-2 text-right">
                          {formatCurrency(currentNGN)}
                        </td>
                        <td
                          className={
                            "p-2 text-right " +
                            (itemGl >= 0 ? "text-green-600" : "text-red-600")
                          }
                        >
                          {formatCurrency(itemGl)}
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
                    <th className="text-right p-2">Rate</th>
                    <th className="text-right p-2">Booked NGN</th>
                    <th className="text-right p-2">Current NGN</th>
                    <th className="text-right p-2">Gain/Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.apItems.map((item) => {
                    const currentNGN = item.foreignBalance * Number(closingRate);
                    const itemGl = item.bookedNGN - currentNGN;
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="p-2">{item.billNumber}</td>
                        <td className="p-2">{item.vendorName}</td>
                        <td className="p-2 text-right">
                          {item.foreignBalance.toLocaleString("en-NG", {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-2 text-right">
                          {item.originalRate.toFixed(4)}
                        </td>
                        <td className="p-2 text-right">
                          {formatCurrency(item.bookedNGN)}
                        </td>
                        <td className="p-2 text-right">
                          {formatCurrency(currentNGN)}
                        </td>
                        <td
                          className={
                            "p-2 text-right " +
                            (itemGl >= 0 ? "text-green-600" : "text-red-600")
                          }
                        >
                          {formatCurrency(itemGl)}
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
              <Select value={fxGainCode} onValueChange={(v) => setFxGainCode(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select income account" />
                </SelectTrigger>
                <SelectContent>
                  {incomeAccounts.map((a) => (
                    <SelectItem key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>FX Loss Account (Expense)</Label>
              <Select value={fxLossCode} onValueChange={(v) => setFxLossCode(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select expense account" />
                </SelectTrigger>
                <SelectContent>
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. March 2026 USD revaluation"
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        {exposure && (
          <Button
            type="button"
            onClick={handlePost}
            disabled={isPending || !fxGainCode || !fxLossCode}
          >
            {isPending ? "Posting..." : "Post Revaluation"}
          </Button>
        )}
      </div>
    </div>
  );
}
