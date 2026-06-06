"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function saveBrandingPrefs({
  keepBranding,
  recommendApp,
}: {
  keepBranding: boolean;
  recommendApp: boolean;
}) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) throw new Error("Unauthorized");

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { keepBranding, recommendApp },
  });

  revalidatePath("/settings/organization/branding");
}
