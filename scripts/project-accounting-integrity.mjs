import "dotenv/config";
import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required to run the Project accounting integrity audit.");
  process.exit(2);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

const checks = [
  {
    name: "Project invoice allocation split balances",
    sql: `
      select ila.id, ila.tenant_id, ila.invoice_id, ila.invoice_line_id,
             ila.invoice_amount, ila.contract_asset_cleared, ila.immediate_revenue, ila.unearned_created
      from invoice_line_revenue_allocations ila
      where abs(ila.invoice_amount - (ila.contract_asset_cleared + ila.immediate_revenue + ila.unearned_created)) > 0.01
    `,
  },
  {
    name: "Deferred Project billing snapshots its Unearned Income account",
    sql: `
      select ila.id, ila.tenant_id, ila.invoice_id, ila.unearned_created
      from invoice_line_revenue_allocations ila
      where ila.unearned_created > 0.005
        and ila.unearned_income_account_id is null
    `,
  },
  {
    name: "Project invoice allocation accounts stay in tenant and expected type",
    sql: `
      select ila.id, ila.tenant_id, ila.income_account_id, ila.unearned_income_account_id
      from invoice_line_revenue_allocations ila
      join chart_of_accounts income on income.id = ila.income_account_id
      left join chart_of_accounts unearned on unearned.id = ila.unearned_income_account_id
      where income.tenant_id <> ila.tenant_id
         or income.type <> 'INCOME'
         or (ila.unearned_income_account_id is not null
             and (unearned.tenant_id <> ila.tenant_id or unearned.type <> 'LIABILITY'))
    `,
  },
  {
    name: "Project invoice allocation dimensions are internally consistent",
    sql: `
      select ila.id, ila.tenant_id, ila.project_id, ila.invoice_id, ila.invoice_line_id
      from invoice_line_revenue_allocations ila
      join projects p on p.id = ila.project_id
      join invoices i on i.id = ila.invoice_id
      join invoice_lines il on il.id = ila.invoice_line_id
      where p.tenant_id <> ila.tenant_id
         or i.tenant_id <> ila.tenant_id
         or il.invoice_id <> ila.invoice_id
         or il.project_id is distinct from ila.project_id
    `,
  },
  {
    name: "Project revenue recognition amount splits exactly",
    sql: `
      select prr.id, prr.tenant_id, prr.project_id, prr.amount,
             prr.unearned_used, prr.contract_asset_created
      from project_revenue_recognitions prr
      where abs(prr.amount - (prr.unearned_used + prr.contract_asset_created)) > 0.01
    `,
  },
  {
    name: "Posted Project revenue recognition has authoritative journal",
    sql: `
      select prr.id, prr.tenant_id, prr.project_id, prr.journal_entry_id
      from project_revenue_recognitions prr
      where prr.status = 'POSTED'
        and not exists (
          select 1 from journal_entries je
          where je.id = prr.journal_entry_id
            and je.tenant_id = prr.tenant_id
            and je.source = 'project_revenue_recognition'
            and je.source_id = prr.id::text
            and je.is_locked = true
        )
    `,
  },
  {
    name: "Reversed Project revenue recognition has authoritative reversal journal",
    sql: `
      select prr.id, prr.tenant_id, prr.project_id, prr.reversal_journal_entry_id
      from project_revenue_recognitions prr
      where prr.status = 'REVERSED'
        and (
          prr.reversal_journal_entry_id is null
          or not exists (
            select 1 from journal_entries je
            where je.id = prr.reversal_journal_entry_id
              and je.tenant_id = prr.tenant_id
              and je.source = 'project_revenue_recognition_reversal'
              and je.source_id = prr.id::text
              and je.is_locked = true
          )
        )
    `,
  },
  {
    name: "Revenue recognition allocation links stay in tenant and Project",
    sql: `
      select rria.id, rria.tenant_id, rria.recognition_id,
             rria.invoice_line_allocation_id, rria.allocation_type
      from revenue_recognition_invoice_allocations rria
      join project_revenue_recognitions prr on prr.id = rria.recognition_id
      join invoice_line_revenue_allocations ila on ila.id = rria.invoice_line_allocation_id
      where rria.tenant_id <> prr.tenant_id
         or rria.tenant_id <> ila.tenant_id
         or prr.project_id <> ila.project_id
         or rria.allocation_type not in ('UNEARNED_RELEASE','CONTRACT_ASSET_CLEARANCE')
    `,
  },
  {
    name: "Unearned Income releases never exceed deferred billing",
    sql: `
      select ila.id, ila.tenant_id, ila.unearned_created,
             coalesce(sum(case
               when rria.allocation_type = 'UNEARNED_RELEASE' and prr.status = 'POSTED'
               then rria.amount else 0 end), 0) as released
      from invoice_line_revenue_allocations ila
      left join revenue_recognition_invoice_allocations rria
        on rria.invoice_line_allocation_id = ila.id
      left join project_revenue_recognitions prr on prr.id = rria.recognition_id
      group by ila.id, ila.tenant_id, ila.unearned_created
      having coalesce(sum(case
        when rria.allocation_type = 'UNEARNED_RELEASE' and prr.status = 'POSTED'
        then rria.amount else 0 end), 0) - ila.unearned_created > 0.01
    `,
  },
  {
    name: "Contract Asset clearances never exceed recognised Contract Asset",
    sql: `
      select prr.id, prr.tenant_id, prr.contract_asset_created,
             coalesce(sum(case
               when rria.allocation_type = 'CONTRACT_ASSET_CLEARANCE' and i.status <> 'VOIDED'
               then rria.amount else 0 end), 0) as cleared
      from project_revenue_recognitions prr
      left join revenue_recognition_invoice_allocations rria on rria.recognition_id = prr.id
      left join invoice_line_revenue_allocations ila on ila.id = rria.invoice_line_allocation_id
      left join invoices i on i.id = ila.invoice_id and i.tenant_id = ila.tenant_id
      where prr.status = 'POSTED'
      group by prr.id, prr.tenant_id, prr.contract_asset_created
      having coalesce(sum(case
        when rria.allocation_type = 'CONTRACT_ASSET_CLEARANCE' and i.status <> 'VOIDED'
        then rria.amount else 0 end), 0) - prr.contract_asset_created > 0.01
    `,
  },
];

let failed = 0;

try {
  await client.connect();
  console.log(`FINOS Project accounting integrity audit — ${new Date().toISOString()}`);
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
  console.error(`\nProject accounting integrity audit FAILED: ${failed} invariant${failed === 1 ? "" : "s"} violated or could not be checked.`);
  process.exit(1);
}

console.log("\n✅ Project accounting integrity audit PASSED.");
