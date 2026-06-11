/**
 * Migration: Email Notification Templates
 *
 * Creates email_notification_category_enum, email_notification_event_enum,
 * and email_notification_templates table. Seeds 17 system templates per tenant.
 *
 * IDEMPOTENT — ON CONFLICT DO NOTHING on (tenant_id, event).
 * Run in Supabase SQL Editor (session pooler, port 5432).
 */

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE email_notification_category_enum AS ENUM (
    'SALES', 'PURCHASES', 'REMINDERS', 'GENERAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE email_notification_event_enum AS ENUM (
    'ESTIMATE_SENT',
    'INVOICE_SENT',
    'PAYMENT_RECEIPT_SENT',
    'CREDIT_NOTE_SENT',
    'CUSTOMER_STATEMENT_SENT',
    'PURCHASE_ORDER_SENT',
    'BILL_REMINDER',
    'VENDOR_PAYMENT_ADVICE',
    'VENDOR_CREDIT_SENT',
    'INVOICE_REMINDER_BEFORE_DUE',
    'INVOICE_REMINDER_ON_DUE',
    'INVOICE_REMINDER_AFTER_DUE',
    'BILL_REMINDER_BEFORE_DUE',
    'BILL_REMINDER_ON_DUE',
    'BILL_REMINDER_AFTER_DUE',
    'USER_INVITATION',
    'ORGANISATION_INVITATION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_notification_templates (
  id                  UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category            email_notification_category_enum NOT NULL,
  event               email_notification_event_enum    NOT NULL,
  name                TEXT        NOT NULL,
  subject             TEXT        NOT NULL,
  body_html           TEXT        NOT NULL,
  body_text           TEXT,
  is_enabled          BOOLEAN     NOT NULL DEFAULT true,
  is_system           BOOLEAN     NOT NULL DEFAULT true,
  is_customised       BOOLEAN     NOT NULL DEFAULT false,
  is_connected        BOOLEAN     NOT NULL DEFAULT false,
  available_variables JSONB       NOT NULL DEFAULT '[]',
  config              JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_email_notification_tenant_event UNIQUE (tenant_id, event)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ent_tenant
  ON email_notification_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ent_tenant_category
  ON email_notification_templates(tenant_id, category);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE email_notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ent_tenant_isolation ON email_notification_templates;
CREATE POLICY ent_tenant_isolation ON email_notification_templates
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_ent_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ent_updated_at ON email_notification_templates;
CREATE TRIGGER trg_ent_updated_at
  BEFORE UPDATE ON email_notification_templates
  FOR EACH ROW EXECUTE FUNCTION fn_ent_updated_at();

-- ─── Seed per tenant ─────────────────────────────────────────────────────────
-- 17 system templates per tenant. Idempotent via ON CONFLICT DO NOTHING.

DO $$
DECLARE
  t_id UUID;
BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP

    -- ── SALES ────────────────────────────────────────────────────────────────

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'SALES', 'INVOICE_SENT', 'Invoice Sent',
      'Invoice {{invoice.number}} from {{organisation.name}}',
      '<p>Hello {{customer.name}},</p><p>Please find attached invoice {{invoice.number}} for {{invoice.total}}.</p><p>Balance due: {{invoice.balance_due}}<br>Due date: {{invoice.due_date}}</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{invoice.number}}","{{invoice.date}}","{{invoice.due_date}}","{{invoice.total}}","{{invoice.balance_due}}","{{customer.name}}","{{customer.company_name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}","{{organisation.address}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'SALES', 'ESTIMATE_SENT', 'Estimate Sent',
      'Estimate {{estimate.number}} from {{organisation.name}}',
      '<p>Hello {{customer.name}},</p><p>Please find attached estimate {{estimate.number}} for {{estimate.total}}.</p><p>This estimate is valid for 30 days. To accept, please reply to this email or contact us directly.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{estimate.number}}","{{estimate.date}}","{{estimate.total}}","{{customer.name}}","{{customer.company_name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'SALES', 'PAYMENT_RECEIPT_SENT', 'Payment Receipt Sent',
      'Payment received - Invoice {{invoice.number}}',
      '<p>Hello {{customer.name}},</p><p>We have received your payment of {{payment.amount}} on {{payment.date}} for invoice {{invoice.number}}.</p><p>Payment reference: {{payment.reference}}</p><p>Thank you for your prompt payment.</p><p>{{organisation.name}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{invoice.number}}","{{payment.amount}}","{{payment.date}}","{{payment.reference}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'SALES', 'CREDIT_NOTE_SENT', 'Credit Note Sent',
      'Credit Note {{credit_note.number}} from {{organisation.name}}',
      '<p>Hello {{customer.name}},</p><p>Please find attached credit note {{credit_note.number}} for {{credit_note.total}}.</p><p>This credit will be applied to your outstanding balance or refunded as agreed.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{credit_note.number}}","{{credit_note.total}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'SALES', 'CUSTOMER_STATEMENT_SENT', 'Customer Statement Sent',
      'Account Statement from {{organisation.name}}',
      '<p>Hello {{customer.name}},</p><p>Please find attached your account statement as of {{statement.date}}.</p><p>Currency: {{tenant.currency}}</p><p>If you have any questions about your account, please contact us.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{statement.date}}","{{tenant.currency}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    -- ── PURCHASES ────────────────────────────────────────────────────────────

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'PURCHASES', 'PURCHASE_ORDER_SENT', 'Purchase Order Sent',
      'Purchase Order {{purchase_order.number}} from {{organisation.name}}',
      '<p>Dear {{vendor.name}},</p><p>Please find attached purchase order {{purchase_order.number}} for your reference.</p><p>Total: {{purchase_order.total}}</p><p>Kindly confirm receipt and advise the expected delivery date.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{purchase_order.number}}","{{purchase_order.total}}","{{vendor.name}}","{{vendor.company_name}}","{{vendor.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'PURCHASES', 'BILL_REMINDER', 'Bill Reminder',
      'Payment Reminder - {{bill.number}}',
      '<p>Dear {{vendor.name}},</p><p>This is a reminder that bill {{bill.number}} for {{bill.total}} is due on {{bill.due_date}}.</p><p>Please ensure payment is arranged on time to avoid delays.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{bill.number}}","{{bill.date}}","{{bill.due_date}}","{{bill.total}}","{{bill.balance_due}}","{{vendor.name}}","{{vendor.email}}","{{organisation.name}}","{{organisation.email}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'PURCHASES', 'VENDOR_PAYMENT_ADVICE', 'Vendor Payment Advice',
      'Payment Advice - {{bill.number}} from {{organisation.name}}',
      '<p>Dear {{vendor.name}},</p><p>We are pleased to advise that payment of {{payment.amount}} has been processed on {{payment.date}} in settlement of bill {{bill.number}}.</p><p>Payment reference: {{payment.reference}}</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{bill.number}}","{{bill.total}}","{{payment.amount}}","{{payment.date}}","{{payment.reference}}","{{vendor.name}}","{{vendor.email}}","{{organisation.name}}","{{organisation.email}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'PURCHASES', 'VENDOR_CREDIT_SENT', 'Vendor Credit Sent',
      'Vendor Credit {{vendor_credit.number}} from {{organisation.name}}',
      '<p>Dear {{vendor.name}},</p><p>Please find attached vendor credit note {{vendor_credit.number}} for {{vendor_credit.total}}.</p><p>This credit has been raised on your account.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{vendor_credit.number}}","{{vendor_credit.total}}","{{vendor.name}}","{{vendor.email}}","{{organisation.name}}","{{organisation.email}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    -- ── REMINDERS ────────────────────────────────────────────────────────────

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'REMINDERS', 'INVOICE_REMINDER_BEFORE_DUE', 'Invoice Reminder - Before Due',
      'Reminder: Invoice {{invoice.number}} is due on {{invoice.due_date}}',
      '<p>Hello {{customer.name}},</p><p>This is a friendly reminder that invoice {{invoice.number}} for {{invoice.total}} is due on {{invoice.due_date}}.</p><p>Outstanding balance: {{invoice.balance_due}}</p><p>Please disregard this message if payment has already been made.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{invoice.number}}","{{invoice.date}}","{{invoice.due_date}}","{{invoice.total}}","{{invoice.balance_due}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'REMINDERS', 'INVOICE_REMINDER_ON_DUE', 'Invoice Reminder - On Due Date',
      'Due Today: Invoice {{invoice.number}} - {{invoice.balance_due}} outstanding',
      '<p>Hello {{customer.name}},</p><p>Invoice {{invoice.number}} for {{invoice.balance_due}} is due today, {{invoice.due_date}}.</p><p>Please arrange payment at your earliest convenience.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{invoice.number}}","{{invoice.due_date}}","{{invoice.total}}","{{invoice.balance_due}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'REMINDERS', 'INVOICE_REMINDER_AFTER_DUE', 'Invoice Reminder - After Due Date',
      'Overdue: Invoice {{invoice.number}} was due on {{invoice.due_date}}',
      '<p>Hello {{customer.name}},</p><p>Invoice {{invoice.number}} for {{invoice.balance_due}} was due on {{invoice.due_date}} and remains unpaid.</p><p>Please arrange payment immediately or contact us to discuss.</p><p>Thank you,<br>{{organisation.name}}<br>{{organisation.phone}}<br>{{organisation.email}}</p>',
      true, true, false, false,
      '["{{invoice.number}}","{{invoice.due_date}}","{{invoice.total}}","{{invoice.balance_due}}","{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{organisation.email}}","{{organisation.phone}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'REMINDERS', 'BILL_REMINDER_BEFORE_DUE', 'Bill Reminder - Before Due',
      'Upcoming Bill: {{bill.number}} is due on {{bill.due_date}}',
      '<p>Internal reminder: Bill {{bill.number}} from {{vendor.name}} for {{bill.total}} is due on {{bill.due_date}}.</p><p>Outstanding: {{bill.balance_due}}</p><p>Please ensure payment is arranged on time.</p><p>{{organisation.name}}</p>',
      true, true, false, false,
      '["{{bill.number}}","{{bill.date}}","{{bill.due_date}}","{{bill.total}}","{{bill.balance_due}}","{{vendor.name}}","{{organisation.name}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'REMINDERS', 'BILL_REMINDER_ON_DUE', 'Bill Reminder - On Due Date',
      'Bill Due Today: {{bill.number}} - {{bill.balance_due}}',
      '<p>Internal reminder: Bill {{bill.number}} from {{vendor.name}} for {{bill.balance_due}} is due today.</p><p>Please process payment as soon as possible to avoid late fees.</p><p>{{organisation.name}}</p>',
      true, true, false, false,
      '["{{bill.number}}","{{bill.due_date}}","{{bill.total}}","{{bill.balance_due}}","{{vendor.name}}","{{organisation.name}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'REMINDERS', 'BILL_REMINDER_AFTER_DUE', 'Bill Reminder - After Due Date',
      'Overdue Bill: {{bill.number}} - Immediate Payment Required',
      '<p>Internal alert: Bill {{bill.number}} from {{vendor.name}} for {{bill.balance_due}} was due on {{bill.due_date}} and has not been paid.</p><p>Please arrange payment immediately to avoid penalties.</p><p>{{organisation.name}}</p>',
      true, true, false, false,
      '["{{bill.number}}","{{bill.due_date}}","{{bill.total}}","{{bill.balance_due}}","{{vendor.name}}","{{organisation.name}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    -- ── GENERAL ──────────────────────────────────────────────────────────────

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'GENERAL', 'USER_INVITATION', 'User Invitation',
      'You have been invited to join {{organisation.name}} on FINOS',
      '<p>Hello,</p><p>You have been invited to join {{organisation.name}} on FINOS.</p><p>Click the link below to accept your invitation and set up your account. This link expires in 48 hours.</p><p>{{invitation.link}}</p><p>If you did not expect this invitation, you can safely ignore this email.</p><p>{{organisation.name}}</p>',
      true, true, false, true,
      '["{{organisation.name}}","{{organisation.email}}","{{invitation.link}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

    INSERT INTO email_notification_templates
      (id, tenant_id, category, event, name, subject, body_html,
       is_enabled, is_system, is_customised, is_connected, available_variables)
    VALUES (
      gen_random_uuid(), t_id,
      'GENERAL', 'ORGANISATION_INVITATION', 'Organisation Invitation',
      'You are invited to access the {{organisation.name}} portal',
      '<p>Hello {{customer.name}},</p><p>You have been invited to access the {{organisation.name}} client portal on FINOS.</p><p>Click the link below to accept your invitation. This link expires in 48 hours.</p><p>{{invitation.link}}</p><p>If you did not expect this invitation, please ignore this email.</p><p>{{organisation.name}}</p>',
      true, true, false, false,
      '["{{customer.name}}","{{customer.email}}","{{organisation.name}}","{{invitation.link}}"]'
    )
    ON CONFLICT ON CONSTRAINT uq_email_notification_tenant_event DO NOTHING;

  END LOOP;
END $$;

-- ─── Gate checks ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  t_count  BIGINT;
  r_count  BIGINT;
BEGIN
  SELECT COUNT(*) INTO t_count FROM tenants;
  IF t_count > 0 THEN
    SELECT COUNT(*) INTO r_count
    FROM email_notification_templates
    WHERE tenant_id = (SELECT id FROM tenants LIMIT 1);
    ASSERT r_count = 17,
      'GATE FAIL: Expected 17 email notification templates per tenant, got ' || r_count;
  END IF;
END $$;

SELECT 'Email Notification Templates migration complete.' AS status;
