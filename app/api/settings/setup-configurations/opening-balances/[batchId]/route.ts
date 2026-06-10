/**
 * PATCH  /api/settings/setup-configurations/opening-balances/[batchId]
 * DELETE /api/settings/setup-configurations/opening-balances/[batchId]
 *
 * PATCH:  updates migration date / notes on a DRAFT batch.
 * DELETE: deletes a DRAFT batch. Finalised batches are blocked.
 */
import { NextResponse }          from "next/server";
import { z }                     from "zod";
import { auth }                  from "@/lib/auth";
import {
  updateOpeningBalanceDraft,
  deleteOpeningBalanceDraft,
} from "@/lib/setup-configurations/service";

function canWrite(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const PatchSchema = z.object({
  migrationDate: z.string().optional(),
  notes:         z.string().max(2000).nullable().optional(),
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: { batchId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body   = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.migrationDate !== undefined) {
      const d = new Date(parsed.data.migrationDate);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid migration date." }, { status: 400 });
      }
    }

    const updated = await updateOpeningBalanceDraft(
      session.user.tenantId,
      params.batchId,
      {
        migrationDate: parsed.data.migrationDate,
        notes:         parsed.data.notes ?? undefined,
      },
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found"))          return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes("Only DRAFT"))         return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: { batchId: string } },
) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canWrite(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteOpeningBalanceDraft(session.user.tenantId, params.batchId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message.includes("not found"))          return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes("Finalised"))          return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
