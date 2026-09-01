import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatDate, formatCurrency } from "@/lib/utils";
import { GeneralLedgerExport } from "./general-ledger-export";
import { LedgerControls } from "./ledger-controls";
import { AccountForm } from "../../accounting/chart-of-accounts/account-form";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual Journal",
  invoice: "Invoice",
  invoice_void: "Invoice Void",
  bill: "Bill",
  customer_payment: "Customer Receipt",
  vendor_payment: "Vendor Payment",
  payment: "Payment",
  "bank-import": "Bank Transaction",
  "fx-revaluation": "FX Revaluation",
  reversal: "Reversal",
};

type RangeKey =
  | "TODAY"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "THIS_YEAR"
  | "LAST_YEAR"
  | "CUSTOM";

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function resolveRange(range: string | undefined, dateFrom?: string, dateTo?: string) {
  const now = new Date();
  const key = (range || "THIS_YEAR") as RangeKey;

  if (key === "CUSTOM" && dateFrom && dateTo) {
    return { key, from: startOfDay(new Date(`${dateFrom}T00:00:00`)), to: endOfDay(new Date(`${dateTo}T00:00:00`)) };
  }

  if (key === "TODAY") return { key, from: startOfDay(now), to: endOfDay(now) };
  if (key === "THIS_MONTH") {
    return { key, from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }
  if (key === "LAST_MONTH") {
    return { key, from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  if (key === "THIS_QUARTER" || key === "LAST_QUARTER") {
    const currentQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const startMonth = key === "THIS_QUARTER" ? currentQuarterStartMonth : currentQuarterStartMonth - 3;
    const from = new Date(now.getFullYear(), startMonth, 1);
    const to = endOfDay(new Date(from.getFullYear(), from.getMonth() + 3, 0));
    return { key, from, to };
  }
  if (key === "LAST_YEAR") {
    return { key, from: new Date(now.getFullYear() - 1, 0, 1), to: endOfDay(new Date(now.getFullYear() - 1, 11, 31)) };
  }
  return { key: "THIS_YEAR" as RangeKey, from: new Date(now.getFullYear(), 0, 1), to: endOfDay(new Date(now.getFullYear(), 11, 31)) };
}

function ymd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function naturalMovement(type: string, debit: number, credit: number) {
  return ["ASSET", "EXPENSE"].includes(type) ? debit - credit : credit - debit;
}

function balanceSide(type: string, naturalBalance: number): "Dr" | "Cr" {
  const debitNormal = ["ASSET", "EXPENSE"].includes(type);
  if (naturalBalance >= 0) return debitNormal ? "Dr" : "Cr";
  return debitNormal ? "Cr" : "Dr";
}

function amountForSide(type: string, naturalBalance: number, side: "Dr" | "Cr") {
  return balanceSide(type, naturalBalance) === side ? Math.abs(naturalBalance) : 0;
}

function sourceHref(source: string, sourceId: string | null, entryId: string) {
  if (sourceId && (source === "invoice" || source === "invoice_void")) return `/sales/invoices/${sourceId}`;
  if (sourceId && source === "bill") return `/purchases/bills/${sourceId}`;
  if (source === "customer_payment") return "/sales/receipts";
  if (source === "vendor_payment") return "/purchases/payments";
  return `/accounting/journal-entries/${entryId}`;
}

function tagMatches(value: unknown, optionId: string) {
  if (!optionId || optionId === "ALL" || !value || typeof value !== "object") return !optionId || optionId === "ALL";
  return Object.values(value as Record<string, unknown>).some((item) => item === optionId);
}

export default async function GeneralLedgerPage(props: {
  searchParams: Promise<{
    accountId?: string;
    accountFilter?: string;
    range?: string;
    dateFrom?: string;
    dateTo?: string;
    projectId?: string;
    tagOptionId?: string;
    source?: string;
    party?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return null;

  const effectiveAccountId = searchParams.accountFilter || searchParams.accountId || "";
  const { key: range, from, to } = resolveRange(searchParams.range, searchParams.dateFrom, searchParams.dateTo);
  const projectId = searchParams.projectId === "ALL" ? "" : (searchParams.projectId ?? "");
  const tagOptionId = searchParams.tagOptionId === "ALL" ? "" : (searchParams.tagOptionId ?? "");
  const sourceFilter = searchParams.source === "ALL" ? "" : (searchParams.source ?? "");
  const partyFilter = (searchParams.party ?? "").trim().toLowerCase();

  const [accounts, projects, reportingTags] = await Promise.all([
    prisma.chartOfAccounts.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        subtype: true,
        financialCategory: true,
        parentId: true,
        isActive: true,
      },
      orderBy: { code: "asc" },
    }),
    prisma.project.findMany({
      where: { tenantId },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.reportingTag.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        options: {
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const selectedAccount = effectiveAccountId
    ? accounts.find((account) => account.id === effectiveAccountId) ?? null
    : null;

  if (!selectedAccount) {
    return (
      <div className="space-y-5 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Account Transactions</h1>
          <p className="mt-1 text-sm text-slate-500">Select an account to view its transaction register.</p>
        </div>
        <LedgerControls
          accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} — ${account.name}` }))}
          projects={projects.map((project) => ({ id: project.id, label: project.code ? `${project.code} — ${project.name}` : project.name }))}
          tagGroups={reportingTags.map((tag) => ({ id: tag.id, name: tag.name, options: tag.options.map((option) => ({ id: option.id, label: option.name })) }))}
          sourceOptions={[]}
          initial={{ accountId: effectiveAccountId, range, dateFrom: ymd(from), dateTo: ymd(to), projectId, tagOptionId, source: sourceFilter, party: searchParams.party ?? "" }}
        />
      </div>
    );
  }

  const [openingLines, periodLines] = await Promise.all([
    prisma.journalEntryLine.findMany({
      where: {
        accountId: selectedAccount.id,
        entry: { tenantId, isLocked: true, entryDate: { lt: from } },
      },
      select: { debit: true, credit: true },
    }),
    prisma.journalEntryLine.findMany({
      where: {
        accountId: selectedAccount.id,
        entry: { tenantId, isLocked: true, entryDate: { gte: from, lte: to } },
      },
      include: {
        project: { select: { id: true, name: true, code: true } },
        entry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            reference: true,
            description: true,
            source: true,
            sourceId: true,
          },
        },
      },
      orderBy: [{ entry: { entryDate: "asc" } }, { id: "asc" }],
    }),
  ]);

  const openingBalance = openingLines.reduce(
    (sum, line) => sum + naturalMovement(selectedAccount.type, Number(line.debit), Number(line.credit)),
    0
  );

  const invoiceIds = periodLines.filter((line) => ["invoice", "invoice_void"].includes(line.entry.source) && line.entry.sourceId).map((line) => line.entry.sourceId!);
  const paymentIds = periodLines.filter((line) => line.entry.source === "customer_payment" && line.entry.sourceId).map((line) => line.entry.sourceId!);
  const billIds = periodLines.filter((line) => line.entry.source === "bill" && line.entry.sourceId).map((line) => line.entry.sourceId!);
  const vendorPaymentKeys = periodLines.filter((line) => line.entry.source === "vendor_payment" && line.entry.sourceId).map((line) => line.entry.sourceId!);

  const [invoices, customerPayments, bills, vendorPayments] = await Promise.all([
    invoiceIds.length ? prisma.invoice.findMany({ where: { tenantId, id: { in: invoiceIds } }, select: { id: true, customer: { select: { companyName: true } } } }) : [],
    paymentIds.length ? prisma.customerPayment.findMany({ where: { tenantId, id: { in: paymentIds } }, select: { id: true, customer: { select: { companyName: true } } } }) : [],
    billIds.length ? prisma.bill.findMany({ where: { tenantId, id: { in: billIds } }, select: { id: true, vendor: { select: { companyName: true } } } }) : [],
    vendorPaymentKeys.length ? prisma.vendorPayment.findMany({ where: { tenantId, OR: [{ id: { in: vendorPaymentKeys } }, { paymentNumber: { in: vendorPaymentKeys } }] }, select: { id: true, paymentNumber: true, vendor: { select: { companyName: true } } } }) : [],
  ]);

  const partyBySource = new Map<string, string>();
  invoices.forEach((item) => partyBySource.set(`invoice:${item.id}`, item.customer.companyName));
  invoices.forEach((item) => partyBySource.set(`invoice_void:${item.id}`, item.customer.companyName));
  customerPayments.forEach((item) => partyBySource.set(`customer_payment:${item.id}`, item.customer.companyName));
  bills.forEach((item) => partyBySource.set(`bill:${item.id}`, item.vendor.companyName));
  vendorPayments.forEach((item) => {
    partyBySource.set(`vendor_payment:${item.id}`, item.vendor.companyName);
    partyBySource.set(`vendor_payment:${item.paymentNumber}`, item.vendor.companyName);
  });

  let runningBalance = openingBalance;
  const allRows = periodLines.map((line) => {
    const debit = Number(line.debit);
    const credit = Number(line.credit);
    runningBalance += naturalMovement(selectedAccount.type, debit, credit);
    const sourceKey = `${line.entry.source}:${line.entry.sourceId ?? ""}`;
    return {
      id: line.id,
      entryId: line.entry.id,
      entryDate: line.entry.entryDate,
      entryNumber: line.entry.entryNumber,
      reference: line.entry.reference,
      description: line.description || line.entry.description,
      source: line.entry.source,
      sourceId: line.entry.sourceId,
      party: partyBySource.get(sourceKey) ?? "",
      debit,
      credit,
      runningBalance,
      projectId: line.projectId ?? "",
      projectLabel: line.project ? (line.project.code ? `${line.project.code} — ${line.project.name}` : line.project.name) : "",
      reportingTags: line.reportingTags,
    };
  });

  const trueClosingBalance = runningBalance;
  const visibleRows = allRows.filter((row) => {
    if (projectId && row.projectId !== projectId) return false;
    if (tagOptionId && !tagMatches(row.reportingTags, tagOptionId)) return false;
    if (sourceFilter && row.source !== sourceFilter) return false;
    if (partyFilter && !row.party.toLowerCase().includes(partyFilter)) return false;
    return true;
  });

  const filteredDebit = visibleRows.reduce((sum, row) => sum + row.debit, 0);
  const filteredCredit = visibleRows.reduce((sum, row) => sum + row.credit, 0);
  const transactionFiltersActive = Boolean(projectId || tagOptionId || sourceFilter || partyFilter);
  const sourceOptions = Array.from(new Set(periodLines.map((line) => line.entry.source)))
    .sort()
    .map((source) => ({ id: source, label: SOURCE_LABELS[source] ?? source }));

  const openingDr = amountForSide(selectedAccount.type, openingBalance, "Dr");
  const openingCr = amountForSide(selectedAccount.type, openingBalance, "Cr");
  const closingDr = amountForSide(selectedAccount.type, trueClosingBalance, "Dr");
  const closingCr = amountForSide(selectedAccount.type, trueClosingBalance, "Cr");

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 text-xs text-slate-400">
            <Link href="/accounting/chart-of-accounts" className="hover:text-slate-700">Chart of Accounts</Link>
            <span className="mx-2">/</span>
            <span>{selectedAccount.code}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{selectedAccount.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {selectedAccount.code}{selectedAccount.subtype ? ` · ${selectedAccount.subtype}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AccountForm
            accounts={accounts}
            editAccount={selectedAccount}
            trigger={<span className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Edit Account</span>}
          />
          <GeneralLedgerExport
            rows={visibleRows}
            accountCode={selectedAccount.code}
            accountName={selectedAccount.name}
          />
        </div>
      </div>

      <LedgerControls
        accounts={accounts.map((account) => ({ id: account.id, label: `${account.code} — ${account.name}` }))}
        projects={projects.map((project) => ({ id: project.id, label: project.code ? `${project.code} — ${project.name}` : project.name }))}
        tagGroups={reportingTags.map((tag) => ({ id: tag.id, name: tag.name, options: tag.options.map((option) => ({ id: option.id, label: option.name })) }))}
        sourceOptions={sourceOptions}
        initial={{ accountId: selectedAccount.id, range, dateFrom: ymd(from), dateTo: ymd(to), projectId, tagOptionId, source: sourceFilter, party: searchParams.party ?? "" }}
      />

      {transactionFiltersActive && (
        <p className="text-xs text-slate-500">
          Debit and credit totals reflect the current filters. Opening, running and closing balances remain the true account balance for the selected date range.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="p-3 text-left font-medium">Date</th>
                <th className="p-3 text-left font-medium">Reference</th>
                <th className="p-3 text-left font-medium">Party</th>
                <th className="p-3 text-left font-medium">Description</th>
                <th className="p-3 text-right font-medium">Debit</th>
                <th className="p-3 text-right font-medium">Credit</th>
                <th className="p-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 bg-slate-50/40 font-medium">
                <td className="p-3 text-slate-500">{formatDate(from)}</td>
                <td className="p-3">—</td>
                <td className="p-3">—</td>
                <td className="p-3">Opening Balance</td>
                <td className="p-3 text-right">{openingDr ? formatCurrency(openingDr) : "—"}</td>
                <td className="p-3 text-right">{openingCr ? formatCurrency(openingCr) : "—"}</td>
                <td className="p-3 text-right font-semibold">{formatCurrency(Math.abs(openingBalance))} {balanceSide(selectedAccount.type, openingBalance)}</td>
              </tr>

              {visibleRows.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td colSpan={7} className="p-10 text-center text-slate-400">No transactions found for the selected view.</td>
                </tr>
              ) : visibleRows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="p-3 text-slate-600">{formatDate(row.entryDate)}</td>
                  <td className="p-3">
                    <Link href={sourceHref(row.source, row.sourceId, row.entryId)} className="font-medium text-emerald-800 hover:underline">
                      {row.reference || row.entryNumber}
                    </Link>
                  </td>
                  <td className="p-3 text-slate-700">{row.party || "—"}</td>
                  <td className="p-3 text-slate-700">
                    {row.description}
                    {row.projectLabel ? <span className="ml-2 text-xs text-slate-400">· {row.projectLabel}</span> : null}
                  </td>
                  <td className="p-3 text-right font-mono">{row.debit ? formatCurrency(row.debit) : "—"}</td>
                  <td className="p-3 text-right font-mono">{row.credit ? formatCurrency(row.credit) : "—"}</td>
                  <td className="p-3 text-right font-mono font-medium">{formatCurrency(Math.abs(row.runningBalance))} {balanceSide(selectedAccount.type, row.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/70 font-semibold">
              <tr>
                <td colSpan={4} className="p-3 text-right">Total</td>
                <td className="p-3 text-right font-mono">{formatCurrency(filteredDebit)}</td>
                <td className="p-3 text-right font-mono">{formatCurrency(filteredCredit)}</td>
                <td className="p-3" />
              </tr>
              <tr className="border-t border-slate-200">
                <td colSpan={4} className="p-3 text-right">Closing Balance</td>
                <td className="p-3 text-right font-mono">{closingDr ? formatCurrency(closingDr) : "—"}</td>
                <td className="p-3 text-right font-mono">{closingCr ? formatCurrency(closingCr) : "—"}</td>
                <td className="p-3 text-right font-mono">{formatCurrency(Math.abs(trueClosingBalance))} {balanceSide(selectedAccount.type, trueClosingBalance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
