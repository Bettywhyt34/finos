import { NextRequest, NextResponse }           from "next/server";
import { z }                                   from "zod";
import { requireAuth, requireMutationRole }    from "@/lib/auth/guards";
import {
  getReportingTags,
  createReportingTag,
  ALL_SCOPES,
} from "@/lib/customization/reporting-tags-service";
import type { ReportingTagEntityScope } from "@prisma/client";

const CreateSchema = z.object({
  name:        z.string().min(1, "Tag name is required.").max(100),
  description: z.string().max(300).optional(),
  color:       z.string().max(20).optional(),
  isActive:    z.boolean().optional(),
  appliesTo:   z.array(z.enum(ALL_SCOPES as [ReportingTagEntityScope, ...ReportingTagEntityScope[]])).optional(),
});

// GET /api/settings/customization/reporting-tags?activeOnly=true
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;

  const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "true";

  try {
    const rows = await getReportingTags(ctx.tenantId, activeOnly);
    return NextResponse.json({ data: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/settings/customization/reporting-tags
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

  try {
    const row = await createReportingTag(ctx.tenantId, parsed.data);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
