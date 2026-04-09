"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface B { code: string; name: string; balance: number; }

export function BalanceSheetExport({
  assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, cumulativeProfit, asOf,
}: {
  assets: B[]; liabilities: B[]; equity: B[];
  totalAssets: number; totalLiabilities: number; totalEquity: number;
  cumulativeProfit: number; asOf: string;
}) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const rows: (string | number)[][] = [
      ["BALANCE SHEET — As of " + asOf],
      [],
      ["ASSETS"],
      ["Code", "Account", "Balance"],
      ...assets.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Total Assets", totalAssets],
      [],
      ["LIABILITIES"],
      ...liabilities.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Total Liabilities", totalLiabilities],
      [],
      ["EQUITY"],
      ...equity.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Retained Earnings", cumulativeProfit],
      ["", "Total Equity", totalEquity + cumulativeProfit],
      [],
      ["", "Total Liabilities + Equity", totalLiabilities + totalEquity + cumulativeProfit],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Balance Sheet");
    XLSX.writeFile(wb, "balance-sheet-" + asOf + ".xlsx");
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
