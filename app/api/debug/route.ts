import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  return NextResponse.json({
    sessionOrgId:    session?.user?.tenantId ?? null,
    sessionUserId:   session?.user?.id ?? null,
    envOrgId:        process.env.BETTYWHYT_ORG_ID ?? "(not set)",
    envOrgIdLength:  process.env.BETTYWHYT_ORG_ID?.length ?? 0,
    match:           session?.user?.tenantId?.trim() === process.env.BETTYWHYT_ORG_ID?.trim(),
  });
}
