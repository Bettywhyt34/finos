"use client";

import { useMemo, useState, useTransition } from "react";
import { createAccrual, releaseAccrual, reverseAccrual, reverseAccrualMovement, settleAccrual } from "./actions";

type Account = { id: string; code: string; name: string };
type Vendor = { id: string; name: string };
type Project = { id: string; name: string };
type ReportingTagDefinition = { id: string; name: string; options: Array<{ id: string; name: string }> };
type BillLine = { id: string; billNumber: string; vendorId: string; billDate: string; accountId: string; projectId: string | null; reportingTags: Record<string,string> | null; description: string; baseAmount: number; usedAmount: number };
type Movement = { id: string; accrualId: string; kind: "SETTLEMENT" | "RELEASE"; date: string; target: string; amount: number; status: string };
type Accrual = { id: string; accrualNumber: string; accrualDate: string; description: string; vendorId: string | null; vendorName: string | null; accountId: string; accountLabel: string; projectId: string | null; projectName: string | null; reportingTags: Record<string,string> | null; currency: string; amount: number; settled: number; released: number; remaining: number; status: string };

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0,10);
}
function money(value: number, currency: string) { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }

export function AccrualManager({ baseCurrency, accounts, vendors, projects, reportingTagDefinitions, billLines, accruals, movements }: {
  baseCurrency: string; accounts: Account[]; vendors: Vendor[]; projects: Project[]; reportingTagDefinitions: ReportingTagDefinition[]; billLines: BillLine[]; accruals: Accrual[]; movements: Movement[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [selectedAccrualId, setSelectedAccrualId] = useState(accruals.find((a) => a.status === "POSTED" && a.remaining > 0.005)?.id ?? "");
  const selected = accruals.find((a) => a.id === selectedAccrualId) ?? null;

  const eligibleBillLines = useMemo(() => selected ? billLines.filter((line) => {
    if (line.accountId !== selected.accountId) return false;
    if (selected.vendorId && line.vendorId !== selected.vendorId) return false;
    if (selected.projectId && line.projectId !== selected.projectId) return false;
    if (JSON.stringify(line.reportingTags ?? {}) !== JSON.stringify(selected.reportingTags ?? {})) return false;
    return line.baseAmount - line.usedAmount > 0.005;
  }) : [], [selected, billLines]);

  function run(task: () => Promise<{ error?: string; success?: true }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await task();
      setMessage(result.error ?? "Saved. Refreshing the accounting view…");
      if (!result.error) window.location.reload();
    });
  }

  return <div className="space-y-6">
    {message ? <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</div> : null}

    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4"><h2 className="text-base font-semibold text-slate-900">Record accrued cost</h2><p className="mt-1 text-sm text-slate-500">Use this when the cost has been incurred but the supplier Bill has not arrived yet. Accruals are recorded in {baseCurrency}.</p></div>
      <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        const reportingTags = Object.fromEntries(reportingTagDefinitions.map((tag) => [tag.id, String(f.get(`tag:${tag.id}`) ?? "")]).filter(([, optionId]) => optionId));
        run(() => createAccrual({ accrualDate: String(f.get("date")), description: String(f.get("description")), amount: Number(f.get("amount")), accountId: String(f.get("account")), vendorId: String(f.get("vendor") || "") || null, projectId: String(f.get("project") || "") || null, reportingTags: Object.keys(reportingTags).length ? reportingTags : null }));
      }}>
        <label className="text-sm font-medium text-slate-700">Date<input name="date" type="date" defaultValue={today()} required className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3" /></label>
        <label className="text-sm font-medium text-slate-700">Expense account<select name="account" required className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3"><option value="">Select account</option>{accounts.map((a)=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Amount ({baseCurrency})<input name="amount" type="number" min="0.01" step="0.01" required className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3" /></label>
        <label className="text-sm font-medium text-slate-700">Vendor <span className="font-normal text-slate-400">optional</span><select name="vendor" className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3"><option value="">Not specified</option>{vendors.map((v)=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Project <span className="font-normal text-slate-400">optional</span><select name="project" className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3"><option value="">No Project</option>{projects.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Description<input name="description" required placeholder="e.g. August legal services" className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3" /></label>
        {reportingTagDefinitions.map((tag) => <label key={tag.id} className="text-sm font-medium text-slate-700">{tag.name} <span className="font-normal text-slate-400">optional</span><select name={`tag:${tag.id}`} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3"><option value="">Not set</option>{tag.options.map((option)=><option key={option.id} value={option.id}>{option.name}</option>)}</select></label>)}
        <div className="md:col-span-2 xl:col-span-3"><button disabled={pending} className="rounded-md bg-[var(--finos-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Record accrual</button></div>
      </form>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4"><h2 className="text-base font-semibold text-slate-900">Clear an accrual</h2><p className="mt-1 text-sm text-slate-500">Link a posted Bill line to reverse the duplicate Bill expense, or release an estimate that will no longer be billed.</p></div>
      <label className="text-sm font-medium text-slate-700">Accrual<select value={selectedAccrualId} onChange={(e)=>setSelectedAccrualId(e.target.value)} className="mt-1 h-10 w-full max-w-xl rounded-md border border-slate-200 px-3"><option value="">Select open accrual</option>{accruals.filter((a)=>a.status==="POSTED"&&a.remaining>0.005).map((a)=><option key={a.id} value={a.id}>{a.accrualNumber} · {a.description} · {money(a.remaining,a.currency)} open</option>)}</select></label>
      {selected ? <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <form className="rounded-lg border border-slate-200 p-4" onSubmit={(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);run(()=>settleAccrual({accrualId:selected.id,billLineId:String(f.get("billLine")),settlementDate:String(f.get("date")),amount:Number(f.get("amount"))}));}}>
          <h3 className="font-semibold text-slate-900">Link supplier Bill</h3><p className="mt-1 text-xs text-slate-500">Only matching immediate Expense lines are shown.</p>
          <select name="billLine" required className="mt-3 h-10 w-full rounded-md border border-slate-200 px-3"><option value="">Select Bill line</option>{eligibleBillLines.map((l)=><option key={l.id} value={l.id}>{l.billNumber} · {l.description} · {money(l.baseAmount-l.usedAmount,baseCurrency)} available</option>)}</select>
          <div className="mt-3 grid grid-cols-2 gap-3"><input name="date" type="date" defaultValue={today()} required className="h-10 rounded-md border border-slate-200 px-3"/><input name="amount" type="number" min="0.01" step="0.01" max={selected.remaining} defaultValue={selected.remaining.toFixed(2)} required className="h-10 rounded-md border border-slate-200 px-3"/></div>
          <button disabled={pending||eligibleBillLines.length===0} className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Settle against Bill</button>
        </form>
        <form className="rounded-lg border border-slate-200 p-4" onSubmit={(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);run(()=>releaseAccrual({accrualId:selected.id,releaseDate:String(f.get("date")),amount:Number(f.get("amount")),reason:String(f.get("reason"))}));}}>
          <h3 className="font-semibold text-slate-900">Release unused estimate</h3><p className="mt-1 text-xs text-slate-500">Use when the remaining accrued amount will not become payable.</p>
          <div className="mt-3 grid grid-cols-2 gap-3"><input name="date" type="date" defaultValue={today()} required className="h-10 rounded-md border border-slate-200 px-3"/><input name="amount" type="number" min="0.01" step="0.01" max={selected.remaining} defaultValue={selected.remaining.toFixed(2)} required className="h-10 rounded-md border border-slate-200 px-3"/></div>
          <input name="reason" required placeholder="Reason for release" className="mt-3 h-10 w-full rounded-md border border-slate-200 px-3"/>
          <button disabled={pending} className="mt-3 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-40">Release balance</button>
        </form>
      </div> : null}
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">Accrual register</h2></div>
      {accruals.length===0 ? <div className="py-12 text-center text-sm text-slate-400">No accruals yet.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Accrual</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Vendor / Project</th><th className="px-4 py-3 text-right">Original</th><th className="px-4 py-3 text-right">Settled</th><th className="px-4 py-3 text-right">Released</th><th className="px-4 py-3 text-right">Open</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{accruals.map((a)=><tr key={a.id}><td className="px-4 py-3 font-mono text-xs">{a.accrualNumber}<div className="mt-1 text-slate-400">{a.accrualDate}</div></td><td className="px-4 py-3"><div className="font-medium text-slate-900">{a.description}</div><div className="text-xs text-slate-400">{a.accountLabel}</div></td><td className="px-4 py-3 text-slate-600">{a.vendorName??"—"}<div className="text-xs text-slate-400">{a.projectName??"No Project"}</div></td><td className="px-4 py-3 text-right font-mono">{money(a.amount,a.currency)}</td><td className="px-4 py-3 text-right font-mono">{money(a.settled,a.currency)}</td><td className="px-4 py-3 text-right font-mono">{money(a.released,a.currency)}</td><td className="px-4 py-3 text-right font-mono font-semibold">{money(a.remaining,a.currency)}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{a.status}</span></td><td className="px-4 py-3 text-right">{a.status==="POSTED"&&a.settled<0.005&&a.released<0.005?<button disabled={pending} onClick={()=>{const reason=window.prompt("Reason for reversal");if(!reason)return;run(()=>reverseAccrual({accrualId:a.id,reversalDate:today(),reason}));}} className="text-xs font-medium text-rose-600">Reverse</button>:null}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">Movement history</h2><p className="mt-1 text-sm text-slate-500">Bill settlements and released estimates retain exact reversal evidence.</p></div>
      {movements.length===0?<div className="py-10 text-center text-sm text-slate-400">No accrual movements yet.</div>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Accrual</th><th className="px-4 py-3">Movement</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Target / reason</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{movements.map((m)=>{const a=accruals.find((x)=>x.id===m.accrualId);return <tr key={`${m.kind}-${m.id}`}><td className="px-4 py-3 font-mono text-xs">{a?.accrualNumber??"—"}</td><td className="px-4 py-3">{m.kind}</td><td className="px-4 py-3 text-slate-500">{m.date}</td><td className="px-4 py-3 text-slate-600">{m.target}</td><td className="px-4 py-3 text-right font-mono">{money(m.amount,a?.currency??baseCurrency)}</td><td className="px-4 py-3 text-right">{m.status==="POSTED"?<button disabled={pending} onClick={()=>{const reason=window.prompt("Reason for reversal");if(!reason)return;run(()=>reverseAccrualMovement({kind:m.kind,id:m.id,reversalDate:today(),reason}));}} className="text-xs font-medium text-rose-600">Reverse</button>:<span className="text-xs text-slate-400">Reversed</span>}</td></tr>})}</tbody></table></div>}
    </section>
  </div>;
}
