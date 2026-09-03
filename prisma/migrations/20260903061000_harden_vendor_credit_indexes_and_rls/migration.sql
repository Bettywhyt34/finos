-- Vendor Credit closure hardening: cover FK access paths and avoid per-row tenant-setting evaluation.

CREATE INDEX IF NOT EXISTS vendor_credits_vendor_fk_idx
  ON public.vendor_credits(vendor_id);
CREATE INDEX IF NOT EXISTS vendor_credits_source_bill_fk_idx
  ON public.vendor_credits(source_bill_id);
CREATE INDEX IF NOT EXISTS vendor_credits_journal_fk_idx
  ON public.vendor_credits(journal_entry_id);
CREATE INDEX IF NOT EXISTS vendor_credits_reversal_journal_fk_idx
  ON public.vendor_credits(reversal_journal_entry_id)
  WHERE reversal_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vendor_credit_lines_account_fk_idx
  ON public.vendor_credit_lines(account_id);
CREATE INDEX IF NOT EXISTS vendor_credit_lines_project_fk_idx
  ON public.vendor_credit_lines(project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_credit_lines_source_bill_line_fk_idx
  ON public.vendor_credit_lines(source_bill_line_id);

CREATE INDEX IF NOT EXISTS vendor_credit_applications_credit_fk_idx
  ON public.vendor_credit_applications(vendor_credit_id);
CREATE INDEX IF NOT EXISTS vendor_credit_applications_bill_fk_idx
  ON public.vendor_credit_applications(bill_id);
CREATE INDEX IF NOT EXISTS vendor_credit_applications_journal_fk_idx
  ON public.vendor_credit_applications(journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_credit_applications_reversal_journal_fk_idx
  ON public.vendor_credit_applications(reversal_journal_entry_id)
  WHERE reversal_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vendor_credit_refunds_credit_fk_idx
  ON public.vendor_credit_refunds(vendor_credit_id);
CREATE INDEX IF NOT EXISTS vendor_credit_refunds_bank_fk_idx
  ON public.vendor_credit_refunds(bank_account_id);
CREATE INDEX IF NOT EXISTS vendor_credit_refunds_journal_fk_idx
  ON public.vendor_credit_refunds(journal_entry_id);
CREATE INDEX IF NOT EXISTS vendor_credit_refunds_reversal_journal_fk_idx
  ON public.vendor_credit_refunds(reversal_journal_entry_id)
  WHERE reversal_journal_entry_id IS NOT NULL;

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_credits;
CREATE POLICY tenant_isolation ON public.vendor_credits
  FOR ALL TO public
  USING (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid)
  WITH CHECK (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_credit_lines;
CREATE POLICY tenant_isolation ON public.vendor_credit_lines
  FOR ALL TO public
  USING (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid)
  WITH CHECK (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_credit_applications;
CREATE POLICY tenant_isolation ON public.vendor_credit_applications
  FOR ALL TO public
  USING (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid)
  WITH CHECK (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.vendor_credit_refunds;
CREATE POLICY tenant_isolation ON public.vendor_credit_refunds
  FOR ALL TO public
  USING (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid)
  WITH CHECK (tenant_id = ((SELECT current_setting('app.current_tenant'::text, true)))::uuid);
