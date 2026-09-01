import { prisma } from "@/lib/prisma";

export interface ProjectFinancialMetrics {
  revenueEarned: number;
  invoiced: number;
  costsIncurred: number;
  grossMargin: number;
  contractAsset: number;
  unearnedIncome: number;
}

export interface ProjectRevenueHistory {
  id: string;
  recognitionDate: string;
  amount: number;
  unearnedUsed: number;
  contractAssetCreated: number;
  currency: string;
  status: string;
  note: string | null;
  journalEntryId: string;
  reversedAt: string | null;
  reversalReason: string | null;
}

export interface ProjectCostBreakdownRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  source: string;
  amount: number;
  entryCount: number;
}

interface MetricRow {
  revenueEarned: unknown;
  invoiced: unknown;
  costsIncurred: unknown;
  contractAsset: unknown;
  unearnedIncome: unknown;
}

interface HistoryRow {
  id: string;
  recognitionDate: Date;
  amount: unknown;
  unearnedUsed: unknown;
  contractAssetCreated: unknown;
  currency: string;
  status: string;
  note: string | null;
  journalEntryId: string;
  reversedAt: Date | null;
  reversalReason: string | null;
}

interface CostBreakdownDbRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  source: string | null;
  amount: unknown;
  entryCount: bigint | number;
}

export async function getProjectFinancials(tenantId: string, projectId: string): Promise<{
  metrics: ProjectFinancialMetrics;
  history: ProjectRevenueHistory[];
  costBreakdown: ProjectCostBreakdownRow[];
}> {
  const [metricRows, historyRows, costRows] = await Promise.all([
    prisma.$queryRaw<MetricRow[]>`
      WITH gl AS (
        SELECT
          COALESCE(SUM(CASE WHEN coa."type" = 'INCOME' THEN jel."credit" - jel."debit" ELSE 0 END), 0) AS "revenueEarned",
          COALESCE(SUM(CASE WHEN coa."type" = 'EXPENSE' THEN jel."debit" - jel."credit" ELSE 0 END), 0) AS "costsIncurred"
        FROM "journal_entry_lines" jel
        INNER JOIN "journal_entries" je ON je."id" = jel."journal_entry_id"
        INNER JOIN "chart_of_accounts" coa ON coa."id" = jel."account_id"
        WHERE je."tenant_id" = ${tenantId}::uuid
          AND jel."project_id" = ${projectId}
          AND je."source" IS DISTINCT FROM 'year-end-close'
      ),
      billing AS (
        SELECT
          COALESCE(SUM(ila."invoice_amount"), 0) AS "invoiced",
          COALESCE(SUM(ila."unearned_created"), 0) AS "unearnedCreated",
          COALESCE(SUM(ila."contract_asset_cleared"), 0) AS "contractAssetCleared"
        FROM "invoice_line_revenue_allocations" ila
        INNER JOIN "invoices" i ON i."id" = ila."invoice_id" AND i."tenant_id" = ila."tenant_id"
        WHERE ila."tenant_id" = ${tenantId}::uuid
          AND ila."project_id" = ${projectId}
          AND i."status" <> 'VOIDED'
      ),
      recognition AS (
        SELECT
          COALESCE(SUM(CASE WHEN "status" = 'POSTED' THEN "unearned_used" ELSE 0 END), 0) AS "unearnedUsed",
          COALESCE(SUM(CASE WHEN "status" = 'POSTED' THEN "contract_asset_created" ELSE 0 END), 0) AS "contractAssetCreated"
        FROM "project_revenue_recognitions"
        WHERE "tenant_id" = ${tenantId}::uuid
          AND "project_id" = ${projectId}
      )
      SELECT
        gl."revenueEarned",
        billing."invoiced",
        gl."costsIncurred",
        recognition."contractAssetCreated" - billing."contractAssetCleared" AS "contractAsset",
        billing."unearnedCreated" - recognition."unearnedUsed" AS "unearnedIncome"
      FROM gl CROSS JOIN billing CROSS JOIN recognition
    `,
    prisma.$queryRaw<HistoryRow[]>`
      SELECT
        "id"::text AS "id",
        "recognition_date" AS "recognitionDate",
        "amount",
        "unearned_used" AS "unearnedUsed",
        "contract_asset_created" AS "contractAssetCreated",
        "currency",
        "status",
        "note",
        "journal_entry_id" AS "journalEntryId",
        "reversed_at" AS "reversedAt",
        "reversal_reason" AS "reversalReason"
      FROM "project_revenue_recognitions"
      WHERE "tenant_id" = ${tenantId}::uuid AND "project_id" = ${projectId}
      ORDER BY "recognition_date" DESC, "created_at" DESC
    `,
    prisma.$queryRaw<CostBreakdownDbRow[]>`
      SELECT
        coa."id" AS "accountId",
        coa."code" AS "accountCode",
        coa."name" AS "accountName",
        je."source",
        COALESCE(SUM(jel."debit" - jel."credit"), 0) AS "amount",
        COUNT(DISTINCT je."id") AS "entryCount"
      FROM "journal_entry_lines" jel
      INNER JOIN "journal_entries" je ON je."id" = jel."journal_entry_id"
      INNER JOIN "chart_of_accounts" coa ON coa."id" = jel."account_id"
      WHERE je."tenant_id" = ${tenantId}::uuid
        AND jel."project_id" = ${projectId}
        AND coa."type" = 'EXPENSE'
        AND je."source" IS DISTINCT FROM 'year-end-close'
      GROUP BY coa."id", coa."code", coa."name", je."source"
      HAVING ABS(COALESCE(SUM(jel."debit" - jel."credit"), 0)) > 0.005
      ORDER BY ABS(COALESCE(SUM(jel."debit" - jel."credit"), 0)) DESC, coa."code" ASC
    `,
  ]);

  const row = metricRows[0];
  const revenueEarned = Number(row?.revenueEarned ?? 0);
  const invoiced = Number(row?.invoiced ?? 0);
  const costsIncurred = Number(row?.costsIncurred ?? 0);
  const contractAsset = Number(row?.contractAsset ?? 0);
  const unearnedIncome = Number(row?.unearnedIncome ?? 0);

  return {
    metrics: {
      revenueEarned,
      invoiced,
      costsIncurred,
      grossMargin: revenueEarned - costsIncurred,
      contractAsset,
      unearnedIncome,
    },
    history: historyRows.map((history) => ({
      id: history.id,
      recognitionDate: history.recognitionDate.toISOString().slice(0, 10),
      amount: Number(history.amount),
      unearnedUsed: Number(history.unearnedUsed),
      contractAssetCreated: Number(history.contractAssetCreated),
      currency: history.currency,
      status: history.status,
      note: history.note,
      journalEntryId: history.journalEntryId,
      reversedAt: history.reversedAt?.toISOString() ?? null,
      reversalReason: history.reversalReason,
    })),
    costBreakdown: costRows.map((cost) => ({
      accountId: cost.accountId,
      accountCode: cost.accountCode,
      accountName: cost.accountName,
      source: cost.source?.trim() || "manual",
      amount: Number(cost.amount),
      entryCount: Number(cost.entryCount),
    })),
  };
}
