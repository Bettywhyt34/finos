import { NextRequest, NextResponse }           from "next/server";
import { z }                                   from "zod";
import { requireAuth, requireMutationRole }    from "@/lib/auth/guards";
import {
  getReportingTagById,
  updateReportingTag,
  deactivateReportingTag,
  deleteReportingTag,
  ALL_SCOPES,
} from "@/lib/customization/reporting-tags-service";
import type { ReportingTagEntityScope } from "@prisma/client";

const UpdateSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(300).optional(),
  color:       z.string().max(20).optional(),
  isActive:    z.boolean().optional(),
  appliesTo:   z.array(z.enum(ALL_SCOPES as [ReportingTagEntityScope, ...ReportingTagEntityScope[]])).optional(),
});

type RouteCtx = { params: Promise<{ tagId: string }> };

// GET /api/settings/customization/reporting-tags/[tagId]
export async function GET(_req: NextRequest, props: RouteCtx) {
  const params = await props.params;
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;

  try {
    const row = await getReportingTagById(ctx.tenantId, params.tagId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/settings/customization/reporting-tags/[tagId]
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
      const row = await deactivateReportingTag(ctx.tenantId, params.tagId);
      return NextResponse.json({ data: row });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: msg }, { status });
    }
  }

  try {
    const row = await updateReportingTag(ctx.tenantId, params.tagId, parsed.data);
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/settings/customization/reporting-tags/[tagId]
export async function DELETE(_req: NextRequest, props: RouteCtx) {
  const params = await props.params;
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response!;

  try {
    await deleteReportingTag(ctx.tenantId, params.tagId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
