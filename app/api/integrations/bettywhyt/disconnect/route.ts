/**
 * DELETE /api/integrations/bettywhyt/disconnect
 * Marks the BettyWhyt connection as DISCONNECTED and clears the API key.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBettywhytOrg } from "@/lib/integrations/bettywhyt/guard";

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = session.user.organizationId;

  if (!isBettywhytOrg(orgId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.integrationConnection.updateMany({
    where: { organizationId: orgId, sourceApp: "bettywhyt" },
    data:  {
      status:           "DISCONNECTED",
      apiKeyEncrypted:  null,
      syncEnabled:      false,
      lastError:        null,
    },
  });

  return NextResponse.json({ ok: true });
}
