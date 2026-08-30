import { prisma } from "@/lib/prisma";
import { getAccountBalances, sumByType } from "@/lib/statements";
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

export interface FinancialOverviewData {
  currency: string;
  cash: {
    total: number;
    accounts: { id: string; name: string; bank: string; amount: number }[];
  };
  attention: {
    overdueInvoiceCount: number;
    overdueInvoiceAmount: number;
    billsDueCount: number;
    billsDueAmount: number;
  };
  performance: {
    revenue: number;
    grossProfit: number;
    operatingProfit: number;
    netProfit: number;
  };
  receivables: {
    id: string;
    invoiceNumber: string;
    customerName: string;
    dueDate: Date;
    amount: number;
    daysOverdue: number;
    status: string;
  }[];
}

export async function getFinancialOverview(tenantId: string): Promise<FinancialOverviewData> {
  const now = new Date();
  const currentPeriod = getRecognitionPeriod(now);
  const yearStart = `${now.getFullYear()}-01`;
  const inSevenDays = new Date(now);
  inSevenDays.setDate(inSevenDays.getDate() + 7);

  const [tenant, bankAccounts, overdueInvoices, billsDue, balances] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    prisma.bankAccount.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, accountName: true, bankName: true, currentBalance: true },
      orderBy: { currentBalance: "desc" },
    }),
    prisma.invoice.findMany({
      where: {
        tenantId,
        dueDate: { lt: now },
        balanceDue: { gt: 0 },
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        balanceDue: true,
        status: true,
        customer: { select: { companyName: true } },
      },
      orderBy: [{ balanceDue: "desc" }, { dueDate: "asc" }],
    }),
    prisma.bill.findMany({
      where: {
        tenantId,
        dueDate: { gte: now, lte: inSevenDays },
        status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] },
      },
      select: { totalAmount: true, amountPaid: true },
    }),
    getAccountBalances(tenantId, currentPeriod, yearStart),
  ]);

  const totalIncome = sumByType(balances, "INCOME");
  const totalExpenses = sumByType(balances, "EXPENSE");
  const otherIncome = balances
    .filter((balance) => balance.financialCategory === "OTHER_INCOME")
    .reduce((sum, balance) => sum + balance.balance, 0);
  const revenue = totalIncome - otherIncome;
  const directCosts = balances
    .filter((balance) => balance.financialCategory === "COST_OF_SALES" || balance.financialCategory === "DIRECT_EXPENSES")
    .reduce((sum, balance) => sum + balance.balance, 0);
  const otherExpenses = balances
    .filter((balance) => balance.financialCategory === "OTHER_EXPENSES")
    .reduce((sum, balance) => sum + balance.balance, 0);
  const operatingExpenses = totalExpenses - directCosts - otherExpenses;
  const grossProfit = revenue - directCosts;
  const operatingProfit = grossProfit - operatingExpenses;
  const netProfit = totalIncome - totalExpenses;

  return {
    currency: tenant?.currency ?? "NGN",
    cash: {
      total: bankAccounts.reduce((sum, account) => sum + toNum(account.currentBalance), 0),
      accounts: bankAccounts.slice(0, 3).map((account) => ({
        id: account.id,
        name: account.accountName,
        bank: account.bankName,
        amount: toNum(account.currentBalance),
      })),
    },
    attention: {
      overdueInvoiceCount: overdueInvoices.length,
      overdueInvoiceAmount: overdueInvoices.reduce((sum, invoice) => sum + toNum(invoice.balanceDue), 0),
      billsDueCount: billsDue.length,
      billsDueAmount: billsDue.reduce(
        (sum, bill) => sum + toNum(bill.totalAmount) - toNum(bill.amountPaid),
        0
      ),
    },
    performance: { revenue, grossProfit, operatingProfit, netProfit },
    receivables: overdueInvoices.slice(0, 6).map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer.companyName,
      dueDate: invoice.dueDate,
      amount: toNum(invoice.balanceDue),
      daysOverdue: Math.max(0, Math.floor((now.getTime() - invoice.dueDate.getTime()) / 86_400_000)),
      status: invoice.status,
    })),
  };
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
