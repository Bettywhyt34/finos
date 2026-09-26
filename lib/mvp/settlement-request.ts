import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

/** A stable client request identifies a settlement, independently of its amount. */
export function settlementRequest(tenantId: string, key: string, payload: unknown) {
  if (!key || key.length > 150) throw new Error("A stable settlement request ID is required.");
  const digest = createHash("sha256").update(`${tenantId}:${key}`).digest("hex");
  const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { id, marker: `request:${fingerprint}` };
}

export async function checkSettlementRetry(tx: Prisma.TransactionClient, tenantId: string, source: string, request: {id: string; marker: string}) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:settlement:${tenantId}:${request.id}`}))`;
  const prior = await tx.journalEntry.findFirst({ where: { tenantId, source, sourceId: request.id }, select: { description: true } });
  if (!prior) return false;
  if (!prior.description.endsWith(request.marker)) throw new Error("This request was already used with different payment details. Refresh before recording a new payment.");
  return true;
}
