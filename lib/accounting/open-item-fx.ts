import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient | typeof prisma;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface AdjustmentRow { posted: unknown; consumed: unknown; }

/** Active unrealised AR adjustment still embedded in one invoice's GL carrying value. */
export async function getActiveArFxAdjustment(
  db: DbClient,
  tenantId: string,
  invoiceId: string,
): Promise<number> {
  const rows = await db.$queryRaw<AdjustmentRow[]>`
    SELECT
      COALESCE((
        SELECT SUM(fri."adjustment_base_amount")
        FROM "fx_revaluation_items" fri
        INNER JOIN "fx_revaluations" fr ON fr."id" = fri."fx_revaluation_id"
        WHERE fri."tenant_id" = ${tenantId}::uuid
          AND fri."item_type" = 'AR'
          AND fri."invoice_id" = ${invoiceId}
          AND fr."status" = 'POSTED'::fx_revaluation_status
      ), 0) AS "posted",
      COALESCE((
        SELECT SUM(cpa."fx_unrealized_consumed")
        FROM "customer_payment_allocations" cpa
        INNER JOIN "customer_payments" cp ON cp."id" = cpa."payment_id"
        WHERE cpa."invoice_id" = ${invoiceId}
          AND cp."tenant_id" = ${tenantId}::uuid
          AND cp."status" = 'POSTED'::customer_payment_status
      ), 0) AS "consumed"
  `;
  return roundMoney(Number(rows[0]?.posted ?? 0) - Number(rows[0]?.consumed ?? 0));
}

/** Posted AP revaluation adjustment. AP settlement consumption is enabled in Money Out, not Money In. */
export async function getActiveApFxAdjustment(
  db: DbClient,
  tenantId: string,
  billId: string,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ posted: unknown }>>`
    SELECT COALESCE(SUM(fri."adjustment_base_amount"), 0) AS "posted"
    FROM "fx_revaluation_items" fri
    INNER JOIN "fx_revaluations" fr ON fr."id" = fri."fx_revaluation_id"
    WHERE fri."tenant_id" = ${tenantId}::uuid
      AND fri."item_type" = 'AP'
      AND fri."bill_id" = ${billId}
      AND fr."status" = 'POSTED'::fx_revaluation_status
  `;
  return roundMoney(Number(rows[0]?.posted ?? 0));
}

export function consumeFxAdjustment(activeAdjustment: number, allocation: number, preAllocationBalance: number) {
  if (preAllocationBalance <= 0) throw new Error("Open-item balance must be positive before FX settlement.");
  if (allocation <= 0) throw new Error("Settlement allocation must be positive.");
  if (allocation - preAllocationBalance > 0.01) throw new Error("Settlement allocation exceeds the open-item balance.");
  if (Math.abs(allocation - preAllocationBalance) <= 0.01) return roundMoney(activeAdjustment);
  return roundMoney(activeAdjustment * allocation / preAllocationBalance);
}
