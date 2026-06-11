/**
 * Backfill: seed missing system defaults for all tenants.
 *
 * Covers:
 *   - 7 system payment terms (including Net 30 as default)
 *   - 10 system reminder rules
 *   - 10 transaction number series (one per module)
 *
 * IDEMPOTENT — uses createMany({ skipDuplicates: true }) for every tenant.
 * The DB uniqueness constraints prevent duplicates; no counting/skipping logic
 * needed. Run this as many times as needed — tenants with complete records are
 * silently unchanged; tenants with partial records get the missing rows.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-tenant-defaults.mjs
 *
 * Requires DATABASE_URL or DIRECT_URL in the environment (port 5432 session pooler).
 */

import { PrismaClient } from "@prisma/client";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });

let prisma;
try {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
} catch {
  prisma = new PrismaClient();
}

// ─── Default data ─────────────────────────────────────────────────────────────

const PAYMENT_TERMS = [
  { name: "Due on Receipt",        dueType: "DUE_ON_RECEIPT",    dueInDays: null, appliesTo: "BOTH", isDefault: false },
  { name: "Net 15",                dueType: "FIXED_DAYS",        dueInDays: 15,   appliesTo: "BOTH", isDefault: false },
  { name: "Net 30",                dueType: "FIXED_DAYS",        dueInDays: 30,   appliesTo: "BOTH", isDefault: true  },
  { name: "Net 60",                dueType: "FIXED_DAYS",        dueInDays: 60,   appliesTo: "BOTH", isDefault: false },
  { name: "Net 90",                dueType: "FIXED_DAYS",        dueInDays: 90,   appliesTo: "BOTH", isDefault: false },
  { name: "Due end of the month",  dueType: "END_OF_MONTH",      dueInDays: null, appliesTo: "BOTH", isDefault: false },
  { name: "Due end of next month", dueType: "END_OF_NEXT_MONTH", dueInDays: null, appliesTo: "BOTH", isDefault: false },
];

const REMINDER_RULES = [
  { entityType: "INVOICE", kind: "MANUAL",    name: "Reminder for Overdue Invoices", triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 0  },
  { entityType: "INVOICE", kind: "MANUAL",    name: "Reminder for Sent Invoices",    triggerBasis: "ISSUE_DATE",            direction: "AFTER",   offsetDays: 0  },
  { entityType: "INVOICE", kind: "AUTOMATED", name: "Payment Expected",              triggerBasis: "EXPECTED_PAYMENT_DATE", direction: "ON_DATE", offsetDays: 0  },
  { entityType: "INVOICE", kind: "AUTOMATED", name: "Reminder - 1",                  triggerBasis: "DUE_DATE",              direction: "ON_DATE", offsetDays: 0  },
  { entityType: "INVOICE", kind: "AUTOMATED", name: "Reminder - 2",                  triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 7  },
  { entityType: "INVOICE", kind: "AUTOMATED", name: "Reminder - 3",                  triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 14 },
  { entityType: "BILL",    kind: "MANUAL",    name: "Reminder for Upcoming Bills",   triggerBasis: "DUE_DATE",              direction: "BEFORE",  offsetDays: 0  },
  { entityType: "BILL",    kind: "MANUAL",    name: "Reminder for Overdue Bills",    triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 0  },
  { entityType: "BILL",    kind: "AUTOMATED", name: "Bill Due Reminder",             triggerBasis: "DUE_DATE",              direction: "BEFORE",  offsetDays: 3  },
  { entityType: "BILL",    kind: "AUTOMATED", name: "Overdue Bill Reminder",         triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 1  },
];

const TRANSACTION_NUMBER_SERIES = [
  { module: "INVOICE",          prefix: "INV",  nextNumber: 1, padLength: 5 },
  { module: "CUSTOMER_PAYMENT", prefix: "PAY",  nextNumber: 1, padLength: 5 },
  { module: "CREDIT_NOTE",      prefix: "CN",   nextNumber: 1, padLength: 5 },
  { module: "BILL",             prefix: "BILL", nextNumber: 1, padLength: 5 },
  { module: "VENDOR_PAYMENT",   prefix: "VPAY", nextNumber: 1, padLength: 5 },
  { module: "JOURNAL",          prefix: "JNL",  nextNumber: 1, padLength: 5 },
  { module: "ESTIMATE",         prefix: "EST",  nextNumber: 1, padLength: 5 },
  { module: "PURCHASE_ORDER",   prefix: "PO",   nextNumber: 1, padLength: 5 },
  { module: "VENDOR_CREDIT",    prefix: "VC",   nextNumber: 1, padLength: 5 },
  { module: "DEBIT_NOTE",       prefix: "DN",   nextNumber: 1, padLength: 5 },
];

// Default values for new columns added post-initial migration.
const TNS_BOOL_DEFAULTS = { suffix: "", allowManualOverride: true, preventDuplicates: true };

const PDF_TEMPLATE_DOC_TYPES = [
  "ESTIMATE", "INVOICE", "SALES_RECEIPT", "CREDIT_NOTE",
  "PAYMENT_RECEIPT", "CUSTOMER_STATEMENT", "BILL", "VENDOR_CREDIT",
  "VENDOR_PAYMENT", "VENDOR_STATEMENT", "JOURNAL", "ADDITIONAL_INFORMATION",
];

const PDF_TEMPLATE_DESCRIPTIONS = {
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

// ─── Email notification templates data ────────────────────────────────────────

const EMAIL_NOTIFICATION_TEMPLATES = [
  // SALES
  { category: "SALES",     event: "INVOICE_SENT",              name: "Invoice Sent",                      isConnected: false,
    subject: "Invoice {{invoice.number}} from {{organisation.name}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Please find attached invoice {{invoice.number}} for {{invoice.total}}.</p><p>Balance due: {{invoice.balance_due}}<br>Due date: {{invoice.due_date}}</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{invoice.number}}","{{invoice.date}}","{{invoice.due_date}}","{{invoice.total}}","{{invoice.balance_due}}","{{customer.name}}","{{customer.company_name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}","{{organisation.address}}"] },
  { category: "SALES",     event: "ESTIMATE_SENT",             name: "Estimate Sent",                     isConnected: false,
    subject: "Estimate {{estimate.number}} from {{organisation.name}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Please find attached estimate {{estimate.number}} for {{estimate.total}}.</p><p>This estimate is valid for 30 days. To accept, please reply to this email or contact us directly.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{estimate.number}}","{{estimate.date}}","{{estimate.total}}","{{customer.name}}","{{customer.company_name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"] },
  { category: "SALES",     event: "PAYMENT_RECEIPT_SENT",      name: "Payment Receipt Sent",              isConnected: false,
    subject: "Payment received \u2013 Invoice {{invoice.number}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>We have received your payment of {{payment.amount}} on {{payment.date}} for invoice {{invoice.number}}.</p><p>Payment reference: {{payment.reference}}</p><p>Thank you for your prompt payment.</p><p>{{organisation.name}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{invoice.number}}","{{payment.amount}}","{{payment.date}}","{{payment.reference}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}"] },
  { category: "SALES",     event: "CREDIT_NOTE_SENT",          name: "Credit Note Sent",                  isConnected: false,
    subject: "Credit Note {{credit_note.number}} from {{organisation.name}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Please find attached credit note {{credit_note.number}} for {{credit_note.total}}.</p><p>This credit will be applied to your outstanding balance or refunded as agreed.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{credit_note.number}}","{{credit_note.total}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}"] },
  { category: "SALES",     event: "CUSTOMER_STATEMENT_SENT",   name: "Customer Statement Sent",           isConnected: false,
    subject: "Account Statement from {{organisation.name}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Please find attached your account statement as of {{statement.date}}.</p><p>Currency: {{tenant.currency}}</p><p>If you have any questions about your account, please contact us.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{statement.date}}","{{tenant.currency}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"] },
  // PURCHASES
  { category: "PURCHASES", event: "PURCHASE_ORDER_SENT",       name: "Purchase Order Sent",               isConnected: false,
    subject: "Purchase Order {{purchase_order.number}} from {{organisation.name}}",
    bodyHtml: "<p>Dear {{vendor.name}},</p><p>Please find attached purchase order {{purchase_order.number}} for your reference.</p><p>Total: {{purchase_order.total}}</p><p>Kindly confirm receipt and advise the expected delivery date.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{purchase_order.number}}","{{purchase_order.total}}","{{vendor.name}}","{{vendor.company_name}}","{{vendor.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"] },
  { category: "PURCHASES", event: "BILL_REMINDER",             name: "Bill Reminder",                     isConnected: false,
    subject: "Payment Reminder \u2013 {{bill.number}}",
    bodyHtml: "<p>Dear {{vendor.name}},</p><p>This is a reminder that bill {{bill.number}} for {{bill.total}} is due on {{bill.due_date}}.</p><p>Please ensure payment is arranged on time to avoid delays.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{bill.number}}","{{bill.date}}","{{bill.due_date}}","{{bill.total}}","{{bill.balance_due}}","{{vendor.name}}","{{vendor.email}}","{{organisation.name}}","{{organisation.email}}"] },
  { category: "PURCHASES", event: "VENDOR_PAYMENT_ADVICE",     name: "Vendor Payment Advice",             isConnected: false,
    subject: "Payment Advice \u2013 {{bill.number}} from {{organisation.name}}",
    bodyHtml: "<p>Dear {{vendor.name}},</p><p>We are pleased to advise that payment of {{payment.amount}} has been processed on {{payment.date}} in settlement of bill {{bill.number}}.</p><p>Payment reference: {{payment.reference}}</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{bill.number}}","{{bill.total}}","{{payment.amount}}","{{payment.date}}","{{payment.reference}}","{{vendor.name}}","{{vendor.email}}","{{organisation.name}}","{{organisation.email}}"] },
  { category: "PURCHASES", event: "VENDOR_CREDIT_SENT",        name: "Vendor Credit Sent",                isConnected: false,
    subject: "Vendor Credit {{vendor_credit.number}} from {{organisation.name}}",
    bodyHtml: "<p>Dear {{vendor.name}},</p><p>Please find attached vendor credit note {{vendor_credit.number}} for {{vendor_credit.total}}.</p><p>This credit has been raised on your account.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{vendor_credit.number}}","{{vendor_credit.total}}","{{vendor.name}}","{{vendor.email}}","{{organisation.name}}","{{organisation.email}}"] },
  // REMINDERS
  { category: "REMINDERS", event: "INVOICE_REMINDER_BEFORE_DUE", name: "Invoice Reminder - Before Due",     isConnected: false,
    subject: "Reminder: Invoice {{invoice.number}} is due on {{invoice.due_date}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>This is a friendly reminder that invoice {{invoice.number}} for {{invoice.total}} is due on {{invoice.due_date}}.</p><p>Outstanding balance: {{invoice.balance_due}}</p><p>Please disregard this message if payment has already been made.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{invoice.number}}","{{invoice.date}}","{{invoice.due_date}}","{{invoice.total}}","{{invoice.balance_due}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"] },
  { category: "REMINDERS", event: "INVOICE_REMINDER_ON_DUE",     name: "Invoice Reminder - On Due Date",    isConnected: false,
    subject: "Due Today: Invoice {{invoice.number}} \u2013 {{invoice.balance_due}} outstanding",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Invoice {{invoice.number}} for {{invoice.balance_due}} is due today, {{invoice.due_date}}.</p><p>Please arrange payment at your earliest convenience.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{invoice.number}}","{{invoice.due_date}}","{{invoice.total}}","{{invoice.balance_due}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"] },
  { category: "REMINDERS", event: "INVOICE_REMINDER_AFTER_DUE",  name: "Invoice Reminder - After Due Date", isConnected: false,
    subject: "Overdue: Invoice {{invoice.number}} was due on {{invoice.due_date}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Invoice {{invoice.number}} for {{invoice.balance_due}} was due on {{invoice.due_date}} and remains unpaid.</p><p>Please arrange payment immediately or contact us to discuss.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
    availableVariables: ["{{invoice.number}}","{{invoice.due_date}}","{{invoice.total}}","{{invoice.balance_due}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"] },
  { category: "REMINDERS", event: "BILL_REMINDER_BEFORE_DUE",    name: "Bill Reminder - Before Due",        isConnected: false,
    subject: "Upcoming Bill: {{bill.number}} is due on {{bill.due_date}}",
    bodyHtml: "<p>Internal reminder: Bill {{bill.number}} from {{vendor.name}} for {{bill.total}} is due on {{bill.due_date}}.</p><p>Outstanding: {{bill.balance_due}}</p><p>Please ensure payment is arranged on time.</p><p>{{organisation.name}}</p>",
    availableVariables: ["{{bill.number}}","{{bill.date}}","{{bill.due_date}}","{{bill.total}}","{{bill.balance_due}}","{{vendor.name}}","{{organisation.name}}"] },
  { category: "REMINDERS", event: "BILL_REMINDER_ON_DUE",        name: "Bill Reminder - On Due Date",       isConnected: false,
    subject: "Bill Due Today: {{bill.number}} \u2013 {{bill.balance_due}}",
    bodyHtml: "<p>Internal reminder: Bill {{bill.number}} from {{vendor.name}} for {{bill.balance_due}} is due today.</p><p>Please process payment as soon as possible to avoid late fees.</p><p>{{organisation.name}}</p>",
    availableVariables: ["{{bill.number}}","{{bill.due_date}}","{{bill.total}}","{{bill.balance_due}}","{{vendor.name}}","{{organisation.name}}"] },
  { category: "REMINDERS", event: "BILL_REMINDER_AFTER_DUE",     name: "Bill Reminder - After Due Date",    isConnected: false,
    subject: "Overdue Bill: {{bill.number}} \u2013 Immediate Payment Required",
    bodyHtml: "<p>Internal alert: Bill {{bill.number}} from {{vendor.name}} for {{bill.balance_due}} was due on {{bill.due_date}} and has not been paid.</p><p>Please arrange payment immediately to avoid penalties.</p><p>{{organisation.name}}</p>",
    availableVariables: ["{{bill.number}}","{{bill.due_date}}","{{bill.total}}","{{bill.balance_due}}","{{vendor.name}}","{{organisation.name}}"] },
  // GENERAL
  { category: "GENERAL",   event: "USER_INVITATION",           name: "User Invitation",                   isConnected: true,
    subject: "You have been invited to join {{organisation.name}} on FINOS",
    bodyHtml: "<p>Hello,</p><p>You have been invited to join {{organisation.name}} on FINOS.</p><p>Click the link below to accept your invitation and set up your account. This link expires in 48 hours.</p><p>{{invitation.link}}</p><p>If you did not expect this invitation, you can safely ignore this email.</p><p>{{organisation.name}}</p>",
    availableVariables: ["{{organisation.name}}","{{organisation.email}}","{{invitation.link}}"] },
  { category: "GENERAL",   event: "ORGANISATION_INVITATION",   name: "Organisation Invitation",           isConnected: false,
    subject: "You are invited to access the {{organisation.name}} portal",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>You have been invited to access the {{organisation.name}} client portal on FINOS.</p><p>Click the link below to accept your invitation. This link expires in 48 hours.</p><p>{{invitation.link}}</p><p>If you did not expect this invitation, please ignore this email.</p><p>{{organisation.name}}</p>",
    availableVariables: ["{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{invitation.link}}"] },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Backfill: tenant defaults (payment terms + reminder rules + TNS + PDF templates + email notifications) ===\n");

  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  console.log(`Tenants found: ${tenants.length}\n`);

  let totalPtCreated   = 0;
  let totalPtSkipped   = 0;
  let totalRrCreated   = 0;
  let totalRrSkipped   = 0;
  let totalTnsCreated  = 0;
  let totalTnsSkipped  = 0;
  let totalPdfCreated  = 0;
  let totalPdfSkipped  = 0;
  let totalEntCreated  = 0;
  let totalEntSkipped  = 0;

  for (const tenant of tenants) {
    // ── Payment terms ────────────────────────────────────────────────────────
    const ptResult = await prisma.paymentTerm.createMany({
      skipDuplicates: true,
      data: PAYMENT_TERMS.map((t) => ({
        tenantId:  tenant.id,
        name:      t.name,
        dueType:   t.dueType,
        dueInDays: t.dueInDays,
        appliesTo: t.appliesTo,
        isDefault: t.isDefault,
        isSystem:  true,
        isActive:  true,
      })),
    });

    const ptCreated = ptResult.count;
    const ptSkipped = PAYMENT_TERMS.length - ptCreated;
    totalPtCreated += ptCreated;
    totalPtSkipped += ptSkipped;

    // ── Reminder rules ───────────────────────────────────────────────────────
    const rrResult = await prisma.reminderRule.createMany({
      skipDuplicates: true,
      data: REMINDER_RULES.map((r) => ({
        tenantId:     tenant.id,
        entityType:   r.entityType,
        kind:         r.kind,
        name:         r.name,
        triggerBasis: r.triggerBasis,
        direction:    r.direction,
        offsetDays:   r.offsetDays,
        isSystem:     true,
        isActive:     false,
      })),
    });

    const rrCreated = rrResult.count;
    const rrSkipped = REMINDER_RULES.length - rrCreated;
    totalRrCreated += rrCreated;
    totalRrSkipped += rrSkipped;

    // ── Transaction number series ─────────────────────────────────────────────
    const tnsResult = await prisma.transactionNumberSeries.createMany({
      skipDuplicates: true,
      data: TRANSACTION_NUMBER_SERIES.map((s) => ({
        tenantId:            tenant.id,
        module:              s.module,
        prefix:              s.prefix,
        suffix:              TNS_BOOL_DEFAULTS.suffix,
        nextNumber:          s.nextNumber,
        padLength:           s.padLength,
        restartFreq:         "NEVER",
        isEnabled:           true,
        allowManualOverride: TNS_BOOL_DEFAULTS.allowManualOverride,
        preventDuplicates:   TNS_BOOL_DEFAULTS.preventDuplicates,
      })),
    });

    const tnsCreated = tnsResult.count;
    const tnsSkipped = TRANSACTION_NUMBER_SERIES.length - tnsCreated;
    totalTnsCreated += tnsCreated;
    totalTnsSkipped += tnsSkipped;

    // ── PDF templates ─────────────────────────────────────────────────────────
    const pdfResult = await prisma.pdfTemplate.createMany({
      skipDuplicates: true,
      data: PDF_TEMPLATE_DOC_TYPES.map((documentType) => ({
        tenantId:    tenant.id,
        documentType,
        name:        "Standard Template",
        description: PDF_TEMPLATE_DESCRIPTIONS[documentType] ?? null,
        layoutKey:   "standard",
        isSystem:    true,
        isDefault:   true,
        isActive:    true,
      })),
    });

    const pdfCreated = pdfResult.count;
    const pdfSkipped = PDF_TEMPLATE_DOC_TYPES.length - pdfCreated;
    totalPdfCreated += pdfCreated;
    totalPdfSkipped += pdfSkipped;

    // Professional Branded Invoice (INVOICE only)
    await prisma.pdfTemplate.createMany({
      skipDuplicates: true,
      data: [{
        tenantId:    tenant.id,
        documentType: "INVOICE",
        name:        "Professional Branded Invoice",
        description: "EJC-style structured invoice: branded header, bill-to, item table, totals, notes, payment terms, warranty. Colours resolve from organisation branding.",
        layoutKey:   "professional_branded_invoice",
        isSystem:    true,
        isDefault:   false,
        isActive:    true,
        config: {
          useBrandAccent: true,
          primaryColorFallback: "#1B3A6B",
          tableHeaderUsesBrandAccent: true,
          sectionHeadingUsesBrandAccent: true,
          alternateRowColor: "#EBF1FA",
          borderColor: "#CCCCCC",
          showSubject: true,
          showNotes: true,
          showPaymentTerms: true,
          showWarranty: true,
        },
      }],
    });

    // ── Email notification templates ─────────────────────────────────────────
    const entResult = await prisma.emailNotificationTemplate.createMany({
      skipDuplicates: true,
      data: EMAIL_NOTIFICATION_TEMPLATES.map((t) => ({
        tenantId:           tenant.id,
        category:           t.category,
        event:              t.event,
        name:               t.name,
        subject:            t.subject,
        bodyHtml:           t.bodyHtml,
        isEnabled:          true,
        isSystem:           true,
        isCustomised:       false,
        isConnected:        t.isConnected,
        availableVariables: t.availableVariables,
      })),
    });

    const entCreated = entResult.count;
    const entSkipped = EMAIL_NOTIFICATION_TEMPLATES.length - entCreated;
    totalEntCreated += entCreated;
    totalEntSkipped += entSkipped;

    // ── Per-tenant summary ───────────────────────────────────────────────────
    const ptStatus  = ptCreated  === 0 ? "already complete" : `${ptCreated} created`;
    const rrStatus  = rrCreated  === 0 ? "already complete" : `${rrCreated} created`;
    const tnsStatus = tnsCreated === 0 ? "already complete" : `${tnsCreated} created`;
    const pdfStatus = pdfCreated === 0 ? "already complete" : `${pdfCreated} created`;
    const entStatus = entCreated === 0 ? "already complete" : `${entCreated} created`;
    console.log(`  ${tenant.name} (${tenant.id.slice(0, 8)}…)`);
    console.log(`    payment terms     : ${ptStatus}${ptSkipped   > 0 ? `, ${ptSkipped} skipped`   : ""}`);
    console.log(`    reminder rules    : ${rrStatus}${rrSkipped   > 0 ? `, ${rrSkipped} skipped`   : ""}`);
    console.log(`    number series     : ${tnsStatus}${tnsSkipped > 0 ? `, ${tnsSkipped} skipped`  : ""}`);
    console.log(`    pdf templates     : ${pdfStatus}${pdfSkipped > 0 ? `, ${pdfSkipped} skipped`  : ""}`);
    console.log(`    email notifs      : ${entStatus}${entSkipped > 0 ? `, ${entSkipped} skipped`  : ""}`);
  }

  console.log("\n=== Summary ===");
  console.log(`Tenants processed             : ${tenants.length}`);
  console.log(`Payment terms  created        : ${totalPtCreated}`);
  console.log(`Payment terms  skipped        : ${totalPtSkipped}`);
  console.log(`Reminder rules created        : ${totalRrCreated}`);
  console.log(`Reminder rules skipped        : ${totalRrSkipped}`);
  console.log(`Transaction series created    : ${totalTnsCreated}`);
  console.log(`Transaction series skipped    : ${totalTnsSkipped}`);
  console.log(`PDF templates  created        : ${totalPdfCreated}`);
  console.log(`PDF templates  skipped        : ${totalPdfSkipped}`);
  console.log(`Email notifs   created        : ${totalEntCreated}`);
  console.log(`Email notifs   skipped        : ${totalEntSkipped}`);
  console.log("\nBackfill complete.\n");
}

main()
  .catch((err) => {
    console.error("\nBackfill FAILED:", err.message ?? err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
