import "dotenv/config";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required to run the invoice settlement audit.");
  process.exit(2);
}
const client = new Client({ connectionString: process.env.DATABASE_URL });

const checks = [
  {
    name: "Invoice balance equals original less all active settlement mechanisms",
    sql: `
      with receipt_totals as (
        select cpa.invoice_id,
               coalesce(sum(cpa.amount) filter (where cp.status='POSTED'::customer_payment_status),0) as receipts
        from customer_payment_allocations cpa
        join customer_payments cp on cp.id=cpa.payment_id
        group by cpa.invoice_id
      ), credit_note_totals as (
        select invoice_id,
               coalesce(sum(ar_applied_amount) filter (where status='APPLIED'::"CreditNoteStatus"),0) as ar_credits
        from credit_notes
        group by invoice_id
      ), customer_credit_totals as (
        select invoice_id,
               coalesce(sum(amount) filter (where status='POSTED'),0) as applied_customer_credit
        from customer_credit_applications
        group by invoice_id
      )
      select i.id, i.tenant_id, i.invoice_number, i.total_amount, i.balance_due,
             coalesce(rt.receipts,0) as receipts,
             coalesce(cnt.ar_credits,0) as credit_note_ar,
             coalesce(cct.applied_customer_credit,0) as customer_credit_applied
      from invoices i
      left join receipt_totals rt on rt.invoice_id=i.id
      left join credit_note_totals cnt on cnt.invoice_id=i.id
      left join customer_credit_totals cct on cct.invoice_id=i.id
      where i.status not in ('VOIDED','WRITTEN_OFF')
        and abs(i.balance_due - greatest(0,
          i.total_amount-coalesce(rt.receipts,0)-coalesce(cnt.ar_credits,0)-coalesce(cct.applied_customer_credit,0)
        ))>0.01
    `,
  },
  {
    name: "Invoice amount paid equals posted customer receipts only",
    sql: `
      with receipt_totals as (
        select cpa.invoice_id,
               coalesce(sum(cpa.amount) filter (where cp.status='POSTED'::customer_payment_status),0) as receipts
        from customer_payment_allocations cpa
        join customer_payments cp on cp.id=cpa.payment_id
        group by cpa.invoice_id
      )
      select i.id,i.tenant_id,i.invoice_number,i.amount_paid,coalesce(rt.receipts,0) as receipts
      from invoices i
      left join receipt_totals rt on rt.invoice_id=i.id
      where abs(i.amount_paid-coalesce(rt.receipts,0))>0.01
    `,
  },
  {
    name: "Open AR states do not carry negative balances",
    sql: `
      select id, tenant_id, invoice_number, status, balance_due
      from invoices
      where status not in ('VOIDED','WRITTEN_OFF') and balance_due < -0.01
    `,
  },
];

let failed=0;
try {
  await client.connect();
  console.log(`FINOS invoice settlement audit — ${new Date().toISOString()}`);
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
if(failed>0){console.error(`\nInvoice settlement audit FAILED: ${failed} invariant${failed===1?"":"s"} violated or could not be checked.`);process.exit(1);}
console.log("\n✅ Invoice settlement audit PASSED.");
