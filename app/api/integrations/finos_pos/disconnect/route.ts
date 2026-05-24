/**
 * POST /api/integrations/finos_pos/disconnect
 * Clears the FINOS POS connection for this tenant.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  await prisma.integrationConnection.updateMany({
    where: { tenantId, sourceApp: "finos_pos" },
    data: {
      status:          "DISCONNECTED",
      apiKeyEncrypted: null,
      syncEnabled:     false,
      lastError:       null,
    },
  });

  return NextResponse.json({ ok: true });
}
