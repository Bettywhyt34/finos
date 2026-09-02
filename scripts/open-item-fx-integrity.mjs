import "dotenv/config";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required to run the open-item FX audit.");
  process.exit(2);
}
const client = new Client({ connectionString: process.env.DATABASE_URL });

const checks = [
  {
    name: "Open-item FX evidence table exists",
    sql: `select 'missing' as issue where to_regclass('public.fx_revaluation_items') is null`,
  },
  {
    name: "Posted FX revaluation atomicity trigger exists",
    sql: `select 'missing' as issue where not exists (
      select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='fx_revaluations' and t.tgname='enforce_fx_revaluation_atomicity' and t.tgconstraint<>0 and not t.tgisinternal
    )`,
  },
  {
    name: "Credit notes guard active foreign AR FX",
    sql: `select 'missing' as issue where not exists (
      select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='credit_notes' and t.tgname='enforce_credit_note_active_ar_fx_guard' and t.tgconstraint<>0 and not t.tgisinternal
    )`,
  },
  {
    name: "FX revaluation item equations agree",
    sql: `select id from fx_revaluation_items
      where abs(historical_base_amount-round((foreign_balance*original_rate)::numeric,2))>0.01
         or abs(carrying_base_amount-round((historical_base_amount+prior_carrying_adjustment)::numeric,2))>0.01
         or abs(target_base_amount-round((foreign_balance*closing_rate)::numeric,2))>0.01
         or abs(adjustment_base_amount-round((target_base_amount-carrying_base_amount)::numeric,2))>0.01`,
  },
  {
    name: "Posted revaluation has open-item evidence",
    sql: `select fr.id,fr.period,fr.currency from fx_revaluations fr
      where fr.status='POSTED'::fx_revaluation_status
        and not exists(select 1 from fx_revaluation_items fri where fri.fx_revaluation_id=fr.id and fri.tenant_id=fr.tenant_id)`,
  },
  {
    name: "Receipt historical AR matches invoice rate",
    sql: `select cpa.id from customer_payment_allocations cpa join invoices i on i.id=cpa.invoice_id
      where abs(cpa.base_historical_ar_amount-round((cpa.amount*i.exchange_rate)::numeric,2))>0.01`,
  },
  {
    name: "Receipt AR cleared equals historical plus consumed FX",
    sql: `select cpa.id from customer_payment_allocations cpa
      where abs(cpa.base_ar_amount-round((cpa.base_historical_ar_amount+cpa.fx_unrealized_consumed)::numeric,2))>0.01`,
  },
  {
    name: "Receipt settlement matches receipt rate",
    sql: `select cpa.id from customer_payment_allocations cpa join customer_payments cp on cp.id=cpa.payment_id
      where abs(cpa.base_settlement_amount-round((cpa.amount*cp.exchange_rate)::numeric,2))>0.01`,
  },
  {
    name: "Active AR FX adjustment is not over-consumed",
    sql: `with posted as (
        select fri.tenant_id,fri.invoice_id,sum(fri.adjustment_base_amount) adjustment
        from fx_revaluation_items fri join fx_revaluations fr on fr.id=fri.fx_revaluation_id
        where fri.item_type='AR' and fr.status='POSTED'::fx_revaluation_status group by fri.tenant_id,fri.invoice_id
      ), consumed as (
        select cp.tenant_id,cpa.invoice_id,sum(cpa.fx_unrealized_consumed) consumed
        from customer_payment_allocations cpa join customer_payments cp on cp.id=cpa.payment_id
        where cp.status='POSTED'::customer_payment_status group by cp.tenant_id,cpa.invoice_id
      )
      select p.invoice_id from posted p left join consumed c on c.tenant_id=p.tenant_id and c.invoice_id=p.invoice_id
      join invoices i on i.id=p.invoice_id and i.tenant_id=p.tenant_id
      where i.balance_due<=0.01 and abs(p.adjustment-coalesce(c.consumed,0))>0.01`,
  },
  {
    name: "Applied foreign credit note has no active AR FX",
    sql: `with active as (
      select fri.tenant_id,fri.invoice_id,
        sum(fri.adjustment_base_amount)-coalesce((select sum(cpa.fx_unrealized_consumed) from customer_payment_allocations cpa join customer_payments cp on cp.id=cpa.payment_id where cpa.invoice_id=fri.invoice_id and cp.tenant_id=fri.tenant_id and cp.status='POSTED'::customer_payment_status),0) amount
      from fx_revaluation_items fri join fx_revaluations fr on fr.id=fri.fx_revaluation_id
      where fri.item_type='AR' and fr.status='POSTED'::fx_revaluation_status group by fri.tenant_id,fri.invoice_id
    )
    select cn.id from credit_notes cn join active a on a.tenant_id=cn.tenant_id and a.invoice_id=cn.invoice_id
      where cn.status='APPLIED'::"CreditNoteStatus" and abs(a.amount)>0.01`,
  },
];

let failed = 0;
try {
  await client.connect();
  console.log(`FINOS open-item FX audit — ${new Date().toISOString()}`);
  for (const check of checks) {
    try {
      const result = await client.query(check.sql);
      if (result.rowCount === 0) console.log(`✅ ${check.name}`);
      else {
        failed += 1;
        console.error(`❌ ${check.name} — ${result.rowCount} violation${result.rowCount === 1 ? "" : "s"}`);
        console.error(result.rows.slice(0, 10));
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
if (failed) process.exit(1);
console.log("\n✅ Open-item FX audit PASSED.");
