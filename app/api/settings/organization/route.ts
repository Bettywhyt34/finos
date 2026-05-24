/**
 * PATCH /api/settings/organization
 * Updates the current tenant's profile fields.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name:            z.string().min(2).max(100).optional(),
  currency:        z.string().length(3).optional(),
  countryCode:     z.string().length(2).optional(),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
  timezone:        z.string().min(1).optional(),
  industryCode:    z.string().max(30).optional(),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const tenant = await prisma.tenant.update({
    where: { id: session.user.tenantId },
    data:  parsed.data,
    select: {
      id: true, name: true, currency: true, countryCode: true,
      fiscalYearStart: true, timezone: true, industryCode: true,
    },
  });

  return NextResponse.json(tenant);
}
