import "dotenv/config";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required to run the customer-credit audit.");
  process.exit(2);
}
const client = new Client({ connectionString: process.env.DATABASE_URL });

const checks = [
  {
    name: "Customer credit liability evidence matches applied credit-note split",
    sql: `
      select cn.id, cn.credit_number, cn.customer_credit_amount,
             cc.id as customer_credit_id, cc.original_amount, cc.original_base_amount
      from credit_notes cn
      left join customer_credits cc on cc.credit_note_id=cn.id and cc.tenant_id=cn.tenant_id
      where cn.status='APPLIED'::"CreditNoteStatus"
        and cn.customer_credit_amount>0.005
        and (
          cc.id is null
          or cc.customer_id<>cn.customer_id
          or upper(cc.currency)<>upper(cn.currency)
          or abs(cc.original_amount-cn.customer_credit_amount)>0.01
          or abs(cc.original_base_amount-round((cn.customer_credit_amount*cn.exchange_rate)::numeric,2))>0.01
        )
    `,
  },
  {
    name: "Customer credit balance reconciles to applications and refunds",
    sql: `
      with movements as (
        select cc.id,
          coalesce((select sum(a.amount) from customer_credit_applications a where a.customer_credit_id=cc.id and a.status='POSTED'),0) as applied,
          coalesce((select sum(r.amount) from customer_credit_refunds r where r.customer_credit_id=cc.id and r.status='POSTED'),0) as refunded
        from customer_credits cc
      )
      select cc.id,cc.original_amount,cc.remaining_amount,m.applied,m.refunded
      from customer_credits cc join movements m on m.id=cc.id
      where cc.status<>'REVERSED'
        and abs(cc.remaining_amount-greatest(0,cc.original_amount-m.applied-m.refunded))>0.01
    `,
  },
  {
    name: "Customer credit base carrying value matches original credit rate",
    sql: `
      select id,remaining_amount,remaining_base_amount,exchange_rate
      from customer_credits
      where status<>'REVERSED'
        and abs(remaining_base_amount-round((remaining_amount*exchange_rate)::numeric,2))>0.01
    `,
  },
  {
    name: "Posted customer-credit applications have locked journals",
    sql: `
      select a.id,a.tenant_id,a.journal_entry_id
      from customer_credit_applications a
      where a.status='POSTED'
        and not exists (
          select 1 from journal_entries je
          where je.id=a.journal_entry_id and je.tenant_id=a.tenant_id
            and je.source='customer_credit_application' and je.source_id=a.id and je.is_locked=true
        )
    `,
  },
  {
    name: "Customer-credit application evidence matches customer currency and AR carrying value",
    sql: `
      select a.id,a.amount,a.base_credit_amount,a.base_ar_amount,a.fx_unrealized_consumed,
             cc.exchange_rate as credit_rate,i.exchange_rate as invoice_rate
      from customer_credit_applications a
      join customer_credits cc on cc.id=a.customer_credit_id
      join invoices i on i.id=a.invoice_id
      where a.status='POSTED'
        and (
          a.tenant_id<>cc.tenant_id or a.tenant_id<>i.tenant_id
          or cc.customer_id<>i.customer_id or upper(cc.currency)<>upper(i.currency)
          or abs(a.base_credit_amount-round((a.amount*cc.exchange_rate)::numeric,2))>0.01
          or abs(a.base_ar_amount-round((a.amount*i.exchange_rate+a.fx_unrealized_consumed)::numeric,2))>0.01
        )
    `,
  },
  {
    name: "Posted customer-credit refunds have locked journals and mapped same-currency banks",
    sql: `
      select r.id,r.tenant_id,r.bank_account_id,r.currency,r.journal_entry_id
      from customer_credit_refunds r
      join bank_accounts ba on ba.id=r.bank_account_id
      left join chart_of_accounts coa on coa.id=ba.ledger_account_id and coa.tenant_id=ba.tenant_id
      where r.status='POSTED'
        and (
          ba.tenant_id<>r.tenant_id or upper(ba.currency)<>upper(r.currency) or ba.is_active<>true
          or ba.ledger_account_id is null or coa.tenant_id<>r.tenant_id or coa.type::text<>'ASSET' or coa.is_active<>true
          or not exists (
            select 1 from journal_entries je
            where je.id=r.journal_entry_id and je.tenant_id=r.tenant_id
              and je.source='customer_credit_refund' and je.source_id=r.id and je.is_locked=true
          )
        )
    `,
  },
  {
    name: "Customer-credit refund base evidence matches liability and settlement rates",
    sql: `
      select r.id,r.amount,r.base_credit_amount,r.base_settlement_amount,r.exchange_rate,cc.exchange_rate as credit_rate
      from customer_credit_refunds r
      join customer_credits cc on cc.id=r.customer_credit_id
      where r.status='POSTED'
        and (
          abs(r.base_credit_amount-round((r.amount*cc.exchange_rate)::numeric,2))>0.01
          or abs(r.base_settlement_amount-round((r.amount*r.exchange_rate)::numeric,2))>0.01
        )
    `,
  },
  {
    name: "Customer Credit system mapping, when present, points to active liability",
    sql: `
      select sam.tenant_id,sam.account_id,coa.type::text as account_type,coa.is_active
      from system_account_mappings sam
      left join chart_of_accounts coa on coa.id=sam.account_id and coa.tenant_id=sam.tenant_id
      where sam.role='CUSTOMER_CREDIT'
        and (coa.id is null or coa.type::text<>'LIABILITY' or coa.is_active<>true)
    `,
  },
];

let failed=0;
try {
  await client.connect();
  console.log(`FINOS customer-credit integrity audit — ${new Date().toISOString()}`);
  console.log(`Running ${checks.length} read-only invariants...\n`);
  for (const check of checks) {
    try {
      const result=await client.query(check.sql);
      if(result.rowCount===0) console.log(`✅ ${check.name}`);
      else {
        failed+=1;
        console.error(`❌ ${check.name} — ${result.rowCount} violation${result.rowCount===1?"":"s"}`);
        console.error(result.rows.slice(0,10));
      }
    } catch(error) {
      failed+=1;
      console.error(`❌ ${check.name} — audit query failed`);
      console.error(error instanceof Error?error.message:error);
    }
  }
} finally {
  await client.end().catch(()=>undefined);
}
if(failed>0){console.error(`\nCustomer-credit audit FAILED: ${failed} invariant${failed===1?"":"s"} violated or could not be checked.`);process.exit(1);}
console.log("\n✅ Customer-credit integrity audit PASSED.");
