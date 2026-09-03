import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient | typeof prisma;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface ArAdjustmentRow {
  posted: unknown;
  receiptConsumed: unknown;
  creditConsumed: unknown;
  creditNoteConsumed: unknown;
}

/** Active unrealised AR adjustment still embedded in one invoice's GL carrying value. */
export async function getActiveArFxAdjustment(
  db: DbClient,
  tenantId: string,
  invoiceId: string,
): Promise<number> {
  const rows = await db.$queryRaw<ArAdjustmentRow[]>`
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
      ), 0) AS "receiptConsumed",
      COALESCE((
        SELECT SUM(cca."fx_unrealized_consumed")
        FROM "customer_credit_applications" cca
        WHERE cca."invoice_id" = ${invoiceId}
          AND cca."tenant_id" = ${tenantId}::uuid
          AND cca."status" = 'POSTED'
      ), 0) AS "creditConsumed",
      COALESCE((
        SELECT SUM(cn."fx_unrealized_consumed")
        FROM "credit_notes" cn
        WHERE cn."invoice_id" = ${invoiceId}
          AND cn."tenant_id" = ${tenantId}::uuid
          AND cn."status" = 'APPLIED'::"CreditNoteStatus"
      ), 0) AS "creditNoteConsumed"
  `;
  return roundMoney(
    Number(rows[0]?.posted ?? 0)
      - Number(rows[0]?.receiptConsumed ?? 0)
      - Number(rows[0]?.creditConsumed ?? 0)
      - Number(rows[0]?.creditNoteConsumed ?? 0),
  );
}

/** Active unrealised AP adjustment still embedded in one bill's GL carrying value. */
export async function getActiveApFxAdjustment(
  db: DbClient,
  tenantId: string,
  billId: string,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ posted: unknown; paymentConsumed: unknown; creditConsumed: unknown }>>`
    SELECT
      COALESCE((
        SELECT SUM(fri."adjustment_base_amount")
        FROM "fx_revaluation_items" fri
        INNER JOIN "fx_revaluations" fr ON fr."id" = fri."fx_revaluation_id"
        WHERE fri."tenant_id" = ${tenantId}::uuid
          AND fri."item_type" = 'AP'
          AND fri."bill_id" = ${billId}
          AND fr."status" = 'POSTED'::fx_revaluation_status
      ), 0) AS "posted",
      COALESCE((
        SELECT SUM(vpa."fx_unrealized_consumed")
        FROM "vendor_payment_allocations" vpa
        INNER JOIN "vendor_payments" vp ON vp."id" = vpa."payment_id"
        WHERE vpa."bill_id" = ${billId}
          AND vpa."tenant_id" = ${tenantId}::uuid
          AND vp."tenant_id" = ${tenantId}::uuid
          AND vp."status" = 'POSTED'
      ), 0) AS "paymentConsumed",
      COALESCE((
        SELECT SUM(vca."fx_unrealized_consumed")
        FROM "vendor_credit_applications" vca
        WHERE vca."bill_id" = ${billId}
          AND vca."tenant_id" = ${tenantId}::uuid
          AND vca."status" = 'POSTED'
      ), 0) AS "creditConsumed"
  `;
  return roundMoney(
    Number(rows[0]?.posted ?? 0)
      - Number(rows[0]?.paymentConsumed ?? 0)
      - Number(rows[0]?.creditConsumed ?? 0),
  );
}

/** Active unrealised FX adjustment still embedded in one open customer-credit liability. */
export async function getActiveCustomerCreditFxAdjustment(
  db: DbClient,
  tenantId: string,
  customerCreditId: string,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{
    posted: unknown;
    applicationConsumed: unknown;
    refundConsumed: unknown;
  }>>`
    SELECT
      COALESCE((
        SELECT SUM(fri."adjustment_base_amount")
        FROM "fx_revaluation_items" fri
        INNER JOIN "fx_revaluations" fr ON fr."id" = fri."fx_revaluation_id"
        WHERE fri."tenant_id" = ${tenantId}::uuid
          AND fri."item_type" = 'CUSTOMER_CREDIT'
          AND fri."customer_credit_id" = ${customerCreditId}
          AND fr."status" = 'POSTED'::fx_revaluation_status
      ), 0) AS "posted",
      COALESCE((
        SELECT SUM(cca."credit_fx_unrealized_consumed")
        FROM "customer_credit_applications" cca
        WHERE cca."customer_credit_id" = ${customerCreditId}
          AND cca."tenant_id" = ${tenantId}::uuid
          AND cca."status" = 'POSTED'
      ), 0) AS "applicationConsumed",
      COALESCE((
        SELECT SUM(ccr."credit_fx_unrealized_consumed")
        FROM "customer_credit_refunds" ccr
        WHERE ccr."customer_credit_id" = ${customerCreditId}
          AND ccr."tenant_id" = ${tenantId}::uuid
          AND ccr."status" = 'POSTED'
      ), 0) AS "refundConsumed"
  `;

  return roundMoney(
    Number(rows[0]?.posted ?? 0)
      - Number(rows[0]?.applicationConsumed ?? 0)
      - Number(rows[0]?.refundConsumed ?? 0),
  );
}

export function consumeFxAdjustment(activeAdjustment: number, allocation: number, preAllocationBalance: number) {
  if (preAllocationBalance <= 0) throw new Error("Open-item balance must be positive before FX settlement.");
  if (allocation <= 0) throw new Error("Settlement allocation must be positive.");
  if (allocation - preAllocationBalance > 0.01) throw new Error("Settlement allocation exceeds the open-item balance.");
  if (Math.abs(allocation - preAllocationBalance) <= 0.01) return roundMoney(activeAdjustment);
  return roundMoney(activeAdjustment * allocation / preAllocationBalance);
}
