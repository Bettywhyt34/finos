import { defineConfig } from "prisma/config";
import { config as loadDotenv } from "dotenv";
import path from "path";

// Prisma CLI reads .env by default — explicitly load .env.local so CLI commands
// (migrate dev, db push, etc.) can resolve DATABASE_URL / DIRECT_URL.
loadDotenv({ path: path.resolve(process.cwd(), ".env.local") });

/**
 * Prisma 7 configuration.
 *
 * datasource.url  → used by CLI commands (migrate dev, db push, introspect)
 *                   Use DIRECT_URL (session/direct pooler, port 5432) — not the
 *                   transaction pooler — because pgBouncer cannot run DDL.
 *
 * Runtime queries use lib/prisma.ts which instantiates PrismaClient with
 * @prisma/adapter-pg pointing at DATABASE_URL (transaction pooler, port 6543).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
  migrations: {
    path: "prisma/migrations",
  },
});
