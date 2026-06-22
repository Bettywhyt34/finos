/**
 * Run the COA baseline migration + backfill.
 * Run: node scripts/run-coa-baseline.mjs
 */
import pg from "pg";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

config({ path: resolve(process.cwd(), ".env.local") });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const sqlPath = resolve(dirname(fileURLToPath(import.meta.url)), "migration-core-chart-of-accounts-baseline.sql");
const sql = readFileSync(sqlPath, "utf8");

async function main() {
  console.log("=== Running COA baseline migration ===\n");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Split on semicolons and run each non-empty statement
    // (keeps SELECT gate results visible)
    const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);

    for (const stmt of stmts) {
      // Skip pure comment blocks
      if (stmt.replace(/--[^\n]*/g, "").trim() === "") continue;

      const res = await client.query(stmt);
      if (res.command === "INSERT") {
        console.log(`  INSERT: ${res.rowCount} row(s)`);
      } else if (res.command === "UPDATE") {
        console.log(`  UPDATE: ${res.rowCount} row(s)`);
      } else if (res.command === "SELECT" && res.rows.length > 0) {
        console.log("\n  " + Object.keys(res.rows[0]).join(" | "));
        console.log("  " + "─".repeat(80));
        for (const row of res.rows) {
          console.log("  " + Object.values(row).map((v) => String(v ?? "NULL")).join(" | "));
        }
        console.log();
      }
    }

    await client.query("COMMIT");
    console.log("\n=== Migration committed successfully ===\n");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("\nERROR — rolled back:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
