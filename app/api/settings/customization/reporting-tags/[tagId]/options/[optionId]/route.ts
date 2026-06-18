import { NextRequest, NextResponse }          from "next/server";
import { z }                                 from "zod";
import { requireMutationRole }               from "@/lib/auth/guards";
import {
  updateReportingTagOption,
  deactivateReportingTagOption,
  deleteReportingTagOption,
} from "@/lib/customization/reporting-tags-service";

const UpdateOptionSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(300).optional(),
  color:       z.string().max(20).optional(),
  sortOrder:   z.number().int().optional(),
  isActive:    z.boolean().optional(),
});

type RouteCtx = { params: { tagId: string; optionId: string } };

// PATCH /api/settings/customization/reporting-tags/[tagId]/options/[optionId]
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateOptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  // Shortcut: isActive: false → deactivate
  if (parsed.data.isActive === false && Object.keys(parsed.data).length === 1) {
    try {
      const row = await deactivateReportingTagOption(ctx.tenantId, params.tagId, params.optionId);
      return NextResponse.json({ data: row });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: msg }, { status });
    }
  }

  try {
    const row = await updateReportingTagOption(ctx.tenantId, params.tagId, params.optionId, parsed.data);
    return NextResponse.json({ data: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/settings/customization/reporting-tags/[tagId]/options/[optionId]
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response!;

  try {
    await deleteReportingTagOption(ctx.tenantId, params.tagId, params.optionId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
