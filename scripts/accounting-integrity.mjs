import "dotenv/config";
import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required to run the accounting integrity audit.");
  process.exit(2);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

const checks = [
  {
    name: "Locked journals are balanced",
    sql: `
      select je.id, je.tenant_id, je.entry_number,
             coalesce(sum(jel.debit),0) as debit,
             coalesce(sum(jel.credit),0) as credit
      from journal_entries je
      left join journal_entry_lines jel on jel.entry_id = je.id
      where je.is_locked = true
      group by je.id, je.tenant_id, je.entry_number
      having abs(coalesce(sum(jel.debit),0) - coalesce(sum(jel.credit),0)) > 0.01
    `,
  },
  {
    name: "Posted journals have at least two lines",
    sql: `
      select je.id, je.tenant_id, je.entry_number, count(jel.id) as line_count
      from journal_entries je
      left join journal_entry_lines jel on jel.entry_id = je.id
      where je.is_locked = true
      group by je.id, je.tenant_id, je.entry_number
      having count(jel.id) < 2
    `,
  },
  {
    name: "Business source events are not posted twice",
    sql: `
      select tenant_id, source, source_id, count(*) as journal_count
      from journal_entries
      where source is not null and source <> ''
        and source_id is not null and source_id <> ''
      group by tenant_id, source, source_id
      having count(*) > 1
    `,
  },
  {
    name: "No journal was created after its period was closed",
    sql: `
      select je.id, je.tenant_id, je.entry_number, je.recognition_period,
             je.created_at, ap.closed_at
      from journal_entries je
      join accounting_periods ap
        on ap.tenant_id = je.tenant_id
       and ap.period = je.recognition_period
      where je.is_locked = true
        and ap.is_closed = true
        and ap.closed_at is not null
        and je.created_at > ap.closed_at
    `,
  },
  {
    name: "Posted invoices have an invoice journal",
    sql: `
      select i.id, i.tenant_id, i.invoice_number, i.status
      from invoices i
      where i.status in ('SENT','PARTIAL','PAID','OVERDUE','WRITTEN_OFF')
        and not exists (
          select 1 from journal_entries je
          where je.tenant_id = i.tenant_id
            and je.source = 'invoice'
            and je.source_id = i.id
            and je.is_locked = true
        )
    `,
  },
  {
    name: "Posted bills have a bill journal",
    sql: `
      select b.id, b.tenant_id, b.bill_number, b.status
      from bills b
      where b.status in ('RECORDED','PARTIAL','PAID','OVERDUE')
        and not exists (
          select 1 from journal_entries je
          where je.tenant_id = b.tenant_id
            and je.source = 'bill'
            and je.source_id = b.id
            and je.is_locked = true
        )
    `,
  },
  {
    name: "Posted customer payments have a receipt journal",
    sql: `
      select cp.id, cp.tenant_id, cp.payment_number, cp.status
      from customer_payments cp
      where cp.status = 'POSTED'
        and not exists (
          select 1 from journal_entries je
          where je.tenant_id = cp.tenant_id
            and je.source = 'customer_payment'
            and je.source_id = cp.id
            and je.is_locked = true
        )
    `,
  },
  {
    name: "Vendor payments have a payment journal",
    sql: `
      select vp.id, vp.tenant_id, vp.payment_number
      from vendor_payments vp
      where not exists (
        select 1 from journal_entries je
        where je.tenant_id = vp.tenant_id
          and je.source = 'vendor_payment'
          and je.source_id = vp.id
          and je.is_locked = true
      )
    `,
  },
  {
    name: "Ledger lines never use another tenant's account",
    sql: `
      select jel.id, je.tenant_id as journal_tenant, coa.tenant_id as account_tenant, jel.account_id
      from journal_entry_lines jel
      join journal_entries je on je.id = jel.entry_id
      join chart_of_accounts coa on coa.id = jel.account_id
      where coa.tenant_id <> je.tenant_id
    `,
  },
  {
    name: "Ledger Project dimensions stay within the journal tenant",
    sql: `
      select jel.id, je.tenant_id as journal_tenant, p.tenant_id as project_tenant, jel.project_id
      from journal_entry_lines jel
      join journal_entries je on je.id = jel.entry_id
      join projects p on p.id = jel.project_id
      where jel.project_id is not null
        and p.tenant_id <> je.tenant_id
    `,
  },
  {
    name: "Ledger Reporting Tag options stay within the journal tenant",
    sql: `
      select distinct jel.id, je.tenant_id as journal_tenant, rto.tenant_id as option_tenant, tag.value as option_id
      from journal_entry_lines jel
      join journal_entries je on je.id = jel.entry_id
      cross join lateral jsonb_each_text(coalesce(jel.reporting_tags, '{}'::jsonb)) tag
      join reporting_tag_options rto on rto.id = tag.value
      where rto.tenant_id <> je.tenant_id
    `,
  },
  {
    name: "System account mappings cannot point across tenants",
    sql: `
      select sam.tenant_id as mapping_tenant, sam.role, sam.account_id, coa.tenant_id as account_tenant
      from system_account_mappings sam
      join chart_of_accounts coa on coa.id = sam.account_id
      where sam.tenant_id <> coa.tenant_id
    `,
  },
  {
    name: "Trial balance remains globally balanced per tenant",
    sql: `
      select je.tenant_id,
             coalesce(sum(jel.debit),0) as debit,
             coalesce(sum(jel.credit),0) as credit
      from journal_entries je
      join journal_entry_lines jel on jel.entry_id = je.id
      where je.is_locked = true
      group by je.tenant_id
      having abs(coalesce(sum(jel.debit),0) - coalesce(sum(jel.credit),0)) > 0.01
    `,
  },
  {
    name: "Reconciliation matches use the bank account's mapped ledger",
    sql: `
      select brm.id, brs.bank_account_id, bt.bank_account_id as statement_bank_account,
             ba.ledger_account_id, jel.account_id as matched_ledger_account
      from bank_reconciliation_matches brm
      join bank_reconciliation_sessions brs on brs.id = brm.session_id
      join bank_transactions bt on bt.id = brm.bank_transaction_id
      join bank_accounts ba on ba.id = brs.bank_account_id
      join journal_entry_lines jel on jel.id = brm.journal_entry_line_id
      join journal_entries je on je.id = jel.entry_id
      where bt.bank_account_id <> brs.bank_account_id
         or ba.ledger_account_id is null
         or jel.account_id <> ba.ledger_account_id
         or je.tenant_id <> brs.tenant_id
         or ba.tenant_id <> brs.tenant_id
    `,
  },
  {
    name: "Reconciled statement flag always has match evidence",
    sql: `
      select bt.id, ba.tenant_id, bt.bank_account_id
      from bank_transactions bt
      join bank_accounts ba on ba.id = bt.bank_account_id
      where bt.is_reconciled = true
        and not exists (
          select 1 from bank_reconciliation_matches brm
          where brm.bank_transaction_id = bt.id
        )
    `,
  },
];

let failed = 0;

try {
  await client.connect();
  console.log(`FINOS accounting integrity audit — ${new Date().toISOString()}`);
  console.log(`Running ${checks.length} read-only invariants...\n`);

  for (const check of checks) {
    try {
      const result = await client.query(check.sql);
      if (result.rowCount === 0) {
        console.log(`✅ ${check.name}`);
      } else {
        failed += 1;
        console.error(`❌ ${check.name} — ${result.rowCount} violation${result.rowCount === 1 ? "" : "s"}`);
        console.error(result.rows.slice(0, 10));
        if (result.rowCount > 10) console.error(`   …and ${result.rowCount - 10} more`);
      }
    } catch (error) {
      failed += 1;
      console.error(`❌ ${check.name} — audit query failed`);
      console.error(error instanceof Error ? error.message : error);
    }
  }
} finally {
  await client.end().catch(() => undefined);
}

if (failed > 0) {
  console.error(`\nAccounting integrity audit FAILED: ${failed} invariant${failed === 1 ? "" : "s"} violated or could not be checked.`);
  process.exit(1);
}

console.log("\n✅ Accounting integrity audit PASSED.");
