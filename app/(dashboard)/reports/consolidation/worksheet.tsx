"use client";
import { useState } from "react";
import type { Elimination } from "@/lib/mvp/consolidation";

export function EliminationWorksheet({accounts, initial}: {accounts: {entityId: string; accountId: string; label: string}[]; initial: Elimination[]}) {
  const [lines, setLines] = useState(initial);
  function change(index: number, patch: Partial<Elimination>) { setLines(previous => previous.map((line,i) => i === index ? {...line,...patch} : line)); }
  return <fieldset className="space-y-3"><legend className="font-semibold">Intercompany eliminations</legend>
    <input type="hidden" name="adjustments" value={JSON.stringify(lines)}/>
    <p className="text-sm">First select entities and run the report to load accounts. Add equal debit and credit adjustments, with a reason for each. These affect this report only.</p>
    {lines.map((line,index) => <div key={index} className="grid gap-2 rounded border p-3 md:grid-cols-5">
      <label className="text-xs">Source account<select required className="block w-full rounded border p-2" value={`${line.entityId}/${line.accountId}`} onChange={e => { const account=accounts.find(a=>`${a.entityId}/${a.accountId}`===e.target.value); if(account)change(index,{entityId:account.entityId,accountId:account.accountId}); }}><option value="/">Choose account</option>{accounts.map(a=><option key={`${a.entityId}/${a.accountId}`} value={`${a.entityId}/${a.accountId}`}>{a.label}</option>)}</select></label>
      <label className="text-xs">Debit<input className="block w-full rounded border p-2" type="number" min="0" step="0.01" value={line.debit} onChange={e=>change(index,{debit:Number(e.target.value)})}/></label>
      <label className="text-xs">Credit<input className="block w-full rounded border p-2" type="number" min="0" step="0.01" value={line.credit} onChange={e=>change(index,{credit:Number(e.target.value)})}/></label>
      <label className="text-xs">Reason<input required maxLength={1000} className="block w-full rounded border p-2" value={line.reason} onChange={e=>change(index,{reason:e.target.value})}/></label>
      <button type="button" className="text-sm underline" onClick={()=>setLines(previous=>previous.filter((_,i)=>i!==index))}>Remove worksheet line</button>
    </div>)}
    <button type="button" disabled={!accounts.length || lines.length >= 100} className="rounded border p-2 disabled:opacity-50" onClick={()=>setLines(previous=>[...previous,{entityId:"",accountId:"",debit:0,credit:0,reason:""}])}>Add elimination line</button>
  </fieldset>;
}

export function ExportConsolidation({snapshot}: {snapshot: object}) {
  return <button className="rounded border px-4 py-2" onClick={()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download="finos-consolidation-evidence.json";link.click();URL.revokeObjectURL(url);
  }}>Download report and evidence</button>;
}
