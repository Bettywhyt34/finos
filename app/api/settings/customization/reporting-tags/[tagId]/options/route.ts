import { NextRequest, NextResponse }        from "next/server";
import { z }                               from "zod";
import { requireMutationRole }             from "@/lib/auth/guards";
import { createReportingTagOption }        from "@/lib/customization/reporting-tags-service";

const CreateOptionSchema = z.object({
  name:        z.string().min(1, "Option name is required.").max(100),
  description: z.string().max(300).optional(),
  color:       z.string().max(20).optional(),
  sortOrder:   z.number().int().optional(),
  isActive:    z.boolean().optional(),
});

type RouteCtx = { params: { tagId: string } };

// POST /api/settings/customization/reporting-tags/[tagId]/options
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateOptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  try {
    const row = await createReportingTagOption(ctx.tenantId, params.tagId, parsed.data);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
