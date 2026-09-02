import "dotenv/config";
import pg from "pg";

const { Client } = pg;
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is required to run the Quote integrity audit.");
  process.exit(2);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
const checks = [
  {
    name: "Quotes never post directly to the General Ledger",
    sql: `select id, tenant_id, source, source_id from journal_entries where lower(source) in ('quote','sales_quote','estimate')`,
  },
  {
    name: "Quote customer and line dimensions remain tenant consistent",
    sql: `
      select distinct q.id, q.tenant_id, q.quote_number
      from quotes q
      join customers c on c.id=q.customer_id
      left join quote_lines ql on ql.quote_id=q.id
      left join items item on item.id=ql.item_id
      left join chart_of_accounts coa on coa.id=ql.income_account_id
      left join projects p on p.id=ql.project_id
      where c.tenant_id<>q.tenant_id
         or (item.id is not null and item.tenant_id<>q.tenant_id)
         or (coa.id is not null and coa.tenant_id<>q.tenant_id)
         or (p.id is not null and (p.tenant_id<>q.tenant_id or p.customer_id<>q.customer_id))
    `,
  },
  {
    name: "Quote totals reconcile to quote lines",
    sql: `
      select q.id, q.tenant_id, q.quote_number, q.subtotal, q.discount_amount, q.tax_amount, q.total_amount,
             coalesce(sum(ql.amount),0) as line_subtotal,
             coalesce(sum(ql.discount_amount),0) as line_discounts,
             coalesce(sum(ql.tax_amount),0) as line_tax
      from quotes q
      left join quote_lines ql on ql.quote_id=q.id
      group by q.id, q.tenant_id, q.quote_number, q.subtotal, q.discount_amount, q.tax_amount, q.total_amount
      having abs(q.subtotal-coalesce(sum(ql.amount),0))>0.01
          or abs(q.tax_amount-coalesce(sum(ql.tax_amount),0))>0.01
          or abs(q.total_amount-(q.subtotal-coalesce(sum(ql.discount_amount),0)-q.discount_amount+q.tax_amount))>0.01
    `,
  },
  {
    name: "NGN quotes use exchange rate one",
    sql: `select id, tenant_id, quote_number, exchange_rate from quotes where upper(currency)='NGN' and abs(exchange_rate-1)>0.000001`,
  },
  {
    name: "Converted quote has one matching invoice pointer",
    sql: `
      select q.id, q.tenant_id, q.quote_number, q.status, q.converted_invoice_id, q.converted_at
      from quotes q
      left join invoices i on i.id=q.converted_invoice_id
      where (q.status='CONVERTED' and (q.converted_invoice_id is null or q.converted_at is null or i.id is null
             or i.tenant_id<>q.tenant_id or i.customer_id<>q.customer_id or upper(i.currency)<>upper(q.currency)))
         or (q.status<>'CONVERTED' and q.converted_invoice_id is not null)
    `,
  },
  {
    name: "Converted quote and invoice commercial totals match",
    sql: `
      select q.id, q.tenant_id, q.quote_number, q.converted_invoice_id,
             q.subtotal as quote_subtotal, i.subtotal as invoice_subtotal,
             q.discount_amount as quote_discount, i.discount_amount as invoice_discount,
             q.tax_amount as quote_tax, i.tax_amount as invoice_tax,
             q.total_amount as quote_total, i.total_amount as invoice_total
      from quotes q
      join invoices i on i.id=q.converted_invoice_id
      where q.status='CONVERTED'
        and (abs(q.subtotal-i.subtotal)>0.01
          or abs(q.discount_amount-i.discount_amount)>0.01
          or abs(q.tax_amount-i.tax_amount)>0.01
          or abs(q.total_amount-i.total_amount)>0.01
          or upper(q.currency)<>upper(i.currency)
          or abs(q.exchange_rate-i.exchange_rate)>0.000001)
    `,
  },
  {
    name: "Converted quote and invoice commercial lines match",
    sql: `
      with quote_lines_ranked as (
        select q.id as quote_id, q.converted_invoice_id,
               row_number() over (partition by q.id order by ql.id) as rn,
               ql.description, ql.quantity, ql.rate, ql.amount,
               ql.tax_name, ql.tax_rate, ql.tax_amount,
               ql.discount_type, ql.discount_value, ql.discount_amount, ql.line_total,
               ql.income_account_id, ql.project_id, ql.reporting_tags
        from quotes q
        join quote_lines ql on ql.quote_id=q.id
        where q.status='CONVERTED'
      ), invoice_lines_ranked as (
        select q.id as quote_id, i.id as invoice_id,
               row_number() over (partition by i.id order by il.id) as rn,
               il.description, il.quantity, il.rate, il.amount,
               il.tax_name, il.tax_rate, il.tax_amount,
               il.discount_type, il.discount_value, il.discount_amount, il.line_total,
               il.income_account_id, il.project_id, il.reporting_tags
        from quotes q
        join invoices i on i.id=q.converted_invoice_id
        join invoice_lines il on il.invoice_id=i.id
        where q.status='CONVERTED'
      ), differences as (
        select coalesce(ql.quote_id, il.quote_id) as quote_id,
               coalesce(ql.converted_invoice_id, il.invoice_id) as invoice_id,
               coalesce(ql.rn, il.rn) as rn
        from quote_lines_ranked ql
        full join invoice_lines_ranked il
          on il.quote_id=ql.quote_id and il.invoice_id=ql.converted_invoice_id and il.rn=ql.rn
        where ql.quote_id is null or il.invoice_id is null
           or ql.description is distinct from il.description
           or abs(ql.quantity-il.quantity)>0.000001
           or abs(ql.rate-il.rate)>0.01
           or abs(ql.amount-il.amount)>0.01
           or ql.tax_name is distinct from il.tax_name
           or abs(ql.tax_rate-il.tax_rate)>0.000001
           or abs(ql.tax_amount-il.tax_amount)>0.01
           or ql.discount_type is distinct from il.discount_type
           or abs(ql.discount_value-il.discount_value)>0.000001
           or abs(ql.discount_amount-il.discount_amount)>0.01
           or abs(ql.line_total-il.line_total)>0.01
           or ql.income_account_id is distinct from il.income_account_id
           or ql.project_id is distinct from il.project_id
           or coalesce(ql.reporting_tags,'{}'::jsonb) is distinct from coalesce(il.reporting_tags,'{}'::jsonb)
      )
      select * from differences
    `,
  },
];

let failed=0;
try {
  await client.connect();
  console.log(`FINOS Quote integrity audit — ${new Date().toISOString()}`);
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
  console.error(`\nQuote integrity audit FAILED: ${failed} invariant${failed===1?"":"s"} violated or could not be checked.`);
  process.exit(1);
}
console.log("\n✅ Quote integrity audit PASSED.");
