import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { VendorCreditForm } from "./vendor-credit-form";
import { VendorCreditActions } from "./vendor-credit-actions";
import { VendorCreditMovementReversalButton } from "./movement-reversal-button";

interface CreditRow {
  id: string;
  vendorId: string;
  creditNumber: string;
  vendorName: string;
  billNumber: string;
  creditDate: Date;
  currency: string;
  exchangeRate: unknown;
  totalAmount: unknown;
  appliedAmount: unknown;
  refundedAmount: unknown;
  remainingAmount: unknown;
  status: string;
}

interface BillRow {
  id: string;
  vendorId: string;
  billNumber: string;
  vendorName: string;
  currency: string;
  exchangeRate: unknown;
  totalAmount: unknown;
  amountPaid: unknown;
  amountCredited: unknown;
  status: string;
}

interface BillLineRow {
  id: string;
  billId: string;
  description: string;
  serviceAmount: unknown;
  taxAmount: unknown;
  alreadyCredited: unknown;
}

interface BankRow {
  id: string;
  accountName: string;
  bankName: string;
  currency: string;
}

interface MovementRow {
  id: string;
  creditNumber: string;
  kind: "APPLICATION" | "REFUND";
  movementDate: Date;
  target: string;
  currency: string;
  amount: unknown;
  status: string;
}

export default async function VendorCreditsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const [tenant, credits, bills, lines, bankAccounts, movements] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    prisma.$queryRaw<CreditRow[]>`
      SELECT vc."id", vc."vendor_id" AS "vendorId", vc."credit_number" AS "creditNumber", v."company_name" AS "vendorName",
             b."bill_number" AS "billNumber", vc."credit_date" AS "creditDate", upper(vc."currency") AS "currency",
             vc."exchange_rate" AS "exchangeRate", vc."total_amount" AS "totalAmount", vc."applied_amount" AS "appliedAmount",
             vc."refunded_amount" AS "refundedAmount", vc."remaining_amount" AS "remainingAmount", vc."status"
      FROM "vendor_credits" vc
      INNER JOIN "vendors" v ON v."id"=vc."vendor_id" AND v."tenant_id"=vc."tenant_id"
      INNER JOIN "bills" b ON b."id"=vc."source_bill_id" AND b."tenant_id"=vc."tenant_id"
      WHERE vc."tenant_id"=${tenantId}::uuid
      ORDER BY vc."credit_date" DESC, vc."created_at" DESC
    `,
    prisma.$queryRaw<BillRow[]>`
      SELECT b."id", b."vendor_id" AS "vendorId", b."bill_number" AS "billNumber", v."company_name" AS "vendorName",
             upper(b."currency") AS "currency", b."exchange_rate" AS "exchangeRate", b."total_amount" AS "totalAmount",
             b."amount_paid" AS "amountPaid", b."amount_credited" AS "amountCredited", b."status"::text AS "status"
      FROM "bills" b
      INNER JOIN "vendors" v ON v."id"=b."vendor_id" AND v."tenant_id"=b."tenant_id"
      WHERE b."tenant_id"=${tenantId}::uuid AND b."status" <> 'DRAFT'::"BillStatus"
      ORDER BY b."bill_date" DESC, b."bill_number" DESC
    `,
    prisma.$queryRaw<BillLineRow[]>`
      SELECT bl."id", bl."bill_id" AS "billId", bl."description", bl."amount" AS "serviceAmount",
             bl."tax_amount" AS "taxAmount",
             COALESCE((
               SELECT SUM(vcl."service_amount")
               FROM "vendor_credit_lines" vcl
               JOIN "vendor_credits" vc ON vc."id"=vcl."vendor_credit_id"
               WHERE vcl."source_bill_line_id"=bl."id" AND vc."tenant_id"=${tenantId}::uuid AND vc."status"<>'REVERSED'
             ),0) AS "alreadyCredited"
      FROM "bill_lines" bl
      INNER JOIN "bills" b ON b."id"=bl."bill_id"
      WHERE b."tenant_id"=${tenantId}::uuid AND b."status" <> 'DRAFT'::"BillStatus"
      ORDER BY bl."bill_id", bl."id"
    `,
    prisma.$queryRaw<BankRow[]>`
      SELECT ba."id", ba."account_name" AS "accountName", ba."bank_name" AS "bankName", upper(ba."currency") AS "currency"
      FROM "bank_accounts" ba
      INNER JOIN "chart_of_accounts" coa
        ON coa."id"=ba."ledger_account_id" AND coa."tenant_id"=ba."tenant_id"
       AND coa."type"='ASSET' AND coa."is_active"=true
      WHERE ba."tenant_id"=${tenantId}::uuid AND ba."is_active"=true
      ORDER BY ba."account_name"
    `,
    prisma.$queryRaw<MovementRow[]>`
      SELECT vc."credit_number" AS "creditNumber", vca."id", 'APPLICATION'::text AS "kind",
             vca."application_date" AS "movementDate", b."bill_number" AS "target", upper(vc."currency") AS "currency",
             vca."amount", vca."status"
      FROM "vendor_credit_applications" vca
      INNER JOIN "vendor_credits" vc ON vc."id"=vca."vendor_credit_id" AND vc."tenant_id"=vca."tenant_id"
      INNER JOIN "bills" b ON b."id"=vca."bill_id" AND b."tenant_id"=vca."tenant_id"
      WHERE vca."tenant_id"=${tenantId}::uuid AND vca."application_type"='LATER'
      UNION ALL
      SELECT vc."credit_number", vcr."id", 'REFUND'::text, vcr."refunded_at",
             COALESCE(vcr."reference",'Bank receipt'), upper(vc."currency"), vcr."amount", vcr."status"
      FROM "vendor_credit_refunds" vcr
      INNER JOIN "vendor_credits" vc ON vc."id"=vcr."vendor_credit_id" AND vc."tenant_id"=vcr."tenant_id"
      WHERE vcr."tenant_id"=${tenantId}::uuid
      ORDER BY "movementDate" DESC, "id" DESC
    `,
  ]);

  const baseCurrency = tenant?.currency.trim().toUpperCase() ?? "NGN";
  const linesByBill = new Map<string, BillLineRow[]>();
  for (const line of lines) {
    const current = linesByBill.get(line.billId) ?? [];
    current.push(line);
    linesByBill.set(line.billId, current);
  }

  const sourceBillOptions = bills.map((bill) => {
    const billLines = (linesByBill.get(bill.id) ?? []).map((line) => ({
      id: line.id,
      description: line.description,
      serviceAmount: Number(line.serviceAmount),
      taxAmount: Number(line.taxAmount),
      availableServiceAmount: Math.max(0, Number(line.serviceAmount) - Number(line.alreadyCredited)),
    }));
    return {
      id: bill.id,
      billNumber: bill.billNumber,
      vendorName: bill.vendorName,
      currency: bill.currency,
      exchangeRate: Number(bill.exchangeRate),
      baseCurrency,
      outstanding: Math.max(0, Number(bill.totalAmount) - Number(bill.amountPaid) - Number(bill.amountCredited)),
      lines: billLines,
    };
  }).filter((bill) => bill.lines.some((line) => line.availableServiceAmount > 0.005));

  const settlementBills = bills
    .filter((bill) => ["RECORDED", "PARTIAL", "OVERDUE"].includes(bill.status))
    .map((bill) => ({
      id: bill.id,
      vendorId: bill.vendorId,
      billNumber: bill.billNumber,
      currency: bill.currency,
      outstanding: Math.max(0, Number(bill.totalAmount) - Number(bill.amountPaid) - Number(bill.amountCredited)),
    }))
    .filter((bill) => bill.outstanding > 0.005);

  const openCredits = credits.filter((credit) => credit.status === "OPEN" && Number(credit.remainingAmount) > 0.005);
  const openByCurrency = new Map<string, number>();
  for (const credit of openCredits) openByCurrency.set(credit.currency, (openByCurrency.get(credit.currency) ?? 0) + Number(credit.remainingAmount));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendor Credits</h1>
          <p className="mt-1 text-sm text-slate-500">Supplier credits stay separate from cash payments: apply them to later Bills, receive supplier refunds, and retain full reversal history.</p>
        </div>
        <VendorCreditForm bills={sourceBillOptions} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Credits</p><p className="mt-2 text-2xl font-semibold text-slate-900">{credits.length}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Open balances</p><div className="mt-2 space-y-1">{openByCurrency.size ? Array.from(openByCurrency).map(([currency, amount]) => <p key={currency} className="font-semibold text-slate-900">{formatCurrency(amount, currency)}</p>) : <p className="text-2xl font-semibold text-slate-900">{formatCurrency(0, baseCurrency)}</p>}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Accounting</p><p className="mt-2 text-sm font-semibold text-slate-900">AP · Vendor Credit asset · Bank · FX</p></div>
      </div>

      {credits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <p className="font-medium text-slate-600">No vendor credits yet</p>
          <p className="mt-1 text-sm text-slate-400">Create a credit from an existing posted Bill.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Credit</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Vendor</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Source Bill</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Date</th>
                <th className="px-4 py-3 text-right font-medium text-slate-500">Total</th>
                <th className="px-4 py-3 text-right font-medium text-slate-500">Applied</th>
                <th className="px-4 py-3 text-right font-medium text-slate-500">Refunded</th>
                <th className="px-4 py-3 text-right font-medium text-slate-500">Open</th>
                <th className="px-4 py-3 text-right font-medium text-slate-500">Status</th>
                <th className="px-4 py-3 text-right font-medium text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credits.map((credit) => (
                <tr key={credit.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">{credit.creditNumber}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{credit.vendorName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{credit.billNumber}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(credit.creditDate)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(credit.totalAmount), credit.currency)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(credit.appliedAmount), credit.currency)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(credit.refundedAmount), credit.currency)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700">{formatCurrency(Number(credit.remainingAmount), credit.currency)}</td>
                  <td className="px-4 py-3 text-right"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${credit.status === "OPEN" ? "bg-emerald-50 text-emerald-700" : credit.status === "REVERSED" ? "bg-slate-100 text-slate-500" : "bg-blue-50 text-blue-700"}`}>{credit.status}</span></td>
                  <td className="px-4 py-3 text-right">
                    {credit.status === "OPEN" && Number(credit.remainingAmount) > 0.005 ? (
                      <VendorCreditActions
                        credit={{ id: credit.id, vendorId: credit.vendorId, creditNumber: credit.creditNumber, currency: credit.currency, exchangeRate: Number(credit.exchangeRate), remainingAmount: Number(credit.remainingAmount) }}
                        bills={settlementBills}
                        bankAccounts={bankAccounts}
                        baseCurrency={baseCurrency}
                      />
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Movement history</h2>
          <p className="text-sm text-slate-500">Later Bill applications and supplier refunds. Reversal preserves the original journal and posts an exact inverse.</p>
        </div>
        {movements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">No later Vendor Credit movements yet.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="px-4 py-3 text-left font-medium text-slate-500">Credit</th><th className="px-4 py-3 text-left font-medium text-slate-500">Movement</th><th className="px-4 py-3 text-left font-medium text-slate-500">Date</th><th className="px-4 py-3 text-left font-medium text-slate-500">Target / reference</th><th className="px-4 py-3 text-right font-medium text-slate-500">Amount</th><th className="px-4 py-3 text-right font-medium text-slate-500">Status</th><th className="px-4 py-3"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((movement) => <tr key={`${movement.kind}-${movement.id}`} className={movement.status === "REVERSED" ? "bg-slate-50 text-slate-400" : ""}>
                  <td className="px-4 py-3 font-mono text-xs">{movement.creditNumber}</td>
                  <td className="px-4 py-3 font-medium">{movement.kind === "APPLICATION" ? "Applied to Bill" : "Supplier refund"}</td>
                  <td className="px-4 py-3">{formatDate(movement.movementDate)}</td>
                  <td className="px-4 py-3">{movement.target}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(movement.amount), movement.currency)}</td>
                  <td className="px-4 py-3 text-right">{movement.status}</td>
                  <td className="px-4 py-3 text-right">{movement.status === "POSTED" ? <VendorCreditMovementReversalButton kind={movement.kind} id={movement.id} label={movement.kind === "APPLICATION" ? "Vendor Credit application" : "supplier refund"} /> : null}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
