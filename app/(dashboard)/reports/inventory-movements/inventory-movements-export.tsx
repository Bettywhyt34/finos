"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Movement = {
  id:           string;
  createdAt:    Date;
  movementType: string;
  channel:      string;
  quantity:     unknown;
  unitCost?:    unknown;
  reference?:   string | null;
  sourceApp?:   string | null;
  notes?:       string | null;
  item: {
    itemCode: string;
    name:     string;
  };
};

const MOVEMENT_LABELS: Record<string, string> = {
  SALE_ONLINE: "Sale (Online)",
  SALE_POS:    "Sale (POS)",
  RECEIPT:     "Stock Receipt",
  ADJUSTMENT:  "Adjustment",
  RESERVATION: "Reservation",
  RELEASE:     "Release",
};

export function InventoryMovementsExport({ movements }: { movements: Movement[] }) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const xlsx = await import("xlsx");
      const rows = movements.map((m) => ({
        Date:        new Date(m.createdAt).toLocaleDateString("en-NG"),
        SKU:         m.item.itemCode,
        Item:        m.item.name,
        Type:        MOVEMENT_LABELS[m.movementType] ?? m.movementType,
        Channel:     m.channel,
        Quantity:    Number(m.quantity),
        "Unit Cost": m.unitCost != null ? Number(m.unitCost) : "",
        Reference:   m.reference ?? "",
        Source:      m.sourceApp ?? "",
        Notes:       m.notes ?? "",
      }));

      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, "Movements");

      const date = new Date().toISOString().slice(0, 10);
      xlsx.writeFile(wb, `inventory-movements-${date}.xlsx`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
      {loading ? (
        <Loader2 size={14} className="mr-1 animate-spin" />
      ) : (
        <Download size={14} className="mr-1" />
      )}
      Export Excel
    </Button>
  );
}
