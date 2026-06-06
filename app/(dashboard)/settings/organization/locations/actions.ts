"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const PATH = "/settings/organization/locations";

async function getSession() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) throw new Error("Unauthorized");
  return tenantId;
}

// ─── Enable locations ─────────────────────────────────────────────────────────

export async function enableLocations() {
  const tenantId = await getSession();
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { locationsEnabled: true },
  });
  revalidatePath(PATH);
}

// ─── Location CRUD ────────────────────────────────────────────────────────────

const locationSchema = z.object({
  name:     z.string().min(1, "Location name is required"),
  type:     z.enum(["BUSINESS_LOCATION", "WAREHOUSE", "BRANCH"]),
  parentId: z.string().nullable().optional(),
  address:  z.string().optional(),
  city:     z.string().min(1, "City is required"),
  state:    z.string().optional(),
  country:  z.string().min(1, "Country is required"),
});

export type LocationInput = z.infer<typeof locationSchema>;

export async function addLocation(data: LocationInput) {
  const tenantId = await getSession();
  const d = locationSchema.parse(data);

  const dupe = await prisma.location.findFirst({
    where: { tenantId, name: { equals: d.name, mode: "insensitive" } },
  });
  if (dupe) throw new Error("A location with this name already exists.");

  await prisma.location.create({
    data: {
      tenantId,
      name:     d.name,
      type:     d.type,
      parentId: d.parentId || null,
      address:  d.address  || null,
      city:     d.city,
      state:    d.state    || null,
      country:  d.country,
    },
  });
  revalidatePath(PATH);
}

export async function updateLocation(id: string, data: LocationInput) {
  const tenantId = await getSession();

  const existing = await prisma.location.findFirst({ where: { id, tenantId } });
  if (!existing) throw new Error("Location not found.");

  const d = locationSchema.parse(data);

  const dupe = await prisma.location.findFirst({
    where: { tenantId, name: { equals: d.name, mode: "insensitive" }, NOT: { id } },
  });
  if (dupe) throw new Error("A location with this name already exists.");

  await prisma.location.update({
    where: { id },
    data: {
      name:     d.name,
      type:     d.type,
      parentId: d.parentId || null,
      address:  d.address  || null,
      city:     d.city,
      state:    d.state    || null,
      country:  d.country,
    },
  });
  revalidatePath(PATH);
}

export async function toggleLocationStatus(id: string) {
  const tenantId = await getSession();
  const loc = await prisma.location.findFirst({ where: { id, tenantId } });
  if (!loc) throw new Error("Location not found.");
  await prisma.location.update({
    where: { id },
    data: { status: loc.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
  });
  revalidatePath(PATH);
}

export async function deleteLocation(id: string) {
  const tenantId = await getSession();
  const loc = await prisma.location.findFirst({
    where: { id, tenantId },
    include: { children: { select: { id: true } } },
  });
  if (!loc) throw new Error("Location not found.");
  if (loc.children.length > 0) {
    throw new Error("Remove all sub-locations before deleting this location.");
  }
  await prisma.location.delete({ where: { id } });
  revalidatePath(PATH);
}
