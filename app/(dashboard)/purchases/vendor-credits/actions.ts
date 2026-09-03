"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertPeriodOpenInTransaction, postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";
import { resolveSystemAccount } from "@/lib/accounting/system-accounts";
import { consumeFxAdjustment, getActiveApFxAdjustment } from "@/lib/accounting/open-item-fx";
import { getRecognitionPeriod } from "@/lib/utils";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normaliseTags(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const entries = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? Object.fromEntries(entries) as Record<string, string> : null;
}

interface BillCreditRow {
  id: string;
  vendorId: string;
  billNumber: string;
  billDate: Date;
  status: string;
  currency: string;
  exchangeRate: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  amountCredited: Prisma.Decimal;
}

interface BillLineCreditRow {
  id: string;
  description: string;
  amount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  accountId: string;
  projectId: string | null;
  reportingTags: Prisma.JsonValue | null;
  alreadyCredited: Prisma.Decimal;
}

export async function postVendorCredit(input: {
  billId: string;
  creditDate: string;
  exchangeRate: number;
  vendorReference?: string;
  notes?: string;
  lines: Array<{ billLineId: string; serviceAmount: number }>;
}) {
  try {
    const session = await auth();
    const tenantId = session?.user?.tenantId;
    const userId = session?.user?.id;
    const role = session?.user?.role;
    if (!tenantId || !userId) return { error: "Unauthorized" };
    if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
      return { error: "You do not have permission to post vendor credits." };
    }

    const creditDate = new Date(`${input.creditDate}T00:00:00`);
    if (Number.isNaN(creditDate.getTime())) return { error: "A valid vendor credit date is required." };
    if (creditDate > new Date()) return { error: "Vendor credit date cannot be in the future." };
    if (!Number.isFinite(input.exchangeRate) || input.exchangeRate <= 0) return { error: "A valid vendor credit exchange rate is required." };
    if (!input.lines.length) return { error: "Credit at least one bill line." };

    const lineIds = Array.from(new Set(input.lines.map((line) => line.billLineId)));
    if (lineIds.length !== input.lines.length) return { error: "Duplicate bill line selected." };

    const id = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:bill:${tenantId}:${input.billId}`}))`;

      const billRows = await tx.$queryRaw<BillCreditRow[]>`
        SELECT b."id", b."vendor_id" AS "vendorId", b."bill_number" AS "billNumber", b."bill_date" AS "billDate",
               b."status"::text AS "status", upper(b."currency") AS "currency", b."exchange_rate" AS "exchangeRate",
               b."total_amount" AS "totalAmount", b."amount_paid" AS "amountPaid", b."amount_credited" AS "amountCredited"
        FROM "bills" b
        WHERE b."id"=${input.billId} AND b."tenant_id"=${tenantId}::uuid
        LIMIT 1
      `;
      const bill = billRows[0];
      if (!bill) throw new Error("Bill not found in this organisation.");
      if (["DRAFT", "SETTLED"].includes(bill.status)) throw new Error(`A ${bill.status.toLowerCase()} bill cannot receive a vendor credit.`);

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
      if (!tenant) throw new Error("Organisation not found.");
      const baseCurrency = tenant.currency.trim().toUpperCase();
      const currency = bill.currency;
      const sourceRate = Number(bill.exchangeRate);
      const creditRate = currency === baseCurrency ? 1 : input.exchangeRate;
      if (currency === baseCurrency && Math.abs(input.exchangeRate - 1) > 0.000001) {
        throw new Error(`${baseCurrency} is this entity's base currency and must use an exchange rate of 1.`);
      }

      const rows = await tx.$queryRaw<BillLineCreditRow[]>`
        SELECT bl."id", bl."description", bl."amount", bl."tax_amount" AS "taxAmount", bl."account_id" AS "accountId",
               bl."project_id" AS "projectId", bl."reporting_tags" AS "reportingTags",
               COALESCE((
                 SELECT SUM(vcl."service_amount")
                 FROM "vendor_credit_lines" vcl
                 JOIN "vendor_credits" vc ON vc."id"=vcl."vendor_credit_id"
                 WHERE vcl."source_bill_line_id"=bl."id" AND vc."tenant_id"=${tenantId}::uuid AND vc."status"<>'REVERSED'
               ),0) AS "alreadyCredited"
        FROM "bill_lines" bl
        WHERE bl."bill_id"=${input.billId} AND bl."id" IN (${Prisma.join(lineIds)})
      `;
      if (rows.length !== lineIds.length) throw new Error("One or more selected bill lines are invalid.");
      const rowMap = new Map(rows.map((row) => [row.id, row]));

      const prepared = input.lines.map((requested) => {
        const row = rowMap.get(requested.billLineId)!;
        const serviceAmount = roundMoney(Number(requested.serviceAmount));
        const sourceService = Number(row.amount);
        const available = roundMoney(sourceService - Number(row.alreadyCredited));
        if (!Number.isFinite(serviceAmount) || serviceAmount <= 0) throw new Error("Vendor credit line amount must be greater than zero.");
        if (serviceAmount - available > 0.01) throw new Error(`Credit for ${row.description} exceeds the uncredited amount.`);
        const taxRatio = sourceService > 0 ? Number(row.taxAmount) / sourceService : 0;
        const taxAmount = roundMoney(serviceAmount * taxRatio);
        return {
          ...row,
          serviceAmount,
          taxAmount,
          totalAmount: roundMoney(serviceAmount + taxAmount),
          baseService: roundMoney(serviceAmount * sourceRate),
          baseTax: roundMoney(taxAmount * sourceRate),
        };
      });

      const subtotal = roundMoney(prepared.reduce((sum, line) => sum + line.serviceAmount, 0));
      const taxAmount = roundMoney(prepared.reduce((sum, line) => sum + line.taxAmount, 0));
      const totalAmount = roundMoney(subtotal + taxAmount);
      const outstandingBefore = roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid) - Number(bill.amountCredited));
      if (outstandingBefore < -0.01) throw new Error("Bill settlement evidence is inconsistent.");

      const appliedAmount = Math.min(totalAmount, Math.max(0, outstandingBefore));
      const openCreditAmount = roundMoney(totalAmount - appliedAmount);
      const activeApFx = currency === baseCurrency || appliedAmount <= 0.005
        ? 0
        : await getActiveApFxAdjustment(tx, tenantId, bill.id);
      const consumedApFx = appliedAmount > 0.005
        ? consumeFxAdjustment(activeApFx, appliedAmount, outstandingBefore)
        : 0;
      const baseHistoricalAp = roundMoney(appliedAmount * sourceRate);
      const baseApAmount = roundMoney(baseHistoricalAp + consumedApFx);
      const baseOpenCreditAmount = roundMoney(openCreditAmount * creditRate);
      const baseSourceReversal = roundMoney(prepared.reduce((sum, line) => sum + line.baseService + line.baseTax, 0));
      const debitBeforeFx = roundMoney(baseApAmount + baseOpenCreditAmount);
      const fxDifference = roundMoney(debitBeforeFx - baseSourceReversal);

      const [apAccount, vendorCreditAccount, inputVatAccount, fxGainAccount, fxLossAccount] = await Promise.all([
        appliedAmount > 0.005 ? resolveSystemAccount(tx, tenantId, "ACCOUNTS_PAYABLE", "CL-001") : Promise.resolve(null),
        openCreditAmount > 0.005 ? resolveSystemAccount(tx, tenantId, "VENDOR_CREDIT") : Promise.resolve(null),
        taxAmount > 0.005 ? resolveSystemAccount(tx, tenantId, "INPUT_VAT") : Promise.resolve(null),
        fxDifference > 0.01 ? resolveSystemAccount(tx, tenantId, "FX_GAIN") : Promise.resolve(null),
        fxDifference < -0.01 ? resolveSystemAccount(tx, tenantId, "FX_LOSS") : Promise.resolve(null),
      ]);

      const period = getRecognitionPeriod(creditDate);
      await assertPeriodOpenInTransaction(tx, tenantId, period);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:vendor-credit:${tenantId}`}))`;
      const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS "count" FROM "vendor_credits" WHERE "tenant_id"=${tenantId}::uuid`;
      const creditNumber = `VCR-${String(Number(countRows[0]?.count ?? 0) + 1).padStart(5, "0")}`;

      const journalLines: JournalPostingLine[] = [];
      if (apAccount && baseApAmount > 0.005) {
        journalLines.push({ accountId: apAccount.id, description: `AP reduced - ${creditNumber}`, debit: baseApAmount, credit: 0 });
      }
      if (vendorCreditAccount && baseOpenCreditAmount > 0.005) {
        journalLines.push({ accountId: vendorCreditAccount.id, description: `Open vendor credit - ${creditNumber}`, debit: baseOpenCreditAmount, credit: 0 });
      }
      if (fxLossAccount && fxDifference < -0.01) {
        journalLines.push({ accountId: fxLossAccount.id, description: `Realised FX loss - ${creditNumber}`, debit: Math.abs(fxDifference), credit: 0 });
      }
      for (const line of prepared) {
        journalLines.push({
          accountId: line.accountId,
          description: `Vendor credit cost reversal - ${creditNumber}`,
          debit: 0,
          credit: line.baseService,
          projectId: line.projectId,
          reportingTags: normaliseTags(line.reportingTags),
        });
      }
      if (inputVatAccount && prepared.some((line) => line.baseTax > 0.005)) {
        journalLines.push({
          accountId: inputVatAccount.id,
          description: `Input VAT reversal - ${creditNumber}`,
          debit: 0,
          credit: roundMoney(prepared.reduce((sum, line) => sum + line.baseTax, 0)),
        });
      }
      if (fxGainAccount && fxDifference > 0.01) {
        journalLines.push({ accountId: fxGainAccount.id, description: `Realised FX gain - ${creditNumber}`, debit: 0, credit: fxDifference });
      }

      const journalEntryId = await postJournalEntryInTransaction(tx, {
        tenantId,
        createdBy: userId,
        entryDate: creditDate,
        reference: creditNumber,
        description: `Vendor credit ${creditNumber} against ${bill.billNumber}${currency !== baseCurrency ? ` (${currency} @ ${creditRate})` : ""}`,
        recognitionPeriod: period,
        source: "vendor_credit",
        sourceId: creditNumber,
        lines: journalLines,
      });

      const creditRows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "vendor_credits" (
          "tenant_id","vendor_id","source_bill_id","credit_number","vendor_reference","credit_date","currency",
          "exchange_rate","source_exchange_rate","subtotal","tax_amount","total_amount","applied_amount","remaining_amount",
          "base_source_reversal_amount","base_ap_amount","base_open_credit_amount","fx_gain_loss","journal_entry_id","status","notes","posted_by"
        ) VALUES (
          ${tenantId}::uuid,${bill.vendorId},${bill.id},${creditNumber},${input.vendorReference?.trim() || null},${creditDate},${currency},
          ${creditRate},${sourceRate},${subtotal},${taxAmount},${totalAmount},${appliedAmount},${openCreditAmount},
          ${baseSourceReversal},${baseApAmount},${baseOpenCreditAmount},${roundMoney(fxDifference)},${journalEntryId},
          ${openCreditAmount > 0.005 ? "OPEN" : "APPLIED"},${input.notes?.trim() || null},${userId}
        ) RETURNING "id"
      `;
      const creditId = creditRows[0]!.id;

      for (const line of prepared) {
        await tx.$executeRaw`
          INSERT INTO "vendor_credit_lines" (
            "tenant_id","vendor_credit_id","source_bill_line_id","description","service_amount","tax_amount","total_amount",
            "account_id","project_id","reporting_tags","source_exchange_rate","base_service_reversal","base_tax_reversal"
          ) VALUES (
            ${tenantId}::uuid,${creditId},${line.id},${line.description},${line.serviceAmount},${line.taxAmount},${line.totalAmount},
            ${line.accountId},${line.projectId},${line.reportingTags ?? Prisma.DbNull},${sourceRate},${line.baseService},${line.baseTax}
          )
        `;
      }

      if (appliedAmount > 0.005) {
        await tx.$executeRaw`
          INSERT INTO "vendor_credit_applications" (
            "tenant_id","vendor_credit_id","bill_id","application_date","application_type","amount",
            "base_historical_ap_amount","fx_unrealized_consumed","base_ap_amount","base_credit_amount","fx_gain_loss","status"
          ) VALUES (
            ${tenantId}::uuid,${creditId},${bill.id},${creditDate},'SOURCE',${appliedAmount},
            ${baseHistoricalAp},${consumedApFx},${baseApAmount},${roundMoney(appliedAmount * creditRate)},0,'POSTED'
          )
        `;
      }

      const newCredited = roundMoney(Number(bill.amountCredited) + appliedAmount);
      const remainingBill = roundMoney(Number(bill.totalAmount) - Number(bill.amountPaid) - newCredited);
      const newStatus = remainingBill <= 0.01 ? "SETTLED" : "PARTIAL";
      await tx.$executeRaw`
        UPDATE "bills"
        SET "amount_credited"=${newCredited}, "status"=${newStatus}::"BillStatus"
        WHERE "id"=${bill.id} AND "tenant_id"=${tenantId}::uuid
      `;

      return creditId;
    });

    revalidatePath("/purchases/vendor-credits");
    revalidatePath("/purchases/bills");
    revalidatePath(`/purchases/bills/${input.billId}`);
    return { success: true, id };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
