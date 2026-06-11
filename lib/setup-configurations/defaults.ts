/**
 * Default setup data seeded for every new tenant.
 *
 * All functions are IDEMPOTENT — safe to call multiple times.
 * They use createMany({ skipDuplicates: true }) so re-runs silently skip existing rows.
 *
 * Each function accepts an optional `db` parameter that can be either:
 *   - the main `prisma` client (default, used standalone / in backfill scripts)
 *   - a transaction client `tx` (used inside prisma.$transaction for atomicity)
 *
 * Call seedTenantDefaults(tenantId, tx) from inside a transaction during
 * tenant creation so tenant + defaults are created atomically.
 */

import { prisma } from "@/lib/prisma";

// ─── Shared db type ───────────────────────────────────────────────────────────
//
// Minimal structural interface covering only what the seed functions call.
// Satisfied by both `prisma` (PrismaClient) and `tx` (Prisma.TransactionClient),
// because both expose the same model delegates.

type DbClient = {
  paymentTerm:             Pick<typeof prisma.paymentTerm,             "createMany">;
  reminderRule:            Pick<typeof prisma.reminderRule,            "createMany">;
  transactionNumberSeries: Pick<typeof prisma.transactionNumberSeries, "createMany">;
  pdfTemplate:             Pick<typeof prisma.pdfTemplate,             "createMany">;
};

// ─── Payment Terms ────────────────────────────────────────────────────────────

/**
 * Seeds the 7 system payment terms for a tenant.
 * Matches the rows inserted by scripts/migration-payment-terms-v25.sql.
 * Unique constraint: (tenantId, name).
 * Net 30 is the single default term.
 */
export async function seedDefaultPaymentTermsForTenant(
  tenantId: string,
  db: DbClient = prisma,
): Promise<void> {
  await db.paymentTerm.createMany({
    skipDuplicates: true,
    data: [
      {
        tenantId,
        name:      "Due on Receipt",
        dueType:   "DUE_ON_RECEIPT" as never,
        dueInDays: null,
        appliesTo: "BOTH" as never,
        isDefault: false,
        isSystem:  true,
        isActive:  true,
      },
      {
        tenantId,
        name:      "Net 15",
        dueType:   "FIXED_DAYS" as never,
        dueInDays: 15,
        appliesTo: "BOTH" as never,
        isDefault: false,
        isSystem:  true,
        isActive:  true,
      },
      {
        tenantId,
        name:      "Net 30",
        dueType:   "FIXED_DAYS" as never,
        dueInDays: 30,
        appliesTo: "BOTH" as never,
        isDefault: true,   // only default term
        isSystem:  true,
        isActive:  true,
      },
      {
        tenantId,
        name:      "Net 60",
        dueType:   "FIXED_DAYS" as never,
        dueInDays: 60,
        appliesTo: "BOTH" as never,
        isDefault: false,
        isSystem:  true,
        isActive:  true,
      },
      {
        tenantId,
        name:      "Net 90",
        dueType:   "FIXED_DAYS" as never,
        dueInDays: 90,
        appliesTo: "BOTH" as never,
        isDefault: false,
        isSystem:  true,
        isActive:  true,
      },
      {
        tenantId,
        name:      "Due end of the month",
        dueType:   "END_OF_MONTH" as never,
        dueInDays: null,
        appliesTo: "BOTH" as never,
        isDefault: false,
        isSystem:  true,
        isActive:  true,
      },
      {
        tenantId,
        name:      "Due end of next month",
        dueType:   "END_OF_NEXT_MONTH" as never,
        dueInDays: null,
        appliesTo: "BOTH" as never,
        isDefault: false,
        isSystem:  true,
        isActive:  true,
      },
    ],
  });
}

// ─── Reminder Rules ───────────────────────────────────────────────────────────

/**
 * Seeds the 10 system reminder rules for a tenant.
 * Matches the rows inserted by scripts/migration-reminders.sql.
 * Unique constraint: (tenantId, entityType, name).
 * All seeded with isActive = false.
 */
export async function seedDefaultReminderRulesForTenant(
  tenantId: string,
  db: DbClient = prisma,
): Promise<void> {
  await db.reminderRule.createMany({
    skipDuplicates: true,
    data: [
      // ── INVOICE · MANUAL ──────────────────────────────────────────────────
      {
        tenantId,
        entityType:   "INVOICE" as never,
        kind:         "MANUAL" as never,
        name:         "Reminder for Overdue Invoices",
        triggerBasis: "DUE_DATE" as never,
        direction:    "AFTER" as never,
        offsetDays:   0,
        isSystem:     true,
        isActive:     false,
      },
      {
        tenantId,
        entityType:   "INVOICE" as never,
        kind:         "MANUAL" as never,
        name:         "Reminder for Sent Invoices",
        triggerBasis: "ISSUE_DATE" as never,
        direction:    "AFTER" as never,
        offsetDays:   0,
        isSystem:     true,
        isActive:     false,
      },
      // ── INVOICE · AUTOMATED ───────────────────────────────────────────────
      {
        tenantId,
        entityType:   "INVOICE" as never,
        kind:         "AUTOMATED" as never,
        name:         "Payment Expected",
        triggerBasis: "EXPECTED_PAYMENT_DATE" as never,
        direction:    "ON_DATE" as never,
        offsetDays:   0,
        isSystem:     true,
        isActive:     false,
      },
      {
        tenantId,
        entityType:   "INVOICE" as never,
        kind:         "AUTOMATED" as never,
        name:         "Reminder - 1",
        triggerBasis: "DUE_DATE" as never,
        direction:    "ON_DATE" as never,
        offsetDays:   0,
        isSystem:     true,
        isActive:     false,
      },
      {
        tenantId,
        entityType:   "INVOICE" as never,
        kind:         "AUTOMATED" as never,
        name:         "Reminder - 2",
        triggerBasis: "DUE_DATE" as never,
        direction:    "AFTER" as never,
        offsetDays:   7,
        isSystem:     true,
        isActive:     false,
      },
      {
        tenantId,
        entityType:   "INVOICE" as never,
        kind:         "AUTOMATED" as never,
        name:         "Reminder - 3",
        triggerBasis: "DUE_DATE" as never,
        direction:    "AFTER" as never,
        offsetDays:   14,
        isSystem:     true,
        isActive:     false,
      },
      // ── BILL · MANUAL ─────────────────────────────────────────────────────
      {
        tenantId,
        entityType:   "BILL" as never,
        kind:         "MANUAL" as never,
        name:         "Reminder for Upcoming Bills",
        triggerBasis: "DUE_DATE" as never,
        direction:    "BEFORE" as never,
        offsetDays:   0,
        isSystem:     true,
        isActive:     false,
      },
      {
        tenantId,
        entityType:   "BILL" as never,
        kind:         "MANUAL" as never,
        name:         "Reminder for Overdue Bills",
        triggerBasis: "DUE_DATE" as never,
        direction:    "AFTER" as never,
        offsetDays:   0,
        isSystem:     true,
        isActive:     false,
      },
      // ── BILL · AUTOMATED ─────────────────────────────────────────────────
      {
        tenantId,
        entityType:   "BILL" as never,
        kind:         "AUTOMATED" as never,
        name:         "Bill Due Reminder",
        triggerBasis: "DUE_DATE" as never,
        direction:    "BEFORE" as never,
        offsetDays:   3,
        isSystem:     true,
        isActive:     false,
      },
      {
        tenantId,
        entityType:   "BILL" as never,
        kind:         "AUTOMATED" as never,
        name:         "Overdue Bill Reminder",
        triggerBasis: "DUE_DATE" as never,
        direction:    "AFTER" as never,
        offsetDays:   1,
        isSystem:     true,
        isActive:     false,
      },
    ],
  });
}

// ─── Transaction Number Series ────────────────────────────────────────────────

/**
 * Seeds the 10 default transaction number series for a tenant.
 * Matches the rows inserted by scripts/migration-transaction-number-series.sql.
 * Unique constraint: (tenantId, module).
 */
export async function seedDefaultTransactionNumberSeriesForTenant(
  tenantId: string,
  db: DbClient = prisma,
): Promise<void> {
  await db.transactionNumberSeries.createMany({
    skipDuplicates: true,
    data: [
      { tenantId, module: "INVOICE" as never,          prefix: "INV",  suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "CUSTOMER_PAYMENT" as never, prefix: "PAY",  suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "CREDIT_NOTE" as never,      prefix: "CN",   suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "BILL" as never,             prefix: "BILL", suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "VENDOR_PAYMENT" as never,   prefix: "VPAY", suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "JOURNAL" as never,          prefix: "JNL",  suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "ESTIMATE" as never,         prefix: "EST",  suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "PURCHASE_ORDER" as never,   prefix: "PO",   suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "VENDOR_CREDIT" as never,    prefix: "VC",   suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
      { tenantId, module: "DEBIT_NOTE" as never,       prefix: "DN",   suffix: "", nextNumber: 1, padLength: 5, restartFreq: "NEVER" as never, isEnabled: true, allowManualOverride: true, preventDuplicates: true },
    ],
  });
}

// ─── PDF Templates ────────────────────────────────────────────────────────────

const PDF_TEMPLATE_DOCUMENT_TYPES = [
  "ESTIMATE", "INVOICE", "SALES_RECEIPT", "CREDIT_NOTE",
  "PAYMENT_RECEIPT", "CUSTOMER_STATEMENT", "BILL", "VENDOR_CREDIT",
  "VENDOR_PAYMENT", "VENDOR_STATEMENT", "JOURNAL", "ADDITIONAL_INFORMATION",
] as const;

const PDF_TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  ESTIMATE:             "Default estimate template",
  INVOICE:              "Default invoice template",
  SALES_RECEIPT:        "Default sales receipt template",
  CREDIT_NOTE:          "Default credit note template",
  PAYMENT_RECEIPT:      "Default payment receipt template",
  CUSTOMER_STATEMENT:   "Default customer statement template",
  BILL:                 "Default bill template",
  VENDOR_CREDIT:        "Default vendor credit template",
  VENDOR_PAYMENT:       "Default vendor payment template",
  VENDOR_STATEMENT:     "Default vendor statement template",
  JOURNAL:              "Default journal template",
  ADDITIONAL_INFORMATION: "Default additional information template",
};

/**
 * Seeds one system "Standard Template" per document type for a tenant.
 * Matches the rows inserted by scripts/migration-pdf-templates.sql.
 * Unique constraint: (tenantId, documentType, name).
 */
export async function seedDefaultPdfTemplatesForTenant(
  tenantId: string,
  db: DbClient = prisma,
): Promise<void> {
  // One "Standard Template" per document type (default)
  await db.pdfTemplate.createMany({
    skipDuplicates: true,
    data: PDF_TEMPLATE_DOCUMENT_TYPES.map((documentType) => ({
      tenantId,
      documentType: documentType as never,
      name:         "Standard Template",
      description:  PDF_TEMPLATE_DESCRIPTIONS[documentType] ?? null,
      layoutKey:    "standard",
      isSystem:     true,
      isDefault:    true,
      isActive:     true,
    })),
  });

  // Professional Branded Invoice — INVOICE only, not default, branded layout
  await db.pdfTemplate.createMany({
    skipDuplicates: true,
    data: [{
      tenantId,
      documentType: "INVOICE" as never,
      name:         "Professional Branded Invoice",
      description:  "EJC-style structured invoice: branded header, bill-to, item table, totals, notes, payment terms, warranty. Colours resolve from organisation branding.",
      layoutKey:    "professional_branded_invoice",
      isSystem:     true,
      isDefault:    false,
      isActive:     true,
      config:       {
        useBrandAccent:                true,
        primaryColorFallback:          "#1B3A6B",
        tableHeaderUsesBrandAccent:    true,
        sectionHeadingUsesBrandAccent: true,
        alternateRowColor:             "#EBF1FA",
        borderColor:                   "#CCCCCC",
        showSubject:                   true,
        showNotes:                     true,
        showPaymentTerms:              true,
        showWarranty:                  true,
      } as never,
    }],
  });
}

// ─── Combined entry point ─────────────────────────────────────────────────────

/**
 * Seeds all default setup data for a newly created tenant.
 *
 * Pass `tx` from prisma.$transaction to run atomically with tenant creation:
 *   await seedTenantDefaults(tenant.id, tx);
 *
 * Omit `tx` for standalone use (backfill scripts, repair routes):
 *   await seedTenantDefaults(tenantId);
 *
 * Uses sequential await (not Promise.all) so it is safe inside an interactive
 * transaction — Prisma's transaction client uses one connection and concurrent
 * queries on it can cause "Transaction already closed" errors.
 */
export async function seedTenantDefaults(
  tenantId: string,
  db: DbClient = prisma,
): Promise<void> {
  await seedDefaultPaymentTermsForTenant(tenantId, db);
  await seedDefaultReminderRulesForTenant(tenantId, db);
  await seedDefaultTransactionNumberSeriesForTenant(tenantId, db);
  await seedDefaultPdfTemplatesForTenant(tenantId, db);
}
