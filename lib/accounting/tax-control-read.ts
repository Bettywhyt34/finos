import "server-only";

import { prisma } from "@/lib/prisma";
import type { SystemAccountRole } from "@/lib/accounting/system-accounts";

interface MappingRow {
  role: string;
  accountId: string;
  code: string;
  name: string;
  type: string;
}

export interface TaxControlBalance {
  role: SystemAccountRole;
  label: string;
  configured: boolean;
  accountId: string | null;
  code: string | null;
  name: string | null;
  balance: number;
  normalSide: "DEBIT" | "CREDIT";
}

export interface TaxSettlementHistoryRow {
  id: string;
  taxType: "VAT" | "WHT";
  taxPeriod: string;
  settlementDate: Date;
  inputVatApplied: number;
  cashPaid: number;
  whtAmount: number;
  reference: string | null;
  notes: string | null;
  journalEntryId: string;
  status: "POSTED" | "REVERSED";
  createdAt: Date;
  reversalReason: string | null;
}

const CONTROL_DEFS: Array<{
  role: SystemAccountRole;
  label: string;
  normalSide: "DEBIT" | "CREDIT";
  legacyCode?: string;
}> = [
  { role: "OUTPUT_VAT", label: "Output VAT Payable", normalSide: "CREDIT", legacyCode: "CL-003" },
  { role: "INPUT_VAT", label: "Input VAT Recoverable", normalSide: "DEBIT" },
  { role: "WHT_PAYABLE", label: "Supplier WHT Payable", normalSide: "CREDIT", legacyCode: "CL-002" },
  { role: "WHT_RECEIVABLE", label: "Customer WHT Receivable", normalSide: "DEBIT" },
];

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function getTaxControlSnapshot(tenantId: string, asOfDate: Date) {
  const mappings = await prisma.$queryRaw<MappingRow[]>`
    SELECT
      sam."role",
      coa."id" AS "accountId",
      coa."code",
      coa."name",
      coa."type"::text AS "type"
    FROM "system_account_mappings" sam
    INNER JOIN "chart_of_accounts" coa
      ON coa."id" = sam."account_id"
     AND coa."tenant_id" = sam."tenant_id"
    WHERE sam."tenant_id" = ${tenantId}::uuid
      AND coa."is_active" = true
  `;
  const mappedByRole = new Map(mappings.map((row) => [row.role, row]));

  // Preserve only the two legacy liability fallbacks already used by posting.
  // New asset roles must be explicitly configured.
  for (const def of CONTROL_DEFS) {
    if (mappedByRole.has(def.role) || !def.legacyCode) continue;
    const account = await prisma.chartOfAccounts.findFirst({
      where: { tenantId, code: def.legacyCode, isActive: true },
      select: { id: true, code: true, name: true, type: true },
    });
    if (account) {
      mappedByRole.set(def.role, {
        role: def.role,
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
      });
    }
  }

  const accountIds = Array.from(
    new Set(CONTROL_DEFS.map((def) => mappedByRole.get(def.role)?.accountId).filter(Boolean) as string[]),
  );

  const balanceRows = accountIds.length
    ? await prisma.journalEntryLine.groupBy({
        by: ["accountId"],
        where: {
          accountId: { in: accountIds },
          entry: {
            tenantId,
            isLocked: true,
            entryDate: { lte: asOfDate },
          },
        },
        _sum: { debit: true, credit: true },
      })
    : [];

  const balanceByAccount = new Map(
    balanceRows.map((row) => [
      row.accountId,
      { debit: Number(row._sum.debit ?? 0), credit: Number(row._sum.credit ?? 0) },
    ]),
  );

  const controls: TaxControlBalance[] = CONTROL_DEFS.map((def) => {
    const mapping = mappedByRole.get(def.role);
    if (!mapping) {
      return {
        role: def.role,
        label: def.label,
        configured: false,
        accountId: null,
        code: null,
        name: null,
        balance: 0,
        normalSide: def.normalSide,
      };
    }
    const totals = balanceByAccount.get(mapping.accountId) ?? { debit: 0, credit: 0 };
    const balance = def.normalSide === "DEBIT"
      ? totals.debit - totals.credit
      : totals.credit - totals.debit;
    return {
      role: def.role,
      label: def.label,
      configured: true,
      accountId: mapping.accountId,
      code: mapping.code,
      name: mapping.name,
      balance: roundMoney(balance),
      normalSide: def.normalSide,
    };
  });

  const byRole = new Map(controls.map((control) => [control.role, control]));
  const outputVatPayable = Math.max(0, byRole.get("OUTPUT_VAT")?.balance ?? 0);
  const inputVatRecoverable = Math.max(0, byRole.get("INPUT_VAT")?.balance ?? 0);
  const maxInputVatApplicable = roundMoney(Math.min(outputVatPayable, inputVatRecoverable));

  return {
    asOfDate,
    controls,
    outputVatPayable,
    inputVatRecoverable,
    maxInputVatApplicable,
    netVatCashDue: roundMoney(Math.max(0, outputVatPayable - maxInputVatApplicable)),
    supplierWhtPayable: Math.max(0, byRole.get("WHT_PAYABLE")?.balance ?? 0),
    customerWhtReceivable: Math.max(0, byRole.get("WHT_RECEIVABLE")?.balance ?? 0),
  };
}

export async function getTaxSettlementHistory(
  tenantId: string,
  limit = 100,
): Promise<TaxSettlementHistoryRow[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    taxType: "VAT" | "WHT";
    taxPeriod: string;
    settlementDate: Date;
    inputVatApplied: unknown;
    cashPaid: unknown;
    whtAmount: unknown;
    reference: string | null;
    notes: string | null;
    journalEntryId: string;
    status: "POSTED" | "REVERSED";
    createdAt: Date;
    reversalReason: string | null;
  }>>`
    SELECT
      "id",
      "tax_type" AS "taxType",
      "tax_period" AS "taxPeriod",
      "settlement_date" AS "settlementDate",
      "input_vat_applied" AS "inputVatApplied",
      "cash_paid" AS "cashPaid",
      "wht_amount" AS "whtAmount",
      "reference",
      "notes",
      "journal_entry_id" AS "journalEntryId",
      "status",
      "created_at" AS "createdAt",
      "reversal_reason" AS "reversalReason"
    FROM "tax_settlements"
    WHERE "tenant_id" = ${tenantId}::uuid
    ORDER BY "settlement_date" DESC, "created_at" DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    ...row,
    inputVatApplied: Number(row.inputVatApplied ?? 0),
    cashPaid: Number(row.cashPaid ?? 0),
    whtAmount: Number(row.whtAmount ?? 0),
  }));
}
