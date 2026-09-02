-- Enforce the customer-receipt accounting contract at transaction commit.
-- This is deliberately DEFERRABLE: the safe receipt engine creates the business
-- rows, enriches evidence and posts the authoritative journal inside one database
-- transaction. Legacy/non-atomic paths cannot commit incomplete receipt state.

CREATE OR REPLACE FUNCTION public.validate_customer_payment_atomicity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allocated numeric;
  bank_ok boolean;
  journal_ok boolean;
  reversal_ok boolean;
BEGIN
  IF NEW.status = 'POSTED'::customer_payment_status THEN
    IF NEW.amount < 0 OR NEW.wht_amount < 0 OR NEW.amount + NEW.wht_amount <= 0 THEN
      RAISE EXCEPTION 'Posted customer receipt must settle a positive amount.' USING ERRCODE='23514';
    END IF;

    IF NEW.amount > 0 THEN
      IF NEW.bank_account_id IS NULL THEN
        RAISE EXCEPTION 'Posted cash receipt must identify the receiving bank/cash account.' USING ERRCODE='23514';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM bank_accounts ba
        JOIN chart_of_accounts coa
          ON coa.id = ba.ledger_account_id
         AND coa.tenant_id = ba.tenant_id
        WHERE ba.id = NEW.bank_account_id
          AND ba.tenant_id = NEW.tenant_id
          AND ba.is_active = true
          AND upper(ba.currency) = upper(NEW.currency)
          AND coa.type::text = 'ASSET'
          AND coa.is_active = true
      ) INTO bank_ok;

      IF NOT bank_ok THEN
        RAISE EXCEPTION 'Receiving account must be active, tenant/currency consistent, and mapped to an active Asset ledger.' USING ERRCODE='23514';
      END IF;
    END IF;

    SELECT coalesce(sum(cpa.amount),0)
      INTO allocated
    FROM customer_payment_allocations cpa
    WHERE cpa.payment_id = NEW.id;

    IF abs(allocated - (NEW.amount + NEW.wht_amount)) > 0.01 THEN
      RAISE EXCEPTION 'Customer receipt allocations must equal gross AR settled.' USING ERRCODE='23514';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.tenant_id = NEW.tenant_id
        AND je.source = 'customer_payment'
        AND je.source_id = NEW.id
        AND je.is_locked = true
    ) INTO journal_ok;

    IF NOT journal_ok THEN
      RAISE EXCEPTION 'Posted customer receipt must have its authoritative locked journal in the same transaction.' USING ERRCODE='23514';
    END IF;

    IF NEW.reversed_at IS NOT NULL
       OR NEW.reversed_by_user_id IS NOT NULL
       OR NEW.reversal_reason IS NOT NULL
       OR NEW.reversal_journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'Posted customer receipt cannot carry reversal evidence.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.status = 'REVERSED'::customer_payment_status THEN
    IF NEW.reversed_at IS NULL
       OR NEW.reversed_by_user_id IS NULL
       OR nullif(btrim(NEW.reversal_reason),'') IS NULL
       OR NEW.reversal_journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Reversed customer receipt must retain complete reversal evidence.' USING ERRCODE='23514';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.id = NEW.reversal_journal_entry_id
        AND je.tenant_id = NEW.tenant_id
        AND je.source = 'customer_payment_reversal'
        AND je.source_id = NEW.id
        AND je.is_locked = true
    ) INTO reversal_ok;

    IF NOT reversal_ok THEN
      RAISE EXCEPTION 'Reversed customer receipt must reference its authoritative locked reversal journal.' USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_customer_payment_atomicity ON public.customer_payments;
CREATE CONSTRAINT TRIGGER enforce_customer_payment_atomicity
AFTER INSERT OR UPDATE ON public.customer_payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.validate_customer_payment_atomicity();

CREATE OR REPLACE FUNCTION public.validate_customer_payment_allocation_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  payment_row customer_payments%ROWTYPE;
  invoice_row invoices%ROWTYPE;
BEGIN
  SELECT * INTO payment_row FROM customer_payments WHERE id = NEW.payment_id;
  SELECT * INTO invoice_row FROM invoices WHERE id = NEW.invoice_id;

  IF payment_row.id IS NULL OR invoice_row.id IS NULL THEN
    RAISE EXCEPTION 'Receipt allocation must reference an existing receipt and invoice.' USING ERRCODE='23503';
  END IF;

  IF payment_row.tenant_id <> invoice_row.tenant_id
     OR payment_row.customer_id <> invoice_row.customer_id
     OR upper(payment_row.currency) <> upper(invoice_row.currency) THEN
    RAISE EXCEPTION 'Receipt allocation invoice must match receipt tenant, customer and currency.' USING ERRCODE='23514';
  END IF;

  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Receipt allocation amount must be positive.' USING ERRCODE='23514';
  END IF;

  IF abs(NEW.base_ar_amount - round((NEW.amount * invoice_row.exchange_rate)::numeric,2)) > 0.01 THEN
    RAISE EXCEPTION 'Receipt allocation base AR evidence does not match the invoice carrying rate.' USING ERRCODE='23514';
  END IF;

  IF abs(NEW.base_settlement_amount - round((NEW.amount * payment_row.exchange_rate)::numeric,2)) > 0.01 THEN
    RAISE EXCEPTION 'Receipt allocation base settlement evidence does not match the receipt rate.' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_customer_payment_allocation_evidence ON public.customer_payment_allocations;
CREATE CONSTRAINT TRIGGER enforce_customer_payment_allocation_evidence
AFTER INSERT OR UPDATE ON public.customer_payment_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.validate_customer_payment_allocation_evidence();

CREATE UNIQUE INDEX IF NOT EXISTS customer_payment_allocations_payment_invoice_uidx
  ON public.customer_payment_allocations(payment_id, invoice_id);
