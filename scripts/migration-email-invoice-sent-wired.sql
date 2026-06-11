-- Mark INVOICE_SENT template as connected (wired to sendInvoice action).
-- Idempotent: safe to re-run.
UPDATE email_notification_templates
SET is_connected = true
WHERE event = 'INVOICE_SENT';
