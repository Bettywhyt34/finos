"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Row {
  entryDate: Date;
  entryNumber: string;
  description: string;
  reference: string | null;
  source: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export function GeneralLedgerExport({
  rows,
  accountCode,
  accountName,
}: {
  rows: Row[];
  accountCode: string;
  accountName: string;
}) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const data = [
      [accountCode + " — " + accountName],
      [],
      ["Date", "Entry #", "Description", "Reference", "Source", "Debit", "Credit", "Balance"],
      ...rows.map((r) => [
        new Date(r.entryDate).toLocaleDateString("en-NG"),
        r.entryNumber,
        r.description,
        r.reference ?? "",
        r.source,
        r.debit,
        r.credit,
        r.runningBalance,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [
      { wch: 12 }, { wch: 12 }, { wch: 36 }, { wch: 16 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, accountCode);
    XLSX.writeFile(wb, "gl-" + accountCode + ".xlsx");
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
