"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Line {
  code: string;
  name: string;
  type: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export function TrialBalanceExport({ lines, period }: { lines: Line[]; period: string }) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const data = [
      ["Code", "Account Name", "Type", "Total Debits", "Total Credits", "Balance"],
      ...lines.map((l) => [l.code, l.name, l.type, l.totalDebit, l.totalCredit, l.balance]),
      [],
      [
        "TOTAL",
        "",
        "",
        lines.reduce((s, l) => s + l.totalDebit, 0),
        lines.reduce((s, l) => s + l.totalCredit, 0),
        "",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 36 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trial Balance");
    XLSX.writeFile(wb, "trial-balance-" + (period || "all") + ".xlsx");
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
