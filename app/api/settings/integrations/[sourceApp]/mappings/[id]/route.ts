import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: { sourceApp: string; id: string } }
) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mapping = await prisma.accountMapping.findFirst({
    where: { id: params.id, tenantId, sourceApp: params.sourceApp },
  });
  if (!mapping) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Soft-delete (isActive = false) rather than hard-delete to preserve audit trail
  await prisma.accountMapping.update({
    where: { id: params.id },
    data:  { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
