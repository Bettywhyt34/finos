import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// Execute the real reporting modules with an isolated database double.
// No credentials, network, production data, or installed packages are required.
async function loadModule(path, imports) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const context = vm.createContext({ Date, Intl });
  const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context });
  await module.link((specifier) => {
    assert.ok(Object.hasOwn(imports, specifier), `Unexpected dependency: ${specifier}`);
    const values = imports[specifier];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

function statementDb() {
  const accounts = [
    { id: 'cash', tenantId: 'a', code: '100', name: 'Cash', type: 'ASSET', isActive: true },
    { id: 'old', tenantId: 'a', code: '110', name: 'Retired bank', type: 'ASSET', isActive: false },
    { id: 'foreign', tenantId: 'b', code: '100', name: 'Other entity', type: 'ASSET', isActive: true },
  ];
  const entries = [
    { accountId: 'cash', tenantId: 'a', isLocked: true, recognitionPeriod: '2026-09', source: 'receipt', debit: 100, credit: 0 },
    { accountId: 'old', tenantId: 'a', isLocked: true, recognitionPeriod: '2026-08', source: 'receipt', debit: 200, credit: 0 },
    { accountId: 'cash', tenantId: 'a', isLocked: false, recognitionPeriod: '2026-09', source: 'manual', debit: 900, credit: 0 },
    { accountId: 'foreign', tenantId: 'b', isLocked: true, recognitionPeriod: '2026-09', source: 'receipt', debit: 5000, credit: 0 },
    { accountId: 'cash', tenantId: 'a', isLocked: true, recognitionPeriod: '2026-10', source: 'receipt', debit: 700, credit: 0 },
  ];
  return {
    chartOfAccounts: { findMany: async ({ where }) => accounts.filter(a =>
      a.tenantId === where.tenantId && (where.isActive === undefined || a.isActive === where.isActive)) },
    journalEntryLine: { groupBy: async ({ where: { entry: w } }) => {
      const groups = new Map();
      for (const row of entries) {
        if (row.tenantId !== w.tenantId || row.isLocked !== w.isLocked ||
            row.recognitionPeriod > w.recognitionPeriod.lte ||
            (w.recognitionPeriod.gte && row.recognitionPeriod < w.recognitionPeriod.gte) ||
            w.source?.notIn?.includes(row.source)) continue;
        const sum = groups.get(row.accountId) ?? { debit: 0, credit: 0 };
        sum.debit += row.debit; sum.credit += row.credit;
        groups.set(row.accountId, sum);
      }
      return [...groups].map(([accountId, _sum]) => ({ accountId, _sum }));
    } },
  };
}

test('posted history survives account deactivation', async () => {
  const { getAccountBalances, sumByType } = await loadModule('lib/statements.ts', { '@/lib/prisma': { prisma: statementDb() } });
  const balances = await getAccountBalances('a', '2026-09');
  assert.equal(sumByType(balances, 'ASSET'), 300);
  assert.equal(balances.find(a => a.accountId === 'old')?.balance, 200);
});

test('statements preserve entity, posted-only and date boundaries', async () => {
  const { getAccountBalances, sumByType } = await loadModule('lib/statements.ts', { '@/lib/prisma': { prisma: statementDb() } });
  const balances = await getAccountBalances('a', '2026-09', '2026-09');
  assert.equal(sumByType(balances, 'ASSET'), 100);
  assert.equal(balances.some(a => a.accountId === 'foreign'), false);
});

for (const closed of [false, true]) {
  test(`dashboard preserves trading profit with year-end closing journal ${closed ? 'present' : 'absent'}`, async () => {
    const rows = [
      { type: 'INCOME', balance: 700, financialCategory: 'REVENUE', source: 'invoice' },
      { type: 'EXPENSE', balance: 200, financialCategory: 'OPERATING_EXPENSES', source: 'bill' },
      ...(closed ? [
        { type: 'INCOME', balance: -700, financialCategory: 'REVENUE', source: 'year-end-close' },
        { type: 'EXPENSE', balance: -200, financialCategory: 'OPERATING_EXPENSES', source: 'year-end-close' },
      ] : []),
    ];
    const prisma = {
      tenant: { findUnique: async () => ({ currency: 'NGN' }) },
      bankAccount: { findMany: async () => [] },
      invoice: { findMany: async () => [] },
      bill: { findMany: async () => [] },
    };
    const { getFinancialOverview } = await loadModule('lib/dashboard-data.ts', {
      '@/lib/prisma': { prisma },
      '@/lib/statements': {
        getAccountBalances: async (_tenant, _to, _from, options) => rows.filter(r => !options?.excludeSources?.includes(r.source)),
        sumByType: (balances, type) => balances.filter(b => b.type === type).reduce((s, b) => s + b.balance, 0),
      },
      '@/lib/utils': { formatCurrency: String, getRecognitionPeriod: () => '2026-12' },
    });
    const result = await getFinancialOverview('a');
    assert.equal(result.performance.revenue, 700);
    assert.equal(result.performance.netProfit, 500);
  });
}
