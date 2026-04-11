import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import { CURRENCY_SYMBOLS } from "@/lib/fx";

interface CurrencyExposure {
  currency: string;
  arForeignBalance: number;
  apForeignBalance: number;
  arBookedNGN: number;
  apBookedNGN: number;
  invoices: {
    id: string;
    invoiceNumber: string;
    customerName: string;
    foreignBalance: number;
    bookedNGN: number;
    exchangeRate: number;
    dueDate: Date;
  }[];
  bills: {
    id: string;
    billNumber: string;
    vendorName: string;
    foreignBalance: number;
    bookedNGN: number;
    exchangeRate: number;
    dueDate: Date;
  }[];
}

export default async function FxExposureReportPage() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return null;

  // All outstanding foreign-currency invoices
  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId: orgId,
      status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      NOT: { currency: "NGN" },
    },
    select: {
      id: true,
      invoiceNumber: true,
      currency: true,
      balanceDue: true,
      exchangeRate: true,
      dueDate: true,
      customer: { select: { companyName: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  // All outstanding foreign-currency bills
  const bills = await prisma.bill.findMany({
    where: {
      tenantId: orgId,
      status: { in: ["RECORDED", "PARTIAL", "OVERDUE"] },
      NOT: { currency: "NGN" },
    },
    select: {
      id: true,
      billNumber: true,
      currency: true,
      totalAmount: true,
      amountPaid: true,
      exchangeRate: true,
      dueDate: true,
      vendor: { select: { companyName: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  // Group by currency
  const byCurrency = new Map<string, CurrencyExposure>();

  for (const inv of invoices) {
    const cur = inv.currency;
    if (!byCurrency.has(cur)) {
      byCurrency.set(cur, { currency: cur, arForeignBalance: 0, apForeignBalance: 0, arBookedNGN: 0, apBookedNGN: 0, invoices: [], bills: [] });
    }
    const group = byCurrency.get(cur)!;
    const foreignBalance = Number(inv.balanceDue);
    const rate = Number(inv.exchangeRate);
    const bookedNGN = Math.round(foreignBalance * rate * 100) / 100;
    group.arForeignBalance += foreignBalance;
    group.arBookedNGN += bookedNGN;
    group.invoices.push({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customer.companyName,
      foreignBalance,
      bookedNGN,
      exchangeRate: rate,
      dueDate: inv.dueDate,
    });
  }

  for (const bill of bills) {
    const cur = bill.currency;
    if (!byCurrency.has(cur)) {
      byCurrency.set(cur, { currency: cur, arForeignBalance: 0, apForeignBalance: 0, arBookedNGN: 0, apBookedNGN: 0, invoices: [], bills: [] });
    }
    const group = byCurrency.get(cur)!;
    const foreignBalance = Number(bill.totalAmount) - Number(bill.amountPaid);
    const rate = Number(bill.exchangeRate);
    const bookedNGN = Math.round(foreignBalance * rate * 100) / 100;
    group.apForeignBalance += foreignBalance;
    group.apBookedNGN += bookedNGN;
    group.bills.push({
      id: bill.id,
      billNumber: bill.billNumber,
      vendorName: bill.vendor.companyName,
      foreignBalance,
      bookedNGN,
      exchangeRate: rate,
      dueDate: bill.dueDate,
    });
  }

  const currencies = Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));

  const totalARNGN = currencies.reduce((s, c) => s + c.arBookedNGN, 0);
  const totalAPNGN = currencies.reduce((s, c) => s + c.apBookedNGN, 0);
  const netExposure = totalARNGN - totalAPNGN;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">FX Exposure Report</h1>
        <p className="text-sm text-muted-foreground">
          Outstanding foreign-currency AR and AP balances at original rates
        </p>
      </div>

      {/* Summary by currency */}
      <div className="rounded-lg border overflow-hidden">
        <div className="p-4 border-b bg-muted/30 font-medium">Currency Summary</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Currency</th>
              <th className="text-right p-3 font-medium">AR Exposure (FCY)</th>
              <th className="text-right p-3 font-medium">AR Booked (₦)</th>
              <th className="text-right p-3 font-medium">AP Exposure (FCY)</th>
              <th className="text-right p-3 font-medium">AP Booked (₦)</th>
              <th className="text-right p-3 font-medium">Net (₦)</th>
            </tr>
          </thead>
          <tbody>
            {currencies.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No outstanding foreign-currency balances
                </td>
              </tr>
            )}
            {currencies.map((c) => {
              const net = c.arBookedNGN - c.apBookedNGN;
              return (
                <tr key={c.currency} className="border-t">
                  <td className="p-3 font-medium">
                    {c.currency} {CURRENCY_SYMBOLS[c.currency] ?? ""}
                  </td>
                  <td className="p-3 text-right">
                    {c.currency} {c.arForeignBalance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-right">{formatCurrency(c.arBookedNGN)}</td>
                  <td className="p-3 text-right">
                    {c.currency} {c.apForeignBalance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-right">{formatCurrency(c.apBookedNGN)}</td>
                  <td className={"p-3 text-right font-medium " + (net >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatCurrency(net)}
                  </td>
                </tr>
              );
            })}
            {currencies.length > 0 && (
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="p-3">Total</td>
                <td className="p-3" />
                <td className="p-3 text-right">{formatCurrency(totalARNGN)}</td>
                <td className="p-3" />
                <td className="p-3 text-right">{formatCurrency(totalAPNGN)}</td>
                <td className={"p-3 text-right " + (netExposure >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatCurrency(netExposure)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail per currency */}
      {currencies.map((c) => (
        <div key={c.currency} className="space-y-4">
          <h2 className="font-semibold text-base">
            {c.currency} {CURRENCY_SYMBOLS[c.currency] ?? ""} — Detail
          </h2>

          {c.invoices.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="p-3 border-b bg-muted/30 text-sm font-medium">Accounts Receivable</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3">Invoice #</th>
                    <th className="text-left p-3">Customer</th>
                    <th className="text-right p-3">Due Date</th>
                    <th className="text-right p-3">Balance ({c.currency})</th>
                    <th className="text-right p-3">Rate</th>
                    <th className="text-right p-3">Booked (₦)</th>
                  </tr>
                </thead>
                <tbody>
                  {c.invoices.map((inv) => (
                    <tr key={inv.id} className="border-t">
                      <td className="p-3">{inv.invoiceNumber}</td>
                      <td className="p-3">{inv.customerName}</td>
                      <td className="p-3 text-right">
                        {new Date(inv.dueDate).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="p-3 text-right">
                        {inv.foreignBalance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right text-muted-foreground">{inv.exchangeRate.toFixed(4)}</td>
                      <td className="p-3 text-right">{formatCurrency(inv.bookedNGN)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {c.bills.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="p-3 border-b bg-muted/30 text-sm font-medium">Accounts Payable</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3">Bill #</th>
                    <th className="text-left p-3">Vendor</th>
                    <th className="text-right p-3">Due Date</th>
                    <th className="text-right p-3">Balance ({c.currency})</th>
                    <th className="text-right p-3">Rate</th>
                    <th className="text-right p-3">Booked (₦)</th>
                  </tr>
                </thead>
                <tbody>
                  {c.bills.map((bill) => (
                    <tr key={bill.id} className="border-t">
                      <td className="p-3">{bill.billNumber}</td>
                      <td className="p-3">{bill.vendorName}</td>
                      <td className="p-3 text-right">
                        {new Date(bill.dueDate).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="p-3 text-right">
                        {bill.foreignBalance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right text-muted-foreground">{bill.exchangeRate.toFixed(4)}</td>
                      <td className="p-3 text-right">{formatCurrency(bill.bookedNGN)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
