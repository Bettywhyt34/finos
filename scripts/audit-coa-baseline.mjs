/**
 * Audit: Chart of Accounts baseline per tenant
 * Run: node scripts/audit-coa-baseline.mjs
 */
import pg from "pg";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const REQUIRED = [
  { code: "CA-001", name: "Accounts Receivable", type: "ASSET",     subtype: "Current Asset",     purpose: "Invoices/AR" },
  { code: "IN-001", name: "Sales Income",         type: "INCOME",    subtype: "Operating Revenue", purpose: "Revenue posting" },
  { code: "CA-003", name: "Bank",                 type: "ASSET",     subtype: "Bank",              purpose: "Payments" },
  { code: "CL-001", name: "Accounts Payable",     type: "LIABILITY", subtype: "Current Liability", purpose: "Bills/AP" },
  { code: "CL-OUTPUT-VAT", name: "Output VAT Payable", type: "LIABILITY", subtype: "Current Liability", purpose: "VAT/Tax" },
];

async function main() {
  console.log("=== Chart of Accounts Baseline Audit ===\n");

  const tenants = await pool.query(
    "SELECT id, name FROM tenants WHERE status != 'ARCHIVED' ORDER BY name"
  );

  if (tenants.rows.length === 0) {
    console.log("No tenants found.");
    return;
  }

  for (const tenant of tenants.rows) {
    console.log(`\nTenant: ${tenant.name} (${tenant.id})`);
    console.log("─".repeat(70));

    // Fetch ALL accounts for this tenant (for inspection)
    const all = await pool.query(
      `SELECT code, name, type, subtype, is_active
       FROM chart_of_accounts
       WHERE tenant_id = $1
       ORDER BY code`,
      [tenant.id]
    );

    // Check required accounts
    for (const req of REQUIRED) {
      const match = all.rows.find((r) => r.code === req.code);
      if (!match) {
        console.log(`  ✗ MISSING  ${req.code.padEnd(16)} [${req.type}] — needed for ${req.purpose}`);
      } else if (!match.is_active) {
        console.log(`  ⚠ INACTIVE ${req.code.padEnd(16)} [${match.type}] name="${match.name}" — needed for ${req.purpose}`);
      } else if (match.type !== req.type) {
        console.log(`  ✗ WRONG TYPE ${req.code.padEnd(14)} found type=${match.type}, expected ${req.type}`);
      } else {
        console.log(`  ✓ OK       ${req.code.padEnd(16)} [${match.type}] "${match.name}"`);
      }
    }

    // Check for alternate VAT/tax payable codes (if CL-OUTPUT-VAT missing)
    const vatLike = all.rows.filter(
      (r) =>
        r.type === "LIABILITY" &&
        r.is_active &&
        (r.name.toLowerCase().includes("vat") ||
          r.name.toLowerCase().includes("tax payable") ||
          r.name.toLowerCase().includes("output tax"))
    );
    if (vatLike.length > 0) {
      const alts = vatLike.map((r) => `${r.code} "${r.name}"`).join(", ");
      console.log(`  ℹ Alternate VAT-like accounts: ${alts}`);
    }

    // All active INCOME accounts
    const incomeAccts = all.rows.filter((r) => r.type === "INCOME" && r.is_active);
    if (incomeAccts.length === 0) {
      console.log(`  ✗ No active INCOME accounts — invoice lines cannot resolve income account`);
    } else {
      console.log(`  ℹ Active INCOME accounts (${incomeAccts.length}): ${incomeAccts.map((r) => r.code).join(", ")}`);
    }

    // Invoice lines NULL count for this tenant
    const nullLines = await pool.query(
      `SELECT COUNT(*) AS n FROM invoice_lines il
       JOIN invoices inv ON inv.id = il.invoice_id
       WHERE inv.tenant_id = $1 AND il.income_account_id IS NULL`,
      [tenant.id]
    );
    const totalLines = await pool.query(
      `SELECT COUNT(*) AS n FROM invoice_lines il
       JOIN invoices inv ON inv.id = il.invoice_id
       WHERE inv.tenant_id = $1`,
      [tenant.id]
    );
    console.log(`  ℹ Invoice lines: ${totalLines.rows[0].n} total, ${nullLines.rows[0].n} with NULL income_account_id`);

    // Posting codes referenced in app but not in COA
    const postingCodes = ["CA-001", "IN-001", "CA-003", "CL-001"];
    const missing = [];
    for (const code of postingCodes) {
      const exists = all.rows.find((r) => r.code === code && r.is_active);
      if (!exists) missing.push(code);
    }
    if (missing.length > 0) {
      console.log(`  ✗ Hardcoded posting codes NOT found active: ${missing.join(", ")}`);
    }
  }

  console.log("\n=== Audit complete ===\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => pool.end());
