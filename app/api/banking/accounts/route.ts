import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  const orgId = session?.user?.tenantId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await prisma.bankAccount.findMany({
    where: { tenantId: orgId, isActive: true },
    select: { id: true, accountName: true, bankName: true, currency: true, currentBalance: true },
    orderBy: { accountName: "asc" },
  });

  return NextResponse.json({
    accounts: accounts.map((a) => ({
      ...a,
      currentBalance: parseFloat(String(a.currentBalance)),
    })),
  });
}
