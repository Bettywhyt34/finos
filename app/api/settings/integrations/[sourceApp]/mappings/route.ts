import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const CreateSchema = z.object({
  sourceAccountCode: z.string().min(1),
  sourceAccountName: z.string().optional(),
  finosAccountId:    z.string().min(1),
  notes:             z.string().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: { sourceApp: string } }
) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mappings = await prisma.accountMapping.findMany({
    where: { tenantId, sourceApp: params.sourceApp, isActive: true },
    include: { finosAccount: { select: { code: true, name: true } } },
    orderBy: { sourceAccountCode: "asc" },
  });

  return NextResponse.json(mappings);
}

export async function POST(
  req: Request,
  { params }: { params: { sourceApp: string } }
) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // Verify finosAccountId belongs to this tenant
  const account = await prisma.chartOfAccounts.findFirst({
    where: { id: parsed.data.finosAccountId, tenantId },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const mapping = await prisma.accountMapping.upsert({
    where: {
      tenantId_sourceApp_sourceAccountCode: {
        tenantId,
        sourceApp: params.sourceApp,
        sourceAccountCode: parsed.data.sourceAccountCode,
      },
    },
    create: {
      tenantId,
      sourceApp:         params.sourceApp,
      sourceAccountCode: parsed.data.sourceAccountCode,
      sourceAccountName: parsed.data.sourceAccountName,
      finosAccountId:    parsed.data.finosAccountId,
      notes:             parsed.data.notes,
    },
    update: {
      sourceAccountName: parsed.data.sourceAccountName,
      finosAccountId:    parsed.data.finosAccountId,
      notes:             parsed.data.notes,
      isActive:          true,
    },
    include: { finosAccount: { select: { code: true, name: true } } },
  });

  return NextResponse.json(mapping, { status: 201 });
}
