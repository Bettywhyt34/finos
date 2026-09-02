import "dotenv/config";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required to run the Money In integrity audit.");
  process.exit(2);
}
const client = new Client({ connectionString: process.env.DATABASE_URL });

const checks = [
  {
    name: "Customer receipt atomicity constraint trigger exists",
    sql: `select 'missing' where not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='customer_payments' and t.tgname='enforce_customer_payment_atomicity' and t.tgconstraint<>0 and not t.tgisinternal)`,
  },
  {
    name: "Customer receipt allocation evidence constraint trigger exists",
    sql: `select 'missing' where not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='customer_payment_allocations' and t.tgname='enforce_customer_payment_allocation_evidence' and t.tgconstraint<>0 and not t.tgisinternal)`,
  },
  {
    name: "One receipt allocation per invoice is enforced",
    sql: `select 'missing' where not exists (select 1 from pg_indexes where schemaname='public' and tablename='customer_payment_allocations' and indexname='customer_payment_allocations_payment_invoice_uidx')`,
  },
  {
    name: "Posted receipt has authoritative journal",
    sql: `select cp.id,cp.tenant_id,cp.payment_number from customer_payments cp where cp.status='POSTED'::customer_payment_status and not exists (select 1 from journal_entries je where je.tenant_id=cp.tenant_id and je.source='customer_payment' and je.source_id=cp.id and je.is_locked=true)`,
  },
  {
    name: "Reversed receipt has reversal journal evidence",
    sql: `select cp.id,cp.tenant_id,cp.payment_number from customer_payments cp where cp.status='REVERSED'::customer_payment_status and (cp.reversal_journal_entry_id is null or not exists (select 1 from journal_entries je where je.id=cp.reversal_journal_entry_id and je.tenant_id=cp.tenant_id and je.source='customer_payment_reversal' and je.source_id=cp.id and je.is_locked=true))`,
  },
  {
    name: "Posted cash receipt has receiving account",
    sql: `select cp.id,cp.tenant_id,cp.payment_number from customer_payments cp where cp.status='POSTED'::customer_payment_status and cp.amount>0 and cp.bank_account_id is null`,
  },
  {
    name: "Receiving account is tenant currency and ledger consistent",
    sql: `select cp.id,cp.payment_number from customer_payments cp join bank_accounts ba on ba.id=cp.bank_account_id left join chart_of_accounts coa on coa.id=ba.ledger_account_id where cp.status='POSTED'::customer_payment_status and cp.amount>0 and (ba.tenant_id<>cp.tenant_id or upper(ba.currency)<>upper(cp.currency) or ba.ledger_account_id is null or coa.tenant_id<>cp.tenant_id or coa.type::text<>'ASSET' or coa.is_active<>true)`,
  },
  {
    name: "NGN receipts use rate one",
    sql: `select id,tenant_id,payment_number,exchange_rate from customer_payments where upper(currency)='NGN' and abs(exchange_rate-1)>0.000001`,
  },
  {
    name: "Receipt allocations equal gross settlement",
    sql: `select cp.id,cp.payment_number from customer_payments cp left join customer_payment_allocations cpa on cpa.payment_id=cp.id group by cp.id,cp.payment_number,cp.amount,cp.wht_amount having abs(coalesce(sum(cpa.amount),0)-(cp.amount+cp.wht_amount))>0.01`,
  },
  {
    name: "Receipt allocation invoice tenant customer and currency consistent",
    sql: `select cpa.id,cpa.payment_id,cpa.invoice_id from customer_payment_allocations cpa join customer_payments cp on cp.id=cpa.payment_id join invoices i on i.id=cpa.invoice_id where i.tenant_id<>cp.tenant_id or i.customer_id<>cp.customer_id or upper(i.currency)<>upper(cp.currency)`,
  },
  {
    name: "Allocation historical AR matches invoice transaction rate",
    sql: `select cpa.id,cpa.payment_id,cpa.invoice_id,cpa.base_historical_ar_amount from customer_payment_allocations cpa join invoices i on i.id=cpa.invoice_id where abs(cpa.base_historical_ar_amount-round((cpa.amount*i.exchange_rate)::numeric,2))>0.01`,
  },
  {
    name: "Allocation AR carrying value includes consumed unrealised FX",
    sql: `select id,payment_id,invoice_id,base_ar_amount,base_historical_ar_amount,fx_unrealized_consumed from customer_payment_allocations where abs(base_ar_amount-round((base_historical_ar_amount+fx_unrealized_consumed)::numeric,2))>0.01`,
  },
  {
    name: "Allocation base settlement matches receipt rate",
    sql: `select cpa.id,cpa.payment_id,cpa.invoice_id,cpa.base_settlement_amount from customer_payment_allocations cpa join customer_payments cp on cp.id=cpa.payment_id where abs(cpa.base_settlement_amount-round((cpa.amount*cp.exchange_rate)::numeric,2))>0.01`,
  },
  {
    name: "Invoice amount paid equals active receipt allocations",
    sql: `select i.id,i.tenant_id,i.invoice_number,i.amount_paid,coalesce(sum(case when cp.id is not null then cpa.amount else 0 end),0) as active_receipts from invoices i left join customer_payment_allocations cpa on cpa.invoice_id=i.id left join customer_payments cp on cp.id=cpa.payment_id and cp.status='POSTED'::customer_payment_status group by i.id,i.tenant_id,i.invoice_number,i.amount_paid having abs(i.amount_paid-coalesce(sum(case when cp.id is not null then cpa.amount else 0 end),0))>0.01`,
  },
  {
    name: "Applied credit note has authoritative journal evidence",
    sql: `select cn.id,cn.tenant_id,cn.credit_number from credit_notes cn where cn.status='APPLIED'::"CreditNoteStatus" and (cn.journal_entry_id is null or not exists (select 1 from journal_entries je where je.id=cn.journal_entry_id and je.tenant_id=cn.tenant_id and je.source='credit_note' and je.source_id=cn.id and je.is_locked=true))`,
  },
  {
    name: "Reversed credit note has reversal journal evidence",
    sql: `select cn.id,cn.tenant_id,cn.credit_number from credit_notes cn where cn.status='REVERSED'::"CreditNoteStatus" and (cn.reversal_journal_entry_id is null or not exists (select 1 from journal_entries je where je.id=cn.reversal_journal_entry_id and je.tenant_id=cn.tenant_id and je.source='credit_note_reversal' and je.source_id=cn.id and je.is_locked=true))`,
  },
  {
    name: "Credit note invoice customer currency and rate are consistent",
    sql: `select cn.id,cn.credit_number from credit_notes cn join invoices i on i.id=cn.invoice_id where cn.tenant_id<>i.tenant_id or cn.customer_id<>i.customer_id or upper(cn.currency)<>upper(i.currency) or abs(cn.exchange_rate-i.exchange_rate)>0.000001`,
  },
  {
    name: "Credit note base and commercial split are consistent",
    sql: `select cn.id,cn.credit_number from credit_notes cn where abs(cn.base_amount-round((cn.amount*cn.exchange_rate)::numeric,2))>0.01 or abs((cn.ar_applied_amount+cn.customer_credit_amount)-cn.amount)>0.01`,
  },
  {
    name: "Applied credit note is not Project linked",
    sql: `select distinct cn.id,cn.tenant_id,cn.credit_number from credit_notes cn join invoice_lines il on il.invoice_id=cn.invoice_id where cn.status='APPLIED'::"CreditNoteStatus" and il.project_id is not null`,
  },
];

let failed=0;
try {
  await client.connect();
  console.log(`FINOS Money In integrity audit — ${new Date().toISOString()}`);
  console.log(`Running ${checks.length} read-only invariants...\n`);
  for(const check of checks){
    try{
      const result=await client.query(check.sql);
      if(result.rowCount===0) console.log(`✅ ${check.name}`);
      else { failed+=1; console.error(`❌ ${check.name} — ${result.rowCount} violation${result.rowCount===1?"":"s"}`); console.error(result.rows.slice(0,10)); }
    } catch(error){ failed+=1; console.error(`❌ ${check.name} — audit query failed`); console.error(error instanceof Error?error.message:error); }
  }
} finally { await client.end().catch(()=>undefined); }
if(failed>0){ console.error(`\nMoney In integrity audit FAILED: ${failed} invariant${failed===1?"":"s"} violated or could not be checked.`); process.exit(1); }
console.log("\n✅ Money In integrity audit PASSED.");
