import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBrainData } from "@/lib/mvp/brain-data";
import { formatCurrency } from "@/lib/utils";
import { recordBrainDecision } from "./actions";

export default async function FinancialBrain({ searchParams }: { searchParams: Promise<{delay?: string}> }) {
  const session = await auth();
  if (!session?.user.tenantId) return null;
  const query = await searchParams;
  const delay = [0,14,30].includes(Number(query.delay)) ? Number(query.delay) : 0;
  const data = await getBrainData(session.user.tenantId, delay);
  const tenant = await prisma.tenant.findUnique({ where: { id: session.user.tenantId }, select: { additionalFields: true } });
  const metadata = tenant?.additionalFields as {finosBrainDecisions?: {id: string; at: string; decision: string; note: string}[]} | null;
  const decisions = Array.isArray(metadata?.finosBrainDecisions) ? metadata.finosBrainDecisions : [];
  const money = (amount: number) => formatCurrency(amount, "NGN");
  return <div className="mx-auto max-w-6xl space-y-6">
    <h1 className="text-3xl font-semibold">Financial Brain</h1>
    <p>{session.user.tenantName} · As of {data.asOf} · Calculation {data.version} · NGN</p>
    <section className="rounded-xl border bg-white p-6 space-y-3">
      <h2 className="text-xl font-semibold">{data.firstShortfall ? `Projected cash shortfall in week ${data.firstShortfall.week}` : "No shortfall in the recorded-document scenario"}</h2>
      <p>{data.firstShortfall ? `Projected closing cash is ${money(data.firstShortfall.closing)}. Review the collections below and agree payment timing with suppliers.` : "Review overdue collections and unrecorded commitments before relying on this outlook."}</p>
      <p className="text-sm text-slate-600">Deterministic first experience. Assumes full collection and payment at due dates; overdue items enter week 1, with the selected delay applied to collections. Uses booked FX rates. Excludes new sales, payroll, tax remittances, capex and other unrecorded commitments. This is a scenario, not a promise of available cash.</p>
      <p className="text-sm">Coverage: {data.receipts.length} open invoices, {data.payments.length} open bills; {data.unmappedBanks} active bank accounts lack a ledger mapping. Opening mapped book cash: {money(data.opening)}.</p>
      {data.unmappedBanks > 0 && <p className="font-semibold text-amber-700">Incomplete cash coverage: map the missing bank accounts before relying on the forecast.</p>}
      <form className="flex gap-3 items-center"><label>Collection delay <select name="delay" defaultValue={delay} className="border rounded p-2"><option value="0">Due-date scenario</option><option value="14">14 days later</option><option value="30">30 days later</option></select></label><button className="border rounded p-2">Recalculate</button></form>
    </section>
    <div className="overflow-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead><tr>{["Week commencing", "Expected receipts", "Planned payments", "Projected closing cash"].map(t => <th className="p-3 text-left" key={t}>{t}</th>)}</tr></thead><tbody>{data.weeks.map(w => <tr key={w.week} className="border-t"><td className="p-3">{w.date}</td><td className="p-3">{money(w.receipts)}</td><td className="p-3">{money(w.payments)}</td><td className={`p-3 ${w.closing < 0 ? "text-red-700" : ""}`}>{money(w.closing)}</td></tr>)}</tbody></table></div>
    <div className="grid gap-6 md:grid-cols-2">{[["Collection evidence", data.receipts], ["Payment evidence", data.payments]].map(([title, items]) => <section className="rounded-xl border bg-white p-5" key={String(title)}><h2 className="text-lg font-semibold">{String(title)}</h2><ul className="mt-3 space-y-2">{(items as typeof data.receipts).sort((a,b) => a.dueDate.localeCompare(b.dueDate)).map(item => <li key={item.id}><Link className="underline" href={item.href}>{item.label}</Link> · {item.dueDate.slice(0,10)} · {money(item.amount)}</li>)}</ul>{(items as typeof data.receipts).length === 0 && <p>No open documents.</p>}</section>)}</div>
    {["OWNER", "ADMIN", "ACCOUNTANT"].includes(session.user.role ?? "") && <form action={recordBrainDecision} className="rounded-xl border bg-white p-5 space-y-3"><h2 className="font-semibold">Record your response</h2><input type="hidden" name="tenantId" value={session.user.tenantId}/><input type="hidden" name="delay" value={delay}/><select name="decision" className="border rounded p-2"><option value="accepted">Accept for follow-up</option><option value="deferred">Defer</option><option value="rejected">Reject</option></select><textarea name="note" maxLength={2000} placeholder="Owner, next step and expected date" className="block w-full border rounded p-2"/><button className="rounded bg-[#173F35] text-white px-4 py-2">Save decision with current evidence</button><p className="text-xs">Records a management response only. No payment, posting or message is sent.</p></form>}
    <section><h2 className="font-semibold">Decision history</h2>{[...decisions].reverse().map(d => <p key={d.id} className="border-b py-2">{d.at} · {d.decision} · {d.note}</p>)}</section>
  </div>;
}
