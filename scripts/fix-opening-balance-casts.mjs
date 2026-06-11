import { readFileSync, writeFileSync } from "fs";

const path = "lib/setup-configurations/service.ts";
let src = readFileSync(path, "utf8");

// Remove the eslint-disable-next-line comments that precede the any casts
src = src.replace(/[ \t]*\/\/ eslint-disable-next-line @typescript-eslint\/no-explicit-any\r?\n/g, "");

// Replace all (prisma as any).openingBalanceBatch / openingBalanceLine
src = src.replace(/\(prisma as any\)\.(openingBalance(?:Batch|Line))/g, "prisma.$1");

writeFileSync(path, src, "utf8");

const remaining = (src.match(/\(prisma as any\)/g) ?? []).length;
const eslintRemaining = (src.match(/eslint-disable-next-line @typescript-eslint\/no-explicit-any/g) ?? []).length;
console.log(`Done. Remaining (prisma as any): ${remaining}, eslint-disable comments: ${eslintRemaining}`);
