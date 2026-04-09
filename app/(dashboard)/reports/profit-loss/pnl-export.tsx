"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface AccountBalance { code: string; name: string; balance: number; }

export function PnLExport({
  currentIncome, currentExpense, totalRevenue, totalExpenses, netProfit, periodFrom, periodTo,
}: {
  currentIncome: AccountBalance[];
  currentExpense: AccountBalance[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  periodFrom: string;
  periodTo: string;
}) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const rows: (string | number)[][] = [
      ["PROFIT & LOSS STATEMENT"],
      ["Period: " + periodFrom + " to " + periodTo],
      [],
      ["REVENUE"],
      ["Code", "Account", "Amount"],
      ...currentIncome.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Total Revenue", totalRevenue],
      [],
      ["EXPENSES"],
      ["Code", "Account", "Amount"],
      ...currentExpense.filter((b) => b.balance !== 0).map((b) => [b.code, b.name, b.balance]),
      ["", "Total Expenses", totalExpenses],
      [],
      ["", "NET PROFIT / (LOSS)", netProfit],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "P&L");
    XLSX.writeFile(wb, "pnl-" + periodFrom + "-" + periodTo + ".xlsx");
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
