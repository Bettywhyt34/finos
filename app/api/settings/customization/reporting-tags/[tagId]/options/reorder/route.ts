import { NextRequest, NextResponse }         from "next/server";
import { z }                                from "zod";
import { requireMutationRole }              from "@/lib/auth/guards";
import { reorderReportingTagOptions }       from "@/lib/customization/reporting-tags-service";

const ReorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

type RouteCtx = { params: Promise<{ tagId: string }> };

// POST /api/settings/customization/reporting-tags/[tagId]/options/reorder
export async function POST(req: NextRequest, props: RouteCtx) {
  const params = await props.params;
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  try {
    await reorderReportingTagOptions(ctx.tenantId, params.tagId, parsed.data.orderedIds);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
