import { EliminationWorksheet, ExportConsolidation } from "./worksheet";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccountBalances } from "@/lib/statements";
import { consolidate, type Elimination } from "@/lib/mvp/consolidation";
import { formatCurrency } from "@/lib/utils";

export default async function ConsolidationPage({searchParams}: {searchParams: Promise<{entities?: string|string[]; period?: string; whollyOwned?: string; adjustments?: string}>}) {
  const session = await auth();
  if (!session?.user.tenantId) return null;
  const query = await searchParams;
  const memberships = await prisma.tenantMembership.findMany({ where: {userId: session.user.id, status: "ACTIVE", tenant: {status: "active"}}, include: {tenant: {select: {id: true, name: true, currency: true}}} });
  const available = memberships.map(m => m.tenant);
  const selected = [...new Set(typeof query.entities === "string" ? [query.entities] : query.entities ?? [])];
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.period ?? "") ? query.period! : new Date().toISOString().slice(0,7);
  let error = "";
  let rows: ReturnType<typeof consolidate> = [];
  let books: {id: string; name: string; currency: string; balances: Awaited<ReturnType<typeof getAccountBalances>>}[] = [];
  let adjustments: Elimination[] = [];
  if (selected.length) {
    try {
      if (query.whollyOwned !== "yes") throw new Error("Confirm wholly-owned entities for this reporting scope.");
      if (selected.some(id => !available.some(t => t.id === id))) throw new Error("One or more selected entities are unavailable.");
      const parsed: unknown = JSON.parse(query.adjustments || "[]");
      if (!Array.isArray(parsed) || parsed.length > 100) throw new Error("Provide at most 100 elimination lines as a JSON array.");
      adjustments = parsed.map((x: Record<string,unknown>) => ({entityId: String(x.entityId ?? ""), accountId: String(x.accountId ?? ""), debit: Number(x.debit ?? 0), credit: Number(x.credit ?? 0), reason: String(x.reason ?? "")}));
      books = await Promise.all(selected.map(async id => { const entity = available.find(t => t.id === id)!; return {...entity, balances: await getAccountBalances(id, period)}; }));
      rows = consolidate(books, adjustments);
    } catch (e) { error = e instanceof Error ? e.message : "Could not generate report"; }
  }
  const sum = (type: string) => rows.filter(r => r.type === type).reduce((s,r) => s+r.balance,0);
  const difference = sum("ASSET") + sum("EXPENSE") - sum("LIABILITY") - sum("EQUITY") - sum("INCOME");
  return <div className="max-w-6xl mx-auto space-y-5">
    <h1 className="text-3xl font-semibold">Basic consolidation</h1>
    <p>NGN, wholly-owned entities only. Account codes map only when names, types and categories also agree. Elimination adjustments apply to this report; source books remain unchanged. Ownership changes, currency translation and noncontrolling interests are unavailable.</p>
    <form className="rounded-xl border bg-white p-5 space-y-4">
      <fieldset><legend className="font-semibold">Entities you can access</legend>{available.map(t => <label className="block my-2" key={t.id}><input type="checkbox" name="entities" value={t.id} defaultChecked={selected.includes(t.id)}/> {t.name} · {t.currency}</label>)}</fieldset>
      <label className="block">Through period <input type="month" name="period" defaultValue={period} required className="border rounded p-2"/></label>
      <label className="block"><input type="checkbox" name="whollyOwned" value="yes" required defaultChecked={query.whollyOwned === "yes"}/> I confirm these are wholly-owned entities in the reporting scope for this period.</label>
      <EliminationWorksheet key={selected.join(",")+period} initial={adjustments} accounts={books.flatMap(b => b.balances.map(a => ({entityId:b.id,accountId:a.accountId,label:`${b.name} · ${a.code} ${a.name}`})))}/>
      <button className="rounded bg-[#173F35] text-white px-4 py-2">Run consolidation</button>
    </form>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {rows.length > 0 && !error && <>
      <ExportConsolidation snapshot={{version:"consolidated-TB-v1",asOf:new Date().toISOString(),period,books,adjustments,rows,trialBalanceDifference:difference,whollyOwnedConfirmed:true}}/>
      <p>Generated {new Date().toISOString()} · consolidated-TB-v1 · through {period} · {books.map(b=>b.name).join(" + ")} · NGN</p>
      <p className={Math.abs(difference) > .01 ? "text-red-700" : "text-green-700"}>Trial balance difference: {formatCurrency(difference)}. {adjustments.length === 0 ? "No eliminations supplied: totals are combined before intercompany elimination." : `${adjustments.length} balanced elimination lines applied. Intercompany completeness requires finance review.`}</p>
      <table className="w-full text-sm bg-white"><thead><tr>{["Account", "Source total", "Eliminations", "Consolidated"].map(t=><th className="text-left p-3" key={t}>{t}</th>)}</tr></thead><tbody>{rows.map(r=><tr className="border-t" key={r.code}><td className="p-3">{r.code} · {r.name}</td><td className="p-3">{formatCurrency(r.source)}</td><td className="p-3">{formatCurrency(r.adjustment)}</td><td className="p-3">{formatCurrency(r.balance)}</td></tr>)}</tbody></table>
      <details><summary>Source trial balances</summary>{books.map(b=><section className="my-4" key={b.id}><h2>{b.name}</h2>{b.balances.map(a=><p className="text-xs py-1" key={a.accountId}>{a.code} · {a.name} · {formatCurrency(a.balance)}</p>)}</section>)}</details>
      <details><summary>Elimination evidence</summary>{adjustments.map((a,i)=><p key={i}>{a.reason} · {a.entityId} / {a.accountId} · Debit {a.debit} / Credit {a.credit}</p>)}</details>
    </>}
  </div>;
}
