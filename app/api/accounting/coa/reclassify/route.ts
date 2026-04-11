import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FinancialCategory } from "@prisma/client";
import { z } from "zod";

const schema = z.object({
  accountId:         z.string().uuid(),
  financialCategory: z.nativeEnum(FinancialCategory),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { accountId, financialCategory } = parsed.data;

  // Verify tenant owns this account (explicit check + Prisma where guard)
  const existing = await prisma.chartOfAccounts.findFirst({
    where: { id: accountId, tenantId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const updated = await prisma.chartOfAccounts.update({
    where: { id: accountId, tenantId },
    data: {
      financialCategory,
      migrationStatus: "tenant_confirmed",
    },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      financialCategory: true,
      migrationStatus: true,
    },
  });

  return NextResponse.json({ account: updated });
}
