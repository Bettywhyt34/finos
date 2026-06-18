import { NextRequest, NextResponse }          from "next/server";
import { z }                                 from "zod";
import { requireAuth, requireMutationRole }  from "@/lib/auth/guards";
import {
  getWebTabs,
  createWebTab,
  validateWebTabUrl,
  ALL_TAB_TYPES,
  ALL_PLACEMENTS,
} from "@/lib/customization/web-tabs-service";
import type { WebTabType, WebTabPlacement } from "@prisma/client";

const CreateSchema = z.object({
  name:            z.string().min(1, "Tab name is required.").max(100),
  description:     z.string().max(300).optional(),
  type:            z.enum(ALL_TAB_TYPES as [WebTabType, ...WebTabType[]]),
  url:             z.string().min(1, "URL or route is required."),
  placement:       z.enum(ALL_PLACEMENTS as [WebTabPlacement, ...WebTabPlacement[]]).optional(),
  icon:            z.string().max(100).optional(),
  sortOrder:       z.number().int().min(0).optional(),
  visibleToRoles:  z.array(z.string()).optional(),
  isActive:        z.boolean().optional(),
});

// GET /api/settings/customization/web-tabs?activeOnly=true
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;

  const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "true";

  try {
    const rows = await getWebTabs(ctx.tenantId, activeOnly);
    return NextResponse.json({ data: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/settings/customization/web-tabs
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  // Extra URL validation
  const urlError = validateWebTabUrl(parsed.data.url, parsed.data.type);
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 422 });
  }

  try {
    const row = await createWebTab(ctx.tenantId, parsed.data);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
