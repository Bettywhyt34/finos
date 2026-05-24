/**
 * PATCH /api/settings/integrations/[sourceApp]/gl-mapping
 * Body: { defaultRevenueAccount?, defaultExpenseAccount?, defaultBankAccount? }
 *
 * Merges the supplied GL mapping fields into tenant_integrations.gl_mapping.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { upsertTenantIntegration, getGLMapping } from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  defaultRevenueAccount: z.string().optional(),
  defaultExpenseAccount: z.string().optional(),
  defaultBankAccount:    z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { sourceApp: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const { sourceApp } = params;

  // Verify integration exists
  const entry = await prisma.integrationRegistry.findUnique({ where: { sourceApp } });
  if (!entry) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Merge with existing mapping
  const existing = (await getGLMapping(tenantId, sourceApp)) ?? {};
  const merged = { ...existing, ...parsed.data };

  await upsertTenantIntegration(tenantId, sourceApp, { glMapping: merged });

  return NextResponse.json({ ok: true, glMapping: merged });
}
