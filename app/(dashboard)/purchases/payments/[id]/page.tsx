import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
export default async function PaymentDetail({params}: {params: Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user.tenantId)return null;
  const {id}=await params;
  const payment=await prisma.vendorPayment.findFirst({where:{id,tenantId:session.user.tenantId},include:{vendor:{select:{companyName:true}},allocations:{where:{tenantId:session.user.tenantId},include:{bill:{select:{billNumber:true}}}}}});
  if(!payment)notFound();
  const journal=await prisma.journalEntry.findFirst({where:{tenantId:session.user.tenantId,source:"vendor_payment",sourceId:id},select:{id:true,entryNumber:true}});
  const money=(n:number)=>formatCurrency(n,payment.currency);
  return <div className="max-w-4xl space-y-5"><Link href="/purchases/payments" className="underline">All vendor payments</Link><h1 className="text-3xl font-semibold">{payment.paymentNumber}</h1><p>{payment.vendor.companyName} · {formatDate(payment.paymentDate)} · {payment.status}</p><section className="rounded-xl border bg-white p-5 space-y-2"><p>Gross AP settled: {money(Number(payment.amount))}</p><p>WHT withheld: {money(Number(payment.whtAmount))}</p><p>Cash paid: {money(Number(payment.amount)-Number(payment.whtAmount))}</p><p>Reference: {payment.reference || "—"}</p>{journal && <Link href={`/accounting/journal-entries/${journal.id}`} className="underline">Journal {journal.entryNumber}</Link>}</section><h2 className="font-semibold">Bill allocations</h2>{payment.allocations.map(a=><p key={a.id}><Link className="underline" href={`/purchases/bills/${a.billId}`}>{a.bill.billNumber}</Link> · {money(Number(a.amount))}</p>)}{!payment.allocations.length && <p>No allocation evidence is stored for this historical payment.</p>}</div>;
}
