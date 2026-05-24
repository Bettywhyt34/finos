import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getQuarantineRecords, retryQuarantine, resolveQuarantine } from "@/lib/integrations/sync-engine";
import { z } from "zod";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action:       z.literal("retry"),
    sourceApp:    z.string(),
    quarantineIds: z.array(z.string()).min(1),
  }),
  z.object({
    action:        z.literal("resolve"),
    quarantineIds: z.array(z.string()).min(1),
  }),
]);

export async function GET(req: Request) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sourceApp = searchParams.get("sourceApp") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await getQuarantineRecords(tenantId, sourceApp as any, page);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  if (parsed.data.action === "retry") {
    await retryQuarantine(
      tenantId,
      parsed.data.sourceApp as Parameters<typeof retryQuarantine>[1],
      parsed.data.quarantineIds,
      session.user?.id ?? "system"
    );
    return NextResponse.json({ ok: true, action: "retry" });
  }

  await resolveQuarantine(tenantId, parsed.data.quarantineIds);
  return NextResponse.json({ ok: true, action: "resolve" });
}
