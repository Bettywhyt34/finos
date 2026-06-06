import { prisma } from "@/lib/prisma";
import { formatCurrency, getRecognitionPeriod } from "@/lib/utils";

function toNum(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  // Prisma Decimal / string
  return parseFloat(String(val)) || 0;
}

export interface KpiData {
  totalRevenue: string;
  totalRevenueRaw: number;
  outstandingAR: string;
  outstandingARRaw: number;
  outstandingAP: string;
  outstandingAPRaw: number;
  bankBalance: string;
  bankBalanceRaw: number;
}

export interface RecentInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  totalAmount: string;
  status: string;
  issueDate: Date;
}

export interface RecentBill {
  id: string;
  billNumber: string;
  vendorName: string;
  totalAmount: string;
  status: string;
  billDate: Date;
}

export async function getDashboardKpis(
  tenantId: string
): Promise<KpiData> {
  const currentPeriod = getRecognitionPeriod();

  const [revenueAgg, arAgg, billsAgg, bankAgg] = await Promise.all([
    // Total revenue this month (posted invoices)
    prisma.invoice.aggregate({
      where: {
        tenantId,
        recognitionPeriod: currentPeriod,
        status: { notIn: ["DRAFT"] },
      },
      _sum: { totalAmount: true },
    }),

    // Outstanding AR (unpaid invoices)
    prisma.invoice.aggregate({
      where: {
        tenantId,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      _sum: { balanceDue: true },
    }),

    // Outstanding AP (unpaid bills — need totalAmount and amountPaid)
    prisma.bill.aggregate({
      where: {
        tenantId,
        status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] },
      },
      _sum: { totalAmount: true, amountPaid: true },
    }),

    // Total bank balance
    prisma.bankAccount.aggregate({
      where: { tenantId, isActive: true },
      _sum: { currentBalance: true },
    }),
  ]);

  const revenue = toNum(revenueAgg._sum.totalAmount);
  const ar = toNum(arAgg._sum.balanceDue);
  const apTotal = toNum(billsAgg._sum.totalAmount);
  const apPaid = toNum(billsAgg._sum.amountPaid);
  const bank = toNum(bankAgg._sum.currentBalance);

  return {
    totalRevenue: formatCurrency(revenue),
    totalRevenueRaw: revenue,
    outstandingAR: formatCurrency(ar),
    outstandingARRaw: ar,
    outstandingAP: formatCurrency(apTotal - apPaid),
    outstandingAPRaw: apTotal - apPaid,
    bankBalance: formatCurrency(bank),
    bankBalanceRaw: bank,
  };
}

export async function getAvgInvoiceAge(tenantId: string): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      sentAt: { not: null },
      status: { notIn: ["DRAFT", "VOIDED", "WRITTEN_OFF"] },
    },
    select: { status: true, sentAt: true, paidAt: true },
  });

  if (invoices.length === 0) return 0;

  const today = Date.now();
  const MS = 86_400_000;
  const totalDays = invoices.reduce((sum, inv) => {
    const end = inv.status === "PAID" && inv.paidAt ? inv.paidAt.getTime() : today;
    return sum + Math.floor((end - inv.sentAt!.getTime()) / MS);
  }, 0);

  return Math.round(totalDays / invoices.length);
}

export interface DsoMetric {
  dso: number;           // Days Sales Outstanding
  arBalance: number;     // Outstanding AR in NGN
  revenue: number;       // Revenue in period in NGN
  period: number;        // 30 | 90 | 365
}

export async function getDsoMetric(tenantId: string, days: 30 | 90 | 365 = 365): Promise<DsoMetric> {
  const since = new Date(Date.now() - days * 86_400_000);

  const [arAgg, revenueAgg] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        tenantId,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      _sum: { balanceDue: true },
    }),
    prisma.invoice.aggregate({
      where: {
        tenantId,
        issueDate: { gte: since },
        status: { notIn: ["DRAFT", "VOIDED"] },
      },
      _sum: { totalAmount: true },
    }),
  ]);

  const ar = toNum(arAgg._sum.balanceDue);
  const revenue = toNum(revenueAgg._sum.totalAmount);
  const dso = revenue > 0 ? Math.round((ar / revenue) * days) : 0;

  return { dso, arBalance: ar, revenue, period: days };
}

export async function getRecentInvoices(
  tenantId: string
): Promise<RecentInvoice[]> {
  const invoices = await prisma.invoice.findMany({
    where: { tenantId },
    include: { customer: { select: { companyName: true } } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerName: inv.customer.companyName,
    totalAmount: formatCurrency(toNum(inv.totalAmount)),
    status: inv.status,
    issueDate: inv.issueDate,
  }));
}

export async function getRecentBills(
  tenantId: string
): Promise<RecentBill[]> {
  const bills = await prisma.bill.findMany({
    where: { tenantId },
    include: { vendor: { select: { companyName: true } } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return bills.map((bill) => ({
    id: bill.id,
    billNumber: bill.billNumber,
    vendorName: bill.vendor.companyName,
    totalAmount: formatCurrency(toNum(bill.totalAmount)),
    status: bill.status,
    billDate: bill.billDate,
  }));
}
