"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface BvaRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number | null;
}

interface BvaExportProps {
  rows: BvaRow[];
  periodFrom: string;
  periodTo: string;
  budgetName: string;
  versionLabel: string;
}

export function BvaExport({
  rows,
  periodFrom,
  periodTo,
  budgetName,
  versionLabel,
}: BvaExportProps) {
  async function handleExport() {
    const xlsx = await import("xlsx");
    const data: (string | number | null)[][] = [
      ["Budget vs Actual Report"],
      ["Budget: " + budgetName + " — Version: " + versionLabel],
      ["Period: " + periodFrom + " to " + periodTo],
      [],
      ["Account Code", "Account Name", "Type", "Budget", "Actual", "Variance", "Variance %"],
      ...rows.map((r) => [
        r.code,
        r.name,
        r.type,
        r.budget,
        r.actual,
        r.variance,
        r.variancePct !== null ? r.variancePct / 100 : null,
      ]),
    ];
    const ws = xlsx.utils.aoa_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Budget vs Actual");
    xlsx.writeFile(wb, "budget-vs-actual-" + periodFrom + "-" + periodTo + ".xlsx");
  }

  return (
    <Button variant="outline" onClick={handleExport} className="flex items-center gap-2">
      <Download className="h-4 w-4" />
      Export Excel
    </Button>
  );
}
