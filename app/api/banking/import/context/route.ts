import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = req.nextUrl.searchParams.get("accountId") ?? "";
  if (!accountId) return NextResponse.json({ error: "Bank account is required" }, { status: 400 });

  const bankRows = await prisma.$queryRaw<Array<{
    id: string;
    accountName: string;
    bankName: string;
    currency: string;
    ledgerAccountId: string | null;
  }>>`
    SELECT ba."id",
           ba."account_name" AS "accountName",
           ba."bank_name" AS "bankName",
           ba."currency",
           ba."ledger_account_id" AS "ledgerAccountId"
    FROM "bank_accounts" ba
    WHERE ba."id" = ${accountId}
      AND ba."tenant_id" = ${tenantId}::uuid
      AND ba."is_active" = true
    LIMIT 1
  `;
  const bankAccount = bankRows[0];
  if (!bankAccount) return NextResponse.json({ error: "Bank account not found" }, { status: 404 });

  const [accounts, customers, vendors, bankAccounts] = await Promise.all([
    prisma.chartOfAccounts.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, code: true, name: true, type: true, financialCategory: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    }),
    prisma.customer.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        companyName: true,
        currency: true,
        invoices: {
          where: { status: { in: ["SENT", "PARTIAL", "OVERDUE"] } },
          select: { id: true, invoiceNumber: true, currency: true, balanceDue: true, dueDate: true },
          orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }],
        },
      },
      orderBy: { companyName: "asc" },
    }),
    prisma.vendor.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        companyName: true,
        currency: true,
        bills: {
          where: { status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] } },
          select: { id: true, billNumber: true, currency: true, totalAmount: true, amountPaid: true, dueDate: true },
          orderBy: [{ dueDate: "asc" }, { billNumber: "asc" }],
        },
      },
      orderBy: { companyName: "asc" },
    }),
    prisma.bankAccount.findMany({
      where: { tenantId, isActive: true, id: { not: accountId } },
      select: { id: true, accountName: true, bankName: true, currency: true },
      orderBy: [{ bankName: "asc" }, { accountName: "asc" }],
    }),
  ]);

  return NextResponse.json({
    bankAccount,
    accounts: accounts
      .filter((account) => account.id !== bankAccount.ledgerAccountId)
      .map((account) => ({ ...account, financialCategory: account.financialCategory ?? null })),
    customers: customers
      .filter((customer) => customer.invoices.length > 0)
      .map((customer) => ({
        id: customer.id,
        companyName: customer.companyName,
        currency: customer.currency,
        invoices: customer.invoices.map((invoice) => ({
          id: invoice.id,
          number: invoice.invoiceNumber,
          currency: invoice.currency,
          outstanding: Number(invoice.balanceDue),
          dueDate: invoice.dueDate.toISOString(),
        })),
      })),
    vendors: vendors
      .filter((vendor) => vendor.bills.length > 0)
      .map((vendor) => ({
        id: vendor.id,
        companyName: vendor.companyName,
        currency: vendor.currency,
        bills: vendor.bills.map((bill) => ({
          id: bill.id,
          number: bill.billNumber,
          currency: bill.currency,
          outstanding: Math.max(0, Number(bill.totalAmount) - Number(bill.amountPaid)),
          dueDate: bill.dueDate.toISOString(),
        })),
      })),
    bankAccounts,
  });
}
