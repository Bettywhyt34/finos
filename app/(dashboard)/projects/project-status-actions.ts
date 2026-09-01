"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: ["ACTIVE"],
  CANCELLED: ["ACTIVE"],
};

export async function changeProjectStatus(input: {
  projectId: string;
  status: string;
  reason?: string;
}): Promise<{ success: true } | { error: string }> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userId = session?.user?.id;
  const role = session?.user?.role;
  if (!tenantId || !userId) return { error: "Your session has expired. Please sign in again." };
  if (!role || !["OWNER", "ADMIN", "ACCOUNTANT"].includes(role)) {
    return { error: "You do not have permission to change Project status." };
  }

  const requested = input.status.trim().toUpperCase();
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 1000) return { error: "Status-change reason is too long." };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`finos:project-status:${tenantId}:${input.projectId}`}))`;
      const project = await tx.project.findFirst({
        where: { id: input.projectId, tenantId },
        select: { id: true, name: true, status: true },
      });
      if (!project) throw new Error("Project not found.");
      const current = String(project.status);
      if (requested === current) return;
      if (!(TRANSITIONS[current] ?? []).includes(requested)) {
        throw new Error(`Project status cannot move directly from ${current.replaceAll("_", " ").toLowerCase()} to ${requested.replaceAll("_", " ").toLowerCase()}.`);
      }

      await tx.$executeRaw`
        UPDATE "projects"
        SET "status" = ${requested}::"ProjectStatus", "updated_at" = now()
        WHERE "id" = ${project.id} AND "tenant_id" = ${tenantId}::uuid
      `;

      await tx.$executeRaw`
        INSERT INTO "project_activities" (
          "tenant_id", "project_id", "event_type", "title", "description", "actor_id", "actor_name", "metadata"
        ) VALUES (
          ${tenantId}::uuid, ${project.id}, 'STATUS_CHANGED', 'Project status changed',
          ${reason ?? `Status changed from ${current} to ${requested}.`},
          ${userId}, ${session.user.email ?? null},
          CAST(${JSON.stringify({ from: current, to: requested, reason })} AS jsonb)
        )
      `;
    });

    revalidatePath(`/projects/${input.projectId}`);
    revalidatePath("/projects");
    return { success: true };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Project status could not be changed." };
  }
}
