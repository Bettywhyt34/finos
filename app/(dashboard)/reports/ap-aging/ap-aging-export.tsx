"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export type ApAgingRow = {
  vendorName: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
};

export function ApAgingExport({
  rows,
  totals,
  asOf,
}: {
  rows: ApAgingRow[];
  totals: Omit<ApAgingRow, "vendorName">;
  asOf: string;
}) {
  async function handleExport() {
    const XLSX = (await import("xlsx")).default;
    const data: (string | number)[][] = [
      ["AP AGING REPORT"],
      ["As of: " + asOf],
      [],
      ["Vendor", "Current", "1–30 days", "31–60 days", "61–90 days", "90+ days", "Total (NGN)"],
      ...rows.map((r) => [
        r.vendorName,
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
    XLSX.utils.book_append_sheet(wb, ws, "AP Aging");
    XLSX.writeFile(wb, `ap-aging-${asOf.replace(/\s/g, "-")}.xlsx`);
  }

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      <Download size={14} className="mr-2" />
      Export Excel
    </Button>
  );
}
