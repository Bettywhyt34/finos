"use server";

import { auth }                  from "@/lib/auth";
import { prisma }                from "@/lib/prisma";
import { generateSlug }          from "@/lib/utils";
import { z }                     from "zod";
import { seedTenantDefaults }    from "@/lib/setup-configurations/defaults";

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

  // Slug uniqueness check is intentionally outside the transaction — it is a
  // non-critical read that avoids a predictable conflict inside the transaction.
  // If two requests race with the same slug the DB unique constraint catches it
  // and the transaction rolls back with a clear error.
  let slug = generateSlug(name);
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  try {
    // Run tenant creation, OWNER membership, and all defaults inside a single
    // transaction.  If any step fails the entire operation rolls back — the
    // user never ends up with an orphaned tenant row that has no defaults.
    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
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

      // Seed payment terms + reminder rules inside the same transaction.
      await seedTenantDefaults(tenant.id, tx);
    });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[createOrganization] error:", msg);
    return { error: `Failed to create workspace: ${msg}` };
  }
}
