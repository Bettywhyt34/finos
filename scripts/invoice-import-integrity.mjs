import "dotenv/config";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required to run the invoice import audit.");
  process.exit(2);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
const checks = [
  {
    name: "Imported invoices remain unposted drafts until explicit posting",
    sql: `
      select i.id, i.tenant_id, i.invoice_number, i.status, i.external_txn_id
      from invoices i
      where i.external_txn_id is not null
        and i.status = 'DRAFT'::"InvoiceStatus"
        and exists (
          select 1 from journal_entries je
          where je.tenant_id=i.tenant_id and je.source='invoice' and je.source_id=i.id
        )
    `,
  },
  {
    name: "Draft imported invoices carry no settlement state",
    sql: `
      select id, tenant_id, invoice_number, amount_paid, balance_due, total_amount
      from invoices
      where external_txn_id is not null
        and status='DRAFT'::"InvoiceStatus"
        and (abs(amount_paid) > 0.01 or abs(balance_due-total_amount) > 0.01)
    `,
  },
  {
    name: "Imported external transaction IDs are unique within entity",
    sql: `
      select tenant_id, external_txn_id, count(*) as duplicate_count
      from invoices
      where external_txn_id is not null
      group by tenant_id, external_txn_id
      having count(*) > 1
    `,
  },
  {
    name: "Imported invoice currencies and rates are valid",
    sql: `
      select id, tenant_id, invoice_number, currency, exchange_rate
      from invoices
      where external_txn_id is not null
        and (
          currency !~ '^[A-Z]{3}$'
          or exchange_rate <= 0
          or (upper(currency)='NGN' and abs(exchange_rate-1) > 0.000001)
        )
    `,
  },
  {
    name: "Imported line economics are non-negative and finite",
    sql: `
      select il.id, i.tenant_id, i.invoice_number, il.quantity, il.rate, il.tax_rate
      from invoice_lines il
      join invoices i on i.id=il.invoice_id
      where i.external_txn_id is not null
        and (il.quantity <= 0 or il.rate < 0 or il.tax_rate < 0 or il.tax_rate > 100)
    `,
  },
];

let failed=0;
try {
  await client.connect();
  console.log(`FINOS invoice import audit — ${new Date().toISOString()}`);
  console.log(`Running ${checks.length} read-only invariants...\n`);
  for (const check of checks) {
    try {
      const result=await client.query(check.sql);
      if (result.rowCount===0) console.log(`✅ ${check.name}`);
      else {
        failed+=1;
        console.error(`❌ ${check.name} — ${result.rowCount} violation${result.rowCount===1?"":"s"}`);
        console.error(result.rows.slice(0,10));
      }
    } catch (error) {
      failed+=1;
      console.error(`❌ ${check.name} — audit query failed`);
      console.error(error instanceof Error?error.message:error);
    }
  }
} finally {
  await client.end().catch(()=>undefined);
}
if (failed>0) {
  console.error(`\nInvoice import audit FAILED: ${failed} invariant${failed===1?"":"s"} violated or could not be checked.`);
  process.exit(1);
}
console.log("\n✅ Invoice import audit PASSED.");
