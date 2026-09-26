import type { AccountBalance } from "@/lib/statements";
export interface EntityBook { id: string; name: string; currency: string; balances: AccountBalance[]; }
export interface Elimination { entityId: string; accountId: string; debit: number; credit: number; reason: string; }

export function consolidate(books: EntityBook[], eliminations: Elimination[]) {
  if (!books.length || new Set(books.map(b => b.id)).size !== books.length) throw new Error("Select distinct entity books");
  if (books.some(b => b.currency !== "NGN")) throw new Error("MVP consolidation supports NGN books only; currency translation is unavailable.");
  const rows = new Map<string, {code: string; name: string; type: string; category: string | null; source: number; adjustment: number; balance: number}>();
  const cents = (n: number) => { if (!Number.isFinite(n)) throw new Error("Invalid amount"); return Math.round(n*100); };
  for (const book of books) for (const account of book.balances) {
    const row = rows.get(account.code);
    if (row && (row.type !== account.type || row.category !== account.financialCategory || row.name !== account.name)) throw new Error(`Account mapping conflict at ${account.code}. Align account name, type and category before consolidating.`);
    const target = row ?? { code: account.code, name: account.name, type: account.type, category: account.financialCategory, source: 0, adjustment: 0, balance: 0 };
    target.source += cents(account.balance); rows.set(account.code, target);
  }
  let debits = 0, credits = 0;
  for (const line of eliminations) {
    const account = books.find(b => b.id === line.entityId)?.balances.find(a => a.accountId === line.accountId);
    if (!account || !line.reason.trim() || line.reason.length > 1000 || line.debit < 0 || line.credit < 0 || (line.debit > 0) === (line.credit > 0)) throw new Error("Each elimination needs an accessible source account, reason and one positive debit or credit.");
    const debit = cents(line.debit), credit = cents(line.credit);
    debits += debit; credits += credit;
    rows.get(account.code)!.adjustment += ["ASSET", "EXPENSE"].includes(account.type) ? debit-credit : credit-debit;
  }
  if (debits !== credits) throw new Error("Elimination debits and credits must balance exactly.");
  return [...rows.values()].map(row => ({ ...row, source: row.source/100, adjustment: row.adjustment/100, balance: (row.source+row.adjustment)/100 }));
}
