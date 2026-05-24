"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export type ArAgingRow = {
  customerName: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
};

export function ArAgingExport({
  rows,
  totals,
  asOf,
}: {
  rows: ArAgingRow[];
  totals: Omit<ArAgingRow, "customerName">;
  asOf: string;
}) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const data: (string | number)[][] = [
      ["AR AGING REPORT"],
      ["As of: " + asOf],
      [],
      ["Customer", "Current", "1–30 days", "31–60 days", "61–90 days", "90+ days", "Total (NGN)"],
      ...rows.map((r) => [
        r.customerName,
        r.current,
        r.d1_30,
        r.d31_60,
        r.d61_90,
        r.d90plus,
        r.total,
      ]),
      [],
      ["TOTAL", totals.current, totals.d1_30, totals.d31_60, totals.d61_90, totals.d90plus, totals.total],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AR Aging");
    XLSX.writeFile(wb, `ar-aging-${asOf.replace(/\s/g, "-")}.xlsx`);
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
