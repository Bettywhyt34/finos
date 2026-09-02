import type { Prisma } from "@prisma/client";
import { getRecognitionPeriod } from "@/lib/utils";
import { postJournalEntryInTransaction, type JournalPostingLine } from "@/lib/journal";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normaliseReportingTags(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? Object.fromEntries(pairs) as Record<string, string> : null;
}

export interface StandaloneRevenueEvidenceRow {
  id: string;
  invoiceLineId: string;
  incomeAccountId: string;
  unearnedIncomeAccountId: string | null;
  invoiceAmount: number;
  immediateRevenue: number;
  unearnedCreated: number;
  reportingTags: Record<string, string> | null;
}

/**
 * Ensures ordinary (non-Project) posted invoices have the same immutable revenue
 * evidence as Project invoices. Existing production data is currently empty, but
 * this repair path also makes the accounting action fail-safe if an older posted
 * invoice reaches it without allocation evidence.
 */
export async function ensureStandaloneInvoiceRevenueEvidence(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceId: string,
): Promise<StandaloneRevenueEvidenceRow[]> {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      totalAmount: true,
      taxAmount: true,
      discountAmount: true,
      exchangeRate: true,
      recogniseRevenueOnInvoiceDate: true,
      lines: {
        select: {
          id: true,
          amount: true,
          discountAmount: true,
          incomeAccountId: true,
          projectId: true,
          reportingTags: true,
        },
      },
    },
  });
  if (!invoice) throw new Error("Invoice not found.");
  if (invoice.lines.some((line) => Boolean(line.projectId))) {
    throw new Error("This action is for ordinary invoices only. Project revenue is recognised from the Project ledger.");
  }
  if (invoice.status === "DRAFT") throw new Error("Post the invoice before recognising revenue.");

  const existing = await tx.$queryRaw<Array<{
    id: string;
    invoiceLineId: string;
    incomeAccountId: string;
    unearnedIncomeAccountId: string | null;
    invoiceAmount: unknown;
    immediateRevenue: unknown;
    unearnedCreated: unknown;
  }>>`
    SELECT "id"::text AS "id", "invoice_line_id" AS "invoiceLineId",
           "income_account_id" AS "incomeAccountId",
           "unearned_income_account_id" AS "unearnedIncomeAccountId",
           "invoice_amount" AS "invoiceAmount", "immediate_revenue" AS "immediateRevenue",
           "unearned_created" AS "unearnedCreated"
    FROM "invoice_line_revenue_allocations"
    WHERE "tenant_id" = ${tenantId}::uuid AND "invoice_id" = ${invoiceId}
    ORDER BY "invoice_line_id"
  `;

  const positiveLines = invoice.lines.filter((line) => Number(line.amount) - Number(line.discountAmount) > 0.005);
  if (existing.length) {
    if (existing.length !== positiveLines.length) {
      throw new Error("Invoice revenue evidence is incomplete. Accounting posting is blocked until the invoice is reviewed.");
    }
    const tagsByLine = new Map(invoice.lines.map((line) => [line.id, normaliseReportingTags(line.reportingTags)]));
    return existing.map((row) => ({
      id: row.id,
      invoiceLineId: row.invoiceLineId,
      incomeAccountId: row.incomeAccountId,
      unearnedIncomeAccountId: row.unearnedIncomeAccountId,
      invoiceAmount: Number(row.invoiceAmount),
      immediateRevenue: Number(row.immediateRevenue),
      unearnedCreated: Number(row.unearnedCreated),
      reportingTags: tagsByLine.get(row.invoiceLineId) ?? null,
    }));
  }

  if (["VOIDED", "WRITTEN_OFF"].includes(invoice.status)) {
    throw new Error(`Revenue evidence cannot be reconstructed while the invoice is ${invoice.status}.`);
  }

  const rate = Number(invoice.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invoice exchange rate is invalid.");
  const base = (value: unknown) => roundMoney(Number(value) * rate);
  const expectedNetSales = roundMoney(base(invoice.totalAmount) - base(invoice.taxAmount));
  const invoiceDiscountBase = base(invoice.discountAmount);

  const allocations = positiveLines.map((line) => ({
    invoiceLineId: line.id,
    incomeAccountId: line.incomeAccountId,
    reportingTags: normaliseReportingTags(line.reportingTags),
    amount: base(Number(line.amount) - Number(line.discountAmount)),
  }));
  if (allocations.some((item) => !item.incomeAccountId)) {
    throw new Error("One or more invoice lines are missing their income account.");
  }

  if (invoiceDiscountBase > 0.001) {
    const before = allocations.reduce((sum, item) => sum + item.amount, 0);
    if (before > 0) {
      for (const item of allocations) {
        item.amount = roundMoney(item.amount - invoiceDiscountBase * (item.amount / before));
      }
    }
  }
  const calculated = roundMoney(allocations.reduce((sum, item) => sum + item.amount, 0));
  const rounding = roundMoney(expectedNetSales - calculated);
  if (Math.abs(rounding) > 1) throw new Error("Invoice service allocation does not reconcile to the posted invoice.");
  if (rounding !== 0 && allocations.length) {
    allocations.sort((a, b) => b.amount - a.amount || a.invoiceLineId.localeCompare(b.invoiceLineId));
    allocations[0].amount = roundMoney(allocations[0].amount + rounding);
  }

  let unearnedAccountId: string | null = null;
  if (!invoice.recogniseRevenueOnInvoiceDate && expectedNetSales > 0.005) {
    const journal = await tx.journalEntry.findFirst({
      where: { tenantId, source: "invoice", sourceId: invoiceId, isLocked: true },
      include: { lines: true },
    });
    if (!journal) throw new Error("The authoritative invoice journal could not be found.");
    const accounts = Array.from(new Set(
      journal.lines
        .filter((line) => Number(line.credit) > 0.005 && (line.description ?? "").startsWith("Unearned Income -"))
        .map((line) => line.accountId),
    ));
    if (accounts.length !== 1) {
      throw new Error("The invoice's original Unearned Revenue account cannot be identified safely.");
    }
    unearnedAccountId = accounts[0];
  }

  const result: StandaloneRevenueEvidenceRow[] = [];
  for (const item of allocations.sort((a, b) => a.invoiceLineId.localeCompare(b.invoiceLineId))) {
    if (item.amount <= 0.005) continue;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "invoice_line_revenue_allocations" (
        "tenant_id", "project_id", "invoice_id", "invoice_line_id", "income_account_id",
        "currency", "invoice_amount", "contract_asset_cleared", "immediate_revenue",
        "unearned_created", "unearned_income_account_id"
      ) VALUES (
        ${tenantId}::uuid, NULL, ${invoiceId}, ${item.invoiceLineId}, ${item.incomeAccountId!},
        'NGN', ${item.amount}, 0,
        ${invoice.recogniseRevenueOnInvoiceDate ? item.amount : 0},
        ${invoice.recogniseRevenueOnInvoiceDate ? 0 : item.amount},
        ${invoice.recogniseRevenueOnInvoiceDate ? null : unearnedAccountId}
      )
      RETURNING "id"::text AS "id"
    `;
    if (!rows[0]?.id) throw new Error("Invoice revenue evidence could not be recorded.");
    result.push({
      id: rows[0].id,
      invoiceLineId: item.invoiceLineId,
      incomeAccountId: item.incomeAccountId!,
      unearnedIncomeAccountId: invoice.recogniseRevenueOnInvoiceDate ? null : unearnedAccountId,
      invoiceAmount: item.amount,
      immediateRevenue: invoice.recogniseRevenueOnInvoiceDate ? item.amount : 0,
      unearnedCreated: invoice.recogniseRevenueOnInvoiceDate ? 0 : item.amount,
      reportingTags: item.reportingTags,
    });
  }
  return result;
}

export async function postStandaloneInvoiceRevenueRecognition(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    invoiceId: string;
    userId: string;
    recognitionId: string;
    recognitionDate: Date;
    transactionAmount: number;
    note: string | null;
  },
) {
  const { tenantId, invoiceId, userId, recognitionId, recognitionDate } = input;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:invoice-revenue:${tenantId}:${invoiceId}`}))`;

  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { id: true, invoiceNumber: true, status: true, currency: true, exchangeRate: true, lines: { select: { projectId: true } } },
  });
  if (!invoice) throw new Error("Invoice not found.");
  if (["DRAFT", "VOIDED", "WRITTEN_OFF"].includes(invoice.status)) {
    throw new Error(`Revenue cannot be recognised while the invoice is ${invoice.status}.`);
  }
  if (invoice.lines.some((line) => Boolean(line.projectId))) {
    throw new Error("Project-linked invoices must use Project revenue recognition.");
  }
  const rate = Number(invoice.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invoice exchange rate is invalid.");

  const evidence = await ensureStandaloneInvoiceRevenueEvidence(tx, tenantId, invoiceId);
  const rows = await tx.$queryRaw<Array<{
    id: string;
    recognised: unknown;
    creditedUnearned: unknown;
  }>>`
    SELECT ila."id"::text AS "id",
      COALESCE((SELECT SUM(irra."base_amount")
        FROM "invoice_revenue_recognition_allocations" irra
        JOIN "invoice_revenue_recognitions" irr ON irr."id" = irra."recognition_id"
        WHERE irra."invoice_line_allocation_id" = ila."id" AND irr."status" = 'POSTED'), 0) AS "recognised",
      COALESCE((SELECT SUM(cnsa."unearned_reversed")
        FROM "credit_note_service_allocations" cnsa
        JOIN "credit_notes" cn ON cn."id" = cnsa."credit_note_id"
        WHERE cnsa."invoice_line_allocation_id" = ila."id" AND cn."status" = 'APPLIED'), 0) AS "creditedUnearned"
    FROM "invoice_line_revenue_allocations" ila
    WHERE ila."tenant_id" = ${tenantId}::uuid AND ila."invoice_id" = ${invoiceId}
  `;
  const usage = new Map(rows.map((row) => [row.id, row]));
  const available = evidence.map((item) => ({
    ...item,
    remaining: roundMoney(item.unearnedCreated - Number(usage.get(item.id)?.recognised ?? 0) - Number(usage.get(item.id)?.creditedUnearned ?? 0)),
  })).filter((item) => item.remaining > 0.005);
  const totalRemaining = roundMoney(available.reduce((sum, item) => sum + item.remaining, 0));
  if (totalRemaining <= 0.005) throw new Error("This invoice has no unearned service value left to recognise.");

  const requestedBase = roundMoney(input.transactionAmount * rate);
  if (requestedBase <= 0) throw new Error("Recognition amount must be greater than zero.");
  if (requestedBase - totalRemaining > 0.01) {
    throw new Error(`Recognition exceeds the remaining deferred service value of ${(totalRemaining / rate).toFixed(2)} ${invoice.currency}.`);
  }
  const baseAmount = Math.min(requestedBase, totalRemaining);
  let remainingToAllocate = baseAmount;
  const allocations: Array<{ row: typeof available[number]; amount: number }> = [];
  for (const item of available.sort((a, b) => a.invoiceLineId.localeCompare(b.invoiceLineId))) {
    if (remainingToAllocate <= 0.005) break;
    const amount = roundMoney(Math.min(item.remaining, remainingToAllocate));
    if (amount <= 0) continue;
    allocations.push({ row: item, amount });
    remainingToAllocate = roundMoney(remainingToAllocate - amount);
  }
  if (Math.abs(remainingToAllocate) > 0.01) throw new Error("Revenue recognition could not be allocated completely.");

  const lines: JournalPostingLine[] = [];
  for (const item of allocations) {
    if (!item.row.unearnedIncomeAccountId) throw new Error("Original Unearned Revenue account evidence is missing.");
    lines.push({
      accountId: item.row.unearnedIncomeAccountId,
      description: `Earned from ${invoice.invoiceNumber}`,
      debit: item.amount,
      credit: 0,
      reportingTags: item.row.reportingTags,
    });
    lines.push({
      accountId: item.row.incomeAccountId,
      description: `Revenue earned - ${invoice.invoiceNumber}`,
      debit: 0,
      credit: item.amount,
      reportingTags: item.row.reportingTags,
    });
  }

  const journalEntryId = await postJournalEntryInTransaction(tx, {
    tenantId,
    createdBy: userId,
    entryDate: recognitionDate,
    reference: `REVREC-${invoice.invoiceNumber}`,
    description: `Revenue recognised from deferred invoice ${invoice.invoiceNumber}`,
    recognitionPeriod: getRecognitionPeriod(recognitionDate),
    source: "invoice_revenue_recognition",
    sourceId: recognitionId,
    lines,
  });

  await tx.$executeRaw`
    INSERT INTO "invoice_revenue_recognitions" (
      "id", "tenant_id", "invoice_id", "recognition_date", "currency", "transaction_amount",
      "exchange_rate", "base_amount", "journal_entry_id", "note", "created_by", "status"
    ) VALUES (
      ${recognitionId}::uuid, ${tenantId}::uuid, ${invoiceId}, ${recognitionDate}, ${invoice.currency},
      ${roundMoney(baseAmount / rate)}, ${rate}, ${baseAmount}, ${journalEntryId}, ${input.note}, ${userId}, 'POSTED'
    )
  `;
  for (const item of allocations) {
    await tx.$executeRaw`
      INSERT INTO "invoice_revenue_recognition_allocations" (
        "tenant_id", "recognition_id", "invoice_line_allocation_id", "base_amount"
      ) VALUES (${tenantId}::uuid, ${recognitionId}::uuid, ${item.row.id}::uuid, ${item.amount})
    `;
  }
  return { baseAmount, transactionAmount: roundMoney(baseAmount / rate), journalEntryId };
}
