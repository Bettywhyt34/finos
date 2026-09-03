CREATE INDEX IF NOT EXISTS bill_lines_bill_id_fk_idx ON public.bill_lines(bill_id);
CREATE INDEX IF NOT EXISTS bill_lines_item_id_fk_idx ON public.bill_lines(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_accounts_ledger_account_id_fk_idx ON public.bank_accounts(ledger_account_id) WHERE ledger_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_payment_allocations_bill_id_fk_idx ON public.vendor_payment_allocations(bill_id);
CREATE INDEX IF NOT EXISTS vendor_payments_bank_account_id_fk_idx ON public.vendor_payments(bank_account_id) WHERE bank_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_payments_reversal_journal_entry_id_fk_idx ON public.vendor_payments(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_payments;
CREATE POLICY tenant_isolation ON public.vendor_payments
FOR ALL
USING (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid)
WITH CHECK (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_payment_allocations;
CREATE POLICY tenant_isolation ON public.vendor_payment_allocations
FOR ALL
USING (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid)
WITH CHECK (tenant_id=(SELECT current_setting('app.current_tenant',true))::uuid);