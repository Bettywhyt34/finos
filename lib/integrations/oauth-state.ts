import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import type { SourceApp } from "./oauth-config";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Generate a cryptographically random state string and persist it. */
export async function createOAuthState(
  organizationId: string,
  userId:         string,
  sourceApp:      SourceApp,
): Promise<string> {
  const state     = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await prisma.oAuthState.create({
    data: { state, organizationId, userId, sourceApp, expiresAt },
  });

  return state;
}

export interface ConsumedState {
  organizationId: string;
  userId:         string;
  sourceApp:      SourceApp;
}

/**
 * Validate and atomically delete the state row.
 * Throws if the state is unknown, expired, or mismatched.
 */
export async function consumeOAuthState(
  state:     string,
  sourceApp: SourceApp,
): Promise<ConsumedState> {
  const row = await prisma.oAuthState.findUnique({ where: { state } });

  if (!row)                             throw new Error("Unknown OAuth state");
  if (row.expiresAt < new Date())       throw new Error("OAuth state expired");
  if (row.sourceApp !== sourceApp)      throw new Error("OAuth state app mismatch");

  // Delete on first use (consume)
  await prisma.oAuthState.delete({ where: { state } });

  return {
    organizationId: row.organizationId,
    userId:         row.userId,
    sourceApp:      row.sourceApp as SourceApp,
  };
}

/** Purge all expired state rows (call from a cron or on-demand). */
export async function purgeExpiredOAuthStates(): Promise<number> {
  const { count } = await prisma.oAuthState.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
