/**
 * Verification script: invoice_lines.income_account_id migration
 * Run: node scripts/verify-invoice-line-income-account.mjs
 *
 * Uses pg directly (bypasses the PrismaPg adapter requirement in standalone scripts).
 */
import pg from "pg";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local (same env file the Next.js app uses)
config({ path: resolve(process.cwd(), ".env.local") });

const { Pool } = pg;

// Use the direct (non-pooler) URL for introspection queries
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("No DATABASE_URL or DIRECT_URL found in .env.local");
  process.exit(1);
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

let failed = false;
function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); failed = true; }
function section(title) { console.log(`\n── ${title} ──`); }

async function q(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function main() {
  console.log("=== invoice_lines.income_account_id QA ===");

  // ── 1. Column shape ───────────────────────────────────────────────────────
  section("1. Column shape");

  const cols = await q(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'invoice_lines'
      AND column_name  = 'income_account_id'
  `);

  if (cols.length === 0) {
    fail("Column income_account_id does NOT exist on invoice_lines");
  } else {
    const col = cols[0];
    col.data_type === "text"
      ? pass(`Column exists, type = ${col.data_type}`)
      : fail(`Column exists but type = ${col.data_type} (expected text)`);
    col.is_nullable === "YES"
      ? pass("Column is nullable (correct)")
      : fail(`Column is NOT nullable (is_nullable = ${col.is_nullable})`);
  }

  // ── 2. Foreign key ────────────────────────────────────────────────────────
  section("2. Foreign key");

  const fks = await q(`
    SELECT
      tc.constraint_name,
      rc.delete_rule,
      ccu.table_name AS ref_table,
      ccu.column_name AS ref_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name   = tc.constraint_name
     AND rc.constraint_schema = tc.constraint_schema
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name   = tc.constraint_name
     AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name   = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.table_schema    = 'public'
      AND tc.table_name      = 'invoice_lines'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name    = 'income_account_id'
  `);

  if (fks.length === 0) {
    fail("No FK found from invoice_lines.income_account_id");
  } else {
    const fk = fks[0];
    pass(`FK exists: ${fk.constraint_name}`);
    fk.delete_rule === "SET NULL"
      ? pass(`ON DELETE ${fk.delete_rule} ✓`)
      : fail(`ON DELETE rule = ${fk.delete_rule} (expected SET NULL)`);
    fk.ref_table === "chart_of_accounts"
      ? pass(`References: ${fk.ref_table}(${fk.ref_col})`)
      : fail(`References: ${fk.ref_table}(${fk.ref_col}) — expected chart_of_accounts(id)`);
  }

  // ── 3. Index ──────────────────────────────────────────────────────────────
  section("3. Index");

  const idxs = await q(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'invoice_lines'
      AND indexname  = 'idx_invoice_lines_income_account'
  `);

  idxs.length > 0
    ? pass("idx_invoice_lines_income_account exists")
    : fail("Index idx_invoice_lines_income_account NOT found");

  // ── 4. Backfill counts ────────────────────────────────────────────────────
  section("4. Backfill counts");

  const [totRow]    = await q(`SELECT COUNT(*) AS n FROM invoice_lines`);
  const [withRow]   = await q(`SELECT COUNT(*) AS n FROM invoice_lines WHERE income_account_id IS NOT NULL`);
  const [nullRow]   = await q(`SELECT COUNT(*) AS n FROM invoice_lines WHERE income_account_id IS NULL`);

  const total = parseInt(totRow.n, 10);
  const withAcc = parseInt(withRow.n, 10);
  const nullAcc = parseInt(nullRow.n, 10);

  console.log(`  Total lines          : ${total}`);
  console.log(`  With income_account  : ${withAcc}`);
  console.log(`  NULL income_account  : ${nullAcc}`);

  if (total === 0) {
    pass("No invoice lines in DB yet — backfill N/A");
  } else {
    // Lines that have an item with income_account_id but line is still null = bad
    const [missedRow] = await q(`
      SELECT COUNT(*) AS n
      FROM invoice_lines il
      JOIN items i ON i.id = il.item_id
      WHERE il.income_account_id IS NULL
        AND i.income_account_id IS NOT NULL
    `);
    const missed = parseInt(missedRow.n, 10);
    missed === 0
      ? pass("No lines missed: all item-linked income accounts are inherited")
      : fail(`${missed} lines have item.income_account_id but line.income_account_id is NULL`);

    // Lines without item that have a valid IN-001 but line is null = bad
    const [missedDefault] = await q(`
      SELECT COUNT(*) AS n
      FROM invoice_lines il
      JOIN invoices inv ON inv.id = il.invoice_id
      JOIN chart_of_accounts coa
        ON coa.tenant_id = inv.tenant_id
       AND coa.code = 'IN-001'
       AND coa.is_active = TRUE
      WHERE il.income_account_id IS NULL
    `);
    const missedDef = parseInt(missedDefault.n, 10);
    missedDef === 0
      ? pass("No lines missed: IN-001 backfill applied where available")
      : fail(`${missedDef} lines could have used IN-001 but income_account_id is NULL`);

    if (nullAcc > 0) {
      console.log(`  Note: ${nullAcc} line(s) remain NULL — tenant had no valid INCOME account`);
    }
  }

  // ── 5. Type-safety cross-check (FK target column type) ───────────────────
  section("5. FK target column type");

  const [targetCol] = await q(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'chart_of_accounts'
      AND column_name  = 'id'
  `);
  if (targetCol) {
    console.log(`  chart_of_accounts.id type = ${targetCol.data_type}`);
    targetCol.data_type === "text"
      ? pass("Types match: both sides are text ✓")
      : fail(`Mismatch: chart_of_accounts.id is ${targetCol.data_type}, invoice_lines.income_account_id is text`);
  } else {
    fail("Could not read chart_of_accounts.id column type");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  section("Summary");
  if (failed) {
    console.error("Some checks FAILED — see ✗ above.\n");
    process.exit(1);
  } else {
    console.log("All checks passed.\n");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => pool.end());
