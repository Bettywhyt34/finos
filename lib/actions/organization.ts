"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSlug } from "@/lib/utils";
import { z } from "zod";

const CreateOrgSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
});

export async function createOrganization(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in to create a workspace." };
  }

  const validated = CreateOrgSchema.safeParse({ name: formData.get("name") });
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const { name } = validated.data;

  try {
    let slug = generateSlug(name);

    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    await prisma.organization.create({
      data: {
        name,
        slug,
        memberships: {
          create: {
            userId: session.user.id,
            role:   "OWNER",
          },
        },
      },
    });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[createOrganization] error:", msg);
    return { error: `DB error: ${msg}` };
  }
}
