import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import * as crypto from 'node:crypto';

async function load(path, imports = {}) {
  const context = vm.createContext({ Date, Intl, console });
  const mod = new vm.SourceTextModule(stripTypeScriptTypes(await readFile(new URL(`../${path}`, import.meta.url), 'utf8')), {context});
  await mod.link(specifier => { assert.ok(imports[specifier], `Unexpected import ${specifier}`); const values = imports[specifier]; return new vm.SyntheticModule(Object.keys(values), function() { for (const [k,v] of Object.entries(values)) this.setExport(k,v); }, {context}); });
  await mod.evaluate(); return mod.namespace;
}
const forecast = await load('lib/mvp/cash-forecast.ts');
const group = await load('lib/mvp/consolidation.ts');
const request = await load('lib/mvp/settlement-request.ts', {'node:crypto': crypto});
const item = (id,amount,dueDate) => ({id,label:`SYNTHETIC ${id}`,amount,dueDate,href:`/evidence/${id}`});

for (const [label, opening, expected] of [['shortfall',0,-50],['liquid',100,50],['zero',50,0]]) {
  test(`13-week cash fixture: ${label}, cents and source evidence`, () => {
    const weeks = forecast.cashForecast(opening,[item('invoice',100,'2026-09-01')],[item('bill',150,'2026-09-22')],'2026-09-22');
    assert.equal(weeks.length,13); assert.equal(weeks[0].closing,expected); assert.equal(weeks[12].closing,expected); assert.equal(weeks[0].receiptIds[0],'invoice');
  });
}
test('collection delay changes timing, not total receipts; outside-horizon amounts excluded', () => {
  const weeks = forecast.cashForecast(0,[item('a',100,'2026-09-22'),item('b',999,'2027-09-22')],[],'2026-09-22',14);
  assert.equal(weeks[0].receipts,0); assert.equal(weeks[2].receipts,100); assert.equal(weeks[12].closing,100);
  assert.throws(()=>forecast.cashForecast(0,[item('bad',NaN,'2026-09-22')],[],'2026-09-22'));
});
const account = (id,code,name,type,balance) => ({accountId:id,code,name,type,balance,financialCategory:null,subtype:null});
const books = [{id:'a',name:'SYNTHETIC A',currency:'NGN',balances:[account('ar','110','AR','ASSET',100),account('rev','400','Sales','INCOME',100)]},{id:'b',name:'SYNTHETIC B',currency:'NGN',balances:[account('ap','210','AP','LIABILITY',100),account('cost','500','Costs','EXPENSE',100)]}];
test('balanced intercompany eliminations remove internal balances and trading without altering books',()=>{
  const before=JSON.stringify(books);
  const rows=group.consolidate(books,[{entityId:'a',accountId:'ar',debit:0,credit:100,reason:'SYNTHETIC reciprocal AR/AP'},{entityId:'b',accountId:'ap',debit:100,credit:0,reason:'SYNTHETIC reciprocal AR/AP'},{entityId:'a',accountId:'rev',debit:100,credit:0,reason:'SYNTHETIC internal trade'},{entityId:'b',accountId:'cost',debit:0,credit:100,reason:'SYNTHETIC internal trade'}]);
  assert.ok(rows.every(r=>r.balance===0)); assert.equal(JSON.stringify(books),before);
});
test('consolidation rejects unbalanced, foreign, incompatible and non-NGN scopes',()=>{
  assert.throws(()=>group.consolidate(books,[{entityId:'a',accountId:'ar',debit:0,credit:1,reason:'x'}]));
  assert.throws(()=>group.consolidate(books,[{entityId:'foreign',accountId:'ar',debit:1,credit:0,reason:'x'}]));
  assert.throws(()=>group.consolidate([{...books[0],currency:'USD'}],[]));
  assert.throws(()=>group.consolidate([books[0],{...books[1],balances:[account('other','110','Different','ASSET',10)]}],[]));
});
test('settlement request identity is stable, tenant scoped and payload-bound',()=>{
  const a=request.settlementRequest('qvt','same',{amount:10});
  assert.equal(a.id,request.settlementRequest('qvt','same',{amount:20}).id);
  assert.notEqual(a.marker,request.settlementRequest('qvt','same',{amount:20}).marker);
  assert.notEqual(a.id,request.settlementRequest('other','same',{amount:10}).id);
  assert.throws(()=>request.settlementRequest('qvt','',{}));
});

async function vendorHarness({role='ACCOUNTANT',fail=false,currency='NGN'}={}) {
  let state={paid:0,payments:[],journals:[],allocations:[]}; let lock=false; let tail=Promise.resolve();
  const prisma={tenant:{findUnique:async()=>({currency:'NGN'})},$transaction:async fn=>{
    const previous=tail; let release; tail=new Promise(resolve=>release=resolve); await previous;
    const saved=structuredClone(state); lock=false;
    const tx={
      $queryRaw:async (strings,...values)=>{ const sql=strings.join('?'); if(sql.includes('pg_advisory_xact_lock')) lock=true; if(sql.includes('SELECT coa.id')) return [{id:'bank-ledger'}]; return []; },
      $executeRaw:async(strings,...values)=>{if(strings.join('').includes('INSERT INTO vendor_payment_allocations'))state.allocations.push(values);return 1;},
      vendor:{findFirst:async()=>({id:'vendor'})},
      bill:{findMany:async()=>{assert.equal(lock,true,'must lock before reading bill balances');return [{id:'bill',status:state.paid===100?'PAID':'RECORDED',totalAmount:100,amountCredited:0,amountPaid:state.paid,currency,exchangeRate:1}];},update:async({data})=>{state.paid=data.amountPaid;}},
      vendorPayment:{count:async()=>state.payments.length,create:async({data})=>{state.payments.push(data);return {id:data.id};}},
      journalEntry:{findFirst:async({where})=>state.journals.find(j=>j.sourceId===where.sourceId)},
    };
    try{return await fn(tx);}catch(e){state=saved;throw e;}finally{release();}
  }};
  const mod=await load('app/(dashboard)/purchases/bills/actions.ts',{
    '@/lib/mvp/settlement-request':request,'next/cache':{revalidatePath:()=>{}},'@/lib/auth':{auth:async()=>({user:{id:'user',tenantId:'qvt',role}})},'@/lib/prisma':{prisma},
    '@/lib/journal':{postJournalEntryInTransaction:async(_tx,data)=>{if(fail)throw Error('Injected journal failure');assert.equal(data.lines.reduce((s,l)=>s+l.debit-l.credit,0),0);state.journals.push(data);}},
    '@/lib/accounting/system-accounts':{resolveSystemAccount:async(_tx,_tenant,key)=>({id:key})},'@/lib/utils':{getRecognitionPeriod:()=> '2026-09',toNGN:(a,r)=>a*r},'@/lib/integrations/bettywhyt/webhook-sender':{sendToBettywhyt:()=>{}},
  });
  const input={requestId:'request-1',tenantId:'qvt',bankAccountId:'bank',vendorId:'vendor',paymentDate:'2026-09-01',amount:100,method:'BANK_TRANSFER',whtAmount:10,billAllocations:[{billId:'bill',amount:100}]};
  return {pay:mod.recordBillPayment,input,state:()=>state};
}
test('vendor payment retry creates one payment, allocation and balanced WHT journal',async()=>{
  const h=await vendorHarness(); const a=await h.pay(h.input); const b=await h.pay(h.input);
  assert.equal(a.success,true);assert.equal(b.id,a.id);assert.equal(h.state().payments.length,1);assert.equal(h.state().allocations.length,1);assert.equal(h.state().paid,100);
  assert.ok((await h.pay({...h.input,whtAmount:0})).error);
});
test('concurrent distinct vendor requests cannot overpay the same bill',async()=>{
  const h=await vendorHarness(); const results=await Promise.all([h.pay(h.input),h.pay({...h.input,requestId:'request-2'})]);
  assert.equal(results.filter(r=>r.success).length,1);assert.equal(h.state().payments.length,1);assert.equal(h.state().paid,100);
});
test('journal failure rolls back payment, allocation and bill balance',async()=>{
  const h=await vendorHarness({fail:true});assert.ok((await h.pay(h.input)).error);assert.equal(h.state().paid,0);assert.equal(h.state().payments.length,0);assert.equal(h.state().allocations.length,0);
});
test('viewer, stale entity, foreign currency and excess allocation fail',async()=>{
  const viewer=await vendorHarness({role:'VIEWER'});assert.ok((await viewer.pay(viewer.input)).error);
  const h=await vendorHarness();assert.ok((await h.pay({...h.input,tenantId:'other'})).error);
  assert.ok((await h.pay({...h.input,amount:100.01,billAllocations:[{billId:'bill',amount:100.01}]})).error);
  const fx=await vendorHarness({currency:'USD'});assert.ok((await fx.pay(fx.input)).error);
});
