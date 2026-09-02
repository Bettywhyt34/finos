"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function updateProjectPaymentTerms(input: { projectId: string; paymentTermsDays: number | null }) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) return { error: "You do not have permission to change Project payment terms." };

  const days = input.paymentTermsDays;
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) {
    return { error: "Project payment terms must be between 0 and 3650 days." };
  }

  const project = await prisma.project.findFirst({ where: { id: input.projectId, tenantId }, select: { id: true, name: true } });
  if (!project) return { error: "Project not found." };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "projects"
      SET "payment_terms_days"=${days}, "updated_at"=now()
      WHERE "id"=${project.id} AND "tenant_id"=${tenantId}::uuid
    `;
    await tx.$executeRaw`
      INSERT INTO "project_activities" (
        "tenant_id","project_id","event_type","title","description","actor_id","actor_name","metadata"
      ) VALUES (
        ${tenantId}::uuid,${project.id},'PAYMENT_TERMS_UPDATED','Invoice payment terms updated',
        ${days === null ? "Project payment terms override cleared; invoices will inherit customer / organisation terms." : `Project invoice payment terms set to ${days} day${days === 1 ? "" : "s"}.`},
        ${userId},${session.user.email ?? null},
        CAST(${JSON.stringify({ paymentTermsDays: days })} AS jsonb)
      )
    `;
  });

  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}?tab=overview`);
  return { success: true };
}
