/**
 * QA: Invoice journal balance arithmetic verification.
 * Exercises the same logic as post-invoice.ts computeRevenue/journalLines
 * against the three spec scenarios without touching the database.
 *
 * Run: node scripts/qa-invoice-journal-balance.mjs
 */

/** toNGN matches lib/utils.ts */
function toNGN(amount, rate) {
  return Math.round(amount * rate * 100) / 100;
}

/**
 * Replicates the post-invoice.ts logic:
 *   - groups line net revenue by incomeAccountId
 *   - allocates invoice-level discount proportionally
 *   - applies rounding adjustment to largest group
 *   - returns DR/CR journal lines
 */
function computeJournal({ lines, invoiceDiscountDoc, taxAmountDoc, totalAmountDoc, rate, arAccountId, vatAccountId, invoiceNumber }) {
  const totalAmountNGN     = toNGN(totalAmountDoc,    rate);
  const taxAmountNGN       = toNGN(taxAmountDoc,      rate);
  const invoiceDiscountNGN = toNGN(invoiceDiscountDoc, rate);

  // Revenue by account
  const revenueByAccount = new Map();
  for (const line of lines) {
    const gross    = line.amount;
    const lineDisc = line.discountAmount;
    const netNGN   = toNGN(gross - lineDisc, rate);
    const accId    = line.incomeAccountId;
    revenueByAccount.set(accId, Math.round(((revenueByAccount.get(accId) ?? 0) + netNGN) * 100) / 100);
  }

  // Proportional invoice-level discount
  if (invoiceDiscountNGN > 0.001) {
    const totalPreDisc = Array.from(revenueByAccount.values()).reduce((s, v) => s + v, 0);
    if (totalPreDisc > 0) {
      for (const [accId, amount] of Array.from(revenueByAccount.entries())) {
        const reduction = Math.round(invoiceDiscountNGN * (amount / totalPreDisc) * 100) / 100;
        revenueByAccount.set(accId, Math.round((amount - reduction) * 100) / 100);
      }
    }
  }

  // Rounding adjustment
  const sumRevenue      = Array.from(revenueByAccount.values()).reduce((s, v) => s + v, 0);
  const expectedRevenue = Math.round((totalAmountNGN - taxAmountNGN) * 100) / 100;
  const diff            = Math.round((expectedRevenue - sumRevenue) * 100) / 100;
  if (Math.abs(diff) > 1.00) throw new Error(`Rounding imbalance too large: ${diff}`);
  if (diff !== 0) {
    let largestAccId = "", largestAmt = -Infinity;
    for (const [accId, amount] of Array.from(revenueByAccount.entries())) {
      if (amount > largestAmt) { largestAmt = amount; largestAccId = accId; }
    }
    if (largestAccId) revenueByAccount.set(largestAccId, Math.round((largestAmt + diff) * 100) / 100);
  }

  // Build journal lines
  const jLines = [];
  jLines.push({ accountId: arAccountId, description: `AR - ${invoiceNumber}`, debit: totalAmountNGN, credit: 0 });
  for (const [accId, amount] of Array.from(revenueByAccount.entries())) {
    if (amount > 0) jLines.push({ accountId: accId, description: `Revenue - ${invoiceNumber}`, debit: 0, credit: amount });
  }
  if (taxAmountNGN > 0.001 && vatAccountId) {
    jLines.push({ accountId: vatAccountId, description: `Output VAT - ${invoiceNumber}`, debit: 0, credit: taxAmountNGN });
  }

  return { jLines, revenueByAccount, totalAmountNGN, taxAmountNGN };
}

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function assertBalance(jLines) {
  const dr = Math.round(jLines.reduce((s, l) => s + l.debit,  0) * 100) / 100;
  const cr = Math.round(jLines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
  assert(Math.abs(dr - cr) <= 0.005, `Journal balances (DR=${dr}, CR=${cr})`);
  return { dr, cr };
}

let passed = 0, failed = 0;
function run(label, fn) {
  console.log(`\n${label}`);
  try { fn(); passed++; }
  catch (e) { console.error(`  ✗ ${e.message}`); failed++; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A — Single line, 10% line discount, 7.5% VAT
// qty=1, rate=1_000_000, lineDiscount=10%, vat=7.5%
// gross=1_000_000, lineDisc=100_000, taxable=900_000, vat=67_500, total=967_500
// ─────────────────────────────────────────────────────────────────────────────
run("Scenario A — single line with VAT and line discount", () => {
  const gross       = 1_000_000;
  const lineDisc    = 100_000;   // 10%
  const taxable     = gross - lineDisc;  // 900_000
  const taxAmt      = Math.round(taxable * 0.075 * 100) / 100; // 67_500
  const total       = taxable + taxAmt;   // 967_500

  const { jLines } = computeJournal({
    lines: [{ amount: gross, discountAmount: lineDisc, incomeAccountId: "ACC_A" }],
    invoiceDiscountDoc: 0,
    taxAmountDoc:       taxAmt,
    totalAmountDoc:     total,
    rate: 1,
    arAccountId:  "AR_ACC",
    vatAccountId: "VAT_ACC",
    invoiceNumber: "INV-001",
  });

  const arLine  = jLines.find((l) => l.accountId === "AR_ACC");
  const revLine = jLines.find((l) => l.accountId === "ACC_A");
  const vatLine = jLines.find((l) => l.accountId === "VAT_ACC");

  assert(arLine?.debit  === 967_500, `AR debit = 967,500 (got ${arLine?.debit})`);
  assert(revLine?.credit === 900_000, `Revenue credit = 900,000 (got ${revLine?.credit})`);
  assert(vatLine?.credit === 67_500,  `VAT credit = 67,500 (got ${vatLine?.credit})`);
  assertBalance(jLines);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B — Two income accounts, combined VAT
// Line 1: ACC_A, net 700_000; Line 2: ACC_B, net 300_000; VAT 75_000
// total = 1_075_000
// ─────────────────────────────────────────────────────────────────────────────
run("Scenario B — two income accounts", () => {
  const { jLines } = computeJournal({
    lines: [
      { amount: 700_000, discountAmount: 0, incomeAccountId: "ACC_A" },
      { amount: 300_000, discountAmount: 0, incomeAccountId: "ACC_B" },
    ],
    invoiceDiscountDoc: 0,
    taxAmountDoc:       75_000,
    totalAmountDoc:     1_075_000,
    rate: 1,
    arAccountId:  "AR_ACC",
    vatAccountId: "VAT_ACC",
    invoiceNumber: "INV-002",
  });

  const arLine   = jLines.find((l) => l.accountId === "AR_ACC");
  const revLineA = jLines.find((l) => l.accountId === "ACC_A");
  const revLineB = jLines.find((l) => l.accountId === "ACC_B");
  const vatLine  = jLines.find((l) => l.accountId === "VAT_ACC");

  assert(arLine?.debit   === 1_075_000, `AR debit = 1,075,000 (got ${arLine?.debit})`);
  assert(revLineA?.credit === 700_000,  `Revenue A credit = 700,000 (got ${revLineA?.credit})`);
  assert(revLineB?.credit === 300_000,  `Revenue B credit = 300,000 (got ${revLineB?.credit})`);
  assert(vatLine?.credit  === 75_000,   `VAT credit = 75,000 (got ${vatLine?.credit})`);
  assertBalance(jLines);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario C — Additional invoice discount allocated proportionally
// Group A net pre-discount = 700_000 (70%), Group B = 300_000 (30%)
// invoiceDiscount = 100_000 → A gets 70_000 off, B gets 30_000 off
// No VAT. total = 900_000.
// ─────────────────────────────────────────────────────────────────────────────
run("Scenario C — proportional invoice-level discount", () => {
  const { jLines } = computeJournal({
    lines: [
      { amount: 700_000, discountAmount: 0, incomeAccountId: "ACC_A" },
      { amount: 300_000, discountAmount: 0, incomeAccountId: "ACC_B" },
    ],
    invoiceDiscountDoc: 100_000,
    taxAmountDoc:       0,
    totalAmountDoc:     900_000,  // 1_000_000 - 100_000
    rate: 1,
    arAccountId:  "AR_ACC",
    vatAccountId: null,
    invoiceNumber: "INV-003",
  });

  const arLine   = jLines.find((l) => l.accountId === "AR_ACC");
  const revLineA = jLines.find((l) => l.accountId === "ACC_A");
  const revLineB = jLines.find((l) => l.accountId === "ACC_B");

  assert(arLine?.debit   === 900_000, `AR debit = 900,000 (got ${arLine?.debit})`);
  assert(revLineA?.credit === 630_000, `Revenue A credit = 630,000 (got ${revLineA?.credit})`);
  assert(revLineB?.credit === 270_000, `Revenue B credit = 270,000 (got ${revLineB?.credit})`);
  assert(jLines.find((l) => l.accountId === "VAT_ACC") === undefined, "No VAT line when taxAmount=0");
  assertBalance(jLines);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario D — FX: USD invoice at rate 1600, single line no discount, no VAT
// amount=5000 USD, total=5000, rate=1600 → NGN=8_000_000
// ─────────────────────────────────────────────────────────────────────────────
run("Scenario D — FX conversion (USD @ 1600)", () => {
  const { jLines } = computeJournal({
    lines: [{ amount: 5_000, discountAmount: 0, incomeAccountId: "ACC_A" }],
    invoiceDiscountDoc: 0,
    taxAmountDoc:       0,
    totalAmountDoc:     5_000,
    rate: 1600,
    arAccountId:  "AR_ACC",
    vatAccountId: null,
    invoiceNumber: "INV-004",
  });

  const arLine  = jLines.find((l) => l.accountId === "AR_ACC");
  const revLine = jLines.find((l) => l.accountId === "ACC_A");

  assert(arLine?.debit  === 8_000_000, `AR debit = 8,000,000 NGN (got ${arLine?.debit})`);
  assert(revLine?.credit === 8_000_000, `Revenue credit = 8,000,000 NGN (got ${revLine?.credit})`);
  assertBalance(jLines);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario E — sentAt future date rejection (date logic only)
// ─────────────────────────────────────────────────────────────────────────────
run("Scenario E — future sentAt rejected, today and past allowed", () => {
  function checkSentAt(sentAt) {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return sentAt > todayEnd ? "REJECTED" : "ALLOWED";
  }

  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const today     = new Date();
  const tomorrow  = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);

  assert(checkSentAt(yesterday) === "ALLOWED",  "Yesterday is allowed");
  assert(checkSentAt(today)     === "ALLOWED",  "Today is allowed");
  assert(checkSentAt(tomorrow)  === "REJECTED", "Tomorrow is rejected");
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
