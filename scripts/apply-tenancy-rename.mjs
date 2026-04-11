#!/usr/bin/env node
/**
 * Phase 2.5 Week 1 — Tenancy rename script
 * Renames org→tenant identifiers across app/, lib/, types/, components/
 *
 * Usage:
 *   node scripts/apply-tenancy-rename.mjs --dry-run   # preview only
 *   node scripts/apply-tenancy-rename.mjs             # apply changes
 *
 * SKIPS: prisma/schema.prisma, lib/auth-config.ts, lib/auth-edge.ts,
 *        middleware.ts, types/next-auth.d.ts  (handled manually)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const DRY_RUN = process.argv.includes("--dry-run");

// ── Ordered replacements (longest-match first) ────────────────────────────────
// Prevent partial overlaps: e.g. OrganizationMembership before Organization.
const REPLACEMENTS = [
  // Prisma accessor — must come before organizationId to avoid partial match
  [/prisma\.organization\b/g, "prisma.tenant"],

  // Full type / model names
  [/OrganizationMembership/g, "TenantMembership"],
  [/organizationMembership/g, "tenantMembership"],

  // Field names
  [/organizationId/g,   "tenantId"],
  [/organizationName/g, "tenantName"],
];

// ── Files/dirs to process ─────────────────────────────────────────────────────
const TARGET_DIRS = ["app", "lib", "types", "components"];

// ── Files to skip (manually edited) ──────────────────────────────────────────
const SKIP_FILES = new Set([
  "prisma/schema.prisma",
  "lib/auth-config.ts",
  "lib/auth-edge.ts",
  "middleware.ts",
  "types/next-auth.d.ts",
]);

const TARGET_EXTS = new Set([".ts", ".tsx"]);

// ── Resolve project root (one level up from scripts/) ────────────────────────
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function collectFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      results.push(...collectFiles(full));
    } else if (TARGET_EXTS.has(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

let totalFiles = 0;
let changedFiles = 0;
let totalReplacements = 0;

for (const dir of TARGET_DIRS) {
  const absDir = join(ROOT, dir);
  const files = collectFiles(absDir);

  for (const file of files) {
    // Normalize to relative path for skip-list check
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) continue;

    totalFiles++;
    const original = readFileSync(file, "utf8");
    let updated = original;
    let fileReplacements = 0;

    for (const [pattern, replacement] of REPLACEMENTS) {
      const before = updated;
      updated = updated.replace(pattern, replacement);
      if (updated !== before) {
        // Count occurrences replaced
        const matches = before.match(pattern);
        fileReplacements += matches ? matches.length : 0;
      }
    }

    if (updated !== original) {
      changedFiles++;
      totalReplacements += fileReplacements;
      console.log(`${DRY_RUN ? "[DRY] " : ""}${rel} — ${fileReplacements} replacement(s)`);
      if (!DRY_RUN) {
        writeFileSync(file, updated, "utf8");
      }
    }
  }
}

console.log("\n─────────────────────────────────────────");
console.log(`Scanned : ${totalFiles} files`);
console.log(`Changed : ${changedFiles} files`);
console.log(`Replaced: ${totalReplacements} occurrences`);
if (DRY_RUN) {
  console.log("\nDRY RUN complete — no files written.");
  console.log("Re-run without --dry-run to apply changes.");
}
