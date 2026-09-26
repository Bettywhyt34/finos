import { prisma } from "@/lib/prisma";
import { getFinancialOverview } from "@/lib/dashboard-data";
import { cashForecast, type CashItem } from "./cash-forecast";

export async function getBrainData(tenantId: string, delay = 0) {
  const asOf = new Date().toISOString().slice(0,10);
  const [overview, invoices, bills, unmappedBanks] = await Promise.all([
    getFinancialOverview(tenantId),
    prisma.invoice.findMany({ where: { tenantId, status: { in: ["SENT", "PARTIAL", "OVERDUE"] }, balanceDue: { gt: 0 } }, select: { id: true, invoiceNumber: true, dueDate: true, balanceDue: true, exchangeRate: true } }),
    prisma.bill.findMany({ where: { tenantId, status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] } }, select: { id: true, billNumber: true, dueDate: true, totalAmount: true, amountPaid: true, amountCredited: true, exchangeRate: true } }),
    prisma.$queryRaw<Array<{count: bigint}>>`SELECT count(*) FROM bank_accounts WHERE tenant_id = ${tenantId}::uuid AND is_active = true AND ledger_account_id IS NULL`,
  ]);
  const receipts: CashItem[] = invoices.map(i => ({ id: i.id, label: i.invoiceNumber, dueDate: i.dueDate.toISOString(), amount: Number(i.balanceDue) * Number(i.exchangeRate), href: `/sales/invoices/${i.id}` }));
  const payments: CashItem[] = bills.filter(b => Number(b.totalAmount) > Number(b.amountPaid) + Number(b.amountCredited)).map(b => ({ id: b.id, label: b.billNumber, dueDate: b.dueDate.toISOString(), amount: (Number(b.totalAmount)-Number(b.amountPaid)-Number(b.amountCredited))*Number(b.exchangeRate), href: `/purchases/bills/${b.id}` }));
  const weeks = cashForecast(overview.cash.total, receipts, payments, asOf, delay);
  return { version: "cash-v1", tenantId, asOf, opening: overview.cash.total, delay, weeks, receipts, payments, unmappedBanks: Number(unmappedBanks[0]?.count ?? 0), firstShortfall: weeks.find(w => w.closing < 0) ?? null };
}
