/**
 * PATCH  /api/settings/taxes/[id]  — update tax rate
 * DELETE /api/settings/taxes/[id]  — deactivate tax rate
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  type:      z.enum(["VAT", "WHT", "PAYE", "CUSTOM"]).optional(),
  rate:      z.number().min(0).max(100).optional(),
  isDefault: z.boolean().optional(),
});

async function getTaxRate(id: string, tenantId: string) {
  return prisma.taxRate.findFirst({ where: { id, tenantId, isActive: true } });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userRole = (session.user as { role?: string }).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const taxRate = await getTaxRate(params.id, session.user.tenantId);
  if (!taxRate) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { isDefault, type, ...rest } = parsed.data;
  const effectiveType = type ?? taxRate.type;

  // Clear existing defaults for this type if marking as default
  if (isDefault) {
    await prisma.taxRate.updateMany({
      where: { tenantId: session.user.tenantId, type: effectiveType, isDefault: true },
      data:  { isDefault: false },
    });
  }

  const updated = await prisma.taxRate.update({
    where: { id: params.id },
    data:  { ...rest, ...(type ? { type } : {}), ...(isDefault !== undefined ? { isDefault } : {}) },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userRole = (session.user as { role?: string }).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const taxRate = await getTaxRate(params.id, session.user.tenantId);
  if (!taxRate) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.taxRate.update({
    where: { id: params.id },
    data:  { isActive: false, isDefault: false },
  });

  return NextResponse.json({ ok: true });
}
