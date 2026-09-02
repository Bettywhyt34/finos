import type { Prisma } from "@prisma/client";
import { ensureStandaloneInvoiceRevenueEvidence } from "@/lib/invoices/revenue-evidence";
import type { JournalPostingLine } from "@/lib/journal";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type ReportingTags = Record<string, string> | null;

function normaliseReportingTags(value: Prisma.JsonValue | null): ReportingTags {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const pairs = Object.entries(value)
    .filter(([, optionId]) => typeof optionId === "string" && optionId.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? Object.fromEntries(pairs) as Record<string, string> : null;
}

type InvoiceLineInput = {
  id: string;
  projectId: string | null;
  amount: unknown;
  discountAmount: unknown;
  reportingTags: Prisma.JsonValue | null;
};

type EvidenceRow = {
  id: string;
  invoiceLineId: string;
  projectId: string | null;
  incomeAccountId: string;
  unearnedIncomeAccountId: string | null;
  invoiceAmount: number;
  contractAssetCleared: number;
  immediateRevenue: number;
  unearnedCreated: number;
  reportingTags: ReportingTags;
};

type UsageRow = {
  id: string;
  standaloneRecognised: unknown;
  projectRecognised: unknown;
  priorUnearnedCredit: unknown;
  priorRevenueCredit: unknown;
  priorContractAssetRestored: unknown;
  priorProjectRevenueReversed: unknown;
};

type ProjectSourceRow = {
  id: string;
  invoiceLineAllocationId: string;
  recognitionId: string;
  allocationType: string;
  amount: unknown;
  recognitionStatus: string;
  contractAssetAccountId: string | null;
  priorAdjusted: unknown;
};

export type CreditNoteServiceAllocation = {
  invoiceLineAllocationId: string;
  serviceBaseAmount: number;
  unearnedReversed: number;
  revenueReversed: number;
  contractAssetRestored: number;
};

export type CreditNoteProjectAdjustment = {
  invoiceLineAllocationId: string;
  sourceAllocationId: string;
  sourceRecognitionId: string;
  adjustmentType: "CONTRACT_ASSET_RESTORATION" | "REVENUE_REVERSAL";
  amount: number;
};

export async function buildCreditNoteServiceReduction(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    serviceBaseAmount: number;
    ratio: number;
    lines: InvoiceLineInput[];
  },
): Promise<{
  journalLines: JournalPostingLine[];
  serviceAllocations: CreditNoteServiceAllocation[];
  projectAdjustments: CreditNoteProjectAdjustment[];
  projectIds: string[];
}> {
  const { tenantId, invoiceId, invoiceNumber } = input;
  const projectIds = Array.from(new Set(
    input.lines.map((line) => line.projectId).filter((id): id is string => Boolean(id)),
  )).sort();

  for (const projectId of projectIds) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:project-revenue:${tenantId}:${projectId}`}))`;
  }

  let evidence: EvidenceRow[];
  if (projectIds.length === 0) {
    const standalone = await ensureStandaloneInvoiceRevenueEvidence(tx, tenantId, invoiceId);
    evidence = standalone.map((row) => ({
      id: row.id,
      invoiceLineId: row.invoiceLineId,
      projectId: null,
      incomeAccountId: row.incomeAccountId,
      unearnedIncomeAccountId: row.unearnedIncomeAccountId,
      invoiceAmount: row.invoiceAmount,
      contractAssetCleared: 0,
      immediateRevenue: row.immediateRevenue,
      unearnedCreated: row.unearnedCreated,
      reportingTags: row.reportingTags,
    }));
  } else {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      invoiceLineId: string;
      projectId: string | null;
      incomeAccountId: string;
      unearnedIncomeAccountId: string | null;
      invoiceAmount: unknown;
      contractAssetCleared: unknown;
      immediateRevenue: unknown;
      unearnedCreated: unknown;
      reportingTags: Prisma.JsonValue | null;
    }>>`
      SELECT ila."id"::text AS "id", ila."invoice_line_id" AS "invoiceLineId",
             ila."project_id" AS "projectId", ila."income_account_id" AS "incomeAccountId",
             ila."unearned_income_account_id" AS "unearnedIncomeAccountId",
             ila."invoice_amount" AS "invoiceAmount", ila."contract_asset_cleared" AS "contractAssetCleared",
             ila."immediate_revenue" AS "immediateRevenue", ila."unearned_created" AS "unearnedCreated",
             il."reporting_tags" AS "reportingTags"
      FROM "invoice_line_revenue_allocations" ila
      INNER JOIN "invoice_lines" il ON il."id" = ila."invoice_line_id"
      WHERE ila."tenant_id" = ${tenantId}::uuid AND ila."invoice_id" = ${invoiceId}
      ORDER BY ila."invoice_line_id"
    `;
    const positiveLines = input.lines.filter((line) => Number(line.amount) - Number(line.discountAmount) > 0.005);
    if (rows.length !== positiveLines.length) {
      throw new Error("Project invoice revenue evidence is incomplete. Credit-note posting is blocked until the invoice is reviewed.");
    }
    evidence = rows.map((row) => ({
      id: row.id,
      invoiceLineId: row.invoiceLineId,
      projectId: row.projectId,
      incomeAccountId: row.incomeAccountId,
      unearnedIncomeAccountId: row.unearnedIncomeAccountId,
      invoiceAmount: Number(row.invoiceAmount),
      contractAssetCleared: Number(row.contractAssetCleared),
      immediateRevenue: Number(row.immediateRevenue),
      unearnedCreated: Number(row.unearnedCreated),
      reportingTags: normaliseReportingTags(row.reportingTags),
    }));
  }

  const usageRows = await tx.$queryRaw<UsageRow[]>`
    SELECT ila."id"::text AS "id",
      COALESCE((
        SELECT SUM(irra."base_amount")
        FROM "invoice_revenue_recognition_allocations" irra
        JOIN "invoice_revenue_recognitions" irr ON irr."id" = irra."recognition_id"
        WHERE irra."invoice_line_allocation_id" = ila."id" AND irr."status" = 'POSTED'
      ), 0) AS "standaloneRecognised",
      COALESCE((
        SELECT SUM(rria."amount")
        FROM "revenue_recognition_invoice_allocations" rria
        JOIN "project_revenue_recognitions" prr ON prr."id" = rria."recognition_id"
        WHERE rria."invoice_line_allocation_id" = ila."id"
          AND rria."allocation_type" = 'UNEARNED_RELEASE' AND prr."status" = 'POSTED'
      ), 0) AS "projectRecognised",
      COALESCE((
        SELECT SUM(cnsa."unearned_reversed")
        FROM "credit_note_service_allocations" cnsa
        JOIN "credit_notes" cn ON cn."id" = cnsa."credit_note_id"
        WHERE cnsa."invoice_line_allocation_id" = ila."id" AND cn."status" = 'APPLIED'
      ), 0) AS "priorUnearnedCredit",
      COALESCE((
        SELECT SUM(cnsa."revenue_reversed")
        FROM "credit_note_service_allocations" cnsa
        JOIN "credit_notes" cn ON cn."id" = cnsa."credit_note_id"
        WHERE cnsa."invoice_line_allocation_id" = ila."id" AND cn."status" = 'APPLIED'
      ), 0) AS "priorRevenueCredit",
      COALESCE((
        SELECT SUM(cnsa."contract_asset_restored")
        FROM "credit_note_service_allocations" cnsa
        JOIN "credit_notes" cn ON cn."id" = cnsa."credit_note_id"
        WHERE cnsa."invoice_line_allocation_id" = ila."id" AND cn."status" = 'APPLIED'
      ), 0) AS "priorContractAssetRestored",
      COALESCE((
        SELECT SUM(cnpa."amount")
        FROM "credit_note_project_adjustments" cnpa
        JOIN "credit_notes" cn ON cn."id" = cnpa."credit_note_id"
        WHERE cnpa."invoice_line_allocation_id" = ila."id"
          AND cnpa."adjustment_type" = 'REVENUE_REVERSAL' AND cn."status" = 'APPLIED'
      ), 0) AS "priorProjectRevenueReversed"
    FROM "invoice_line_revenue_allocations" ila
    WHERE ila."tenant_id" = ${tenantId}::uuid AND ila."invoice_id" = ${invoiceId}
  `;
  const usage = new Map(usageRows.map((row) => [row.id, row]));

  const projectSources = projectIds.length ? await tx.$queryRaw<ProjectSourceRow[]>`
    SELECT rria."id"::text AS "id", rria."invoice_line_allocation_id"::text AS "invoiceLineAllocationId",
           rria."recognition_id"::text AS "recognitionId", rria."allocation_type" AS "allocationType",
           rria."amount", prr."status" AS "recognitionStatus",
           prr."contract_asset_account_id" AS "contractAssetAccountId",
           COALESCE((
             SELECT SUM(cnpa."amount")
             FROM "credit_note_project_adjustments" cnpa
             JOIN "credit_notes" cn ON cn."id" = cnpa."credit_note_id"
             WHERE cnpa."source_allocation_id" = rria."id" AND cn."status" = 'APPLIED'
           ), 0) AS "priorAdjusted"
    FROM "revenue_recognition_invoice_allocations" rria
    INNER JOIN "project_revenue_recognitions" prr ON prr."id" = rria."recognition_id"
    INNER JOIN "invoice_line_revenue_allocations" ila ON ila."id" = rria."invoice_line_allocation_id"
    WHERE rria."tenant_id" = ${tenantId}::uuid AND ila."invoice_id" = ${invoiceId}
      AND rria."allocation_type" IN ('CONTRACT_ASSET_CLEARANCE','UNEARNED_RELEASE')
    ORDER BY prr."recognition_date" ASC, prr."created_at" ASC, rria."id" ASC
  ` : [];
  const sourcesByLine = new Map<string, ProjectSourceRow[]>();
  for (const source of projectSources) {
    const list = sourcesByLine.get(source.invoiceLineAllocationId) ?? [];
    list.push(source);
    sourcesByLine.set(source.invoiceLineAllocationId, list);
  }

  const state = evidence.map((row) => {
    const item = usage.get(row.id);
    const standaloneRecognised = roundMoney(Number(item?.standaloneRecognised ?? 0));
    const projectRecognised = roundMoney(Number(item?.projectRecognised ?? 0));
    const priorUnearned = roundMoney(Number(item?.priorUnearnedCredit ?? 0));
    const priorRevenue = roundMoney(Number(item?.priorRevenueCredit ?? 0));
    const priorContractRestored = roundMoney(Number(item?.priorContractAssetRestored ?? 0));
    const priorProjectRevenueReversed = roundMoney(Number(item?.priorProjectRevenueReversed ?? 0));
    const recognised = row.projectId ? projectRecognised : standaloneRecognised;
    const unearnedRemaining = Math.max(0, roundMoney(row.unearnedCreated - recognised - priorUnearned));
    const contractAssetRemaining = Math.max(0, roundMoney(row.contractAssetCleared - priorContractRestored));
    const revenueRemaining = row.projectId
      ? Math.max(0, roundMoney(row.immediateRevenue + projectRecognised - priorRevenue))
      : Math.max(0, roundMoney(row.immediateRevenue + standaloneRecognised - priorRevenue));
    const serviceRemaining = roundMoney(unearnedRemaining + contractAssetRemaining + revenueRemaining);
    return {
      ...row,
      unearnedRemaining,
      contractAssetRemaining,
      revenueRemaining,
      priorProjectRevenueReversed,
      serviceRemaining,
      target: 0,
    };
  });

  for (const row of state) {
    row.target = Math.min(row.serviceRemaining, roundMoney(row.invoiceAmount * input.ratio));
  }
  let serviceDifference = roundMoney(input.serviceBaseAmount - state.reduce((sum, row) => sum + row.target, 0));
  if (serviceDifference > 0.005) {
    for (const row of [...state].sort((a, b) => a.invoiceLineId.localeCompare(b.invoiceLineId))) {
      if (serviceDifference <= 0.005) break;
      const extra = roundMoney(Math.min(Math.max(0, row.serviceRemaining - row.target), serviceDifference));
      row.target = roundMoney(row.target + extra);
      serviceDifference = roundMoney(serviceDifference - extra);
    }
  } else if (serviceDifference < -0.005) {
    for (const row of [...state].sort((a, b) => b.target - a.target || a.invoiceLineId.localeCompare(b.invoiceLineId))) {
      if (serviceDifference >= -0.005) break;
      const reduction = roundMoney(Math.min(row.target, Math.abs(serviceDifference)));
      row.target = roundMoney(row.target - reduction);
      serviceDifference = roundMoney(serviceDifference + reduction);
    }
  }
  if (Math.abs(roundMoney(state.reduce((sum, row) => sum + row.target, 0)) - input.serviceBaseAmount) > 0.01) {
    throw new Error("The credit note service reduction exceeds the remaining invoice service value.");
  }

  const journalLines: JournalPostingLine[] = [];
  const serviceAllocations: CreditNoteServiceAllocation[] = [];
  const projectAdjustments: CreditNoteProjectAdjustment[] = [];

  for (const row of state.filter((item) => item.target > 0.005)) {
    let amountLeft = row.target;
    const unearnedReversed = roundMoney(Math.min(amountLeft, row.unearnedRemaining));
    amountLeft = roundMoney(amountLeft - unearnedReversed);
    if (unearnedReversed > 0.005) {
      if (!row.unearnedIncomeAccountId) throw new Error("Original Unearned Revenue account evidence is missing.");
      journalLines.push({
        accountId: row.unearnedIncomeAccountId,
        description: `Credit note - unearned service ${invoiceNumber}`,
        debit: unearnedReversed,
        credit: 0,
        projectId: row.projectId,
        reportingTags: row.reportingTags,
      });
    }

    let contractAssetRestored = 0;
    let projectRecognitionRevenueReversed = 0;
    if (row.projectId && amountLeft > 0.005) {
      const sources = sourcesByLine.get(row.id) ?? [];
      for (const source of sources.filter((item) => item.allocationType === "CONTRACT_ASSET_CLEARANCE")) {
        if (amountLeft <= 0.005) break;
        if (source.recognitionStatus !== "POSTED") throw new Error("Project Contract Asset source has been reversed and cannot be credited safely.");
        const available = Math.max(0, roundMoney(Number(source.amount) - Number(source.priorAdjusted ?? 0)));
        if (available <= 0.005) continue;
        if (!source.contractAssetAccountId) throw new Error("Project Contract Asset account evidence is missing.");
        const account = await tx.chartOfAccounts.findFirst({
          where: { id: source.contractAssetAccountId, tenantId, type: "ASSET", isActive: true },
          select: { id: true },
        });
        if (!account) throw new Error("The Contract Asset account used by the original earning event is inactive or invalid.");
        const restored = roundMoney(Math.min(available, amountLeft));
        journalLines.push({
          accountId: source.contractAssetAccountId,
          description: `Credit note - Contract Asset restored ${invoiceNumber}`,
          debit: restored,
          credit: 0,
          projectId: row.projectId,
        });
        projectAdjustments.push({
          invoiceLineAllocationId: row.id,
          sourceAllocationId: source.id,
          sourceRecognitionId: source.recognitionId,
          adjustmentType: "CONTRACT_ASSET_RESTORATION",
          amount: restored,
        });
        contractAssetRestored = roundMoney(contractAssetRestored + restored);
        amountLeft = roundMoney(amountLeft - restored);
      }

      for (const source of sources.filter((item) => item.allocationType === "UNEARNED_RELEASE")) {
        if (amountLeft <= 0.005) break;
        if (source.recognitionStatus !== "POSTED") throw new Error("Project revenue source has been reversed and cannot be credited safely.");
        const available = Math.max(0, roundMoney(Number(source.amount) - Number(source.priorAdjusted ?? 0)));
        if (available <= 0.005) continue;
        const reversed = roundMoney(Math.min(available, amountLeft));
        journalLines.push({
          accountId: row.incomeAccountId,
          description: `Credit note - earned Project service ${invoiceNumber}`,
          debit: reversed,
          credit: 0,
          projectId: row.projectId,
          reportingTags: row.reportingTags,
        });
        projectAdjustments.push({
          invoiceLineAllocationId: row.id,
          sourceAllocationId: source.id,
          sourceRecognitionId: source.recognitionId,
          adjustmentType: "REVENUE_REVERSAL",
          amount: reversed,
        });
        projectRecognitionRevenueReversed = roundMoney(projectRecognitionRevenueReversed + reversed);
        amountLeft = roundMoney(amountLeft - reversed);
      }
    }

    const immediateOrStandaloneRevenueAvailable = row.projectId
      ? Math.max(0, roundMoney(row.immediateRevenue - (Number(usage.get(row.id)?.priorRevenueCredit ?? 0) - row.priorProjectRevenueReversed)))
      : row.revenueRemaining;
    const directRevenueReversed = roundMoney(Math.min(amountLeft, immediateOrStandaloneRevenueAvailable));
    amountLeft = roundMoney(amountLeft - directRevenueReversed);
    if (directRevenueReversed > 0.005) {
      journalLines.push({
        accountId: row.incomeAccountId,
        description: `Credit note - earned service ${invoiceNumber}`,
        debit: directRevenueReversed,
        credit: 0,
        projectId: row.projectId,
        reportingTags: row.reportingTags,
      });
    }

    if (amountLeft > 0.01) {
      throw new Error("The Project credit note exceeds the remaining billing and earning evidence for an invoice line.");
    }

    serviceAllocations.push({
      invoiceLineAllocationId: row.id,
      serviceBaseAmount: row.target,
      unearnedReversed,
      revenueReversed: roundMoney(projectRecognitionRevenueReversed + directRevenueReversed),
      contractAssetRestored,
    });
  }

  return { journalLines, serviceAllocations, projectAdjustments, projectIds };
}
