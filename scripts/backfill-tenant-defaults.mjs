/**
 * Backfill: seed missing system defaults for all tenants.
 *
 * Covers:
 *   - 7 system payment terms (including Net 30 as default)
 *   - 10 system reminder rules
 *
 * IDEMPOTENT — uses createMany({ skipDuplicates: true }) for every tenant.
 * The DB uniqueness constraints prevent duplicates; no counting/skipping logic
 * needed. Run this as many times as needed — tenants with complete records are
 * silently unchanged; tenants with partial records get the missing rows.
 *
 * Usage:
 *   node scripts/backfill-tenant-defaults.mjs
 *
 * Requires DATABASE_URL or DIRECT_URL in the environment (port 5432 session pooler).
 */

import { PrismaClient } from "@prisma/client";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });

let prisma;
try {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
} catch {
  prisma = new PrismaClient();
}

// ─── Default data ─────────────────────────────────────────────────────────────

const PAYMENT_TERMS = [
  { name: "Due on Receipt",        dueType: "DUE_ON_RECEIPT",  dueInDays: null, appliesTo: "BOTH", isDefault: false },
  { name: "Net 15",                dueType: "FIXED_DAYS",      dueInDays: 15,   appliesTo: "BOTH", isDefault: false },
  { name: "Net 30",                dueType: "FIXED_DAYS",      dueInDays: 30,   appliesTo: "BOTH", isDefault: true  },
  { name: "Net 60",                dueType: "FIXED_DAYS",      dueInDays: 60,   appliesTo: "BOTH", isDefault: false },
  { name: "Net 90",                dueType: "FIXED_DAYS",      dueInDays: 90,   appliesTo: "BOTH", isDefault: false },
  { name: "Due end of the month",  dueType: "END_OF_MONTH",    dueInDays: null, appliesTo: "BOTH", isDefault: false },
  { name: "Due end of next month", dueType: "END_OF_NEXT_MONTH", dueInDays: null, appliesTo: "BOTH", isDefault: false },
];

const REMINDER_RULES = [
  { entityType: "INVOICE", kind: "MANUAL",    name: "Reminder for Overdue Invoices", triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 0  },
  { entityType: "INVOICE", kind: "MANUAL",    name: "Reminder for Sent Invoices",    triggerBasis: "ISSUE_DATE",            direction: "AFTER",   offsetDays: 0  },
  { entityType: "INVOICE", kind: "AUTOMATED", name: "Payment Expected",              triggerBasis: "EXPECTED_PAYMENT_DATE", direction: "ON_DATE", offsetDays: 0  },
  { entityType: "INVOICE", kind: "AUTOMATED", name: "Reminder - 1",                  triggerBasis: "DUE_DATE",              direction: "ON_DATE", offsetDays: 0  },
  { entityType: "INVOICE", kind: "AUTOMATED", name: "Reminder - 2",                  triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 7  },
  { entityType: "INVOICE", kind: "AUTOMATED", name: "Reminder - 3",                  triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 14 },
  { entityType: "BILL",    kind: "MANUAL",    name: "Reminder for Upcoming Bills",   triggerBasis: "DUE_DATE",              direction: "BEFORE",  offsetDays: 0  },
  { entityType: "BILL",    kind: "MANUAL",    name: "Reminder for Overdue Bills",    triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 0  },
  { entityType: "BILL",    kind: "AUTOMATED", name: "Bill Due Reminder",             triggerBasis: "DUE_DATE",              direction: "BEFORE",  offsetDays: 3  },
  { entityType: "BILL",    kind: "AUTOMATED", name: "Overdue Bill Reminder",         triggerBasis: "DUE_DATE",              direction: "AFTER",   offsetDays: 1  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Backfill: tenant defaults (payment terms + reminder rules) ===\n");

  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  console.log(`Tenants found: ${tenants.length}\n`);

  let totalPtCreated  = 0;
  let totalPtSkipped  = 0;
  let totalRrCreated  = 0;
  let totalRrSkipped  = 0;

  for (const tenant of tenants) {
    // ── Payment terms ────────────────────────────────────────────────────────
    const ptResult = await prisma.paymentTerm.createMany({
      skipDuplicates: true,
      data: PAYMENT_TERMS.map((t) => ({
        tenantId:  tenant.id,
        name:      t.name,
        dueType:   t.dueType,
        dueInDays: t.dueInDays,
        appliesTo: t.appliesTo,
        isDefault: t.isDefault,
        isSystem:  true,
        isActive:  true,
      })),
    });

    const ptCreated = ptResult.count;
    const ptSkipped = PAYMENT_TERMS.length - ptCreated;
    totalPtCreated += ptCreated;
    totalPtSkipped += ptSkipped;

    // ── Reminder rules ───────────────────────────────────────────────────────
    const rrResult = await prisma.reminderRule.createMany({
      skipDuplicates: true,
      data: REMINDER_RULES.map((r) => ({
        tenantId:     tenant.id,
        entityType:   r.entityType,
        kind:         r.kind,
        name:         r.name,
        triggerBasis: r.triggerBasis,
        direction:    r.direction,
        offsetDays:   r.offsetDays,
        isSystem:     true,
        isActive:     false,
      })),
    });

    const rrCreated = rrResult.count;
    const rrSkipped = REMINDER_RULES.length - rrCreated;
    totalRrCreated += rrCreated;
    totalRrSkipped += rrSkipped;

    // ── Per-tenant summary ───────────────────────────────────────────────────
    const ptStatus = ptCreated === 0 ? "already complete" : `${ptCreated} created`;
    const rrStatus = rrCreated === 0 ? "already complete" : `${rrCreated} created`;
    console.log(`  ${tenant.name} (${tenant.id.slice(0, 8)}…)`);
    console.log(`    payment terms  : ${ptStatus}${ptSkipped > 0 ? `, ${ptSkipped} skipped` : ""}`);
    console.log(`    reminder rules : ${rrStatus}${rrSkipped > 0 ? `, ${rrSkipped} skipped` : ""}`);
  }

  console.log("\n=== Summary ===");
  console.log(`Tenants processed       : ${tenants.length}`);
  console.log(`Payment terms  created  : ${totalPtCreated}`);
  console.log(`Payment terms  skipped  : ${totalPtSkipped}`);
  console.log(`Reminder rules created  : ${totalRrCreated}`);
  console.log(`Reminder rules skipped  : ${totalRrSkipped}`);
  console.log("\nBackfill complete.\n");
}

main()
  .catch((err) => {
    console.error("\nBackfill FAILED:", err.message ?? err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
