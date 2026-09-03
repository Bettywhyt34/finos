import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TOLERANCE = 0.005;

function startOfDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid statement date");
  return date;
}

function daysFrom(value: string, delta: number) {
  const date = startOfDay(value);
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const tenantId = session?.user?.tenantId;
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const accountId = req.nextUrl.searchParams.get("accountId") ?? "";
    const date = req.nextUrl.searchParams.get("date") ?? "";
    const type = req.nextUrl.searchParams.get("type") ?? "";
    const reference = (req.nextUrl.searchParams.get("reference") ?? "").trim().toLowerCase();
    const amount = Number(req.nextUrl.searchParams.get("amount") ?? "0");
    if (!accountId || !date || !["CREDIT", "DEBIT"].includes(type) || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Valid bank account, date, direction and amount are required" }, { status: 400 });
    }

    const accounts = await prisma.$queryRaw<Array<{
      ledgerAccountId: string | null;
      currency: string;
      baseCurrency: string;
    }>>`
      SELECT
        ba."ledger_account_id" AS "ledgerAccountId",
        UPPER(ba."currency") AS "currency",
        UPPER(t."currency") AS "baseCurrency"
      FROM "bank_accounts" ba
      INNER JOIN "tenants" t ON t."id" = ba."tenant_id"
      WHERE ba."id" = ${accountId}
        AND ba."tenant_id" = ${tenantId}::uuid
        AND ba."is_active" = true
      LIMIT 1
    `;
    const bank = accounts[0];
    if (!bank) return NextResponse.json({ error: "Bank account not found" }, { status: 404 });
    if (!bank.ledgerAccountId) return NextResponse.json({ error: "Map this bank account to its Bank/Cash ledger first" }, { status: 400 });
    if (bank.currency !== bank.baseCurrency) {
      return NextResponse.json({
        error: `FX-aware statement matching is not enabled yet. This bank account is ${bank.currency}, while FINOS ledger evidence is ${bank.baseCurrency}.`,
      }, { status: 400 });
    }

    const from = daysFrom(date, -31);
    const to = daysFrom(date, 32);
    const lines = await prisma.$queryRaw<Array<{
      id: string;
      entryNumber: string;
      entryDate: Date;
      reference: string | null;
      description: string | null;
      source: string | null;
      debit: unknown;
      credit: unknown;
      matchedAmount: unknown;
      entityName: string | null;
    }>>`
      SELECT
        jel."id",
        je."entry_number" AS "entryNumber",
        je."entry_date" AS "entryDate",
        je."reference",
        COALESCE(jel."description", je."description") AS "description",
        je."source",
        jel."debit",
        jel."credit",
        COALESCE(match_totals."matchedAmount", 0) AS "matchedAmount",
        COALESCE(c."company_name", v."company_name") AS "entityName"
      FROM "journal_entry_lines" jel
      INNER JOIN "journal_entries" je ON je."id" = jel."entry_id"
      LEFT JOIN "customer_payments" cp
        ON je."source" = 'customer_payment' AND cp."id" = je."source_id"
      LEFT JOIN "customers" c ON c."id" = cp."customer_id"
      LEFT JOIN "vendor_payments" vp
        ON je."source" = 'vendor_payment' AND vp."id" = je."source_id"
      LEFT JOIN "vendors" v ON v."id" = vp."vendor_id"
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(brm."matched_amount"), 0) AS "matchedAmount"
        FROM "bank_reconciliation_matches" brm
        INNER JOIN "bank_reconciliation_sessions" brs ON brs."id" = brm."session_id"
        WHERE brm."journal_entry_line_id" = jel."id"
          AND brs."tenant_id" = ${tenantId}::uuid
          AND brs."bank_account_id" = ${accountId}
      ) match_totals ON true
      WHERE je."tenant_id" = ${tenantId}::uuid
        AND jel."account_id" = ${bank.ledgerAccountId}
        AND je."is_locked" = true
        AND je."entry_date" >= ${from}
        AND je."entry_date" < ${to}
      ORDER BY je."entry_date" ASC, je."entry_number" ASC
    `;

    const statementDate = startOfDay(date).getTime();
    const candidates = lines
      .map((line) => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        const eligibleAmount = type === "CREDIT" ? debit : credit;
        const opposite = type === "CREDIT" ? credit : debit;
        const remainingAmount = Math.max(0, Math.round((eligibleAmount - Number(line.matchedAmount ?? 0)) * 100) / 100);
        const daysApart = Math.round(Math.abs(new Date(line.entryDate).getTime() - statementDate) / 86_400_000);
        const candidateReference = (line.reference ?? "").trim().toLowerCase();
        const exactAmount = Math.abs(remainingAmount - amount) <= TOLERANCE;
        const referenceMatch = Boolean(reference && candidateReference && (reference.includes(candidateReference) || candidateReference.includes(reference)));
        let score = 0;
        if (exactAmount) score += 100;
        if (referenceMatch) score += 80;
        if (daysApart === 0) score += 30;
        else if (daysApart <= 3) score += 20;
        else if (daysApart <= 7) score += 10;
        if (line.entityName) score += 5;
        return {
          id: line.id,
          entryNumber: line.entryNumber,
          entryDate: line.entryDate.toISOString(),
          reference: line.reference,
          description: line.description,
          source: line.source,
          entityName: line.entityName,
          eligibleAmount,
          matchedAmount: Number(line.matchedAmount ?? 0),
          remainingAmount,
          daysApart,
          exactAmount,
          referenceMatch,
          score,
          validDirection: opposite <= TOLERANCE && eligibleAmount > TOLERANCE,
        };
      })
      .filter((line) => line.validDirection && line.remainingAmount > TOLERANCE)
      .sort((a, b) => b.score - a.score || a.daysApart - b.daysApart || a.entryNumber.localeCompare(b.entryNumber))
      .slice(0, 20)
      .map(({ validDirection: _validDirection, ...candidate }) => candidate);

    return NextResponse.json({ currency: bank.currency, candidates });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load existing FINOS matches" }, { status: 500 });
  }
}
