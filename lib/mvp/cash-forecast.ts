export interface CashItem { id: string; label: string; dueDate: string; amount: number; href: string; }
export function cashForecast(opening: number, receipts: CashItem[], payments: CashItem[], asOf: string, collectionDelayDays = 0) {
  const start = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(opening) || !Number.isInteger(collectionDelayDays) || collectionDelayDays < 0 || collectionDelayDays > 90) throw new Error("Invalid forecast inputs");
  const cents = (n: number) => { if (!Number.isFinite(n) || n < 0) throw new Error("Invalid cash flow amount"); return Math.round(n * 100); };
  const weeks = Array.from({length: 13}, (_, i) => ({ week: i + 1, date: new Date(start + i * 7 * 86400000).toISOString().slice(0,10), receipts: 0, payments: 0, closing: 0, receiptIds: [] as string[], paymentIds: [] as string[] }));
  for (const [items, key, delay] of [[receipts, "receipts", collectionDelayDays], [payments, "payments", 0]] as const) {
    for (const item of items) {
      const due = Date.parse(item.dueDate);
      if (!Number.isFinite(due)) throw new Error("Invalid evidence due date");
      const days = Math.max(0, Math.floor((due - start) / 86400000)) + delay;
      const index = Math.floor(days / 7);
      if (index >= 13) continue;
      weeks[index][key] += cents(item.amount);
      weeks[index][key === "receipts" ? "receiptIds" : "paymentIds"].push(item.id);
    }
  }
  let balance = Math.round(opening * 100);
  return weeks.map(week => { balance += week.receipts - week.payments; return { ...week, receipts: week.receipts / 100, payments: week.payments / 100, closing: balance / 100 }; });
}
