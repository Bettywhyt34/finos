"use server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBrainData } from "@/lib/mvp/brain-data";
import { revalidatePath } from "next/cache";

export async function recordBrainDecision(form: FormData) {
  const session = await auth();
  const tenantId = session?.user.tenantId;
  if (!tenantId || tenantId !== form.get("tenantId") || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(session?.user.role ?? "")) throw new Error("Permission denied or entity changed");
  const decision = String(form.get("decision"));
  if (!["accepted", "deferred", "rejected"].includes(decision)) throw new Error("Invalid decision");
  const delay = Number(form.get("delay") ?? 0);
  const snapshot = await getBrainData(tenantId, delay);
  const record = JSON.stringify({ id: crypto.randomUUID(), at: new Date().toISOString(), actor: session.user.id, decision, note: String(form.get("note") ?? "").slice(0,2000), snapshot });
  // Append under one namespaced key, preserving all existing tenant metadata and decisions.
  await prisma.$executeRaw`UPDATE tenants SET additional_fields = jsonb_set(COALESCE(additional_fields, '{}'::jsonb), '{finosBrainDecisions}', COALESCE(additional_fields->'finosBrainDecisions','[]'::jsonb) || ${record}::jsonb) WHERE id = ${tenantId}::uuid`;
  revalidatePath("/financial-brain");
}
