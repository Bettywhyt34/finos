import { NextRequest, NextResponse }             from "next/server";
import { z }                                    from "zod";
import { requireMutationRole }                  from "@/lib/auth/guards";
import { updateTransactionNumberSeries }        from "@/lib/customization/service";

const PatchSchema = z.object({
  prefix:               z.string().max(20).optional(),
  suffix:               z.string().max(20).optional(),
  nextNumber:           z.number().int().min(1).optional(),
  padLength:            z.number().int().min(1).max(10).optional(),
  restartFreq:          z.enum(["NEVER", "MONTHLY", "YEARLY"]).optional(),
  isEnabled:            z.boolean().optional(),
  allowManualOverride:  z.boolean().optional(),
  preventDuplicates:    z.boolean().optional(),
});

// PATCH /api/settings/customization/transaction-number-series/[seriesId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { seriesId: string } },
) {
  const { ctx, response } = await requireMutationRole(["OWNER", "ADMIN"]);
  if (!ctx) return response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 422 },
    );
  }

  try {
    const updated = await updateTransactionNumberSeries(
      ctx.tenantId,
      params.seriesId,
      parsed.data,
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Series not found." ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
