/**
 * GET  /api/settings/taxes  — list active tax rates
 * POST /api/settings/taxes  — create a tax rate
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  name:      z.string().min(1).max(100),
  type:      z.enum(["VAT", "WHT", "PAYE", "CUSTOM"]),
  rate:      z.number().min(0).max(100),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rates = await prisma.taxRate.findMany({
    where:   { tenantId: session.user.tenantId, isActive: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(rates);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, type, rate, isDefault } = parsed.data;

  // If marking as default, clear existing defaults for this type
  if (isDefault) {
    await prisma.taxRate.updateMany({
      where: { tenantId, type, isDefault: true },
      data:  { isDefault: false },
    });
  }

  const taxRate = await prisma.taxRate.create({
    data: { tenantId, name, type, rate, isDefault: isDefault ?? false },
  });

  return NextResponse.json(taxRate, { status: 201 });
}
