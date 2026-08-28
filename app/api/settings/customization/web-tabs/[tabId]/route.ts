import { NextRequest, NextResponse }          from "next/server";
import { z }                                 from "zod";
import { requireAuth, requireMutationRole }  from "@/lib/auth/guards";
import {
  getWebTabById,
  updateWebTab,
  deactivateWebTab,
  deleteWebTab,
  validateWebTabUrl,
  ALL_TAB_TYPES,
  ALL_PLACEMENTS,
} from "@/lib/customization/web-tabs-service";
import type { WebTabType, WebTabPlacement } from "@prisma/client";

const UpdateSchema = z.object({
  name:            z.string().min(1).max(100).optional(),
  description:     z.string().max(300).optional(),
  type:            z.enum(ALL_TAB_TYPES as [WebTabType, ...WebTabType[]]).optional(),
  url:             z.string().min(1).optional(),
  placement:       z.enum(ALL_PLACEMENTS as [WebTabPlacement, ...WebTabPlacement[]]).optional(),
  icon:            z.string().max(100).optional(),
  sortOrder:       z.number().int().min(0).optional(),
  visibleToRoles:  z.array(z.string()).optional(),
  isActive:        z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ tabId: string }> };

// GET /api/settings/customization/web-tabs/[tabId]
export async function GET(_req: NextRequest, props: RouteCtx) {
  const params = await props.params;
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;

  try {
    const row = await getWebTabById(ctx.tenantId, params.tabId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/settings/customization/web-tabs/[tabId]
export async function PATCH(req: NextRequest, props: RouteCtx) {
  const params = await props.params;
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  // Shortcut: isActive: false → deactivate
  if (parsed.data.isActive === false && Object.keys(parsed.data).length === 1) {
    try {
      const row = await deactivateWebTab(ctx.tenantId, params.tabId);
      return NextResponse.json({ data: row });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: msg.includes("not found") ? 404 : 400 });
    }
  }

  // Extra URL validation if url or type changed
  if (parsed.data.url !== undefined || parsed.data.type !== undefined) {
    const current = await getWebTabById(ctx.tenantId, params.tabId);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const resolvedUrl  = parsed.data.url  ?? current.url;
    const resolvedType = parsed.data.type ?? current.type;
    const urlError = validateWebTabUrl(resolvedUrl, resolvedType);
    if (urlError) return NextResponse.json({ error: urlError }, { status: 422 });
  }

  try {
    const row = await updateWebTab(ctx.tenantId, params.tabId, parsed.data);
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/settings/customization/web-tabs/[tabId]
export async function DELETE(_req: NextRequest, props: RouteCtx) {
  const params = await props.params;
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response!;

  try {
    await deleteWebTab(ctx.tenantId, params.tabId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: msg.includes("not found") ? 404 : 400 });
  }
}
