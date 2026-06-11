/**
 * Email notification template renderer.
 * Pure, client-safe — no server-only imports.
 * Safe to import in "use client" components.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailNotificationCategory = "SALES" | "PURCHASES" | "REMINDERS" | "GENERAL";

export type EmailNotificationEvent =
  | "ESTIMATE_SENT"
  | "INVOICE_SENT"
  | "PAYMENT_RECEIPT_SENT"
  | "CREDIT_NOTE_SENT"
  | "CUSTOMER_STATEMENT_SENT"
  | "PURCHASE_ORDER_SENT"
  | "BILL_REMINDER"
  | "VENDOR_PAYMENT_ADVICE"
  | "VENDOR_CREDIT_SENT"
  | "INVOICE_REMINDER_BEFORE_DUE"
  | "INVOICE_REMINDER_ON_DUE"
  | "INVOICE_REMINDER_AFTER_DUE"
  | "BILL_REMINDER_BEFORE_DUE"
  | "BILL_REMINDER_ON_DUE"
  | "BILL_REMINDER_AFTER_DUE"
  | "USER_INVITATION"
  | "ORGANISATION_INVITATION";

export type EmailNotificationTemplateRow = {
  id:                 string;
  tenantId:           string;
  category:           EmailNotificationCategory;
  event:              EmailNotificationEvent;
  name:               string;
  subject:            string;
  bodyHtml:           string;
  bodyText:           string | null;
  isEnabled:          boolean;
  isSystem:           boolean;
  isCustomised:       boolean;
  isConnected:        boolean;
  availableVariables: string[];
  config:             Record<string, unknown>;
  createdAt:          Date;
  updatedAt:          Date;
};

// ─── Display helpers ──────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<EmailNotificationCategory, string> = {
  SALES:     "Sales",
  PURCHASES: "Purchases",
  REMINDERS: "Reminders",
  GENERAL:   "General",
};

export const CATEGORY_ORDER: EmailNotificationCategory[] = [
  "SALES", "PURCHASES", "REMINDERS", "GENERAL",
];

export const EVENT_LABELS: Record<EmailNotificationEvent, string> = {
  ESTIMATE_SENT:               "Estimate Sent",
  INVOICE_SENT:                "Invoice Sent",
  PAYMENT_RECEIPT_SENT:        "Payment Receipt Sent",
  CREDIT_NOTE_SENT:            "Credit Note Sent",
  CUSTOMER_STATEMENT_SENT:     "Customer Statement Sent",
  PURCHASE_ORDER_SENT:         "Purchase Order Sent",
  BILL_REMINDER:               "Bill Reminder",
  VENDOR_PAYMENT_ADVICE:       "Vendor Payment Advice",
  VENDOR_CREDIT_SENT:          "Vendor Credit Sent",
  INVOICE_REMINDER_BEFORE_DUE: "Invoice Reminder \u2013 Before Due",
  INVOICE_REMINDER_ON_DUE:     "Invoice Reminder \u2013 On Due Date",
  INVOICE_REMINDER_AFTER_DUE:  "Invoice Reminder \u2013 After Due Date",
  BILL_REMINDER_BEFORE_DUE:    "Bill Reminder \u2013 Before Due",
  BILL_REMINDER_ON_DUE:        "Bill Reminder \u2013 On Due Date",
  BILL_REMINDER_AFTER_DUE:     "Bill Reminder \u2013 After Due Date",
  USER_INVITATION:             "User Invitation",
  ORGANISATION_INVITATION:     "Organisation Invitation",
};

// ─── Available variables per event ───────────────────────────────────────────

export const VARIABLES_BY_EVENT: Record<EmailNotificationEvent, string[]> = {
  INVOICE_SENT: [
    "{{invoice.number}}", "{{invoice.date}}", "{{invoice.due_date}}",
    "{{invoice.total}}", "{{invoice.balance_due}}",
    "{{customer.name}}", "{{customer.company_name}}", "{{customer.email}}",
    "{{organisation.name}}", "{{organisation.email}}", "{{organisation.phone}}", "{{organisation.address}}",
  ],
  ESTIMATE_SENT: [
    "{{estimate.number}}", "{{estimate.date}}", "{{estimate.total}}",
    "{{customer.name}}", "{{customer.company_name}}", "{{customer.email}}",
    "{{organisation.name}}", "{{organisation.email}}", "{{organisation.phone}}",
  ],
  PAYMENT_RECEIPT_SENT: [
    "{{invoice.number}}",
    "{{payment.amount}}", "{{payment.date}}", "{{payment.reference}}",
    "{{customer.name}}", "{{customer.email}}",
    "{{organisation.name}}", "{{organisation.email}}",
  ],
  CREDIT_NOTE_SENT: [
    "{{credit_note.number}}", "{{credit_note.total}}",
    "{{customer.name}}", "{{customer.email}}",
    "{{organisation.name}}", "{{organisation.email}}",
  ],
  CUSTOMER_STATEMENT_SENT: [
    "{{statement.date}}", "{{tenant.currency}}",
    "{{customer.name}}", "{{customer.email}}",
    "{{organisation.name}}", "{{organisation.email}}", "{{organisation.phone}}",
  ],
  PURCHASE_ORDER_SENT: [
    "{{purchase_order.number}}", "{{purchase_order.total}}",
    "{{vendor.name}}", "{{vendor.company_name}}", "{{vendor.email}}",
    "{{organisation.name}}", "{{organisation.email}}", "{{organisation.phone}}",
  ],
  BILL_REMINDER: [
    "{{bill.number}}", "{{bill.date}}", "{{bill.due_date}}", "{{bill.total}}", "{{bill.balance_due}}",
    "{{vendor.name}}", "{{vendor.email}}",
    "{{organisation.name}}", "{{organisation.email}}",
  ],
  VENDOR_PAYMENT_ADVICE: [
    "{{bill.number}}", "{{bill.total}}",
    "{{payment.amount}}", "{{payment.date}}", "{{payment.reference}}",
    "{{vendor.name}}", "{{vendor.email}}",
    "{{organisation.name}}", "{{organisation.email}}",
  ],
  VENDOR_CREDIT_SENT: [
    "{{vendor_credit.number}}", "{{vendor_credit.total}}",
    "{{vendor.name}}", "{{vendor.email}}",
    "{{organisation.name}}", "{{organisation.email}}",
  ],
  INVOICE_REMINDER_BEFORE_DUE: [
    "{{invoice.number}}", "{{invoice.date}}", "{{invoice.due_date}}",
    "{{invoice.total}}", "{{invoice.balance_due}}",
    "{{customer.name}}", "{{customer.email}}",
    "{{organisation.name}}", "{{organisation.email}}", "{{organisation.phone}}",
  ],
  INVOICE_REMINDER_ON_DUE: [
    "{{invoice.number}}", "{{invoice.due_date}}", "{{invoice.total}}", "{{invoice.balance_due}}",
    "{{customer.name}}", "{{customer.email}}",
    "{{organisation.name}}", "{{organisation.email}}", "{{organisation.phone}}",
  ],
  INVOICE_REMINDER_AFTER_DUE: [
    "{{invoice.number}}", "{{invoice.due_date}}", "{{invoice.total}}", "{{invoice.balance_due}}",
    "{{customer.name}}", "{{customer.email}}",
    "{{organisation.name}}", "{{organisation.email}}", "{{organisation.phone}}",
  ],
  BILL_REMINDER_BEFORE_DUE: [
    "{{bill.number}}", "{{bill.date}}", "{{bill.due_date}}", "{{bill.total}}", "{{bill.balance_due}}",
    "{{vendor.name}}",
    "{{organisation.name}}",
  ],
  BILL_REMINDER_ON_DUE: [
    "{{bill.number}}", "{{bill.due_date}}", "{{bill.total}}", "{{bill.balance_due}}",
    "{{vendor.name}}",
    "{{organisation.name}}",
  ],
  BILL_REMINDER_AFTER_DUE: [
    "{{bill.number}}", "{{bill.due_date}}", "{{bill.total}}", "{{bill.balance_due}}",
    "{{vendor.name}}",
    "{{organisation.name}}",
  ],
  USER_INVITATION: [
    "{{organisation.name}}", "{{organisation.email}}",
    "{{invitation.link}}",
  ],
  ORGANISATION_INVITATION: [
    "{{customer.name}}", "{{customer.email}}",
    "{{organisation.name}}",
    "{{invitation.link}}",
  ],
};

// ─── Template context ─────────────────────────────────────────────────────────

export type TemplateContext = {
  organisation?:   { name?: string; email?: string; phone?: string; address?: string };
  customer?:       { name?: string; company_name?: string; email?: string };
  vendor?:         { name?: string; company_name?: string; email?: string };
  invoice?:        { number?: string; date?: string; due_date?: string; total?: string; balance_due?: string };
  estimate?:       { number?: string; date?: string; total?: string };
  payment?:        { amount?: string; date?: string; reference?: string };
  bill?:           { number?: string; date?: string; due_date?: string; total?: string; balance_due?: string };
  credit_note?:    { number?: string; total?: string };
  vendor_credit?:  { number?: string; total?: string };
  purchase_order?: { number?: string; total?: string };
  statement?:      { date?: string };
  invitation?:     { link?: string };
  tenant?:         { currency?: string };
};

/** Safe sample context used for previews. */
export const SAMPLE_CONTEXT: TemplateContext = {
  organisation:   { name: "Acme Corp Ltd", email: "info@acmecorp.com", phone: "+234 801 234 5678", address: "12 Victoria Island, Lagos" },
  customer:       { name: "David Okafor", company_name: "Okafor & Sons Ltd", email: "david@okafor.com" },
  vendor:         { name: "Global Supplies Co.", company_name: "Global Supplies Co.", email: "orders@globalsupplies.com" },
  invoice:        { number: "INV-00042", date: "10 Jun 2026", due_date: "10 Jul 2026", total: "\u20a6450,000.00", balance_due: "\u20a6450,000.00" },
  estimate:       { number: "EST-00015", date: "10 Jun 2026", total: "\u20a6210,000.00" },
  payment:        { amount: "\u20a6450,000.00", date: "11 Jun 2026", reference: "PAY-00017" },
  bill:           { number: "BILL-00031", date: "01 Jun 2026", due_date: "30 Jun 2026", total: "\u20a6180,000.00", balance_due: "\u20a6180,000.00" },
  credit_note:    { number: "CN-00008",  total: "\u20a650,000.00" },
  vendor_credit:  { number: "VC-00003",  total: "\u20a625,000.00" },
  purchase_order: { number: "PO-00011",  total: "\u20a6380,000.00" },
  statement:      { date: "10 Jun 2026" },
  invitation:     { link: "https://app.finos.com/invite/accept?token=sample" },
  tenant:         { currency: "NGN" },
};

// ─── Renderer ─────────────────────────────────────────────────────────────────

function interpolate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{([a-z_]+)\.([a-z_]+)\}\}/g, (_match, entity, field) => {
    const obj = (context as Record<string, Record<string, string | undefined>>)[entity];
    return obj?.[field] ?? `{{${entity}.${field}}}`;
  });
}

/** Render subject string with context values. */
export function renderEmailSubject(subject: string, context: TemplateContext): string {
  return interpolate(subject, context);
}

/**
 * Render body_html with context values.
 * Strips <script> tags before interpolation.
 */
export function renderEmailBody(bodyHtml: string, context: TemplateContext): string {
  const safe = bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
  return interpolate(safe, context);
}

/** Return the list of supported variables for an event. */
export function listVariablesForEvent(event: string): string[] {
  return VARIABLES_BY_EVENT[event as EmailNotificationEvent] ?? [];
}

/**
 * Validate template subject + body against the event's allowed variables.
 * Returns warning strings (empty array = no issues).
 */
export function validateTemplateVariables(
  subject:  string,
  bodyHtml: string,
  event:    string,
): string[] {
  const warnings: string[] = [];

  if (/<script/i.test(subject) || /<script/i.test(bodyHtml)) {
    warnings.push("Script tags are not allowed in email templates.");
  }

  const allowed     = new Set(listVariablesForEvent(event));
  const seen        = new Set<string>();
  const allMatches  = [
    ...Array.from(subject.matchAll(/\{\{[a-z_]+\.[a-z_]+\}\}/g)),
    ...Array.from(bodyHtml.matchAll(/\{\{[a-z_]+\.[a-z_]+\}\}/g)),
  ];

  for (const match of allMatches) {
    const p = match[0];
    if (!allowed.has(p) && !seen.has(p)) {
      seen.add(p);
      warnings.push(`Unsupported variable: ${p}`);
    }
  }

  return warnings;
}

// ─── System defaults ──────────────────────────────────────────────────────────

export type SystemEmailDefault = { subject: string; bodyHtml: string };

export const SYSTEM_EMAIL_DEFAULTS: Record<EmailNotificationEvent, SystemEmailDefault> = {
  INVOICE_SENT: {
    subject:  "Invoice {{invoice.number}} from {{organisation.name}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Please find attached invoice {{invoice.number}} for {{invoice.total}}.</p><p>Balance due: {{invoice.balance_due}}<br>Due date: {{invoice.due_date}}</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
  },
  ESTIMATE_SENT: {
    subject:  "Estimate {{estimate.number}} from {{organisation.name}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Please find attached estimate {{estimate.number}} for {{estimate.total}}.</p><p>This estimate is valid for 30 days. To accept, please reply to this email or contact us directly.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
  },
  PAYMENT_RECEIPT_SENT: {
    subject:  "Payment received \u2013 Invoice {{invoice.number}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>We have received your payment of {{payment.amount}} on {{payment.date}} for invoice {{invoice.number}}.</p><p>Payment reference: {{payment.reference}}</p><p>Thank you for your prompt payment.</p><p>{{organisation.name}}<br>{{organisation.email}}</p>",
  },
  CREDIT_NOTE_SENT: {
    subject:  "Credit Note {{credit_note.number}} from {{organisation.name}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Please find attached credit note {{credit_note.number}} for {{credit_note.total}}.</p><p>This credit will be applied to your outstanding balance or refunded as agreed.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>",
  },
  CUSTOMER_STATEMENT_SENT: {
    subject:  "Account Statement from {{organisation.name}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Please find attached your account statement as of {{statement.date}}.</p><p>Currency: {{tenant.currency}}</p><p>If you have any questions about your account, please contact us.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
  },
  PURCHASE_ORDER_SENT: {
    subject:  "Purchase Order {{purchase_order.number}} from {{organisation.name}}",
    bodyHtml: "<p>Dear {{vendor.name}},</p><p>Please find attached purchase order {{purchase_order.number}} for your reference.</p><p>Total: {{purchase_order.total}}</p><p>Kindly confirm receipt and advise the expected delivery date.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
  },
  BILL_REMINDER: {
    subject:  "Payment Reminder \u2013 {{bill.number}}",
    bodyHtml: "<p>Dear {{vendor.name}},</p><p>This is a reminder that bill {{bill.number}} for {{bill.total}} is due on {{bill.due_date}}.</p><p>Please ensure payment is arranged on time to avoid delays.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>",
  },
  VENDOR_PAYMENT_ADVICE: {
    subject:  "Payment Advice \u2013 {{bill.number}} from {{organisation.name}}",
    bodyHtml: "<p>Dear {{vendor.name}},</p><p>We are pleased to advise that payment of {{payment.amount}} has been processed on {{payment.date}} in settlement of bill {{bill.number}}.</p><p>Payment reference: {{payment.reference}}</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>",
  },
  VENDOR_CREDIT_SENT: {
    subject:  "Vendor Credit {{vendor_credit.number}} from {{organisation.name}}",
    bodyHtml: "<p>Dear {{vendor.name}},</p><p>Please find attached vendor credit note {{vendor_credit.number}} for {{vendor_credit.total}}.</p><p>This credit has been raised on your account.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>",
  },
  INVOICE_REMINDER_BEFORE_DUE: {
    subject:  "Reminder: Invoice {{invoice.number}} is due on {{invoice.due_date}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>This is a friendly reminder that invoice {{invoice.number}} for {{invoice.total}} is due on {{invoice.due_date}}.</p><p>Outstanding balance: {{invoice.balance_due}}</p><p>Please disregard this message if payment has already been made.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
  },
  INVOICE_REMINDER_ON_DUE: {
    subject:  "Due Today: Invoice {{invoice.number}} \u2013 {{invoice.balance_due}} outstanding",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Invoice {{invoice.number}} for {{invoice.balance_due}} is due today, {{invoice.due_date}}.</p><p>Please arrange payment at your earliest convenience.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
  },
  INVOICE_REMINDER_AFTER_DUE: {
    subject:  "Overdue: Invoice {{invoice.number}} was due on {{invoice.due_date}}",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>Invoice {{invoice.number}} for {{invoice.balance_due}} was due on {{invoice.due_date}} and remains unpaid.</p><p>Please arrange payment immediately or contact us to discuss.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>",
  },
  BILL_REMINDER_BEFORE_DUE: {
    subject:  "Upcoming Bill: {{bill.number}} is due on {{bill.due_date}}",
    bodyHtml: "<p>Internal reminder: Bill {{bill.number}} from {{vendor.name}} for {{bill.total}} is due on {{bill.due_date}}.</p><p>Outstanding: {{bill.balance_due}}</p><p>Please ensure payment is arranged on time.</p><p>{{organisation.name}}</p>",
  },
  BILL_REMINDER_ON_DUE: {
    subject:  "Bill Due Today: {{bill.number}} \u2013 {{bill.balance_due}}",
    bodyHtml: "<p>Internal reminder: Bill {{bill.number}} from {{vendor.name}} for {{bill.balance_due}} is due today.</p><p>Please process payment as soon as possible to avoid late fees.</p><p>{{organisation.name}}</p>",
  },
  BILL_REMINDER_AFTER_DUE: {
    subject:  "Overdue Bill: {{bill.number}} \u2013 Immediate Payment Required",
    bodyHtml: "<p>Internal alert: Bill {{bill.number}} from {{vendor.name}} for {{bill.balance_due}} was due on {{bill.due_date}} and has not been paid.</p><p>Please arrange payment immediately to avoid penalties.</p><p>{{organisation.name}}</p>",
  },
  USER_INVITATION: {
    subject:  "You have been invited to join {{organisation.name}} on FINOS",
    bodyHtml: "<p>Hello,</p><p>You have been invited to join {{organisation.name}} on FINOS.</p><p>Click the link below to accept your invitation and set up your account. This link expires in 48 hours.</p><p>{{invitation.link}}</p><p>If you did not expect this invitation, you can safely ignore this email.</p><p>{{organisation.name}}</p>",
  },
  ORGANISATION_INVITATION: {
    subject:  "You are invited to access the {{organisation.name}} portal",
    bodyHtml: "<p>Hello {{customer.name}},</p><p>You have been invited to access the {{organisation.name}} client portal on FINOS.</p><p>Click the link below to accept your invitation. This link expires in 48 hours.</p><p>{{invitation.link}}</p><p>If you did not expect this invitation, please ignore this email.</p><p>{{organisation.name}}</p>",
  },
};
