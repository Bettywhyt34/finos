import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { AccountType } from "@prisma/client";
import type { SystemAccountRole } from "@/lib/accounting/system-accounts";
import { saveSystemAccountMapping } from "./actions";

interface MappingRow { role: string; accountId: string; }

const ROLES: Array<{ role: SystemAccountRole; label: string; description: string; types: AccountType[] }> = [
  { role: "ACCOUNTS_RECEIVABLE", label: "Accounts Receivable", description: "Customer balances owed to the business.", types: ["ASSET"] },
  { role: "ACCOUNTS_PAYABLE", label: "Accounts Payable", description: "Amounts owed to vendors and suppliers.", types: ["LIABILITY"] },
  { role: "CUSTOMER_CREDIT", label: "Customer Credit Liability", description: "Amounts owed back to customers or available to offset future invoices.", types: ["LIABILITY"] },
  { role: "VENDOR_CREDIT", label: "Vendor Credit Asset", description: "Supplier credits available to offset future bills or be refunded to the business.", types: ["ASSET"] },
  { role: "PREPAID_EXPENSE", label: "Prepaid Expense", description: "Costs billed before they are recognised as expense. FINOS releases this asset to the intended expense account over time.", types: ["ASSET"] },
  { role: "EXPENSE_REIMBURSEMENT_PAYABLE", label: "Expense Reimbursement Payable", description: "Approved employee claims awaiting reimbursement.", types: ["LIABILITY"] },
  { role: "DEFAULT_BANK", label: "Default Bank", description: "Default cash account used when a transaction does not specify another bank account.", types: ["ASSET"] },
  { role: "INPUT_VAT", label: "Input VAT Recoverable", description: "Recoverable VAT paid on eligible purchases.", types: ["ASSET"] },
  { role: "OUTPUT_VAT", label: "Output VAT Payable", description: "VAT collected from customers and payable to the tax authority.", types: ["LIABILITY"] },
  { role: "WHT_PAYABLE", label: "Withholding Tax Payable", description: "WHT deducted from vendor payments and awaiting remittance.", types: ["LIABILITY"] },
  { role: "WHT_RECEIVABLE", label: "Withholding Tax Receivable", description: "WHT deducted by customers and recoverable as a tax credit.", types: ["ASSET"] },
  { role: "RETAINED_EARNINGS", label: "Retained Earnings", description: "Equity account used for year-end profit or loss transfer.", types: ["EQUITY"] },
  { role: "FX_GAIN", label: "Unrealised FX Gain", description: "Income account used by foreign-currency revaluation and realised FX gains.", types: ["INCOME"] },
  { role: "FX_LOSS", label: "Unrealised FX Loss", description: "Expense account used by foreign-currency revaluation and realised FX losses.", types: ["EXPENSE"] },
  { role: "CONTRACT_ASSET", label: "Contract Asset", description: "Revenue recognised before an unconditional receivable exists.", types: ["ASSET"] },
  { role: "UNEARNED_REVENUE", label: "Unearned Revenue", description: "Customer consideration billed before revenue is earned.", types: ["LIABILITY"] },
];

export default async function SystemAccountsPage() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) redirect("/login");

  const [accounts, mappings] = await Promise.all([
    prisma.chartOfAccounts.findMany({ where: { tenantId, isActive: true }, select: { id: true, code: true, name: true, type: true }, orderBy: { code: "asc" } }),
    prisma.$queryRaw<MappingRow[]>`SELECT "role", "account_id" AS "accountId" FROM "system_account_mappings" WHERE "tenant_id" = ${tenantId}::uuid`,
  ]);
  const mappingByRole = new Map(mappings.map((mapping) => [mapping.role, mapping.accountId]));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--finos-accent)]">Accounting controls</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight text-[var(--text-primary)]">System Accounts</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">Map FINOS accounting roles to your Chart of Accounts. Automatic postings stop when a required mapping is missing rather than guessing an account.</p>
      </header>
      <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-white">
        <div className="grid grid-cols-[1.25fr_1.5fr_auto] gap-4 border-b border-[var(--app-border)] bg-[var(--surface-muted)] px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"><span>Accounting role</span><span>Mapped account</span><span>Action</span></div>
        <div className="divide-y divide-[var(--app-border)]">
          {ROLES.map((item) => {
            const eligible = accounts.filter((account) => item.types.includes(account.type));
            const current = mappingByRole.get(item.role) ?? "";
            return (
              <form key={item.role} action={saveSystemAccountMapping} className="grid grid-cols-[1.25fr_1.5fr_auto] gap-4 px-5 py-4 items-center">
                <input type="hidden" name="role" value={item.role} />
                <div><p className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</p><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{item.description}</p></div>
                <select name="accountId" defaultValue={current} className="h-10 w-full rounded-md border border-[var(--app-border)] bg-white px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--finos-accent)]">
                  <option value="">Not mapped</option>
                  {eligible.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                </select>
                <button type="submit" className="h-10 rounded-md bg-[var(--finos-accent)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90">Save</button>
              </form>
            );
          })}
        </div>
      </div>
    </div>
  );
}
