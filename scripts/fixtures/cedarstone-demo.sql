-- Cedarstone demo bootstrap. Additive only. Never run cleanup as part of this file.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM tenant_memberships WHERE user_id='cmpjtprok000004l4mphwbd5c' AND role='OWNER' AND status='ACTIVE') THEN RAISE EXCEPTION 'Existing owner unavailable'; END IF;
 IF EXISTS (SELECT 1 FROM tenants WHERE id IN ('ceda0000-0000-4000-a000-000000000001','ceda0000-0000-4000-a000-000000000002') AND additional_fields->>'finosDemo' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Demo identity collision'; END IF;
END $$;
INSERT INTO tenants (id,name,slug,currency,additional_fields)
VALUES ('ceda0000-0000-4000-a000-000000000001','Cedarstone Media & Services — FINOS Demo','cedarstone-finos-demo','NGN','{"finosDemo":true,"syntheticData":true,"fixtureVersion":"cedarstone-v1","group":"cedarstone-demo","ownershipPercent":100}'::jsonb),
('ceda0000-0000-4000-a000-000000000002','Cedarstone Studio — FINOS Demo','cedarstone-studio-finos-demo','NGN','{"finosDemo":true,"syntheticData":true,"fixtureVersion":"cedarstone-v1","group":"cedarstone-demo","parentTenantId":"ceda0000-0000-4000-a000-000000000001","ownershipPercent":100}'::jsonb)
ON CONFLICT DO NOTHING;
INSERT INTO tenant_memberships (id,tenant_id,user_id,role,status,updated_at)
SELECT gen_random_uuid(),id,'cmpjtprok000004l4mphwbd5c','OWNER','ACTIVE',now() FROM tenants WHERE id IN ('ceda0000-0000-4000-a000-000000000001','ceda0000-0000-4000-a000-000000000002') ON CONFLICT DO NOTHING;
INSERT INTO chart_of_accounts (id,tenant_id,code,name,type,description)
SELECT id,'ceda0000-0000-4000-a000-000000000001'::uuid,code,name,type::"AccountType",'SYNTHETIC FINOS MVP fixture 2026-09-26. Not actual Cedarstone activity.' FROM (VALUES
('f1900000-0000-4000-a000-000000000001','SYNTH-AR','SYNTHETIC Accounts Receivable','ASSET'),
('f1900000-0000-4000-a000-000000000002','SYNTH-BANK','SYNTHETIC Test Bank Ledger','ASSET'),
('f1900000-0000-4000-a000-000000000003','SYNTH-AP','SYNTHETIC Accounts Payable','LIABILITY'),
('f1900000-0000-4000-a000-000000000004','SYNTH-REV','SYNTHETIC Service Revenue','INCOME'),
('f1900000-0000-4000-a000-000000000005','SYNTH-COST','SYNTHETIC Service Cost','EXPENSE'),
('f1900000-0000-4000-a000-000000000006','SYNTH-WHT-AR','SYNTHETIC WHT Receivable','ASSET'),
('f1900000-0000-4000-a000-000000000007','SYNTH-WHT-AP','SYNTHETIC WHT Payable','LIABILITY'),
('f1900000-0000-4000-a000-000000000008','SYNTH-UNEARNED','SYNTHETIC Unearned Revenue','LIABILITY')
) v(id,code,name,type) ON CONFLICT DO NOTHING;
INSERT INTO system_account_mappings (tenant_id,role,account_id)
SELECT 'ceda0000-0000-4000-a000-000000000001'::uuid,role,account_id FROM (VALUES
('ACCOUNTS_RECEIVABLE','f1900000-0000-4000-a000-000000000001'),
('DEFAULT_BANK','f1900000-0000-4000-a000-000000000002'),
('ACCOUNTS_PAYABLE','f1900000-0000-4000-a000-000000000003'),
('WHT_RECEIVABLE','f1900000-0000-4000-a000-000000000006'),
('WHT_PAYABLE','f1900000-0000-4000-a000-000000000007'),
('UNEARNED_REVENUE','f1900000-0000-4000-a000-000000000008')
) v(role,account_id) ON CONFLICT DO NOTHING;
INSERT INTO bank_accounts (id,tenant_id,account_name,account_number,bank_name,currency,ledger_account_id)
VALUES ('f1900000-0000-4000-a000-000000000009','ceda0000-0000-4000-a000-000000000001','SYNTHETIC MVP Test Bank','SYNTHETIC-NOT-A-BANK','SYNTHETIC no financial institution','NGN','f1900000-0000-4000-a000-000000000002') ON CONFLICT DO NOTHING;
INSERT INTO customers (id,tenant_id,customer_code,company_name)
VALUES ('f1900000-0000-4000-a000-000000000010','ceda0000-0000-4000-a000-000000000001','SYNTH-MVP-CUSTOMER','SYNTHETIC MVP Customer — not a real client') ON CONFLICT DO NOTHING;
INSERT INTO vendors (id,tenant_id,vendor_code,company_name,is_wht_eligible)
VALUES ('f1900000-0000-4000-a000-000000000011','ceda0000-0000-4000-a000-000000000001','SYNTH-MVP-VENDOR','SYNTHETIC MVP Vendor — not a real supplier',true) ON CONFLICT DO NOTHING;
INSERT INTO invoices (id,tenant_id,customer_id,invoice_number,issue_date,due_date,status,subtotal,total_amount,balance_due,recognition_period,notes,recognise_revenue_on_invoice_date)
VALUES ('f1900000-0000-4000-a000-000000000012','ceda0000-0000-4000-a000-000000000001','f1900000-0000-4000-a000-000000000010','SYNTH-MVP-INV-001','2026-09-26','2026-10-06','DRAFT',100000,100000,100000,'2026-09','SYNTHETIC MVP acceptance draft. Not actual Cedarstone revenue. Do not email.',true) ON CONFLICT DO NOTHING;
INSERT INTO invoice_lines (id,invoice_id,description,quantity,rate,amount,line_total,income_account_id)
VALUES ('f1900000-0000-4000-a000-000000000013','f1900000-0000-4000-a000-000000000012','SYNTHETIC service for MVP invoice-to-receipt test',1,100000,100000,100000,'f1900000-0000-4000-a000-000000000004') ON CONFLICT DO NOTHING;
INSERT INTO bills (id,tenant_id,vendor_id,bill_number,bill_date,due_date,status,subtotal,total_amount,notes)
VALUES ('f1900000-0000-4000-a000-000000000014','ceda0000-0000-4000-a000-000000000001','f1900000-0000-4000-a000-000000000011','SYNTH-MVP-BILL-001','2026-09-26','2026-09-29','DRAFT',60000,60000,'SYNTHETIC MVP acceptance draft. Not an actual Cedarstone liability.') ON CONFLICT DO NOTHING;
INSERT INTO bill_lines (id,bill_id,description,quantity,rate,amount,account_id)
VALUES ('f1900000-0000-4000-a000-000000000015','f1900000-0000-4000-a000-000000000014','SYNTHETIC service for MVP bill-to-payment test',1,60000,60000,'f1900000-0000-4000-a000-000000000005') ON CONFLICT DO NOTHING;
INSERT INTO chart_of_accounts (id,tenant_id,code,name,type,description)
SELECT id,'ceda0000-0000-4000-a000-000000000002'::uuid,code,name,type::"AccountType",'SYNTHETIC FINOS MVP fixture 2026-09-26. Not actual Cedarstone activity.' FROM (VALUES
('f1910000-0000-4000-a000-000000000001','SYNTH-AR','SYNTHETIC Accounts Receivable','ASSET'),
('f1910000-0000-4000-a000-000000000002','SYNTH-BANK','SYNTHETIC Test Bank Ledger','ASSET'),
('f1910000-0000-4000-a000-000000000003','SYNTH-AP','SYNTHETIC Accounts Payable','LIABILITY'),
('f1910000-0000-4000-a000-000000000004','SYNTH-REV','SYNTHETIC Service Revenue','INCOME'),
('f1910000-0000-4000-a000-000000000005','SYNTH-COST','SYNTHETIC Service Cost','EXPENSE'),
('f1910000-0000-4000-a000-000000000006','SYNTH-WHT-AR','SYNTHETIC WHT Receivable','ASSET'),
('f1910000-0000-4000-a000-000000000007','SYNTH-WHT-AP','SYNTHETIC WHT Payable','LIABILITY'),
('f1910000-0000-4000-a000-000000000008','SYNTH-UNEARNED','SYNTHETIC Unearned Revenue','LIABILITY')
) v(id,code,name,type) ON CONFLICT DO NOTHING;
INSERT INTO system_account_mappings (tenant_id,role,account_id)
SELECT 'ceda0000-0000-4000-a000-000000000002'::uuid,role,account_id FROM (VALUES
('ACCOUNTS_RECEIVABLE','f1910000-0000-4000-a000-000000000001'),
('DEFAULT_BANK','f1910000-0000-4000-a000-000000000002'),
('ACCOUNTS_PAYABLE','f1910000-0000-4000-a000-000000000003'),
('WHT_RECEIVABLE','f1910000-0000-4000-a000-000000000006'),
('WHT_PAYABLE','f1910000-0000-4000-a000-000000000007'),
('UNEARNED_REVENUE','f1910000-0000-4000-a000-000000000008')
) v(role,account_id) ON CONFLICT DO NOTHING;
INSERT INTO bank_accounts (id,tenant_id,account_name,account_number,bank_name,currency,ledger_account_id)
VALUES ('f1910000-0000-4000-a000-000000000009','ceda0000-0000-4000-a000-000000000002','SYNTHETIC MVP Test Bank','SYNTHETIC-NOT-A-BANK','SYNTHETIC no financial institution','NGN','f1910000-0000-4000-a000-000000000002') ON CONFLICT DO NOTHING;
INSERT INTO customers (id,tenant_id,customer_code,company_name)
VALUES ('f1910000-0000-4000-a000-000000000010','ceda0000-0000-4000-a000-000000000002','SYNTH-MVP-CUSTOMER','SYNTHETIC MVP Customer — not a real client') ON CONFLICT DO NOTHING;
INSERT INTO vendors (id,tenant_id,vendor_code,company_name,is_wht_eligible)
VALUES ('f1910000-0000-4000-a000-000000000011','ceda0000-0000-4000-a000-000000000002','SYNTH-MVP-VENDOR','SYNTHETIC MVP Vendor — not a real supplier',true) ON CONFLICT DO NOTHING;
INSERT INTO invoices (id,tenant_id,customer_id,invoice_number,issue_date,due_date,status,subtotal,total_amount,balance_due,recognition_period,notes,recognise_revenue_on_invoice_date)
VALUES ('f1910000-0000-4000-a000-000000000012','ceda0000-0000-4000-a000-000000000002','f1910000-0000-4000-a000-000000000010','SYNTH-MVP-INV-001','2026-09-26','2026-10-06','DRAFT',100000,100000,100000,'2026-09','SYNTHETIC MVP acceptance draft. Not actual Cedarstone revenue. Do not email.',true) ON CONFLICT DO NOTHING;
INSERT INTO invoice_lines (id,invoice_id,description,quantity,rate,amount,line_total,income_account_id)
VALUES ('f1910000-0000-4000-a000-000000000013','f1910000-0000-4000-a000-000000000012','SYNTHETIC service for MVP invoice-to-receipt test',1,100000,100000,100000,'f1910000-0000-4000-a000-000000000004') ON CONFLICT DO NOTHING;
INSERT INTO bills (id,tenant_id,vendor_id,bill_number,bill_date,due_date,status,subtotal,total_amount,notes)
VALUES ('f1910000-0000-4000-a000-000000000014','ceda0000-0000-4000-a000-000000000002','f1910000-0000-4000-a000-000000000011','SYNTH-MVP-BILL-001','2026-09-26','2026-09-29','DRAFT',60000,60000,'SYNTHETIC MVP acceptance draft. Not an actual Cedarstone liability.') ON CONFLICT DO NOTHING;
INSERT INTO bill_lines (id,bill_id,description,quantity,rate,amount,account_id)
VALUES ('f1910000-0000-4000-a000-000000000015','f1910000-0000-4000-a000-000000000014','SYNTHETIC service for MVP bill-to-payment test',1,60000,60000,'f1910000-0000-4000-a000-000000000005') ON CONFLICT DO NOTHING;
COMMIT;
SELECT id,name FROM tenants WHERE slug IN ('cedarstone-finos-demo','cedarstone-studio-finos-demo');
